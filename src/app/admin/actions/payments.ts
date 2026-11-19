'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { mutate, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { appUrl } from '@/server/email/templates';
import { requestOrigin } from '@/server/security';
import { accountGone, connectDashboardLink, connectOnboardingLink, createConnectAccount, hotelOwnStripe, platformReady, retrieveConnectStatus, retrieveOwnStatus, stripeMode, updateOwnPayoutSchedule, updatePayoutSchedule, type ConnectStatus } from '@/server/payments/stripe';
import { InstantError, instantView, sendInstant, type InstantView } from '@/server/payments/instant';
import { AuthError, requireUser } from '@/server/auth/guard';
import { money } from '@/lib/utils';

async function stripeCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = (e as Error).message;
    // the platform's Stripe account has never switched on Connect: say what to do, in plain words
    if (/signed up for Connect|connect.*not enabled|enable Connect|accounts_v2_access_blocked|Accounts v2 is not enabled|platform profile/i.test(msg)) {
      throw new UserError(`Prima serve un passo, una volta sola, su Stripe, nell’account del sito: apri dashboard.stripe.com/${stripeMode() === 'test' ? 'test/' : ''}connect e premi “Inizia” (scegli “Piattaforma”, conti gestiti da Stripe). Poi torna qui e premi di nuovo “Collega Stripe”.`);
    }
    // the site's own Stripe account is not activated yet for real payments: nothing the hotel can do
    if (/activat|cannot currently (make|create)|live (charges|mode).*not|account.*(not|isn.t).*(enabled|active)|complete.*(onboarding|activation)|requirements/i.test(msg)) {
      throw new UserError('Il conto Stripe del sito non è ancora attivo per i pagamenti veri. Chi gestisce il sito deve completare “Attiva i pagamenti” su dashboard.stripe.com (dati, documento, IBAN). Poi premi di nuovo “Collega Stripe”.');
    }
    throw new UserError(`Stripe: ${msg}`);
  }
}

function saveStatus(s: ConnectStatus) {
  mutate((db) => {
    Object.assign(db.settings.stripeConnect, { ...s, updatedAt: new Date().toISOString() });
  });
}

/**
 * Step 1 of "Collega Stripe": creates the hotel's Express account (once) and returns the
 * Stripe-hosted onboarding link (identity, IBAN, payouts). Without a platform key the demo
 * explains what is missing instead of pretending.
 */
export async function startStripeConnectAction() {
  return act('payments.manage', async (u) => {
    if (stripeMode() === 'off') throw new UserError('Per collegare un conto reale serve la chiave Stripe della piattaforma (STRIPE_SECRET_KEY). In demo puoi usare “Simula collegamento”.');
    // the hotel's own Stripe is already on the site: nothing to create, only its page to open
    if (hotelOwnStripe()) return { url: 'https://dashboard.stripe.com/' };
    // Stripe refuses new hotel accounts until the site's own account is activated: say it before trying
    if (!(await platformReady())) throw new UserError('I pagamenti con carta non sono ancora pronti dal lato del sito: l’assistenza tecnica sta completando l’attivazione su Stripe. Appena è fatta, questo pulsante funziona.');
    const db = readDb();
    let id = db.settings.stripeConnect.simulated ? null : db.settings.stripeConnect.accountId;
    // an account made with the test keys does not exist for the real ones: a new one, real
    let st: ConnectStatus | 'gone' | null = id ? await retrieveConnectStatus(id).catch((e) => (accountGone(e) ? ('gone' as const) : null)) : null;
    if (st === 'gone') {
      id = null;
      st = null;
    }
    if (!id) {
      const h = db.settings.hotel;
      id = await stripeCall(() => createConnectAccount({ email: h.email, name: h.name, url: appUrl() }));
      const accountId = id;
      mutate((d) => {
        Object.assign(d.settings.stripeConnect, { accountId, simulated: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, updatedAt: new Date().toISOString() });
        audit(d, u.name, 'stripe_connect', 'settings', null, `Creato account Stripe ${accountId}`);
      });
    }
    const accountId = id;
    // the panel shows what Stripe really has (payout calendar, status) from the first moment
    if (!st) st = await retrieveConnectStatus(accountId).catch(() => null);
    if (st) saveStatus(st);
    // back to the address the owner is using now (this computer, the public link or the real domain)
    const base = await requestOrigin();
    return { url: await stripeCall(() => connectOnboardingLink(accountId, base)) };
  });
}

export async function refreshStripeConnectAction() {
  return act('payments.manage', async () => {
    if (hotelOwnStripe()) {
      const s = await stripeCall(() => retrieveOwnStatus());
      mutate((db) => Object.assign(db.settings.stripeConnect, { ...s, accountId: null, simulated: false, direct: true, updatedAt: new Date().toISOString() }));
      return s;
    }
    const c = readDb().settings.stripeConnect;
    if (!c.accountId) throw new UserError('Nessun conto Stripe collegato.');
    if (c.simulated) return c;
    const accountId = c.accountId;
    const s = await stripeCall(() => retrieveConnectStatus(accountId));
    saveStatus(s);
    return s;
  }, 'Stato Stripe aggiornato.');
}

export async function stripeDashboardAction() {
  return act('payments.manage', async () => {
    if (hotelOwnStripe()) return { url: 'https://dashboard.stripe.com/' };
    const c = readDb().settings.stripeConnect;
    if (!c.accountId || c.simulated) throw new UserError('Disponibile dopo aver collegato un conto Stripe reale.');
    const accountId = c.accountId;
    return { url: await stripeCall(() => connectDashboardLink(accountId)) };
  });
}

const Schedule = z.object({
  interval: z.enum(['daily', 'weekly', 'monthly']),
  weeklyAnchor: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  monthlyAnchor: z.number().int().min(1).max(31),
});

export async function savePayoutScheduleAction(raw: unknown) {
  return act('payments.manage', async (u) => {
    const s = Schedule.parse(raw);
    const c = readDb().settings.stripeConnect;
    if (hotelOwnStripe()) {
      const st = await stripeCall(() => updateOwnPayoutSchedule(s));
      mutate((db) => Object.assign(db.settings.stripeConnect, { ...st, accountId: null, direct: true, updatedAt: new Date().toISOString() }));
    } else if (!c.accountId) throw new UserError('Collega prima un conto Stripe.');
    else if (!c.simulated) {
      const accountId = c.accountId;
      saveStatus(await stripeCall(() => updatePayoutSchedule(accountId, s)));
    } else {
      mutate((db) => Object.assign(db.settings.stripeConnect, { payoutInterval: s.interval, weeklyAnchor: s.weeklyAnchor, monthlyAnchor: s.monthlyAnchor, updatedAt: new Date().toISOString() }));
    }
    mutate((db) => audit(db, u.name, 'payout_schedule', 'settings', null, `Bonifici ${s.interval === 'daily' ? 'giornalieri' : s.interval === 'weekly' ? `settimanali (${s.weeklyAnchor})` : `mensili (giorno ${s.monthlyAnchor})`}`));
  }, 'Calendario dei bonifici salvato.');
}

/** DEMO ONLY: shows the connected state without a Stripe platform key. Clearly labelled. */
export async function simulateStripeConnectAction() {
  return act('payments.manage', (u) => {
    if (stripeMode() !== 'off') throw new UserError('Con Stripe configurato usa il collegamento reale.');
    if (process.env.DEMO_MODE === 'false') throw new UserError('Sul sito vero il collegamento simulato non c’è: serve Stripe.');
    mutate((db) => {
      Object.assign(db.settings.stripeConnect, {
        accountId: 'acct_SIMULAZIONE',
        simulated: true,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        businessName: db.settings.hotel.name,
        bankLast4: '0000',
        requirements: [],
        updatedAt: new Date().toISOString(),
      });
      audit(db, u.name, 'stripe_connect', 'settings', null, 'Collegamento Stripe SIMULATO (demo)');
    });
  }, 'Collegamento simulato: nessun conto reale è stato creato.');
}

export async function disconnectStripeAction() {
  return act('payments.manage', (u) => {
    mutate((db) => {
      const prev = db.settings.stripeConnect.accountId;
      Object.assign(db.settings.stripeConnect, { accountId: null, simulated: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, businessName: null, bankLast4: null, requirements: [], updatedAt: new Date().toISOString() });
      audit(db, u.name, 'stripe_disconnect', 'settings', null, `Scollegato ${prev ?? '—'} (il conto Stripe resta attivo su Stripe)`);
    });
  }, 'Conto scollegato dal sito. Il conto resta attivo su Stripe.');
}

/** "Ricevi subito": what can arrive now and where (read only, nothing is saved or refreshed). */
export async function instantInfoAction(): Promise<{ ok: true; data: Omit<InstantView, 'destination'> | null } | { ok: false; error: string }> {
  try {
    await requireUser('payments.manage');
    const v = await instantView(readDb());
    if (!v) return { ok: true, data: null };
    const { destination: _d, ...view } = v;
    return { ok: true, data: view };
  } catch (e) {
    return { ok: false, error: e instanceof AuthError ? e.message : 'Non riesco a leggere il saldo ora.' };
  }
}

/** "Ricevi subito": the owner confirmed the amount; it leaves now (or, in the demo, nothing moves). */
export async function instantPayoutAction(raw: unknown) {
  return act('payments.manage', async (u) => {
    const { amount } = z.object({ amount: z.number().positive().max(9999) }).parse(raw);
    try {
      const r = await sendInstant(readDb(), amount);
      mutate((db) => audit(db, u.name, 'instant_payout', 'settings', r.id, r.simulated ? `Bonifico immediato SIMULATO di ${money(r.amount, 'it', 2)} (demo: nessun soldo spostato)` : `Bonifico immediato di ${money(r.amount, 'it', 2)} verso ${r.to ?? 'carta'} (${r.id})`));
      return r;
    } catch (e) {
      if (e instanceof InstantError) throw new UserError(e.message);
      throw e;
    }
  });
}

/** "Ricevi subito in automatico": on or off (each automatic transfer has Stripe's cost). */
export async function setAutoInstantAction(on: boolean) {
  return act('payments.manage', (u) => {
    mutate((db) => {
      db.settings.stripeConnect.autoInstant = Boolean(on);
      audit(db, u.name, 'instant_payout_auto', 'settings', null, on ? 'Bonifico immediato automatico acceso: ogni pagamento con carta va subito sulla carta dell’hotel' : 'Bonifico immediato automatico spento');
    });
  }, on ? 'Acceso: ogni pagamento con carta arriverà subito sulla carta.' : 'Spento: i soldi arrivano con il bonifico normale.');
}
