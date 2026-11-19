import 'server-only';
import type { Booking, ChangeRequest, DB, GuestMessage } from '@/lib/types';
import { cancelFeeAmount, cancelRefund, isFreeCancel } from '@/lib/cancellation';
import { isBookingActive, quoteStay, roomConflicts, round2, stayCashPercent } from '@/lib/availability';
import { diffDays, fmtDate, todayISO } from '@/lib/dates';
import { BookingError, cancelBooking, paymentRefundable, validateStay } from './bookings';
import { mutate, newId, readDb } from './db/store';
import { audit, guestName, notify, queueEmail } from './events';
import { chargeSavedCard, cardLabel } from './payments/card';
import { refundGuestPayment } from './payments/refund';
import { onlinePeriods, onlineRoom } from '@/lib/online-price';

/**
 * What the hotel does with a booking after it is made, like on the portals' extranet:
 *  · cancel, also free of charge when the guest asks after the free days (money given back for real);
 *  · no-show: the fee is kept / charged on the card, or waived;
 *  · ask the guest for a new card within X hours, otherwise the booking is cancelled;
 *  · new dates proposed by the hotel or asked by the guest, the other side accepts or declines;
 *  · the conversation with the guest on the booking page (and in the guest area).
 */

const find = (db: DB, id: string): Booking => {
  const b = db.bookings.find((x) => x.id === id);
  if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
  return b;
};
const roomOf = (db: DB, b: Booking) => db.rooms.find((r) => r.id === b.roomId) ?? null;
const euro = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;

/* ------------------------------------------------------------------ */
/* money back                                                          */
/* ------------------------------------------------------------------ */

export interface RefundOutcome {
  /** given back in all */
  refunded: number;
  /** of which on the card (the guest gets it on the card by itself) */
  onCard: number;
  /** of which to be given back by hand (cash, POS, transfer) */
  byHand: number;
  /** the card the money went back to ("Visa •••• 4242"), when known */
  card: string | null;
  /** what could not be given back automatically, in plain words */
  problems: string[];
}

/**
 * Gives back `amount` from the booking's payments: card payments first (newest first), then the
 * others. A card paid on the site is refunded on the card for real; cash, POS and transfers are
 * recorded for the owner to give back by hand; money collected by a portal is refunded there.
 * One "rimborso" e-mail with the total, when asked.
 */
export async function refundBooking(bookingId: string, amount: number, actor: string, notifyGuest: boolean): Promise<RefundOutcome> {
  const out: RefundOutcome = { refunded: 0, onCard: 0, byHand: 0, card: null, problems: [] };
  let left = round2(amount);
  if (!(left > 0)) return out;
  const db = readDb();
  const b = find(db, bookingId);
  const card = (p: { provider: string }) => p.provider === 'stripe' || p.provider === 'stripe_test' || p.provider === 'simulazione';
  const pays = db.payments
    .filter((p) => p.bookingId === b.id && paymentRefundable(db, p) > 0)
    .sort((x, y) => Number(card(y)) - Number(card(x)) || y.createdAt.localeCompare(x.createdAt));
  for (const p of pays) {
    if (left <= 0.004) break;
    const take = round2(Math.min(left, paymentRefundable(readDb(), p)));
    if (!(take > 0)) continue;
    try {
      const r = await refundGuestPayment(p.id, take, actor, false);
      out.refunded = round2(out.refunded + take);
      if (r.via === 'manual') out.byHand = round2(out.byHand + take);
      else {
        out.onCard = round2(out.onCard + take);
        out.card ??= r.card;
      }
      left = round2(left - take);
    } catch (e) {
      out.problems.push((e as Error).message);
    }
  }
  if (left > 0.004 && !out.problems.length) out.problems.push(`${euro(left)} non risultano tra i pagamenti registrati di questa prenotazione.`);
  if (notifyGuest && out.refunded > 0) {
    mutate((d) => {
      const x = find(d, bookingId);
      if (x.guest.email) queueEmail(d, 'rimborso', x.guest.email, { booking: x, room: roomOf(d, x), extra: refundExtra(out) });
    });
  }
  return out;
}

/** What the guest's refund e-mail says: how much, and whether it goes back on the card or by hand. */
function refundExtra(o: RefundOutcome) {
  return { amount: o.refunded, refundVia: o.onCard > 0 && o.byHand > 0 ? ('mixed' as const) : o.onCard > 0 ? ('card' as const) : ('hand' as const), ...(o.card ? { card: o.card } : {}) };
}

/** What the cancellation costs today and what goes back (the fee is never more than the stay). */
export function cancelPreview(db: DB, b: Booking) {
  const nights = diffDays(b.checkIn, b.checkOut);
  const rules = db.settings.payments;
  const free = isFreeCancel(todayISO(), b.checkIn, rules.freeCancellationDays);
  return { free, fee: free ? 0 : cancelFeeAmount(rules, b.total, nights), refund: cancelRefund(rules, todayISO(), { checkIn: b.checkIn, total: b.total, amountPaid: b.amountPaid, nights }) };
}

/**
 * Cancels a booking and gives the money back for real.
 *  · `waive`: free cancellation granted by the hotel (e.g. the guest asked after the free days):
 *    everything paid goes back and the e-mail says there is no fee;
 *  · `refund`: the amount chosen by the owner (default: the rule, i.e. paid minus the fee).
 */
export async function cancelAndRefund(bookingId: string, actor: string, o: { waive?: boolean; refund?: number; reason?: string; notifyGuest?: boolean; emailMessage?: string } = {}) {
  const db = readDb();
  const b = find(db, bookingId);
  if (b.status === 'cancelled') throw new BookingError('La prenotazione è già annullata.');
  const plan = cancelPreview(db, b);
  const amount = o.waive ? b.amountPaid : round2(Math.min(b.amountPaid, Math.max(0, o.refund ?? plan.refund)));
  const money = await refundBooking(b.id, amount, actor, false);
  const reason = [o.reason, o.waive ? 'senza penale (concessa dall’hotel)' : ''].filter(Boolean).join(' · ');
  cancelBooking(b.id, actor, { refundAmount: 0, reason, notifyGuest: o.notifyGuest, emailExtra: o.waive || o.emailMessage ? { waived: o.waive, message: o.emailMessage } : undefined });
  mutate((d) => {
    const x = find(d, b.id);
    // first "cancelled", then "this is what we give back"
    if (o.notifyGuest !== false && money.refunded > 0 && x.guest.email) queueEmail(d, 'rimborso', x.guest.email, { booking: x, room: roomOf(d, x), extra: refundExtra(money) });
    if (x.changeRequest?.status === 'pending') x.changeRequest = { ...x.changeRequest, status: x.changeRequest.kind === 'free_cancel' ? 'accepted' : 'withdrawn', answeredAt: new Date().toISOString() };
    if (x.cardRequest && !x.cardRequest.outcome) x.cardRequest = { ...x.cardRequest, outcome: 'withdrawn', doneAt: new Date().toISOString() };
    if (money.problems.length) notify(d, 'pagamento_non_completato', `Rimborso da completare · ${x.code}`, `${guestName(x)}: ${money.problems.join(' ')}`, `/admin/prenotazioni?id=${x.id}`);
  });
  return { ...money, waived: Boolean(o.waive), fee: o.waive ? 0 : plan.fee };
}

/* ------------------------------------------------------------------ */
/* no-show                                                             */
/* ------------------------------------------------------------------ */

export function noShowPreview(db: DB, b: Booking) {
  const fee = cancelFeeAmount(db.settings.payments, b.total, diffDays(b.checkIn, b.checkOut));
  return { fee, paid: b.amountPaid, toCharge: round2(Math.max(0, fee - b.amountPaid)), toRefund: round2(Math.max(0, b.amountPaid - fee)), card: b.card ? cardLabel(b.card) : null };
}

/**
 * The guest did not arrive. The booking is closed (the remaining nights are free again) and the
 * guest gets an e-mail saying what happened to the fee:
 *  · charge: the fee is kept from what was paid (the rest goes back) or charged on the card;
 *    when the card refuses or there is none, the fee stays "due" and the owner can ask for a new card;
 *  · waive: no fee, everything paid goes back.
 */
export async function markNoShow(bookingId: string, actor: string, o: { waive: boolean; fee?: number }) {
  const db = readDb();
  const b = find(db, bookingId);
  if (b.status !== 'confirmed') throw new BookingError('Si può segnare come no-show solo una prenotazione confermata.');
  if (todayISO() < b.checkIn) throw new BookingError(`Il no-show si segna dal giorno di arrivo (${fmtDate(b.checkIn, 'it', { weekday: 'long', day: 'numeric', month: 'long' })}).`);
  const plan = noShowPreview(db, b);
  const fee = o.waive ? 0 : round2(Math.min(b.total, Math.max(0, o.fee ?? plan.fee)));
  let outcome: 'charged' | 'waived' | 'due' = o.waive ? 'waived' : 'charged';
  let charged = 0;
  let declined: string | null = null;
  const money = await refundBooking(b.id, o.waive ? b.amountPaid : round2(Math.max(0, b.amountPaid - fee)), actor, false);
  if (!o.waive && fee > b.amountPaid + 0.004) {
    const r = await chargeSavedCard(b.id, round2(fee - b.amountPaid), actor, 'penale no-show');
    if (r.ok) charged = r.amount;
    else {
      outcome = 'due';
      declined = r.reason;
    }
  }
  const now = new Date().toISOString();
  const after = mutate((d) => {
    const x = find(d, b.id);
    x.status = 'cancelled';
    x.cancelledAt = now;
    x.updatedAt = now;
    x.noShow = { at: now, by: actor, fee, outcome };
    x.notes = [x.notes, `No-show: ${outcome === 'waived' ? 'penale non applicata' : outcome === 'due' ? `penale ${euro(fee)} da incassare` : `penale ${euro(fee)}`}`].filter(Boolean).join(' · ');
    if (x.changeRequest?.status === 'pending') x.changeRequest = { ...x.changeRequest, status: 'withdrawn', answeredAt: now };
    const due = round2(Math.max(0, fee - x.amountPaid));
    if (x.guest.email) queueEmail(d, 'no_show', x.guest.email, { booking: x, room: roomOf(d, x), extra: { outcome, amount: outcome === 'waived' ? money.refunded : outcome === 'due' ? due : fee } });
    audit(d, actor, 'no_show', 'booking', x.id, `${x.code} · no-show · ${outcome === 'waived' ? 'penale non applicata' : `penale ${euro(fee)}`}${charged ? ` · addebitati ${euro(charged)} sulla carta` : ''}${money.refunded ? ` · restituiti ${euro(money.refunded)}` : ''}${declined ? ` · carta: ${declined}` : ''}`);
    return { due };
  });
  return { outcome, fee, charged, refunded: money.refunded, byHand: money.byHand, problems: money.problems, declined, due: after.due };
}

/* ------------------------------------------------------------------ */
/* charging the card, asking for a new one                              */
/* ------------------------------------------------------------------ */

/** The owner charges the card kept with the booking (balance, extra, late cancellation…). */
export async function chargeBooking(bookingId: string, amount: number, actor: string, why: string) {
  const r = await chargeSavedCard(bookingId, amount, actor, why || 'addebito');
  if (r.ok) {
    mutate((d) => {
      const x = find(d, bookingId);
      if (x.noShow?.outcome === 'due' && x.amountPaid + 0.004 >= x.noShow.fee) x.noShow = { ...x.noShow, outcome: 'charged' };
      notify(d, 'nuovo_pagamento', `Addebito sulla carta · ${euro(r.amount)}`, `${x.code} · ${guestName(x)} · ${why || 'addebito'}`, `/admin/prenotazioni?id=${x.id}`);
    });
  }
  return r;
}

export const CARD_HOURS = [12, 24, 48, 72] as const;

/**
 * Asks the guest for a new card within `hours`: e-mail with the link to the guest area, where the
 * guest types it on the secure payment page (and pays `amount`, when there is one). When the
 * deadline passes without a new card the booking is cancelled (if `cancelOnExpiry`).
 */
export function requestNewCard(bookingId: string, actor: string, o: { hours: number; amount: number; cancelOnExpiry: boolean; declined: boolean; reason?: string }) {
  return mutate((db) => {
    const b = find(db, bookingId);
    if (!b.guest.email) throw new BookingError('Questa prenotazione non ha un indirizzo email: chiama l’ospite.');
    if (b.status === 'cancelled' && !(b.noShow?.outcome === 'due')) throw new BookingError('La prenotazione è annullata.');
    const hours = Math.min(168, Math.max(1, Math.round(o.hours)));
    const now = new Date();
    const deadline = new Date(now.getTime() + hours * 3_600_000).toISOString();
    const amount = round2(Math.max(0, o.amount));
    const cancelOnExpiry = o.cancelOnExpiry && b.status !== 'cancelled';
    b.cardRequest = { at: now.toISOString(), by: actor, deadline, amount, reason: o.reason || (o.declined ? 'La carta non ha pagato' : 'Carta da aggiornare'), cancelOnExpiry, doneAt: null, outcome: null };
    b.updatedAt = now.toISOString();
    queueEmail(db, 'carta_da_aggiornare', b.guest.email, { booking: b, room: roomOf(db, b), extra: { deadline, amount, cancelOnExpiry, declined: o.declined } });
    audit(db, actor, 'card_request', 'booking', b.id, `${b.code} · chiesta una nuova carta entro ${hours} ore${amount ? ` (da pagare ${euro(amount)})` : ''}${cancelOnExpiry ? ' · poi la prenotazione si cancella' : ''}`);
    return { deadline, hours };
  });
}

export function withdrawCardRequest(bookingId: string, actor: string): void {
  mutate((db) => {
    const b = find(db, bookingId);
    if (!b.cardRequest || b.cardRequest.outcome) throw new BookingError('Non c’è una richiesta in corso.');
    b.cardRequest = { ...b.cardRequest, outcome: 'withdrawn', doneAt: new Date().toISOString() };
    audit(db, actor, 'card_request_withdrawn', 'booking', b.id, `${b.code} · richiesta della carta ritirata`);
  });
}

/** Deadlines of the card requests: runs every minute. Returns how many expired. */
export function expireCardRequests(now = new Date()): number {
  const due = readDb().bookings.filter((b) => b.cardRequest && !b.cardRequest.outcome && new Date(b.cardRequest.deadline) <= now);
  for (const b of due) {
    const cancel = b.cardRequest!.cancelOnExpiry && b.status !== 'cancelled';
    mutate((d) => {
      const x = d.bookings.find((k) => k.id === b.id);
      if (!x?.cardRequest || x.cardRequest.outcome) return;
      x.cardRequest = { ...x.cardRequest, outcome: 'expired', doneAt: now.toISOString() };
      if (!cancel) notify(d, 'pagamento_non_completato', `Carta non aggiornata · ${x.code}`, `${guestName(x)} non ha inserito una nuova carta entro il termine.`, `/admin/prenotazioni?id=${x.id}`);
    });
    if (cancel) {
      try {
        cancelBooking(b.id, 'Sistema', { reason: 'carta non aggiornata entro il termine', emailExtra: { message: b.guest.lang === 'it' || !b.guest.lang ? 'La carta non è stata aggiornata entro il termine indicato.' : undefined } });
        mutate((d) => {
          const x = find(d, b.id);
          notify(d, 'prenotazione_cancellata', `Cancellata: carta non aggiornata · ${x.code}`, `${guestName(x)} non ha inserito una nuova carta entro il termine: la prenotazione è stata cancellata e le notti sono di nuovo libere.${x.amountPaid > 0 ? ` Aveva pagato ${euro(x.amountPaid)}: decidi tu se restituirli.` : ''}`, `/admin/prenotazioni?id=${x.id}`);
        });
      } catch (e) {
        console.error('[carta] cancellazione alla scadenza:', (e as Error).message);
      }
    }
  }
  return due.length;
}

const timer = globalThis as typeof globalThis & { __lancoraCareTimer?: ReturnType<typeof setInterval> };
export function startCareSweeper(): void {
  if (timer.__lancoraCareTimer) return;
  const run = () => {
    try {
      expireCardRequests();
    } catch (e) {
      console.error('[carta] scadenze:', (e as Error).message);
    }
  };
  timer.__lancoraCareTimer = setInterval(run, 60_000);
  timer.__lancoraCareTimer.unref?.();
  setTimeout(run, 8_000).unref?.();
}

/* ------------------------------------------------------------------ */
/* new dates, free cancellation asked by the guest                      */
/* ------------------------------------------------------------------ */

/** Price and availability of the same booking with other dates (and room). */
export function quoteChange(db: DB, b: Booking, checkIn: string, checkOut: string, roomId?: string | null) {
  validateStay(checkIn, checkOut);
  const rid = roomId ?? b.roomId;
  const room = db.rooms.find((r) => r.id === rid) ?? null;
  if (!room) throw new BookingError('Camera non trovata.', 'not_found');
  if (room.maxGuests < b.adults + b.children) throw new BookingError(`La camera ${room.number} ospita al massimo ${room.maxGuests} ${room.maxGuests === 1 ? 'persona' : 'persone'}.`, 'capacity');
  const busy = roomConflicts(db, room.id, checkIn, checkOut, { ignoreBookingId: b.id });
  // a booking made on the site keeps the site's prices (online increase included, when it is on)
  const site = b.source === 'sito';
  const priced = site ? onlineRoom(room, db.settings) : room;
  const periods = site ? onlinePeriods(db.ratePeriods, db.settings) : db.ratePeriods;
  const q = quoteStay(priced, checkIn, checkOut, periods, null, { guests: b.adults + b.children, singleUsePercent: db.settings.pricing?.singleUsePercent });
  // a cash booking keeps the cash price
  const total = b.paymentMethod === 'cash' ? round2(q.total * (1 - stayCashPercent(priced, checkIn, checkOut, periods, db.settings.payments) / 100)) : q.total;
  return { roomId: room.id, roomNumber: room.number, total, nights: q.nights, free: busy.length === 0, busy: busy[0] ? `${fmtDate(busy[0].from)} → ${fmtDate(busy[0].to)}` : null };
}

/**
 * New dates proposed by the hotel (the guest gets an e-mail and answers in the guest area) or asked
 * by the guest (the owner is told on Telegram and answers on the booking page).
 */
export function proposeDates(bookingId: string, by: 'hotel' | 'guest', actor: string, o: { checkIn: string; checkOut: string; roomId?: string | null; total?: number | null; note?: string }): ChangeRequest {
  return mutate((db) => {
    const b = find(db, bookingId);
    if (b.status !== 'confirmed' || !isBookingActive(b)) throw new BookingError('La prenotazione non è attiva.');
    if (b.checkOut <= todayISO()) throw new BookingError('Il soggiorno è già concluso.');
    if (b.changeRequest?.status === 'pending') throw new BookingError(by === 'guest' ? 'pending' : 'C’è già una richiesta in attesa: rispondi prima a quella (o ritirala).');
    if (o.checkIn === b.checkIn && o.checkOut === b.checkOut && (o.roomId ?? b.roomId) === b.roomId) throw new BookingError('Sono le stesse date di adesso.');
    const q = quoteChange(db, b, o.checkIn, o.checkOut, o.roomId);
    if (!q.free) throw new BookingError(by === 'guest' ? 'not_available' : `La camera ${q.roomNumber} è occupata in quelle date (${q.busy}).`, 'conflict');
    const total = by === 'hotel' && typeof o.total === 'number' && o.total >= 0 ? round2(o.total) : q.total;
    const now = new Date().toISOString();
    const req: ChangeRequest = { id: newId('chg-'), kind: 'dates', by, checkIn: o.checkIn, checkOut: o.checkOut, roomId: q.roomId, total, note: (o.note ?? '').slice(0, 800), at: now, status: 'pending', answeredAt: null };
    b.changeRequest = req;
    b.updatedAt = now;
    const when = `${fmtDate(o.checkIn)} → ${fmtDate(o.checkOut)}`;
    if (by === 'hotel') {
      if (b.guest.email) queueEmail(db, 'richiesta_modifica', b.guest.email, { booking: b, room: roomOf(db, b), extra: { checkIn: o.checkIn, checkOut: o.checkOut, total, message: req.note || undefined } });
      audit(db, actor, 'change_proposed', 'booking', b.id, `${b.code} · proposte nuove date ${when} · ${euro(total)}`);
    } else {
      notify(db, 'messaggio_ospite', `Richiesta cambio date · ${b.code}`, `${guestName(b)} chiede ${when} (ora ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}) · nuovo totale ${euro(total)}${req.note ? `\n«${req.note.slice(0, 160)}»` : ''}`, `/admin/prenotazioni?id=${b.id}`);
      audit(db, 'Ospite', 'change_requested', 'booking', b.id, `${b.code} · chieste nuove date ${when}`);
    }
    return req;
  });
}

/** The guest asks to cancel without the fee (after the free days): the owner decides. */
export function askFreeCancel(bookingId: string, note: string): ChangeRequest {
  return mutate((db) => {
    const b = find(db, bookingId);
    if (b.status !== 'confirmed') throw new BookingError('La prenotazione non è attiva.');
    const now = new Date().toISOString();
    const req: ChangeRequest = { id: newId('chg-'), kind: 'free_cancel', by: 'guest', checkIn: b.checkIn, checkOut: b.checkOut, roomId: b.roomId, total: b.total, note: note.slice(0, 800), at: now, status: 'pending', answeredAt: null };
    b.changeRequest = req;
    b.updatedAt = now;
    notify(db, 'messaggio_ospite', `Richiesta di cancellazione gratuita · ${b.code}`, `${guestName(b)} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)} · pagato ${euro(b.amountPaid)}${req.note ? `\n«${req.note.slice(0, 160)}»` : ''}`, `/admin/prenotazioni?id=${b.id}`);
    audit(db, 'Ospite', 'free_cancel_requested', 'booking', b.id, `${b.code} · chiesta la cancellazione gratuita`);
    return req;
  });
}

/**
 * The other side answers a pending request. New dates accepted → the booking moves (room re-checked
 * at that moment) and the guest gets the updated summary. Free cancellation accepted → cancelled
 * without fee, everything paid goes back.
 */
export async function answerChange(bookingId: string, by: 'hotel' | 'guest', accept: boolean, actor: string, answer = '') {
  const db = readDb();
  const b = find(db, bookingId);
  const req = b.changeRequest;
  if (!req || req.status !== 'pending') throw new BookingError('Non c’è una richiesta in attesa.');
  if (req.by === by) throw new BookingError('La risposta spetta all’altra parte.');
  if (accept && req.kind === 'free_cancel') {
    const r = await cancelAndRefund(b.id, actor, { waive: true, reason: 'cancellazione gratuita chiesta dall’ospite' });
    return { kind: req.kind, accepted: true, refunded: r.refunded, problems: r.problems };
  }
  return mutate((d) => {
    const x = find(d, bookingId);
    const r = x.changeRequest!;
    const now = new Date().toISOString();
    if (!accept) {
      x.changeRequest = { ...r, status: 'refused', answeredAt: now, answer: answer.slice(0, 800) };
      if (by === 'hotel' && x.guest.email) queueEmail(d, 'risposta_modifica', x.guest.email, { booking: x, room: roomOf(d, x), extra: { kind: r.kind, message: answer || undefined } });
      if (by === 'guest') notify(d, 'messaggio_ospite', `Proposta rifiutata · ${x.code}`, `${guestName(x)} non accetta le nuove date ${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)}: la prenotazione resta com’era.${answer ? `\n«${answer.slice(0, 160)}»` : ''}`, `/admin/prenotazioni?id=${x.id}`);
      audit(d, actor, 'change_refused', 'booking', x.id, `${x.code} · ${r.kind === 'free_cancel' ? 'cancellazione gratuita' : 'nuove date'} rifiutata`);
      return { kind: r.kind, accepted: false, refunded: 0, problems: [] as string[] };
    }
    const conflicts = r.roomId ? roomConflicts(d, r.roomId, r.checkIn, r.checkOut, { ignoreBookingId: x.id }) : [];
    if (conflicts.length) throw new BookingError(by === 'guest' ? 'not_available' : `Nel frattempo la camera è stata occupata (${fmtDate(conflicts[0]!.from)} → ${fmtDate(conflicts[0]!.to)}): proponi altre date.`, 'conflict');
    const before = `${fmtDate(x.checkIn)} → ${fmtDate(x.checkOut)}, ${euro(x.total)}`;
    const roomBefore = x.roomId;
    x.checkIn = r.checkIn;
    x.checkOut = r.checkOut;
    x.roomId = r.roomId;
    x.total = r.total;
    x.updatedAt = now;
    x.changeRequest = { ...r, status: 'accepted', answeredAt: now, answer: answer.slice(0, 800) };
    const room = roomOf(d, x);
    const changes = `${fmtDate(r.checkIn, x.guest.lang ?? 'it', { weekday: 'long', day: 'numeric', month: 'long' })} → ${fmtDate(r.checkOut, x.guest.lang ?? 'it', { weekday: 'long', day: 'numeric', month: 'long' })}`;
    if (x.guest.email) queueEmail(d, 'modifica', x.guest.email, { booking: x, room, extra: { changes } });
    if (by === 'guest') notify(d, 'nuova_prenotazione', `Nuove date accettate · ${x.code}`, `${guestName(x)} ha accettato: ${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)} · ${euro(r.total)}${x.amountPaid > r.total ? ` · pagato ${euro(x.amountPaid)}: c’è una differenza da restituire` : ''}`, `/admin/prenotazioni?id=${x.id}`);
    audit(d, actor, 'change_accepted', 'booking', x.id, `${x.code} · da ${before} a ${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)}, ${euro(r.total)}${roomBefore !== r.roomId ? ` · camera ${room?.number ?? '—'}` : ''}`);
    return { kind: r.kind, accepted: true, refunded: 0, problems: [] as string[] };
  });
}

export function withdrawChange(bookingId: string, by: 'hotel' | 'guest', actor: string): void {
  mutate((db) => {
    const b = find(db, bookingId);
    if (!b.changeRequest || b.changeRequest.status !== 'pending' || b.changeRequest.by !== by) throw new BookingError('Non c’è una richiesta da ritirare.');
    b.changeRequest = { ...b.changeRequest, status: 'withdrawn', answeredAt: new Date().toISOString() };
    audit(db, actor, 'change_withdrawn', 'booking', b.id, `${b.code} · richiesta ritirata`);
  });
}

/* ------------------------------------------------------------------ */
/* the conversation                                                    */
/* ------------------------------------------------------------------ */

export interface ThreadMessage {
  id: string;
  sender: 'guest' | 'hotel';
  name: string;
  body: string;
  subject: string;
  at: string;
  read: boolean;
}

/** Messages of one booking, oldest first (what the guest wrote from the site and the hotel's replies). */
export function threadOf(db: DB, bookingId: string): ThreadMessage[] {
  return db.messages
    .filter((m) => m.bookingId === bookingId)
    .map((m) => ({ id: m.id, sender: m.sender ?? 'guest', name: m.name, body: m.body, subject: m.subject, at: m.createdAt, read: m.read }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Writes in the conversation of a booking. The hotel's message reaches the guest by e-mail too
 * (with the link to answer from the guest area); the guest's message reaches the owner on Telegram.
 */
export function postMessage(bookingId: string, sender: 'guest' | 'hotel', body: string, actor: string, emailText?: string): GuestMessage {
  const text = body.replace(/\r/g, '').trim().slice(0, 3000);
  if (text.length < 1) throw new BookingError('Scrivi il messaggio.');
  return mutate((db) => {
    const b = find(db, bookingId);
    const now = new Date().toISOString();
    const m: GuestMessage = {
      id: newId('m-'),
      bookingId: b.id,
      name: sender === 'hotel' ? actor : guestName(b),
      email: b.guest.email,
      subject: sender === 'hotel' ? `Risposta dell’hotel · ${b.code}` : `Messaggio · ${b.code}`,
      body: text,
      source: 'area_ospite',
      read: sender === 'hotel',
      createdAt: now,
      sender,
    };
    db.messages.unshift(m);
    if (sender === 'hotel') {
      // emailText: the same message translated into the guest's language (the panel keeps the original)
      if (b.guest.email) queueEmail(db, 'messaggio_hotel', b.guest.email, { booking: b, room: roomOf(db, b), extra: { message: emailText?.trim() ? emailText.trim().slice(0, 4000) : text } });
      // what the guest wrote before is answered
      for (const x of db.messages) if (x.bookingId === b.id && (x.sender ?? 'guest') === 'guest') x.read = true;
      audit(db, actor, 'guest_message', 'booking', b.id, `${b.code} · messaggio all’ospite`);
    } else {
      notify(db, 'messaggio_ospite', `Messaggio · ${b.code}`, `${guestName(b)}: ${text.slice(0, 200)}`, `/admin/prenotazioni?id=${b.id}`);
    }
    return m;
  });
}

export function markThreadRead(bookingId: string): number {
  const unread = readDb().messages.filter((m) => m.bookingId === bookingId && (m.sender ?? 'guest') === 'guest' && !m.read).length;
  if (!unread) return 0;
  mutate((db) => {
    for (const m of db.messages) if (m.bookingId === bookingId && (m.sender ?? 'guest') === 'guest') m.read = true;
  });
  return unread;
}
