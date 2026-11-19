'use server';
import QRCode from 'qrcode';
import { act, UserError } from '@/server/action';
import { verifyPassword } from '@/server/auth/password';
import { issueSession } from '@/server/auth/login';
import { checkCode, groupKey, hashRecovery, newRecoveryCodes, newSecret, openNote, otpauthUri, sealNote, sealSecret } from '@/server/auth/totp';
import { mutate, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { rateLimit } from '@/server/security';

/**
 * "Codice dal telefono": the second step of the login, turned on by each person for their own
 * login from Impostazioni. Nothing secret is ever sent back to the browser except the new key
 * (once, inside the QR code, while setting up) and the emergency codes (once, right after).
 */

const me = (id: string) => {
  const u = readDb().users.find((x) => x.id === id);
  if (!u) throw new UserError('Accesso non trovato.');
  return u;
};

function checkPassword(id: string, password: unknown) {
  if (!rateLimit(`2fa-password:${id}`, 6, 15 * 60_000)) throw new UserError('Troppi tentativi. Riprova tra 15 minuti.');
  if (typeof password !== 'string' || !verifyPassword(password.slice(0, 200), me(id).passwordHash)) throw new UserError('Password non corretta.');
}

/** Step 1: a new key, as a QR code for the app (and written out, for typing it by hand). */
export async function twoFactorStartAction() {
  return act('assistant.use', async (u) => {
    const user = me(u.id);
    if (user.twoFactor) throw new UserError('Il codice dal telefono è già attivo.');
    const secret = newSecret();
    const qr = await QRCode.toDataURL(otpauthUri(secret, user.email), { errorCorrectionLevel: 'M', margin: 1, width: 280, color: { dark: '#10283dff', light: '#ffffffff' } });
    // the key travels sealed and bound to this login; it is stored only after a right code
    return { qr, key: groupKey(secret), account: user.email, token: sealNote({ uid: u.id, secret }, 20 * 60_000) };
  });
}

/** Step 2: the first code from the app proves it was set up right; then the code is on. */
export async function twoFactorConfirmAction(token: string, code: string) {
  return act('assistant.use', async (u) => {
    if (!rateLimit(`2fa-setup:${u.id}`, 10, 15 * 60_000)) throw new UserError('Troppi tentativi. Riprova tra 15 minuti.');
    const note = openNote<{ uid: string; secret: string }>(String(token ?? '').slice(0, 2000));
    if (!note || note.uid !== u.id) throw new UserError('È passato troppo tempo: chiudi e ricomincia (ci vuole un minuto).');
    const step = checkCode(note.secret, String(code ?? ''));
    if (step === null) throw new UserError('Codice non corretto. Usa le 6 cifre che l’app mostra adesso; se non va, controlla che l’ora del telefono sia automatica.');
    const recovery = newRecoveryCodes();
    mutate((db) => {
      const x = db.users.find((k) => k.id === u.id);
      if (!x) throw new UserError('Accesso non trovato.');
      if (x.twoFactor) throw new UserError('Il codice dal telefono è già attivo.');
      x.twoFactor = { secret: sealSecret(note.secret), enabledAt: new Date().toISOString(), recovery: recovery.map(hashRecovery), lastStep: step };
      audit(db, u.name, 'two_factor_on', 'user', x.id, 'Codice dal telefono attivato: gli altri dispositivi sono stati disconnessi');
    });
    // this browser stays in; every other open session (old phone, reception PC…) must log in again with the code
    await issueSession(me(u.id));
    return { recovery };
  }, 'Fatto: da ora all’accesso ti chiederemo anche il codice dal telefono.');
}

/** New emergency codes (the old ones stop working). Asks for the password. */
export async function twoFactorNewCodesAction(password: string) {
  return act('assistant.use', (u) => {
    checkPassword(u.id, password);
    if (!me(u.id).twoFactor) throw new UserError('Il codice dal telefono non è attivo.');
    const recovery = newRecoveryCodes();
    mutate((db) => {
      const x = db.users.find((k) => k.id === u.id)!;
      if (!x.twoFactor) throw new UserError('Il codice dal telefono non è attivo.');
      x.twoFactor.recovery = recovery.map(hashRecovery);
      audit(db, u.name, 'two_factor_codes', 'user', x.id, 'Nuovi codici di emergenza (i vecchi non valgono più)');
    });
    return { recovery };
  }, 'Nuovi codici di emergenza pronti: i vecchi non valgono più.');
}

/** Turns the code off. Asks for the password. */
export async function twoFactorDisableAction(password: string) {
  return act('assistant.use', async (u) => {
    checkPassword(u.id, password);
    mutate((db) => {
      const x = db.users.find((k) => k.id === u.id);
      if (!x?.twoFactor) throw new UserError('Il codice dal telefono non è attivo.');
      delete x.twoFactor;
      audit(db, u.name, 'two_factor_off', 'user', x.id, 'Codice dal telefono disattivato');
    });
    await issueSession(me(u.id));
  }, 'Codice dal telefono disattivato: per entrare basta di nuovo la password.');
}
