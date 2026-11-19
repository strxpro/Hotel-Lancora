import 'server-only';
import { cancelRefund } from '@/lib/cancellation';
import type { Booking, BookingSource, DB, Payment, PaymentProvider } from '@/lib/types';
import { amountDueNow, findPromo, isBookingActive, isPubliclyBookable, quoteStay, roomConflicts, round2, stayCashPercent } from '@/lib/availability';
import { addDays, diffDays, fmtDate, isValidISODate, todayISO } from '@/lib/dates';
import { afterCommit, mutate, newId, newToken, readDb } from './db/store';
import { audit, guestName, notify, queueEmail } from './events';
import { notti, ospiti } from '@/lib/utils';
import { onlinePeriods, onlineRoom } from '@/lib/online-price';

export class BookingError extends Error {
  constructor(message: string, public code: 'invalid' | 'conflict' | 'not_found' | 'expired' | 'capacity' = 'invalid') {
    super(message);
  }
}

const SOURCE_LABEL: Record<BookingSource, string> = { sito: 'Sito web', telefono: 'Telefono', email: 'Email', walkin: 'Walk-in', booking: 'Booking.com', expedia: 'Expedia', altro_ota: 'Altro OTA' };
export const sourceLabel = (s: BookingSource) => SOURCE_LABEL[s];

function makeCode(db: DB): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c: string;
  do c = 'LA-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => A[b % A.length]).join('');
  while (db.bookings.some((b) => b.code === c));
  return c;
}

export function validateStay(checkIn: string, checkOut: string, opts: { allowPast?: boolean } = {}): void {
  if (!isValidISODate(checkIn) || !isValidISODate(checkOut)) throw new BookingError('Date non valide.');
  if (checkOut <= checkIn) throw new BookingError('La partenza deve essere successiva all’arrivo.');
  if (!opts.allowPast && checkIn < todayISO()) throw new BookingError('Non è possibile prenotare date passate.');
  if (diffDays(checkIn, checkOut) > 30) throw new BookingError('Il soggiorno massimo prenotabile online è di 30 notti.');
}

function assertFree(db: DB, roomId: string, checkIn: string, checkOut: string, ignoreBookingId?: string): void {
  const conflicts = roomConflicts(db, roomId, checkIn, checkOut, { ignoreBookingId });
  if (conflicts.length) {
    const c = conflicts[0]!;
    throw new BookingError(
      c.kind === 'block'
        ? `Camera bloccata dal ${fmtDate(c.from)} al ${fmtDate(c.to)} (${c.label}).`
        : `Camera già occupata dal ${fmtDate(c.from)} al ${fmtDate(c.to)} (${c.label}).`,
      'conflict',
    );
  }
}

export interface WebsiteBookingInput {
  roomId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges: number[];
  guest: { firstName: string; lastName: string; email: string; phone: string; country?: string };
  specialRequests: string;
  consents: { privacy: boolean; terms: boolean; marketing: boolean };
  promoCode: string | null;
}

/** Step 1 of a website booking: reserve the room for a few minutes while the guest pays. */
export function createWebsiteHold(input: WebsiteBookingInput): { booking: Booking; dueNow: number } {
  validateStay(input.checkIn, input.checkOut);
  if (!input.consents.privacy || !input.consents.terms) throw new BookingError('È necessario accettare privacy e condizioni.');
  return mutate((db) => {
    const room = db.rooms.find((r) => r.id === input.roomId);
    if (!room || !isPubliclyBookable(room)) throw new BookingError('Camera non disponibile.', 'not_found');
    if (input.adults < 1) throw new BookingError('È richiesto almeno un adulto.');
    if (input.adults + input.children > room.maxGuests) throw new BookingError(`La camera ospita al massimo ${room.maxGuests} ${room.maxGuests === 1 ? 'persona' : 'persone'}.`, 'capacity');
    assertFree(db, room.id, input.checkIn, input.checkOut);
    const promo = findPromo(db, input.promoCode);
    const q = quoteStay(onlineRoom(room, db.settings), input.checkIn, input.checkOut, onlinePeriods(db.ratePeriods, db.settings), promo, { guests: input.adults + input.children, singleUsePercent: db.settings.pricing?.singleUsePercent });
    const now = new Date();
    const b: Booking = {
      id: newId('bk-'),
      code: makeCode(db),
      token: newToken(),
      roomId: room.id,
      guest: input.guest,
      adults: input.adults,
      children: input.children,
      childrenAges: input.childrenAges.slice(0, input.children),
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      total: q.total,
      discount: q.discount,
      promoCode: q.promo?.code ?? null,
      amountPaid: 0,
      status: 'pending_payment',
      holdExpiresAt: new Date(now.getTime() + db.settings.payments.holdMinutes * 60000).toISOString(),
      source: 'sito',
      otaRef: null,
      specialRequests: input.specialRequests,
      notes: '',
      consents: input.consents,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      cancelledAt: null,
      simulated: false,
      demo: false,
    };
    db.bookings.push(b);
    audit(db, 'Sito web', 'hold', 'booking', b.id, `${b.code} · camera ${room.number} · ${b.checkIn} → ${b.checkOut}`);
    return { booking: b, dueNow: amountDueNow(b.total, db.settings.payments) };
  });
}

/** Payment succeeded (Stripe webhook or explicit simulation). Idempotent on `reference`. */
export function confirmPayment(bookingId: string, p: { amount: number; provider: PaymentProvider; reference: string | null }): Booking {
  return mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
    if (p.reference && db.payments.some((x) => x.reference === p.reference && x.status === 'succeeded')) return b;
    // Paid after the hold ran out (already released, or expired a moment ago and not yet swept):
    // only re-activate when the room is still free, otherwise two guests would get the same nights
    if (!isBookingActive(b)) {
      if (b.roomId && roomConflicts(db, b.roomId, b.checkIn, b.checkOut, { ignoreBookingId: b.id }).length) {
        if (b.status === 'pending_payment') {
          // close it here, as the sweeper would: the guest did pay, so no "Prenotazione non completata" later
          b.status = 'cancelled';
          b.cancelledAt = new Date().toISOString();
          b.notes = [b.notes, 'Pagamento arrivato dopo la scadenza: camera non più libera, da rimborsare'].filter(Boolean).join(' · ');
          audit(db, 'Sistema', 'hold_expired', 'booking', b.id, b.code);
        }
        notify(db, 'pagamento_non_completato', `Pagamento ricevuto per prenotazione scaduta ${b.code}`, 'La camera non è più libera: verifica e rimborsa.', `/admin/prenotazioni?id=${b.id}`);
        return b;
      }
      b.cancelledAt = null;
    }
    const pay: Payment = { id: newId('pay-'), bookingId: b.id, amount: round2(p.amount), kind: p.amount >= b.total ? 'full' : 'deposit', provider: p.provider, status: 'succeeded', reference: p.reference, createdAt: new Date().toISOString() };
    db.payments.push(pay);
    const wasPending = b.status !== 'confirmed';
    b.amountPaid = round2(b.amountPaid + pay.amount);
    if (p.provider === 'stripe_test' || p.provider === 'stripe' || p.provider === 'simulazione') b.paymentMethod = 'card';
    b.status = 'confirmed';
    b.holdExpiresAt = null;
    b.updatedAt = pay.createdAt;
    const room = db.rooms.find((r) => r.id === b.roomId) ?? null;
    if (wasPending) {
      queueEmail(db, 'conferma', b.guest.email, { booking: b, room });
      notify(db, 'nuova_prenotazione', `Nuova prenotazione dal sito · ${b.code}`, `${guestName(b)} · camera ${room?.number ?? '—'} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)} · ${ospiti(b.adults + b.children)}`, `/admin/prenotazioni?id=${b.id}`);
    }
    notify(db, 'nuovo_pagamento', `Pagamento ricevuto · € ${pay.amount.toFixed(2)}`, `${b.code} · ${guestName(b)} · ${p.provider === 'simulazione' ? 'pagamento simulato (demo)' : p.provider === 'stripe_test' ? 'Stripe test mode' : p.provider}`, `/admin/pagamenti`);
    audit(db, p.provider === 'stripe_test' ? 'Stripe webhook' : 'Sito web', 'payment', 'booking', b.id, `${b.code} pagato € ${pay.amount.toFixed(2)} (${p.provider})`);
    // "Ricevi subito in automatico": the money goes on to the hotel's card (only when switched on)
    if ((p.provider === 'stripe' || p.provider === 'stripe_test') && db.settings.stripeConnect.autoInstant) afterCommit(() => import('./payments/instant').then((m) => m.autoInstantAfterPayment()));
    return b;
  });
}

/**
 * The guest chose to pay cash at the hotel: the cash price (total minus the cash discount set in
 * Pagamenti) becomes the booking total and the room is confirmed without an online payment.
 */
export function confirmPayAtHotel(bookingId: string): { booking: Booking; saved: number } {
  return mutate((db) => {
    const p = db.settings.payments;
    if (!p.allowCashAtHotel) throw new BookingError('Il pagamento in struttura non è disponibile.');
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
    if (b.status !== 'pending_payment') throw new BookingError('La prenotazione temporanea è scaduta.', 'expired');
    // hold ran out a moment ago (not yet released): confirm only if nobody took the room meanwhile
    if (!isBookingActive(b) && b.roomId && roomConflicts(db, b.roomId, b.checkIn, b.checkOut, { ignoreBookingId: b.id }).length) {
      throw new BookingError('La prenotazione temporanea è scaduta.', 'expired');
    }
    const roomOf = db.rooms.find((r) => r.id === b.roomId);
    const pct = roomOf ? stayCashPercent(onlineRoom(roomOf, db.settings), b.checkIn, b.checkOut, onlinePeriods(db.ratePeriods, db.settings), p) : Math.max(0, p.cashDiscountPercent);
    const saved = round2((b.total * pct) / 100);
    b.total = round2(b.total - saved);
    b.discount = round2(b.discount + saved);
    b.paymentMethod = 'cash';
    b.status = 'confirmed';
    b.holdExpiresAt = null;
    b.updatedAt = new Date().toISOString();
    b.notes = [b.notes, `Pagamento in contanti all’arrivo${saved ? ` (sconto contanti ${Math.round(pct * 10) / 10}% · −€ ${saved.toFixed(2)})` : ''}`].filter(Boolean).join(' · ');
    const room = db.rooms.find((r) => r.id === b.roomId) ?? null;
    queueEmail(db, 'conferma', b.guest.email, { booking: b, room });
    notify(db, 'nuova_prenotazione', `Nuova prenotazione dal sito · ${b.code}`, `${guestName(b)} · camera ${room?.number ?? '—'} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)} · paga in contanti all’arrivo € ${b.total.toFixed(2)}`, `/admin/prenotazioni?id=${b.id}`);
    audit(db, 'Sito web', 'pay_at_hotel', 'booking', b.id, `${b.code} · contanti in struttura € ${b.total.toFixed(2)}`);
    return { booking: b, saved };
  });
}

export function paymentFailed(bookingId: string, reason: string): void {
  mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    db.payments.push({ id: newId('pay-'), bookingId, amount: 0, kind: 'deposit', provider: 'simulazione', status: 'failed', reference: null, createdAt: new Date().toISOString() });
    notify(db, 'pagamento_non_completato', `Pagamento non completato · ${b.code}`, `${guestName(b)} · ${reason}. La camera resta riservata fino alla scadenza.`, `/admin/prenotazioni?id=${b.id}`);
    audit(db, 'Sito web', 'payment_failed', 'booking', b.id, reason);
  });
}

export function refundableAmount(db: DB, b: Booking): number {
  // free until 00:00 of the day N days before arrival; afterwards what was paid minus the fee
  return cancelRefund(db.settings.payments, todayISO(), { checkIn: b.checkIn, total: b.total, amountPaid: b.amountPaid, nights: diffDays(b.checkIn, b.checkOut) });
}

export function cancelBooking(bookingId: string, actor: string, opts: { refundAmount?: number; reason?: string; notifyGuest?: boolean; emailExtra?: { message?: string; waived?: boolean } } = {}): Booking {
  return mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
    if (b.status === 'cancelled') throw new BookingError('La prenotazione è già annullata.');
    b.status = 'cancelled';
    b.cancelledAt = new Date().toISOString();
    b.holdExpiresAt = null;
    b.updatedAt = b.cancelledAt;
    if (opts.reason) b.notes = [b.notes, `Annullata: ${opts.reason}`].filter(Boolean).join(' · ');
    const room = db.rooms.find((r) => r.id === b.roomId) ?? null;
    const refund = round2(Math.min(b.amountPaid, Math.max(0, opts.refundAmount ?? 0)));
    if (opts.notifyGuest !== false && b.guest.email) queueEmail(db, 'cancellazione', b.guest.email, { booking: b, room, ...(opts.emailExtra ? { extra: opts.emailExtra } : {}) });
    if (refund > 0) {
      db.payments.push({ id: newId('pay-'), bookingId: b.id, amount: -refund, kind: 'refund', provider: 'simulazione', status: 'succeeded', reference: null, createdAt: new Date().toISOString() });
      b.amountPaid = round2(b.amountPaid - refund);
      queueEmail(db, 'rimborso', b.guest.email, { booking: b, room, extra: { amount: refund } });
    }
    notify(db, 'prenotazione_cancellata', `Prenotazione cancellata · ${b.code}`, `${guestName(b)} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}${refund ? ` · rimborso € ${refund.toFixed(2)}` : ''}. Le notti sono di nuovo disponibili.`, `/admin/prenotazioni?id=${b.id}`);
    audit(db, actor, 'cancel', 'booking', b.id, `${b.code}${refund ? ` rimborso € ${refund}` : ''}${opts.reason ? ` · ${opts.reason}` : ''}`);
    return b;
  });
}

export function refundPayment(bookingId: string, amount: number, actor: string): Booking {
  return mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
    const value = round2(Math.min(amount, b.amountPaid));
    if (value <= 0) throw new BookingError('Nessun importo rimborsabile.');
    db.payments.push({ id: newId('pay-'), bookingId: b.id, amount: -value, kind: 'refund', provider: 'simulazione', status: 'succeeded', reference: null, createdAt: new Date().toISOString() });
    b.amountPaid = round2(b.amountPaid - value);
    b.updatedAt = new Date().toISOString();
    queueEmail(db, 'rimborso', b.guest.email, { booking: b, room: db.rooms.find((r) => r.id === b.roomId) ?? null, extra: { amount: value } });
    audit(db, actor, 'refund', 'booking', b.id, `Rimborso € ${value.toFixed(2)} (simulato)`);
    return b;
  });
}

/* ---------------- refunds of one payment (guest card) ---------------- */

const PROVIDER_LABEL: Record<PaymentProvider, string> = { stripe: 'Carta online', stripe_test: 'Carta online (prova)', simulazione: 'Carta (simulazione)', contanti: 'Contanti', bonifico: 'Bonifico', ota: 'Incassato dal portale', pos: 'Carta (POS)' };
export const providerLabel = (p: PaymentProvider) => PROVIDER_LABEL[p] ?? p;

const REFUND_TAG = 'rimborso:';
/** A refund's reference: "rimborso:<paymentId>", plus ":<provider id>" (Stripe re_…) when there is one. */
export const refundReference = (paymentId: string, providerRef?: string | null) => `${REFUND_TAG}${paymentId}${providerRef ? `:${providerRef}` : ''}`;
/** The payment a refund gives money back for (null for older refunds, which were per booking). */
export function refundedPaymentId(ref: string | null): string | null {
  if (!ref?.startsWith(REFUND_TAG)) return null;
  return ref.slice(REFUND_TAG.length).split(':')[0] || null;
}

/** Already given back for this payment. */
export function refundedFor(db: DB, paymentId: string): number {
  return round2(db.payments.filter((x) => x.kind === 'refund' && x.status === 'succeeded' && refundedPaymentId(x.reference) === paymentId).reduce((s, x) => s - x.amount, 0));
}

/**
 * How much of one payment can still be given back: what is left of it, never more than what the
 * booking still holds (older refunds were recorded per booking, without saying which payment).
 * Money collected by a portal (Booking.com, Expedia) is refunded on the portal, not here.
 */
export function paymentRefundable(db: DB, p: Payment): number {
  if (p.status !== 'succeeded' || p.amount <= 0 || p.kind === 'refund' || p.provider === 'ota') return 0;
  const b = db.bookings.find((x) => x.id === p.bookingId);
  if (!b) return 0;
  return round2(Math.max(0, Math.min(p.amount - refundedFor(db, p.id), b.amountPaid)));
}

/**
 * Records a refund of one payment (the money itself moved before: Stripe, or by hand for cash, POS,
 * transfer). Re-checks the amount inside the write, writes the audit line and, if asked, queues the
 * "rimborso" e-mail to the guest.
 */
export function recordPaymentRefund(paymentId: string, amount: number, actor: string, opts: { providerRef?: string | null; notifyGuest: boolean; card?: string | null }): { booking: Booking; refund: Payment; full: boolean } {
  return mutate((db) => {
    const p = db.payments.find((x) => x.id === paymentId);
    if (!p) throw new BookingError('Pagamento non trovato.', 'not_found');
    const b = db.bookings.find((x) => x.id === p.bookingId);
    if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
    const max = paymentRefundable(db, p);
    const value = round2(amount);
    if (!(value > 0)) throw new BookingError('Importo non valido.');
    if (value > max + 0.004) throw new BookingError(max > 0 ? `Di questo pagamento puoi rimborsare al massimo € ${max.toFixed(2)}.` : 'Questo pagamento è già stato rimborsato.');
    const full = Math.abs(value - max) < 0.005;
    const now = new Date().toISOString();
    const refund: Payment = { id: newId('pay-'), bookingId: b.id, amount: -value, kind: 'refund', provider: p.provider, status: 'succeeded', reference: refundReference(p.id, opts.providerRef), createdAt: now };
    db.payments.push(refund);
    b.amountPaid = round2(b.amountPaid - value);
    b.updatedAt = now;
    if (opts.notifyGuest && b.guest.email) queueEmail(db, 'rimborso', b.guest.email, { booking: b, room: db.rooms.find((r) => r.id === b.roomId) ?? null, extra: { amount: value, refundVia: p.provider === 'stripe' || p.provider === 'stripe_test' || p.provider === 'simulazione' ? 'card' : 'hand', ...(opts.card ? { card: opts.card } : {}) } });
    const how = opts.providerRef ? `Stripe ${opts.providerRef}${p.provider === 'stripe_test' ? ' (modalità prova)' : ''}` : p.provider === 'simulazione' ? 'simulato (demo)' : 'registrato: i soldi vanno restituiti a mano';
    audit(db, actor, 'refund', 'booking', b.id, `${b.code} · rimborso ${full ? 'totale' : 'parziale'} € ${value.toFixed(2)} del pagamento del ${fmtDate(p.createdAt.slice(0, 10))} (${providerLabel(p.provider)}, € ${p.amount.toFixed(2)}) · ${how}${opts.notifyGuest && b.guest.email ? ' · email all’ospite' : ''}`);
    return { booking: b, refund, full };
  });
}

export function assignRoom(bookingId: string, roomId: string | null, actor: string): Booking {
  return mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
    if (roomId) {
      const room = db.rooms.find((r) => r.id === roomId);
      if (!room) throw new BookingError('Camera non trovata.', 'not_found');
      if (room.maxGuests < b.adults + b.children) throw new BookingError(`La camera ${room.number} ospita al massimo ${room.maxGuests} ${room.maxGuests === 1 ? 'persona' : 'persone'}.`, 'capacity');
      if (b.status !== 'cancelled') assertFree(db, roomId, b.checkIn, b.checkOut, b.id);
    }
    const prev = db.rooms.find((r) => r.id === b.roomId)?.number ?? 'da assegnare';
    b.roomId = roomId;
    b.updatedAt = new Date().toISOString();
    audit(db, actor, 'assign_room', 'booking', b.id, `${b.code}: ${prev} → ${db.rooms.find((r) => r.id === roomId)?.number ?? 'da assegnare'}`);
    return b;
  });
}

export interface ManualBookingInput {
  roomId: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  guest: { firstName: string; lastName: string; email: string; phone: string };
  source: BookingSource;
  status: 'confirmed' | 'pending_payment';
  total: number | null;
  amountPaid: number;
  notes: string;
  sendEmail: boolean;
  otaRef?: string | null;
  simulated?: boolean;
}

export function createManualBooking(input: ManualBookingInput, actor: string): Booking {
  validateStay(input.checkIn, input.checkOut, { allowPast: true });
  return mutate((db) => {
    const room = input.roomId ? db.rooms.find((r) => r.id === input.roomId) : null;
    if (input.roomId && !room) throw new BookingError('Camera non trovata.', 'not_found');
    if (room) {
      if (room.maxGuests < input.adults + input.children) throw new BookingError(`La camera ${room.number} ospita al massimo ${room.maxGuests} ${room.maxGuests === 1 ? 'persona' : 'persone'}.`, 'capacity');
      assertFree(db, room.id, input.checkIn, input.checkOut);
    }
    const total = input.total ?? (room ? quoteStay(room, input.checkIn, input.checkOut, db.ratePeriods, null, { guests: input.adults + input.children, singleUsePercent: db.settings.pricing?.singleUsePercent }).total : 0);
    const now = new Date().toISOString();
    const b: Booking = {
      id: newId('bk-'),
      code: makeCode(db),
      token: newToken(),
      roomId: room?.id ?? null,
      guest: input.guest,
      adults: input.adults,
      children: input.children,
      childrenAges: [],
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      total: round2(total),
      discount: 0,
      promoCode: null,
      amountPaid: round2(input.amountPaid),
      status: input.status,
      holdExpiresAt: null,
      source: input.source,
      otaRef: input.otaRef ?? null,
      specialRequests: '',
      notes: input.notes,
      consents: { privacy: true, terms: true, marketing: false },
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      simulated: input.simulated ?? false,
      demo: false,
    };
    db.bookings.push(b);
    if (b.amountPaid > 0) db.payments.push({ id: newId('pay-'), bookingId: b.id, amount: b.amountPaid, kind: b.amountPaid >= b.total ? 'full' : 'deposit', provider: input.source === 'booking' || input.source === 'expedia' ? 'ota' : 'contanti', status: 'succeeded', reference: null, createdAt: now });
    if (input.sendEmail && b.guest.email) queueEmail(db, 'conferma', b.guest.email, { booking: b, room: room ?? null });
    const sim = b.simulated ? 'SIMULAZIONE · ' : '';
    notify(db, 'nuova_prenotazione', `${sim}Nuova prenotazione ${SOURCE_LABEL[b.source]} · ${b.code}`, `${guestName(b)} · ${room ? `camera ${room.number}` : 'camera da assegnare'} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`, `/admin/prenotazioni?id=${b.id}`);
    audit(db, actor, 'create', 'booking', b.id, `${b.code} (${SOURCE_LABEL[b.source]}) ${room ? `camera ${room.number}` : 'da assegnare'} ${b.checkIn} → ${b.checkOut}`);
    return b;
  });
}

export function markPaid(bookingId: string, amount: number, provider: PaymentProvider, actor: string): Booking {
  return mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
    const value = round2(amount);
    if (value <= 0) throw new BookingError('Importo non valido.');
    db.payments.push({ id: newId('pay-'), bookingId, amount: value, kind: b.amountPaid + value >= b.total ? 'balance' : 'deposit', provider, status: 'succeeded', reference: null, createdAt: new Date().toISOString() });
    b.amountPaid = round2(b.amountPaid + value);
    if (provider === 'contanti') b.paymentMethod = 'cash';
    else if (provider === 'pos') b.paymentMethod = 'card';
    else if (provider === 'bonifico') b.paymentMethod = 'transfer';
    if (b.status === 'pending_payment') {
      b.status = 'confirmed';
      b.holdExpiresAt = null;
    }
    b.updatedAt = new Date().toISOString();
    notify(db, 'nuovo_pagamento', `Pagamento registrato · € ${value.toFixed(2)}`, `${b.code} · ${guestName(b)} · ${provider === 'pos' ? 'carta (POS)' : provider}`, `/admin/pagamenti`);
    audit(db, actor, 'payment', 'booking', b.id, `Registrato € ${value.toFixed(2)} (${provider})`);
    return b;
  });
}

export function updateBookingNotes(bookingId: string, notes: string, actor: string): void {
  mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
    b.notes = notes;
    b.updatedAt = new Date().toISOString();
    audit(db, actor, 'notes', 'booking', b.id, 'Note aggiornate');
  });
}

/**
 * Which expired holds are worth telling the owner about: not the ones the same guest (same e-mail)
 * followed with a later booking, whether that one is paid, still being paid, or expiring too
 * (then only the latest attempt is reported). Statuses are read before the holds are cancelled.
 */
export function abandonedLeads(all: Booking[], expired: Booking[]): Booking[] {
  const mail = (b: Booking) => b.guest.email.trim().toLowerCase();
  return expired.filter((b) => !all.some((x) => x.id !== b.id && x.createdAt > b.createdAt && mail(x) === mail(b) && x.status !== 'cancelled'));
}

/**
 * Releases website holds whose payment time ran out. Runs every minute (startHoldSweeper) and,
 * as a safety net, when the panel or the booking page opens.
 * The owner hears about an abandoned checkout once, as a lead he can follow up: never when the
 * same guest went on to book again (a retry), and several at once arrive as one message.
 */
export function releaseExpiredHolds(): number {
  const db = readDb();
  const now = new Date();
  const expired = db.bookings.filter((b) => b.status === 'pending_payment' && b.holdExpiresAt && new Date(b.holdExpiresAt) <= now);
  if (!expired.length) return 0;
  mutate((d) => {
    const due = d.bookings.filter((b) => expired.some((e) => e.id === b.id) && b.status === 'pending_payment');
    const leads = abandonedLeads(d.bookings, due);
    for (const b of due) {
      b.status = 'cancelled';
      b.cancelledAt = now.toISOString();
      b.notes = [b.notes, 'Prenotazione temporanea scaduta senza pagamento'].filter(Boolean).join(' · ');
      audit(d, 'Sistema', 'hold_expired', 'booking', b.id, b.code);
    }
    if (!leads.length) return;
    const line = (b: Booking) => {
      const room = d.rooms.find((r) => r.id === b.roomId);
      const when = `${fmtDate(b.checkIn, 'it', { day: 'numeric', month: 'short' })} → ${fmtDate(b.checkOut, 'it', { day: 'numeric', month: 'short' })}`;
      return `${guestName(b)} · ${room ? `camera ${room.number}` : 'camera da assegnare'} · ${when} · ${b.total.toFixed(2).replace('.', ',')} €`;
    };
    const contact = (b: Booking) => [b.guest.email, b.guest.phone].filter(Boolean).join(' · ');
    const minutes = d.settings.payments.holdMinutes;
    if (leads.length === 1) {
      const b = leads[0]!;
      notify(d, 'pagamento_non_completato', `Prenotazione non completata · ${b.code}`, `${line(b)}\nIl pagamento non è stato concluso entro ${minutes} minuti: le date sono di nuovo libere.\nContatto: ${contact(b)}`, `/admin/prenotazioni?id=${b.id}`);
    } else {
      notify(d, 'pagamento_non_completato', `${leads.length} prenotazioni non completate`, `${leads.map((b) => `${b.code} · ${line(b)}`).join('\n')}\nPagamento non concluso entro ${minutes} minuti: le date sono di nuovo libere.`, '/admin/prenotazioni');
    }
  });
  return expired.length;
}

const sweeper = globalThis as typeof globalThis & { __lancoraHoldTimer?: ReturnType<typeof setInterval> };
/** Frees expired holds at the right minute instead of whenever someone next opens a page. */
export function startHoldSweeper() {
  if (sweeper.__lancoraHoldTimer) return;
  const run = () => {
    try {
      releaseExpiredHolds();
    } catch (e) {
      console.error('[prenotazioni] rilascio blocchi scaduti:', (e as Error).message);
    }
  };
  sweeper.__lancoraHoldTimer = setInterval(run, 60_000);
  sweeper.__lancoraHoldTimer.unref?.();
  setTimeout(run, 5_000).unref?.();
}

export function findBookingByToken(token: string): Booking | null {
  if (!token || token.length < 16) return null;
  return readDb().bookings.find((b) => b.token === token) ?? null;
}

export function stayNightsLabel(b: Booking): string {
  return notti(diffDays(b.checkIn, b.checkOut));
}

export { addDays };
