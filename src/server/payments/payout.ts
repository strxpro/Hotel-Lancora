import 'server-only';
import type { DB } from '@/lib/types';
import { todayISO } from '@/lib/dates';
import { estimatePayout, nextPayoutDay, scheduleLabel, type PayoutSchedule } from '@/lib/payout';
import { stripe, stripeMode } from './stripe';

/** What the "Oggi" card shows about the next payout to the hotel's bank account. */
export interface PayoutInfo {
  /** 'stripe' = numbers read from Stripe now; 'estimate' = worked out from the site's payments */
  source: 'stripe' | 'estimate';
  mode: 'test' | 'live' | 'off';
  amount: number;
  /** ISO day the money should arrive (null = no automatic payouts) */
  date: string | null;
  /** Stripe payout state, or 'scheduled' when no payout exists yet for that day */
  status: 'in_transit' | 'pending' | 'scheduled' | 'manual' | 'estimate';
  schedule: string;
  bank: string | null;
  available: number | null;
  pending: number | null;
  last: { amount: number; date: string } | null;
  /** estimate: payments counted and from which day */
  count?: number;
  from?: string;
  refunds?: number;
  /** why Stripe could not be read (the estimate is shown instead) */
  error?: string;
  simulated?: boolean;
  /** Stripe: first day on which money still "in arrivo" becomes available */
  availableOn?: string | null;
}

const g = globalThis as unknown as { __lancoraPayout?: { key: string; at: number; info: PayoutInfo } };
const TTL = 3 * 60_000;

const isoDay = (unix: number) => todayISO(new Date(unix * 1000));
const eur = (list: { amount: number; currency: string }[] | undefined) => Math.round((list ?? []).filter((x) => x.currency === 'eur').reduce((a, x) => a + x.amount, 0)) / 100;

function scheduleOf(db: DB): PayoutSchedule {
  const c = db.settings.stripeConnect;
  return { interval: c.payoutInterval ?? 'weekly', weeklyAnchor: c.weeklyAnchor ?? 'monday', monthlyAnchor: c.monthlyAnchor ?? 1 };
}

function estimate(db: DB, extra: Partial<PayoutInfo> = {}): PayoutInfo {
  const s = scheduleOf(db);
  const today = todayISO();
  const e = estimatePayout(db.payments, today, s, (iso) => todayISO(new Date(iso)));
  const c = db.settings.stripeConnect;
  return {
    source: 'estimate',
    mode: stripeMode(),
    amount: e.amount,
    date: e.date,
    status: 'estimate',
    schedule: scheduleLabel(s),
    bank: c.bankLast4 ? `•••• ${c.bankLast4}` : null,
    available: null,
    pending: null,
    last: null,
    count: e.count,
    from: e.from,
    refunds: e.refunds,
    simulated: c.simulated,
    ...extra,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Stripe non risponde (timeout)')), ms))]);
}

/** Reads balance, payouts and payout schedule of the hotel's Stripe account (read-only calls). */
async function fromStripe(db: DB): Promise<PayoutInfo> {
  const s = stripe();
  const c = db.settings.stripeConnect;
  // a real connected account (Stripe Connect) receives the money; otherwise the keys are the hotel's own account
  const acct = c.accountId && !c.simulated ? c.accountId : null;
  const opts = acct ? { stripeAccount: acct } : undefined;
  const [payouts, balance, account] = await Promise.all([s.payouts.list({ limit: 10 }, opts), s.balance.retrieve(undefined, opts), acct ? s.accounts.retrieve(acct) : s.accounts.retrieveCurrent()]);
  const upcoming = payouts.data.filter((p) => p.status === 'pending' || p.status === 'in_transit').sort((a, b) => a.arrival_date - b.arrival_date)[0];
  const paid = payouts.data.filter((p) => p.status === 'paid').sort((a, b) => b.arrival_date - a.arrival_date)[0];
  const sched = account.settings?.payouts?.schedule;
  const schedule: PayoutSchedule = { interval: (['daily', 'weekly', 'monthly', 'manual'].includes(sched?.interval ?? '') ? sched!.interval : 'daily') as PayoutSchedule['interval'], weeklyAnchor: sched?.weekly_anchor ?? 'monday', monthlyAnchor: sched?.monthly_anchor ?? 1 };
  const bank = account.external_accounts?.data?.find((x) => x.object === 'bank_account') as { last4?: string } | undefined;
  const available = eur(balance.available);
  const pending = eur(balance.pending);
  const base = { source: 'stripe' as const, mode: stripeMode(), schedule: scheduleLabel(schedule), bank: bank?.last4 ? `•••• ${bank.last4}` : null, available, pending, last: paid ? { amount: paid.amount / 100, date: isoDay(paid.arrival_date) } : null };
  if (upcoming) return { ...base, amount: upcoming.amount / 100, date: isoDay(upcoming.arrival_date), status: upcoming.status as 'pending' | 'in_transit' };
  // money still "in arrivo" becomes available on its own day (Stripe holds card payments a few days)
  const waiting = pending > 0 ? (await s.balanceTransactions.list({ limit: 100 }, opts)).data.filter((t) => t.status === 'pending' && t.currency === 'eur') : [];
  const availableOn = waiting.length ? isoDay(Math.min(...waiting.map((t) => t.available_on))) : null;
  // payouts "a mano" on Stripe: nothing leaves by itself; say how much and from which day it can
  if (schedule.interval === 'manual') return { ...base, amount: Math.round((available + pending) * 100) / 100, date: null, status: 'manual', availableOn };
  // no payout created yet: the next one takes what is available by then
  let date = nextPayoutDay(todayISO(), schedule);
  let amount = available;
  if (availableOn) {
    if (available <= 0) date = nextPayoutDay(availableOn > todayISO() ? availableOn : todayISO(), schedule);
    const by = date;
    amount = Math.round(available * 100 + waiting.filter((t) => by && isoDay(t.available_on) <= by).reduce((a, t) => a + t.net, 0)) / 100;
  }
  return { ...base, amount, date, status: 'scheduled', availableOn };
}

/**
 * The next payout: real numbers from Stripe when a Stripe key is connected (cached a few minutes,
 * never blocks the page more than a few seconds), otherwise an estimate from the site's payments
 * and the payout calendar in Pagamenti — always labelled as an estimate.
 */
export async function payoutInfo(db: DB): Promise<PayoutInfo> {
  const mode = stripeMode();
  if (mode === 'off') return estimate(db);
  const c = db.settings.stripeConnect;
  const key = `${mode}:${c.simulated ? '' : (c.accountId ?? '')}`;
  const hit = g.__lancoraPayout;
  if (hit && hit.key === key && Date.now() - hit.at < TTL) return hit.info;
  try {
    const info = await withTimeout(fromStripe(db), 6000);
    g.__lancoraPayout = { key, at: Date.now(), info };
    return info;
  } catch (e) {
    const info = estimate(db, { error: (e as Error).message.slice(0, 160) });
    g.__lancoraPayout = { key, at: Date.now() - TTL + 60_000, info }; // retry Stripe in a minute
    return info;
  }
}
