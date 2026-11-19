import 'server-only';
import type Stripe from 'stripe';
import type { DB } from '@/lib/types';
import { todayISO } from '@/lib/dates';
import { estimatePayout } from '@/lib/payout';
import { stripe, stripeMode } from './stripe';

/**
 * "Ricevi subito": the hotel moves its card takings to its debit card (or a bank that accepts
 * instant transfers) in about 30 minutes, any day, instead of waiting for the normal transfer.
 * Stripe Instant Payouts on the hotel's connected account. Stripe decides who can use it (new
 * accounts wait a while, and the site's Stripe account needs a daily limit); the panel only shows
 * what Stripe says is possible now, and the owner always confirms the amount first.
 */
export type InstantState = 'ready' | 'no_card' | 'not_enabled' | 'empty' | 'error';

export interface InstantView {
  state: InstantState;
  simulated: boolean;
  test: boolean;
  /** the most the hotel can receive now, after the cost of the service */
  max: number;
  /** what receiving `max` costs the hotel (0 = nothing) */
  fee: number;
  /** where the money lands, e.g. "Visa •••• 4242" */
  to: string | null;
  /** Stripe id of that card/account: server side only, never sent to the page */
  destination?: string | null;
  error?: string;
}

/** Stripe's limits for one instant transfer in euro (the minimum is 0.40 €, the panel asks at least 1 €). */
export const INSTANT_MIN = 1;
export const INSTANT_MAX = 9999;

export class InstantError extends Error {}

type External = Stripe.Card | Stripe.BankAccount;

const cents = (n: number) => Math.round(n * 100);
const eur = (n: number) => Math.round(n) / 100;

export function destinationLabel(x: External): string {
  if (x.object === 'card') return `${x.brand && x.brand !== 'Unknown' ? x.brand : 'Carta'} •••• ${x.last4}`;
  return `${x.bank_name ? x.bank_name : 'Conto'} •••• ${x.last4}`;
}

/**
 * What the panel shows, from Stripe's own numbers: the debit card / bank that accepts instant
 * transfers (the default one first), the instant balance and, when the site charges for the
 * service, the amount net of that cost (`net_available`).
 */
export function instantFromStripe(balance: Pick<Stripe.Balance, 'available' | 'pending' | 'instant_available'>, externals: External[], test: boolean): InstantView {
  const base = { simulated: false, test, max: 0, fee: 0 };
  const ok = externals.filter((x) => x.available_payout_methods?.includes('instant'));
  const dest = ok.find((x) => x.default_for_currency && x.currency === 'eur') ?? ok.find((x) => x.currency === 'eur') ?? ok[0];
  if (!dest) return { ...base, state: 'no_card', to: null, destination: null };
  const inst = balance.instant_available?.find((x) => x.currency === 'eur');
  const gross = eur(inst?.amount ?? 0);
  const netEntry = inst?.net_available?.find((n) => n.destination === dest.id);
  const net = netEntry ? eur(netEntry.amount) : gross;
  const to = destinationLabel(dest);
  if (net < INSTANT_MIN) {
    // money is there (or on its way) but none of it can go instantly: Stripe has not enabled the
    // service for this account yet, or today's limit is used up
    const waiting = [...balance.available, ...balance.pending].filter((x) => x.currency === 'eur').reduce((a, x) => a + x.amount, 0);
    return { ...base, state: waiting >= cents(INSTANT_MIN) ? 'not_enabled' : 'empty', to, destination: dest.id };
  }
  const max = Math.min(net, INSTANT_MAX);
  return { ...base, state: 'ready', max, fee: Math.max(0, Math.round((gross - net) * 100) / 100), to, destination: dest.id };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Stripe non risponde')), ms))]);
}

/** The demo without Stripe: the card takings since the last normal transfer, nothing really moves. */
function simulatedView(db: DB): InstantView {
  const c = db.settings.stripeConnect;
  const e = estimatePayout(db.payments, todayISO(), { interval: c.payoutInterval ?? 'daily', weeklyAnchor: c.weeklyAnchor ?? 'monday', monthlyAnchor: c.monthlyAnchor ?? 1 }, (iso) => todayISO(new Date(iso)));
  const max = Math.min(e.amount, INSTANT_MAX);
  return { state: max >= INSTANT_MIN ? 'ready' : 'empty', simulated: true, test: false, max, fee: 0, to: 'Carta di debito •••• 0000', destination: null };
}

/** The connected account that receives the money, or null when there is none (or only the demo). */
function account(db: DB): string | null {
  const c = db.settings.stripeConnect;
  return c.accountId && !c.simulated && c.detailsSubmitted ? c.accountId : null;
}

export async function instantView(db: DB): Promise<InstantView | null> {
  const c = db.settings.stripeConnect;
  if (c.simulated && c.accountId) return simulatedView(db);
  const acct = account(db);
  const mode = stripeMode();
  if (!acct || mode === 'off') return null;
  try {
    const s = stripe();
    const [balance, externals] = await withTimeout(
      Promise.all([s.balance.retrieve({ expand: ['instant_available.net_available'] }, { stripeAccount: acct }), s.accounts.listExternalAccounts(acct, { limit: 20 })]),
      7000,
    );
    return instantFromStripe(balance, externals.data as External[], mode === 'test');
  } catch (e) {
    return { state: 'error', simulated: false, test: mode === 'test', max: 0, fee: 0, to: null, error: (e as Error).message.slice(0, 160) };
  }
}

/** Stripe's refusals, in the owner's words. */
export function instantErrorText(e: unknown): string {
  const x = e as { code?: string; message?: string } | null;
  const code = x?.code ?? '';
  if (/limit_exceeded|daily/i.test(code)) return 'Per oggi è stato raggiunto il limite dei bonifici immediati. Riprova domani, oppure i soldi arrivano con il bonifico normale.';
  if (/instant_payouts_unsupported|config_disabled|currency_disabled|not_enabled|unsupported/i.test(code)) return 'Stripe non ha ancora attivato i bonifici immediati per questo conto. Intanto i soldi arrivano con il bonifico normale.';
  if (/balance_insufficient/.test(code)) return 'L’importo non è più disponibile (forse è appena partito un bonifico). Riapri la finestra per vedere la cifra aggiornata.';
  if (/amount_too_small/.test(code)) return `L’importo minimo è ${INSTANT_MIN} €.`;
  if (/amount_too_large/.test(code)) return `Con un solo bonifico immediato si possono ricevere al massimo ${INSTANT_MAX.toLocaleString('it-IT')} €.`;
  if (/invalid_card_type|debit_not_authorized|card_declined|account_closed|no_account|external_account/i.test(code)) return 'La carta o il conto scelto non accetta bonifici immediati. Controlla la carta su Stripe.';
  return 'Stripe non ha accettato il bonifico immediato. Nessun soldo è stato spostato: riprova tra qualche minuto.';
}

export interface InstantResult {
  amount: number;
  to: string | null;
  simulated: boolean;
  /** ISO time Stripe expects the money to arrive (null in the demo) */
  arrival: string | null;
  id: string | null;
}

/**
 * Sends `amount` euro now. The amount is checked again against what Stripe says right now, and the
 * same request repeated within a minute (a double click) is sent to Stripe only once.
 */
export async function sendInstant(db: DB, amount: number): Promise<InstantResult> {
  const v = await instantView(db);
  if (!v) throw new InstantError('Collega prima il conto su cui ricevere i soldi.');
  if (v.state === 'error') throw new InstantError('Stripe non risponde ora. Nessun soldo è stato spostato: riprova tra qualche minuto.');
  if (v.state === 'no_card') throw new InstantError('Serve una carta di debito collegata al conto per ricevere i soldi in pochi minuti.');
  if (v.state === 'not_enabled') throw new InstantError('Stripe non ha ancora attivato i bonifici immediati per questo conto.');
  if (v.state === 'empty') throw new InstantError('Per ora non c’è niente da trasferire.');
  const want = Math.round(amount * 100) / 100;
  if (!(want >= INSTANT_MIN)) throw new InstantError(`L’importo minimo è ${INSTANT_MIN} €.`);
  if (want > v.max + 0.001) throw new InstantError(`Ora puoi ricevere al massimo ${v.max.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €.`);
  if (v.simulated) return { amount: want, to: v.to, simulated: true, arrival: null, id: null };
  const acct = account(db)!;
  try {
    const p = await stripe().payouts.create(
      { amount: cents(want), currency: 'eur', method: 'instant', ...(v.destination ? { destination: v.destination } : {}), description: 'Ricevi subito (pannello hotel)', metadata: { app: 'hotel-lancora' } },
      { stripeAccount: acct, idempotencyKey: `instant:${acct}:${cents(want)}:${Math.floor(Date.now() / 60_000)}` },
    );
    // the "Oggi" card reads the balance again
    (globalThis as { __lancoraPayout?: unknown }).__lancoraPayout = undefined;
    return { amount: p.amount / 100, to: v.to, simulated: false, arrival: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString() : null, id: p.id };
  } catch (e) {
    throw new InstantError(instantErrorText(e));
  }
}

/* ------------------------------------------------------------------ */
/* automatic: every card payment goes on to the hotel's card at once   */
/* ------------------------------------------------------------------ */

const ga = globalThis as unknown as { __lancoraAutoInstant?: Promise<void> };

/**
 * "Ricevi subito in automatico" (Pagamenti): right after a guest pays by card, what can leave now is
 * sent to the hotel's debit card. Off unless the owner switched it on; each transfer has Stripe's
 * cost. One at a time (two payments a second apart make one transfer), never blocks the booking.
 */
export function autoInstantAfterPayment(): void {
  const run = async () => {
    const { readDb, mutate } = await import('../db/store');
    const { audit, notify } = await import('../events');
    const db = readDb();
    if (!db.settings.stripeConnect.autoInstant || db.settings.stripeConnect.simulated) return;
    // the card payment reaches the hotel's balance a moment after the confirmation
    await new Promise((r) => setTimeout(r, 8000));
    const v = await instantView(readDb());
    if (!v || v.state !== 'ready' || v.max < INSTANT_MIN) {
      if (v && v.state !== 'empty' && v.state !== 'ready') mutate((d) => audit(d, 'Sistema', 'instant_payout_auto', 'settings', null, `Bonifico immediato automatico non partito (${v.state === 'no_card' ? 'manca la carta di debito' : v.state === 'not_enabled' ? 'non ancora attivo su Stripe' : 'Stripe non risponde'}): arriva con il bonifico normale`));
      return;
    }
    try {
      const r = await sendInstant(readDb(), v.max);
      mutate((d) => {
        audit(d, 'Sistema', 'instant_payout_auto', 'settings', r.id, `Bonifico immediato automatico di € ${r.amount.toFixed(2)} verso ${r.to ?? 'carta'}`);
        notify(d, 'nuovo_pagamento', `In arrivo sulla carta · € ${r.amount.toFixed(2)}`, `Bonifico immediato automatico verso ${r.to ?? 'la carta dell’hotel'}: di solito entro 30 minuti.`, '/admin/pagamenti');
      });
    } catch (e) {
      mutate((d) => audit(d, 'Sistema', 'instant_payout_auto', 'settings', null, `Bonifico immediato automatico non partito: ${(e as Error).message.slice(0, 160)}`));
    }
  };
  ga.__lancoraAutoInstant = (ga.__lancoraAutoInstant ?? Promise.resolve()).then(run, run).catch((e) => console.error('[instant]', (e as Error).message));
}
