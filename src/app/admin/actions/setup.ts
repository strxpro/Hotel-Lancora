'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { can } from '@/server/auth/guard';
import { hashPassword } from '@/server/auth/password';
import { issueSession } from '@/server/auth/login';
import { mutate, newId, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { clean } from '@/server/security';
import { isStarterEmail, OWNER_ID, setupState } from '@/server/setup';
import type { PanelPrefs } from '@/lib/types';

type Setup = NonNullable<PanelPrefs['setup']>;
const setSetup = (fn: (s: Setup) => void) =>
  mutate((db) => {
    const panel = (db.settings.panel ??= {});
    const s = (panel.setup ??= {});
    fn(s);
  });

export async function setupStateAction() {
  return act('assistant.use', (u) => setupState(readDb(), u.id));
}

const Account = z.object({ name: z.string().trim().min(2).max(60), email: z.email().max(120), password: z.string().min(10).max(200) });

/** Wizard step 1: the owner's own e-mail and password replace the starter login. */
export async function setupAccountAction(raw: unknown) {
  return act('settings.edit', async (u) => {
    const d = Account.parse(raw);
    const email = d.email.trim().toLowerCase();
    if (isStarterEmail(email)) throw new UserError('Scegli la tua e-mail personale, non quella di prova.');
    const db = readDb();
    if (db.users.some((x) => x.id !== u.id && x.email.toLowerCase() === email)) throw new UserError('Questa e-mail è già usata da un altro accesso (per esempio quello di assistenza): scegline un’altra.');
    const name = clean(d.name, 60);
    mutate((x) => {
      const me = x.users.find((k) => k.id === u.id);
      if (!me) throw new UserError('Utente non trovato.');
      me.email = email;
      me.name = name;
      me.passwordHash = hashPassword(d.password);
      const s = ((x.settings.panel ??= {}).setup ??= {});
      s.accountAt = new Date().toISOString();
      audit(x, name, 'setup_account', 'user', me.id, 'Accesso personale creato (e-mail e password nuove)');
    });
    // the session shows the new name at once (and stays valid with the new password)
    const me = readDb().users.find((k) => k.id === u.id);
    if (me) await issueSession(me);
    return { name };
  });
}

const Hotel = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(30),
  email: z.union([z.email(), z.literal('')]),
  addressLine: z.string().trim().max(120),
  postalCode: z.string().trim().max(10),
  city: z.string().trim().max(60),
});

/** Wizard step 2: the details guests see. */
export async function setupHotelAction(raw: unknown) {
  return act('settings.edit', (u) => {
    const d = Hotel.parse(raw);
    mutate((db) => {
      const h = db.settings.hotel;
      h.name = clean(d.name, 80);
      h.phone = clean(d.phone, 30);
      if (d.email) h.email = d.email.toLowerCase();
      if (d.addressLine) {
        h.addressLine = clean(d.addressLine, 120);
        h.addressVerified = true;
      }
      if (d.postalCode) h.postalCode = clean(d.postalCode, 10);
      if (d.city) h.city = clean(d.city, 60);
      const s = ((db.settings.panel ??= {}).setup ??= {});
      s.hotelAt = new Date().toISOString();
      audit(db, u.name, 'setup_hotel', 'settings', null, 'Dati dell’hotel confermati');
    });
  });
}

const Choice = z.enum(['payments_hotel', 'payments_stripe', 'telegram_skip', 'portals_skip', 'wizard_done', 'celebrated']);

/** "Not now", "cash only", end of the wizard, the welcome moment shown. */
export async function setupChoiceAction(choice: string) {
  return act('assistant.use', (u) => {
    const c = Choice.parse(choice);
    if (c.startsWith('payments') && !can(u.role, 'payments.manage')) throw new UserError('Solo l’amministratore può scegliere i pagamenti.');
    const now = new Date().toISOString();
    setSetup((s) => {
      if (c === 'payments_hotel') s.payments = 'hotel';
      if (c === 'payments_stripe') s.payments = 'stripe';
      if (c === 'telegram_skip') s.telegramSkipped = true;
      if (c === 'portals_skip') s.portalsSkipped = true;
      if (c === 'wizard_done') s.wizardDoneAt = now;
      if (c === 'celebrated') s.celebratedAt = now;
    });
    return setupState(readDb(), u.id);
  });
}

/* ------------------------------------------------------------------ */
/* logins: the owner, the reception, the technical assistance          */
/* ------------------------------------------------------------------ */

export async function usersOverviewAction() {
  return act('users.manage', (u) => {
    const db = readDb();
    const lastLogin = (id: string) => db.audit.find((a) => a.action === 'login' && a.entityId === id)?.at ?? null;
    return db.users.map((x) => ({ id: x.id, name: x.name, email: x.email, role: x.role, me: x.id === u.id, owner: x.id === OWNER_ID, starter: isStarterEmail(x.email), lastLogin: lastLogin(x.id), createdAt: x.createdAt, twoFactor: Boolean(x.twoFactor) }));
  });
}

const NewUser = z.object({ name: z.string().trim().min(2).max(60), email: z.email().max(120), role: z.enum(['admin', 'staff']), password: z.string().min(10).max(200) });

export async function addUserAction(raw: unknown) {
  return act('users.manage', (u) => {
    const d = NewUser.parse(raw);
    const email = d.email.trim().toLowerCase();
    mutate((db) => {
      if (db.users.some((x) => x.email.toLowerCase() === email)) throw new UserError('Questa e-mail ha già un accesso.');
      const id = newId('u-');
      db.users.push({ id, email, name: clean(d.name, 60), role: d.role, passwordHash: hashPassword(d.password), createdAt: new Date().toISOString() });
      audit(db, u.name, 'user_add', 'user', id, `Nuovo accesso ${d.role === 'admin' ? 'amministratore' : 'reception'}: ${email}`);
    });
  }, 'Accesso creato: può entrare subito con la sua e-mail e la password.');
}

/** Sets a new password for someone who lost theirs (told to them by phone or in person). */
export async function setUserPasswordAction(userId: string, password: string) {
  return act('users.manage', async (u) => {
    const pw = z.string().min(10, 'La password deve avere almeno 10 caratteri.').max(200).parse(password);
    mutate((db) => {
      const x = db.users.find((k) => k.id === userId);
      if (!x) throw new UserError('Accesso non trovato.');
      x.passwordHash = hashPassword(pw);
      audit(db, u.name, 'password_reset', 'user', x.id, `Nuova password impostata per ${x.email}`);
    });
    // your own new password: this browser stays logged in (the others are logged out)
    if (userId === u.id) {
      const me = readDb().users.find((k) => k.id === u.id);
      if (me) await issueSession(me);
    }
  }, 'Nuova password salvata: comunicala alla persona di persona o al telefono.');
}

/**
 * Someone lost or changed their phone: an administrator removes the code from their login, they
 * enter with the password alone and turn the code on again with the new phone.
 */
export async function resetUserTwoFactorAction(userId: string) {
  return act('users.manage', (u) => {
    if (userId === u.id) throw new UserError('Per il tuo accesso usa la scheda «Codice dal telefono» qui sotto.');
    mutate((db) => {
      const x = db.users.find((k) => k.id === userId);
      if (!x) throw new UserError('Accesso non trovato.');
      if (!x.twoFactor) throw new UserError('Questo accesso non usa il codice dal telefono.');
      delete x.twoFactor;
      audit(db, u.name, 'two_factor_reset', 'user', x.id, `Codice dal telefono tolto per ${x.email} (telefono perso o cambiato)`);
    });
  }, 'Fatto: può entrare con la sola password e riattivare il codice dal nuovo telefono.');
}

export async function removeUserAction(userId: string) {
  return act('users.manage', (u) => {
    if (userId === u.id) throw new UserError('Non puoi eliminare il tuo stesso accesso.');
    if (userId === OWNER_ID) throw new UserError('L’accesso del proprietario non si elimina.');
    mutate((db) => {
      const x = db.users.find((k) => k.id === userId);
      if (!x) throw new UserError('Accesso non trovato.');
      db.users = db.users.filter((k) => k.id !== userId);
      audit(db, u.name, 'user_remove', 'user', userId, `Accesso eliminato: ${x.email}`);
    });
  }, 'Accesso eliminato.');
}

/**
 * For the technical assistance, before handing the site over (or to show it again): the owner's
 * login goes back to the starter one and the set-up starts again at the next sign-in.
 */
export async function restartSetupAction() {
  return act('users.manage', (u) => {
    if (u.id === OWNER_ID) throw new UserError('Usa questa funzione dal tuo accesso di assistenza, non da quello del proprietario.');
    mutate((db) => {
      const owner = db.users.find((k) => k.id === OWNER_ID);
      if (!owner) throw new UserError('Accesso del proprietario non trovato.');
      if (db.users.some((k) => k.id !== OWNER_ID && k.email.toLowerCase() === 'admin@lancora.demo')) throw new UserError('L’e-mail di prova è già usata da un altro accesso.');
      owner.email = 'admin@lancora.demo';
      owner.name = 'Proprietario';
      owner.passwordHash = hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'Ancora-Demo-2026!');
      delete owner.twoFactor; // the starter login has no phone code: the owner turns it on with their own phone
      if (db.settings.panel) db.settings.panel.setup = {};
      audit(db, u.name, 'setup_restart', 'user', OWNER_ID, 'Configurazione iniziale da rifare: accesso di prova ripristinato');
    });
  }, 'Fatto: con l’accesso di prova parte di nuovo la configurazione guidata.');
}
