import 'server-only';
import type { Booking } from '@/lib/types';
import { chargeDay, chargeLaterRule, plannedCharge } from '@/lib/charge-later';
import { fmtDate, HOTEL_TZ, todayISO } from '@/lib/dates';
import { BookingError } from '../bookings';
import { mutate, readDb } from '../db/store';
import { audit, guestName, notify } from '../events';
import { cardLabel, chargeSavedCard, type ChargeResult } from './card';
import { stripeMode } from './stripe';

/**
 * "Paga dopo": charging the saved card N days before arrival.
 *  · by itself: the hourly job charges the bookings whose day has come (from 9:00 hotel time, so the
 *    guest's bank message does not arrive at night), when "in automatico" is on;
 *  · by hand: "Addebita ora" in Pagamenti, at any moment.
 * When the bank refuses, the owner is told (Telegram too) and the guest gets the e-mail with the
 * link to pay with another card (booking-care.ts → requestNewCard); the job does not try again
 * by itself: "Addebita ora" does.
 */

const euro = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;
const CHARGE_FROM_HOUR = 9;

function hotelHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: HOTEL_TZ, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

/** The bookings still to charge, for the list in Pagamenti (soonest first). */
export function pendingCharges(now = new Date()) {
  const db = readDb();
  const rule = chargeLaterRule(db.settings.payments);
  const today = todayISO(now);
  return db.bookings
    .filter((b) => plannedCharge(b) > 0)
    .map((b) => {
      const on = chargeDay(b.checkIn, rule);
      const room = db.rooms.find((r) => r.id === b.roomId);
      return {
        id: b.id,
        code: b.code,
        guest: guestName(b),
        room: room?.number ?? null,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        amount: plannedCharge(b),
        on,
        due: on <= today,
        auto: rule.auto,
        card: b.card ? cardLabel(b.card) : null,
        failed: b.chargePlan?.outcome === 'failed' ? (b.chargePlan.reason ?? 'la carta non ha pagato') : null,
        asked: Boolean(b.cardRequest && !b.cardRequest.outcome),
      };
    })
    .sort((a, b) => a.on.localeCompare(b.on) || a.checkIn.localeCompare(b.checkIn));
}

export type PendingCharge = ReturnType<typeof pendingCharges>[number];

/** Charges what is left of a "pay later" booking on its card, now. */
export async function chargePlanned(bookingId: string, actor: string): Promise<ChargeResult> {
  const b = readDb().bookings.find((x) => x.id === bookingId);
  if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
  const amount = plannedCharge(b);
  if (!(amount > 0)) throw new BookingError('Non c’è niente da addebitare: la prenotazione è già pagata o annullata.');
  const auto = actor.startsWith('Sistema');
  const r = await chargeSavedCard(b.id, amount, actor, auto ? 'soggiorno · addebito automatico prima dell’arrivo' : 'soggiorno · addebito prima dell’arrivo');
  const now = new Date().toISOString();
  mutate((db) => {
    const x = db.bookings.find((k) => k.id === b.id);
    if (!x?.chargePlan) return;
    x.chargePlan = { ...x.chargePlan, outcome: r.ok ? 'charged' : 'failed', at: now, reason: r.ok ? null : r.reason };
    x.updatedAt = now;
    if (r.ok) {
      notify(db, 'nuovo_pagamento', `Addebito riuscito · ${euro(r.amount)}`, `${x.code} · ${guestName(x)} · arrivo ${fmtDate(x.checkIn)} · pagato con la carta salvata`, `/admin/prenotazioni?id=${x.id}`);
    } else {
      notify(db, 'pagamento_non_completato', `Addebito non riuscito · ${x.code}`, `${guestName(x)} · ${euro(amount)}: ${r.reason}.${!r.declined ? ' Quando è risolto, premi “Addebita ora” in Pagamenti.' : x.guest.email ? ' L’ospite riceve l’email per pagare con un’altra carta.' : ' Contatta l’ospite per un’altra carta.'}`, `/admin/prenotazioni?id=${x.id}`);
    }
  });
  // the bank refused: the guest gets the link to pay with another card (the booking is not cancelled by itself)
  if (!r.ok && r.declined && b.guest.email && !(b.cardRequest && !b.cardRequest.outcome)) {
    const { requestNewCard } = await import('../booking-care');
    try {
      requestNewCard(b.id, 'Sistema', { hours: 48, amount, cancelOnExpiry: false, declined: true, reason: `Addebito prima dell’arrivo non riuscito: ${r.reason}` });
    } catch (e) {
      console.error('[paga dopo] richiesta carta:', (e as Error).message);
    }
  }
  return r;
}

/** The hourly job: charges the "pay later" bookings whose day has come. */
export async function runPlannedCharges(now = new Date()): Promise<string> {
  if (stripeMode() === 'off') return 'spento';
  const db = readDb();
  const rule = chargeLaterRule(db.settings.payments);
  if (!rule.auto) return 'solo a mano';
  const today = todayISO(now);
  // the arrival day itself is charged at any hour: the guest is coming today
  const due = db.bookings.filter((b: Booking) => {
    if (!(plannedCharge(b) > 0) || b.chargePlan?.outcome === 'failed') return false;
    if (b.cardRequest && !b.cardRequest.outcome) return false;
    const on = chargeDay(b.checkIn, rule);
    return on < today || (on === today && (hotelHour(now) >= CHARGE_FROM_HOUR || b.checkIn <= today));
  });
  let ok = 0;
  let failed = 0;
  for (const b of due) {
    try {
      const r = await chargePlanned(b.id, 'Sistema (addebito automatico)');
      if (r.ok) ok++;
      else failed++;
    } catch (e) {
      failed++;
      console.error('[paga dopo]', b.code, (e as Error).message);
    }
  }
  if (due.length) {
    mutate((d) => {
      audit(d, 'Sistema', 'pay_later_run', 'payments', null, `Addebiti prima dell’arrivo: ${ok} riusciti, ${failed} non riusciti`);
    });
  }
  return due.length ? `${ok} addebitati · ${failed} non riusciti` : 'niente da addebitare';
}
