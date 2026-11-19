import type { Payment } from './types';
import { addDays, daysInMonth, weekdayMon } from './dates';

/**
 * Payout calendar maths shared by the "Oggi" card and the tests. Dates are ISO days in hotel time.
 * Stripe pays out on business days: daily = every Monday–Friday, weekly = on the chosen weekday,
 * monthly = on the chosen day of the month (the last day when the month is shorter).
 */
export type PayoutInterval = 'daily' | 'weekly' | 'monthly' | 'manual';
export type PayoutSchedule = { interval: PayoutInterval; weeklyAnchor: string; monthlyAnchor: number };

const WEEKDAY: Record<string, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const DAY_IT = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];

export function isPayoutDay(iso: string, s: PayoutSchedule): boolean {
  const wd = weekdayMon(iso);
  if (s.interval === 'daily') return wd < 5;
  if (s.interval === 'weekly') return wd === (WEEKDAY[s.weeklyAnchor] ?? 0);
  if (s.interval === 'monthly') return Number(iso.slice(8)) === Math.min(Math.max(1, s.monthlyAnchor), daysInMonth(iso));
  return false;
}

/** The first payout day from `from` (included). null for manual payouts. */
export function nextPayoutDay(from: string, s: PayoutSchedule): string | null {
  if (s.interval === 'manual') return null;
  for (let i = 0; i < 400; i++) {
    const d = addDays(from, i);
    if (isPayoutDay(d, s)) return d;
  }
  return null;
}

/** The last payout day before `before` (excluded). */
export function previousPayoutDay(before: string, s: PayoutSchedule): string | null {
  if (s.interval === 'manual') return null;
  for (let i = 1; i < 400; i++) {
    const d = addDays(before, -i);
    if (isPayoutDay(d, s)) return d;
  }
  return null;
}

export function scheduleLabel(s: PayoutSchedule): string {
  if (s.interval === 'daily') return 'ogni giorno lavorativo';
  if (s.interval === 'weekly') return `ogni settimana, il ${DAY_IT[WEEKDAY[s.weeklyAnchor] ?? 0]}`;
  if (s.interval === 'monthly') return s.monthlyAnchor >= 31 ? 'ogni mese, l’ultimo giorno' : `ogni mese, il giorno ${s.monthlyAnchor}`;
  return 'a mano, dalla dashboard di Stripe';
}

/** Card payments that go through Stripe to the hotel's account (POS, cash, transfers and portals do not). */
export const PAID_OUT_BY_STRIPE = new Set<Payment['provider']>(['stripe', 'stripe_test', 'simulazione']);

/**
 * Estimate of the next payout from the site's own records: card payments received since the
 * previous payout day, minus the card refunds of the same days, gross of Stripe's fees.
 */
export function estimatePayout(payments: Pick<Payment, 'amount' | 'provider' | 'status' | 'createdAt'>[], today: string, s: PayoutSchedule, dayOf: (iso: string) => string = (x) => x.slice(0, 10)) {
  const date = nextPayoutDay(today, s);
  const since = previousPayoutDay(date ?? today, s);
  const from = since ? addDays(since, 1) : addDays(today, -30);
  const inWindow = payments.filter((p) => p.status === 'succeeded' && PAID_OUT_BY_STRIPE.has(p.provider) && dayOf(p.createdAt) >= from && dayOf(p.createdAt) <= today);
  const gross = inWindow.filter((p) => p.amount > 0).reduce((a, p) => a + p.amount, 0);
  const refunds = inWindow.filter((p) => p.amount < 0).reduce((a, p) => a - p.amount, 0);
  return { date, from, count: inWindow.filter((p) => p.amount > 0).length, gross: Math.round(gross * 100) / 100, refunds: Math.round(refunds * 100) / 100, amount: Math.round(Math.max(0, gross - refunds) * 100) / 100 };
}
