import type { Locale } from './types';
import { addDays, fmtDate, todayISO } from './dates';
import { money } from './utils';

/**
 * The cancellation rule, in one place (panel → Pagamenti):
 *  · free until 00:00 (hotel time, Europe/Rome) of the day that falls N days before arrival;
 *  · from that midnight on, cancelling costs a fee the owner chooses: a percentage of the stay,
 *    the first night, or a fixed amount.
 * Example with N = 3 and arrival on Friday 15: free through Monday 11 at 23:59; from Tuesday 12 at
 * 00:00 the fee applies.
 * The same functions feed the site (room page, booking, guest area, terms), the chat, the refund
 * shown in the panel and the amount given back when a booking is cancelled.
 */
export type CancelFee = { type: 'percent' | 'first_night' | 'fixed'; value: number };
export type CancelRules = { freeCancellationDays: number; cancellationFee?: CancelFee };

export const DEFAULT_CANCEL_FEE: CancelFee = { type: 'percent', value: 100 };
export const cancelFeeOf = (r: CancelRules): CancelFee => r.cancellationFee ?? DEFAULT_CANCEL_FEE;

/** The fee applies from 00:00 of this date (ISO day, hotel time). */
export const cancelDeadline = (checkIn: string, days: number): string => addDays(checkIn, -Math.max(0, Math.round(days)));

/** `today` is the hotel's current day (todayISO()). */
export const isFreeCancel = (today: string, checkIn: string, days: number): boolean => today < cancelDeadline(checkIn, days);

/** What a late cancellation costs for a stay of `total` euro over `nights` nights (never more than the stay). */
export function cancelFeeAmount(r: CancelRules, total: number, nights: number): number {
  const f = cancelFeeOf(r);
  const raw = f.type === 'percent' ? (total * f.value) / 100 : f.type === 'first_night' ? total / Math.max(1, nights) : f.value;
  return Math.round(Math.min(Math.max(0, total), Math.max(0, raw)) * 100) / 100;
}

/** Money given back when cancelling today: everything while it is free, what was paid minus the fee afterwards. */
export function cancelRefund(r: CancelRules, today: string, b: { checkIn: string; total: number; amountPaid: number; nights: number }): number {
  if (isFreeCancel(today, b.checkIn, r.freeCancellationDays)) return b.amountPaid;
  return Math.round(Math.max(0, b.amountPaid - cancelFeeAmount(r, b.total, b.nights)) * 100) / 100;
}

type Copy = { title: string; dated: string; generic: string; dated0: string; generic0: string; late: string; late0: string; day: [string, string]; full: string; percent: string; first: string };
const C: Record<Locale, Copy> = {
  it: {
    title: 'Cancellazione',
    dated: 'Cancellazione gratuita fino a {date} alle 23:59, cioè fino a {days} dal check-in. Dopo quel momento la cancellazione costa {fee}.',
    generic: 'Cancellazione gratuita fino alle 00:00 (ora italiana) del giorno che cade {days} prima dell’arrivo. Da quel momento la cancellazione costa {fee}.',
    dated0: 'Cancellazione gratuita fino a {date} alle 23:59, il giorno prima del check-in. Dopo quel momento la cancellazione costa {fee}.',
    generic0: 'Cancellazione gratuita fino alle 00:00 (ora italiana) del giorno di arrivo. Da quel momento la cancellazione costa {fee}.',
    late: 'Prenotazione fatta a meno di {days} dal check-in, quando la cancellazione gratuita non è più prevista: la cancellazione costa {fee}.',
    late0: 'Prenotazione per il giorno stesso: la cancellazione costa {fee}.',
    day: ['1 giorno', '{n} giorni'],
    full: 'l’intero importo del soggiorno',
    percent: 'il {p}% del totale del soggiorno',
    first: 'il prezzo della prima notte',
  },
  en: {
    title: 'Cancellation',
    dated: 'Free cancellation until {date} at 23:59, that is up to {days} before check-in. After that, cancelling costs {fee}.',
    generic: 'Free cancellation until 00:00 (Italian time) of the day that falls {days} before arrival. From that moment, cancelling costs {fee}.',
    dated0: 'Free cancellation until {date} at 23:59, the day before check-in. After that, cancelling costs {fee}.',
    generic0: 'Free cancellation until 00:00 (Italian time) on the day of arrival. From that moment, cancelling costs {fee}.',
    late: 'Booking made less than {days} before check-in, when free cancellation no longer applies: cancelling costs {fee}.',
    late0: 'Same-day booking: cancelling costs {fee}.',
    day: ['1 day', '{n} days'],
    full: 'the full price of the stay',
    percent: '{p}% of the stay total',
    first: 'the price of the first night',
  },
  pl: {
    title: 'Anulowanie',
    dated: 'Bezpłatne anulowanie do {date}, godz. 23:59, czyli do {days} przed zameldowaniem. Później anulowanie kosztuje {fee}.',
    generic: 'Bezpłatne anulowanie do godz. 00:00 (czasu włoskiego) dnia przypadającego {days} przed przyjazdem. Od tej chwili anulowanie kosztuje {fee}.',
    dated0: 'Bezpłatne anulowanie do {date}, godz. 23:59 (dzień przed zameldowaniem). Później anulowanie kosztuje {fee}.',
    generic0: 'Bezpłatne anulowanie do godz. 00:00 (czasu włoskiego) w dniu przyjazdu. Od tej chwili anulowanie kosztuje {fee}.',
    late: 'Rezerwacja zrobiona mniej niż {days} przed zameldowaniem, gdy bezpłatne anulowanie już nie obowiązuje: anulowanie kosztuje {fee}.',
    late0: 'Rezerwacja na ten sam dzień: anulowanie kosztuje {fee}.',
    day: ['1 dzień', '{n} dni'],
    full: 'pełną kwotę pobytu',
    percent: '{p}% wartości pobytu',
    first: 'cenę pierwszej nocy',
  },
  de: {
    title: 'Stornierung',
    dated: 'Kostenlose Stornierung bis {date} um 23:59 Uhr, also bis {days} vor dem Check-in. Danach kostet die Stornierung {fee}.',
    generic: 'Kostenlose Stornierung bis 00:00 Uhr (italienische Zeit) des Tages, der {days} vor der Anreise liegt. Danach kostet die Stornierung {fee}.',
    dated0: 'Kostenlose Stornierung bis {date} um 23:59 Uhr, dem Tag vor dem Check-in. Danach kostet die Stornierung {fee}.',
    generic0: 'Kostenlose Stornierung bis 00:00 Uhr (italienische Zeit) am Anreisetag. Danach kostet die Stornierung {fee}.',
    late: 'Buchung weniger als {days} vor dem Check-in, wenn die kostenlose Stornierung nicht mehr gilt: Die Stornierung kostet {fee}.',
    late0: 'Buchung für denselben Tag: Die Stornierung kostet {fee}.',
    day: ['1 Tag', '{n} Tage'],
    full: 'den gesamten Aufenthaltspreis',
    percent: '{p}% des Aufenthaltspreises',
    first: 'den Preis der ersten Nacht',
  },
  fr: {
    title: 'Annulation',
    dated: 'Annulation gratuite jusqu’au {date} à 23h59, soit jusqu’à {days} avant l’arrivée. Ensuite, l’annulation coûte {fee}.',
    generic: 'Annulation gratuite jusqu’à 00h00 (heure italienne) du jour situé {days} avant l’arrivée. À partir de ce moment, l’annulation coûte {fee}.',
    dated0: 'Annulation gratuite jusqu’au {date} à 23h59, la veille de l’arrivée. Ensuite, l’annulation coûte {fee}.',
    generic0: 'Annulation gratuite jusqu’à 00h00 (heure italienne) le jour de l’arrivée. À partir de ce moment, l’annulation coûte {fee}.',
    late: 'Réservation faite moins de {days} avant l’arrivée, quand l’annulation gratuite ne s’applique plus : l’annulation coûte {fee}.',
    late0: 'Réservation pour le jour même : l’annulation coûte {fee}.',
    day: ['1 jour', '{n} jours'],
    full: 'la totalité du séjour',
    percent: '{p}% du total du séjour',
    first: 'le prix de la première nuit',
  },
  es: {
    title: 'Cancelación',
    dated: 'Cancelación gratuita hasta el {date} a las 23:59, es decir, hasta {days} antes del check-in. Después, cancelar cuesta {fee}.',
    generic: 'Cancelación gratuita hasta las 00:00 (hora italiana) del día situado {days} antes de la llegada. A partir de ese momento, cancelar cuesta {fee}.',
    dated0: 'Cancelación gratuita hasta el {date} a las 23:59, el día antes del check-in. Después, cancelar cuesta {fee}.',
    generic0: 'Cancelación gratuita hasta las 00:00 (hora italiana) del día de llegada. A partir de ese momento, cancelar cuesta {fee}.',
    late: 'Reserva hecha a menos de {days} del check-in, cuando la cancelación gratuita ya no se aplica: cancelar cuesta {fee}.',
    late0: 'Reserva para el mismo día: cancelar cuesta {fee}.',
    day: ['1 día', '{n} días'],
    full: 'el importe total de la estancia',
    percent: 'el {p}% del total de la estancia',
    first: 'el precio de la primera noche',
  },
};

export const cancelTitle = (lang: Locale): string => C[lang].title;

/**
 * The rule as one sentence for the guest. With `checkIn` it names the last free day (until 23:59)
 * and says "up to N days before check-in"; with `total` and `nights` it also says the fee in euro.
 * With `bookedAt` (when the booking was made) a booking made when the free days were already over
 * says so, instead of naming a day in the past.
 */
export function cancelText(lang: Locale, r: CancelRules, o: { checkIn?: string | null; total?: number | null; nights?: number | null; bookedAt?: string | null } = {}): string {
  const c = C[lang];
  const n = Math.max(0, Math.round(r.freeCancellationDays));
  const f = cancelFeeOf(r);
  const known = typeof o.total === 'number' && o.total > 0;
  const amount = known ? money(cancelFeeAmount(r, o.total!, o.nights ?? 1), lang, 2) : null;
  let fee = f.type === 'fixed' ? money(known ? cancelFeeAmount(r, o.total!, o.nights ?? 1) : f.value, lang, 2) : f.type === 'first_night' ? c.first : f.value >= 100 ? c.full : c.percent.replace('{p}', String(f.value));
  if (amount && f.type !== 'fixed') fee += ` (${amount})`;
  const days = (n === 1 ? c.day[0] : c.day[1]).replace('{n}', String(n));
  const deadline = o.checkIn ? cancelDeadline(o.checkIn, n) : null;
  // the last day it is free, until 23:59 (the fee starts at 00:00 of the deadline)
  const date = deadline ? fmtDate(addDays(deadline, -1), lang, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const late = Boolean(deadline && o.bookedAt && todayISO(new Date(o.bookedAt)) >= deadline);
  const tpl = !deadline ? (n === 0 ? c.generic0 : c.generic) : late ? (n === 0 ? c.late0 : c.late) : n === 0 ? c.dated0 : c.dated;
  return tpl.replace('{date}', date).replace('{days}', days).replace('{fee}', fee);
}

/** True when the booking was made after the free cancellation was over (no free days at all). */
export function bookedLate(r: CancelRules, checkIn: string, bookedAt: string): boolean {
  return todayISO(new Date(bookedAt)) >= cancelDeadline(checkIn, r.freeCancellationDays);
}
