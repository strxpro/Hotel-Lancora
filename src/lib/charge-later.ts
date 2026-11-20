import type { Booking, DB, Locale } from './types';
import { addDays } from './dates';
import { amountDueNow, round2 } from './availability';

/**
 * "Paga dopo" (Pagamenti → Con la carta, quanto pagano subito → Più tardi):
 *  · the guest saves the card when booking and pays nothing;
 *  · N days before arrival the stay is charged on that card, by itself or when the owner clicks;
 *  · when the arrival is closer than N days, the guest pays the whole stay at once, as usual.
 * N and "automatic / by hand" are read from the settings every time, so changing them in the panel
 * also moves the bookings already made. The day is a hotel-time day (Europe/Rome).
 */

type Payments = DB['settings']['payments'];
export type ChargeLaterRule = { enabled: boolean; daysBefore: number; auto: boolean };

export const DEFAULT_CHARGE_LATER: ChargeLaterRule = { enabled: false, daysBefore: 3, auto: true };
export const chargeLaterRule = (p: Pick<Payments, 'chargeLater'>): ChargeLaterRule => ({ ...DEFAULT_CHARGE_LATER, ...(p.chargeLater ?? {}) });

/** The day a "pay later" booking is charged: N days before arrival. */
export const chargeDay = (checkIn: string, rule: ChargeLaterRule): string => addDays(checkIn, -Math.max(0, rule.daysBefore));

/**
 * For a new card booking: the day the card will be charged, or null when the guest pays now
 * (setting off, card payments off, or the arrival is too close).
 */
export function laterChargeDay(p: Payments, checkIn: string, today: string, cards: boolean): string | null {
  const r = chargeLaterRule(p);
  if (!cards || !r.enabled || p.allowOnline === false) return null;
  const on = chargeDay(checkIn, r);
  return on > today ? on : null;
}

/** What a card guest pays when booking: nothing (pay later), the whole stay (pay later, arrival close) or the deposit rule. */
export function cardDueNow(total: number, p: Payments, checkIn: string, today: string, cards: boolean): number {
  if (laterChargeDay(p, checkIn, today, cards)) return 0;
  if (cards && chargeLaterRule(p).enabled && p.allowOnline !== false) return round2(total);
  return amountDueNow(total, p);
}

/** Still to charge on a "pay later" booking (0 = nothing: paid, cancelled, or not a "pay later" booking). */
export function plannedCharge(b: Pick<Booking, 'chargePlan' | 'status' | 'total' | 'amountPaid'>): number {
  if (!b.chargePlan || b.chargePlan.outcome === 'charged' || b.status !== 'confirmed') return 0;
  return round2(Math.max(0, b.total - b.amountPaid));
}

/** The guest's words: booking page, confirmation, guest area, e-mail. {amount} {date} are filled in. */
type LaterText = { today: string; row: string; when: string; note: string; button: string };

export const LATER_T: Record<Locale, LaterText> = {
  it: { today: 'Oggi non paghi nulla', row: 'Addebito sulla carta', when: '{amount} il {date}', note: 'Salvi la carta sulla pagina sicura di Stripe e adesso non paghi nulla: {amount} verranno addebitati il {date}.', button: 'Salva la carta · paghi il {date}' },
  en: { today: 'Nothing to pay today', row: 'Charged to your card', when: '{amount} on {date}', note: 'You save your card on Stripe’s secure page and pay nothing now: {amount} will be charged on {date}.', button: 'Save your card · pay on {date}' },
  pl: { today: 'Dziś nic nie płacisz', row: 'Obciążenie karty', when: '{amount} dnia {date}', note: 'Zapisujesz kartę na bezpiecznej stronie Stripe i teraz nic nie płacisz: {amount} zostanie pobrane z karty {date}.', button: 'Zapisz kartę · płatność {date}' },
  de: { today: 'Heute zahlen Sie nichts', row: 'Belastung der Karte', when: '{amount} am {date}', note: 'Sie hinterlegen Ihre Karte auf der sicheren Seite von Stripe und zahlen jetzt nichts: {amount} werden am {date} abgebucht.', button: 'Karte hinterlegen · Zahlung am {date}' },
  fr: { today: 'Vous ne payez rien aujourd’hui', row: 'Débit sur la carte', when: '{amount} le {date}', note: 'Vous enregistrez votre carte sur la page sécurisée de Stripe et ne payez rien maintenant : {amount} seront débités le {date}.', button: 'Enregistrer la carte · paiement le {date}' },
  es: { today: 'Hoy no pagas nada', row: 'Cargo en la tarjeta', when: '{amount} el {date}', note: 'Guardas la tarjeta en la página segura de Stripe y ahora no pagas nada: {amount} se cargarán el {date}.', button: 'Guardar la tarjeta · pago el {date}' },
};

/** Italian: "l’8 gennaio", "l’11", "l’1" (not "il 8"). */
export const itOn = (date: string): string => (/^(8|11|1)(\D|$)/.test(date) ? `l’${date}` : `il ${date}`);

export const laterFill = (s: string, amount: string, date: string): string => s.replace('{amount}', amount).replace('il {date}', itOn(date)).replace('{date}', date);
