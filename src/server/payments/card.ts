import 'server-only';
import type Stripe from 'stripe';
import type { Booking, Payment, SavedCard } from '@/lib/types';
import { roomConflicts, round2 } from '@/lib/availability';
import { fmtDate } from '@/lib/dates';
import { BookingError, cancelBooking, confirmCardLater, confirmPayAtHotel } from '../bookings';
import { mutate, newId, readDb } from '../db/store';
import { audit, guestName, notify } from '../events';
import { payoutDestination, platformFee, stripe, stripeMode } from './stripe';

/**
 * The guest's card kept with the booking.
 *  · paid on the site: the card is saved by the payment page itself (setup_future_usage);
 *  · pays cash at the hotel: the guest leaves a card as a guarantee (nothing is charged), when the
 *    owner switched it on in Pagamenti;
 *  · the hotel asked for a new card: the guest types it on the payment page from the guest area.
 * With it the hotel charges a no-show, a late cancellation or the balance with one click. If the bank
 * refuses, the owner sends the guest the request for a new card (booking-care.ts).
 * Only ids, brand, last 4 digits and expiry are stored: never the card number.
 */

export type CardPurpose = 'guarantee' | 'card_update' | 'cancel_fee' | 'pay_later';

export const cardsAvailable = (): boolean => stripeMode() !== 'off';
const provider = (): Payment['provider'] => (stripeMode() === 'live' ? 'stripe' : 'stripe_test');

function cardOf(pm: Stripe.PaymentMethod | string | null | undefined, customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): SavedCard | null {
  if (!pm || typeof pm === 'string' || pm.type !== 'card' || !pm.card) return null;
  const cust = typeof customer === 'string' ? customer : (customer?.id ?? (typeof pm.customer === 'string' ? pm.customer : pm.customer?.id));
  if (!cust) return null;
  return {
    customer: cust,
    paymentMethod: pm.id,
    brand: pm.card.brand,
    last4: pm.card.last4,
    exp: `${String(pm.card.exp_month).padStart(2, '0')}/${String(pm.card.exp_year).slice(-2)}`,
    mode: stripeMode() === 'live' ? 'live' : 'test',
    savedAt: new Date().toISOString(),
  };
}

function keepCard(bookingId: string, card: SavedCard, actor: string): void {
  mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    if (b.card?.paymentMethod === card.paymentMethod) return;
    b.card = card;
    b.updatedAt = card.savedAt;
    audit(db, actor, 'card_saved', 'booking', b.id, `${b.code} · carta ${cardLabel(card)} collegata alla prenotazione`);
  });
}

export const cardLabel = (c: Pick<SavedCard, 'brand' | 'last4' | 'exp'>): string => `${c.brand.toUpperCase()} •••• ${c.last4} (scad. ${c.exp})`;

/**
 * Back from the payment page: keeps the card with the booking and finishes what the page was for.
 *  · booking payment: only the card (the payment itself is confirmed by confirmPayment);
 *  · guarantee: the cash booking is confirmed;
 *  · card_update: the hotel's request is done; a payment made with it is recorded.
 * Safe to call more than once (return page + webhook). Never throws.
 */
export async function completeCardSession(sessionId: string, bookingId?: string): Promise<'done' | 'unpaid' | 'skipped'> {
  if (stripeMode() === 'off' || !/^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(sessionId)) return 'skipped';
  try {
    const s = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.payment_method', 'setup_intent.payment_method'] });
    const id = s.metadata?.bookingId;
    if (!id || (bookingId && id !== bookingId)) return 'skipped';
    const purpose = s.metadata?.purpose as CardPurpose | undefined;
    if (s.mode === 'setup') {
      const si = s.setup_intent as Stripe.SetupIntent | null;
      if (!si || si.status !== 'succeeded') return 'unpaid';
      const card = cardOf(si.payment_method as Stripe.PaymentMethod, si.customer as string | null);
      if (card) keepCard(id, card, 'Ospite');
      if (purpose === 'guarantee' || purpose === 'pay_later') {
        const b = readDb().bookings.find((x) => x.id === id);
        const confirm = purpose === 'guarantee' ? confirmPayAtHotel : confirmCardLater;
        // the guest took longer than the hold: the booking is given back if the room is still free
        if (b?.status === 'cancelled' && !b.noShow && b.amountPaid === 0 && reopenExpiredHold(id)) confirm(id);
        else if (b?.status === 'pending_payment') confirm(id);
      }
      if (purpose === 'card_update') cardRequestDone(id, card, 0, null);
      return 'done';
    }
    if (s.payment_status !== 'paid') return 'unpaid';
    const pi = s.payment_intent as Stripe.PaymentIntent | null;
    const card = cardOf(pi?.payment_method as Stripe.PaymentMethod | null, (pi?.customer as string | null) ?? (s.customer as string | null));
    if (card) keepCard(id, card, 'Ospite');
    if (purpose === 'card_update') cardRequestDone(id, card, (s.amount_total ?? 0) / 100, pi?.id ?? s.id);
    if (purpose === 'cancel_fee') cancelFeePaid(id, (s.amount_total ?? 0) / 100, pi?.id ?? s.id);
    return 'done';
  } catch (e) {
    console.error('[carta] verifica non riuscita:', (e as Error).message);
    return 'skipped';
  }
}

/** A website hold that ran out while the guest was leaving the guarantee card: back to "waiting" if nobody took the room. */
function reopenExpiredHold(bookingId: string): boolean {
  return mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b || b.status !== 'cancelled' || !b.roomId || b.source !== 'sito') return false;
    if (roomConflicts(db, b.roomId, b.checkIn, b.checkOut, { ignoreBookingId: b.id }).length) {
      notify(db, 'pagamento_non_completato', `Carta a garanzia arrivata tardi · ${b.code}`, `${guestName(b)} ha lasciato la carta dopo la scadenza e la camera non è più libera: contatta l’ospite.`, `/admin/prenotazioni?id=${b.id}`);
      return false;
    }
    b.status = 'pending_payment';
    b.cancelledAt = null;
    b.holdExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    return true;
  });
}

/** The guest paid the late-cancellation fee online: the payment is recorded and the booking cancelled (once). */
function cancelFeePaid(bookingId: string, paid: number, reference: string): void {
  const open = mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) return false;
    if (paid > 0 && !db.payments.some((p) => p.reference === reference && p.status === 'succeeded')) {
      db.payments.push({ id: newId('pay-'), bookingId: b.id, amount: round2(paid), kind: 'balance', provider: provider(), status: 'succeeded', reference, createdAt: new Date().toISOString() });
      b.amountPaid = round2(b.amountPaid + paid);
      audit(db, 'Ospite', 'cancel_fee', 'booking', b.id, `${b.code} · penale di cancellazione pagata online € ${paid.toFixed(2)}`);
    }
    return b.status !== 'cancelled';
  });
  if (open) cancelBooking(bookingId, 'Ospite (area ospite)', { refundAmount: 0, reason: `dall’ospite online, con la penale pagata (€ ${paid.toFixed(2)})` });
}

/** The guest updated the card (and paid, when the request had an amount): the owner is told. */
function cardRequestDone(bookingId: string, card: SavedCard | null, paid: number, reference: string | null): void {
  mutate((db) => {
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) return;
    const now = new Date().toISOString();
    if (paid > 0 && reference && !db.payments.some((p) => p.reference === reference && p.status === 'succeeded')) {
      db.payments.push({ id: newId('pay-'), bookingId: b.id, amount: round2(paid), kind: b.amountPaid + paid >= b.total ? 'balance' : 'deposit', provider: provider(), status: 'succeeded', reference, createdAt: now });
      b.amountPaid = round2(b.amountPaid + paid);
      if (b.noShow?.outcome === 'due') b.noShow = { ...b.noShow, outcome: 'charged' };
      // a "pay later" charge the bank refused, paid now with the new card
      if (b.chargePlan && b.chargePlan.outcome !== 'charged' && b.amountPaid + 0.004 >= b.total) b.chargePlan = { ...b.chargePlan, outcome: 'charged', at: now, reason: null };
    }
    const req = b.cardRequest;
    if (req && !req.outcome) {
      b.cardRequest = { ...req, outcome: 'done', doneAt: now };
      notify(db, 'nuovo_pagamento', `Carta aggiornata · ${b.code}`, `${guestName(b)} ha inserito una nuova carta${card ? ` (${cardLabel(card)})` : ''}${paid > 0 ? ` e ha pagato € ${paid.toFixed(2)}` : ''}.`, `/admin/prenotazioni?id=${b.id}`);
      audit(db, 'Ospite', 'card_updated', 'booking', b.id, `${b.code} · nuova carta${paid > 0 ? ` · pagati € ${paid.toFixed(2)}` : ''}`);
    }
    b.updatedAt = now;
  });
}

/**
 * Opens the payment page for the guest: only the card (guarantee, card update without amount) or a
 * payment that also keeps the card (card update with an amount to pay).
 */
export async function startCardCheckout(b: Booking, p: { purpose: CardPurpose; amount: number; successUrl: string; cancelUrl: string; locale: string }): Promise<string> {
  if (stripeMode() === 'off') throw new BookingError('I pagamenti con carta non sono attivi.');
  const s = stripe();
  const db = readDb();
  const destination = payoutDestination(db);
  const meta = { bookingId: b.id, code: b.code, purpose: p.purpose };
  const locale = (['it', 'en', 'pl', 'de', 'fr', 'es'].includes(p.locale) ? p.locale : 'auto') as Stripe.Checkout.SessionCreateParams.Locale;
  const sameMode = b.card && b.card.mode === (stripeMode() === 'live' ? 'live' : 'test');
  const amount = round2(p.amount);
  if (amount > 0) {
    const session = await s.checkout.sessions.create({
      mode: 'payment',
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      ...(sameMode ? { customer: b.card!.customer } : { customer_email: b.guest.email || undefined, customer_creation: 'always' as const }),
      client_reference_id: b.id,
      metadata: meta,
      allowed_payment_method_types: ['card'],
      payment_intent_data: {
        metadata: meta,
        setup_future_usage: 'off_session',
        ...(destination ? { transfer_data: { destination }, on_behalf_of: destination, application_fee_amount: platformFee(amount) } : {}),
      },
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: Math.round(amount * 100), product_data: { name: `${db.settings.hotel.name} · ${b.code}`, description: `${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}` } } }],
      locale,
    });
    if (!session.url) throw new BookingError('Pagina di pagamento non disponibile.');
    return session.url;
  }
  const customer = sameMode ? b.card!.customer : (await s.customers.create({ email: b.guest.email || undefined, name: guestName(b), metadata: { bookingId: b.id, code: b.code } })).id;
  const session = await s.checkout.sessions.create({
    mode: 'setup',
    currency: 'eur',
    customer,
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    client_reference_id: b.id,
    metadata: meta,
    allowed_payment_method_types: ['card'],
    setup_intent_data: { metadata: meta, description: `${db.settings.hotel.name} · ${b.code} · ${p.purpose === 'pay_later' ? 'carta per l’addebito prima dell’arrivo' : 'carta a garanzia'}`, ...(destination ? { on_behalf_of: destination } : {}) },
    locale,
    // the guarantee / pay-later page closes with the booking's hold (Stripe: at least 30 minutes)
    ...(p.purpose === 'guarantee' || p.purpose === 'pay_later' ? { expires_at: Math.floor(Date.now() / 1000) + Math.max(30, db.settings.payments.holdMinutes) * 60 } : {}),
  });
  if (!session.url) throw new BookingError('Pagina della carta non disponibile.');
  return session.url;
}

/**
 * The card or the bank said no (a new card can help). Anything else — a key without permissions, a
 * wrong key, Stripe not answering — is the site's side: asking the guest for a new card would not help.
 */
function cardRefused(e: unknown): boolean {
  const err = e as { type?: string; rawType?: string; code?: string } | null;
  if (!err) return true;
  if (err.type === 'StripeCardError' || err.rawType === 'card_error') return true;
  // our own answer for a payment Stripe did not complete (no error type)
  return !err.type && (err.code === 'authentication_required' || err.code === 'card_declined');
}

/** The bank's answer, in words the owner understands. */
function declineReason(e: unknown): string {
  const err = e as { code?: string; decline_code?: string; message?: string; type?: string };
  if (err?.type === 'StripePermissionError') return 'la chiave di Stripe collegata al sito non ha il permesso di addebitare: ricollega Stripe con una chiave ad accesso completo';
  if (err?.type === 'StripeAuthenticationError') return 'la chiave di Stripe collegata al sito non è valida: ricollega Stripe';
  if (err?.type === 'StripeConnectionError' || err?.type === 'StripeAPIError' || err?.type === 'StripeRateLimitError') return 'Stripe non ha risposto: riprova tra qualche minuto';
  const code = err.decline_code ?? err.code ?? '';
  if (code === 'authentication_required') return 'la banca vuole che sia l’ospite ad approvare il pagamento';
  if (code === 'expired_card') return 'la carta è scaduta';
  if (code === 'insufficient_funds') return 'fondi insufficienti sulla carta';
  if (code === 'lost_card' || code === 'stolen_card') return 'la carta è bloccata';
  if (code === 'incorrect_cvc' || code === 'incorrect_number' || code === 'invalid_cvc') return 'i dati della carta non sono validi';
  if (code === 'card_declined' || code === 'generic_decline' || code === 'do_not_honor') return 'la banca ha rifiutato il pagamento';
  return 'la carta non ha pagato';
}

export type ChargeResult = { ok: true; amount: number; paymentId: string } | { ok: false; reason: string; declined: boolean };

/**
 * Charges the card kept with the booking (no-show, late cancellation, balance). A refusal is written
 * in the payments as "non riuscito" and returned in plain words: the owner can then ask the guest
 * for a new card.
 */
export async function chargeSavedCard(bookingId: string, amount: number, actor: string, why: string): Promise<ChargeResult> {
  const value = round2(amount);
  if (!(value > 0)) throw new BookingError('Importo non valido.');
  const db = readDb();
  const b = db.bookings.find((x) => x.id === bookingId);
  if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
  const card = b.card;
  if (!card) return { ok: false, reason: 'non c’è una carta collegata a questa prenotazione', declined: false };
  if (stripeMode() === 'off') return { ok: false, reason: 'i pagamenti con carta non sono attivi', declined: false };
  if (card.mode !== (stripeMode() === 'live' ? 'live' : 'test')) return { ok: false, reason: card.mode === 'test' ? 'la carta è stata salvata con i pagamenti di prova' : 'la carta è stata salvata con i pagamenti veri', declined: false };
  const destination = payoutDestination(db);
  const attempts = db.payments.filter((x) => x.bookingId === b.id && x.reference?.startsWith('pi_')).length + db.payments.filter((x) => x.bookingId === b.id && x.status === 'failed').length;
  let pi: Stripe.PaymentIntent | null = null;
  let failure: unknown = null;
  try {
    pi = await stripe().paymentIntents.create(
      {
        amount: Math.round(value * 100),
        currency: 'eur',
        customer: card.customer,
        payment_method: card.paymentMethod,
        off_session: true,
        confirm: true,
        description: `${db.settings.hotel.name} · ${b.code} · ${why}`,
        metadata: { bookingId: b.id, code: b.code, why },
        ...(destination ? { transfer_data: { destination }, on_behalf_of: destination, application_fee_amount: platformFee(value) } : {}),
      },
      { idempotencyKey: `lancora-charge-${b.id}-${attempts}-${Math.round(value * 100)}` },
    );
    if (pi.status !== 'succeeded') failure = { code: pi.status === 'requires_action' ? 'authentication_required' : 'card_declined' };
  } catch (e) {
    failure = e;
  }
  const now = new Date().toISOString();
  if (failure || !pi) {
    const reason = declineReason(failure);
    const ref = (failure as { payment_intent?: { id?: string } })?.payment_intent?.id ?? pi?.id ?? null;
    mutate((d) => {
      const x = d.bookings.find((k) => k.id === b.id);
      if (!x) return;
      d.payments.push({ id: newId('pay-'), bookingId: x.id, amount: value, kind: 'balance', provider: provider(), status: 'failed', reference: ref, createdAt: now });
      audit(d, actor, 'charge_failed', 'booking', x.id, `${x.code} · addebito € ${value.toFixed(2)} (${why}) non riuscito: ${reason}`);
    });
    return { ok: false, reason, declined: cardRefused(failure) };
  }
  const paymentId = newId('pay-');
  mutate((d) => {
    const x = d.bookings.find((k) => k.id === b.id);
    // two clicks (or the panel and the hourly job) at the same moment get the same Stripe payment: recorded once
    if (!x || d.payments.some((p) => p.reference === pi!.id && p.status === 'succeeded')) return;
    d.payments.push({ id: paymentId, bookingId: x.id, amount: value, kind: x.amountPaid + value >= x.total ? 'balance' : 'deposit', provider: provider(), status: 'succeeded', reference: pi!.id, createdAt: now });
    x.amountPaid = round2(x.amountPaid + value);
    x.updatedAt = now;
    audit(d, actor, 'charge', 'booking', x.id, `${x.code} · addebitati € ${value.toFixed(2)} sulla carta ${cardLabel(card)} (${why})`);
  });
  return { ok: true, amount: value, paymentId };
}
