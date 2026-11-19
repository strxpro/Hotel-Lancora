import 'server-only';
import { BookingError, paymentRefundable, recordPaymentRefund } from '../bookings';
import { readDb } from '../db/store';
import { round2 } from '@/lib/availability';
import { stripe, stripeMode } from './stripe';

/**
 * Gives back (part of) one payment from the guest card.
 *  · card paid on the site (Stripe): the refund is made on Stripe first — only in the mode the
 *    payment was made in (a test payment with the test key, a real one only with live payments on);
 *  · cash, POS, bank transfer, demo simulation: the refund is recorded and the owner gives the money
 *    back by hand;
 *  · money collected by a portal: refused, it is refunded on the portal.
 * Then the refund is written (amount re-checked), with an audit line and, if asked, the e-mail.
 */
export async function refundGuestPayment(paymentId: string, amount: number, actor: string, notifyGuest: boolean) {
  const db = readDb();
  const p = db.payments.find((x) => x.id === paymentId);
  if (!p) throw new BookingError('Pagamento non trovato.', 'not_found');
  if (p.provider === 'ota') throw new BookingError('Pagamento incassato dal portale: il rimborso si fa sul portale (Booking.com, Expedia…).');
  const max = paymentRefundable(db, p);
  const value = round2(amount);
  if (!(value > 0)) throw new BookingError('Importo non valido.');
  if (value > max + 0.004) throw new BookingError(max > 0 ? `Di questo pagamento puoi rimborsare al massimo € ${max.toFixed(2)}.` : 'Questo pagamento è già stato rimborsato.');

  let providerRef: string | null = null;
  // the card the money goes back to ("Visa •••• 4242"), for the guest's e-mail
  let card: string | null = null;
  const bookingCard = db.bookings.find((b) => b.id === p.bookingId)?.card;
  if (bookingCard?.last4) card = `${brandName(bookingCard.brand)} •••• ${bookingCard.last4}`;
  if (p.provider === 'stripe' || p.provider === 'stripe_test') {
    const needed = p.provider === 'stripe' ? 'live' : 'test';
    if (stripeMode() !== needed) throw new BookingError(p.provider === 'stripe' ? 'Pagamento con carta reale: per rimborsarlo serve Stripe collegato con i pagamenti reali attivi.' : 'Pagamento fatto con Stripe in modalità prova: per rimborsarlo serve la chiave Stripe di prova collegata.');
    if (!p.reference?.startsWith('pi_')) throw new BookingError('Manca il riferimento Stripe del pagamento: rimborsalo dalla dashboard di Stripe.');
    const ref = p.reference;
    const done = db.payments.filter((x) => x.kind === 'refund' && x.reference?.startsWith(`rimborso:${p.id}`)).length;
    try {
      const s = stripe();
      const pi = await s.paymentIntents.retrieve(ref, { expand: ['latest_charge'] });
      const paid = typeof pi.latest_charge === 'object' && pi.latest_charge ? pi.latest_charge.payment_method_details?.card : null;
      if (paid?.last4) card = `${brandName(paid.brand ?? '')} •••• ${paid.last4}`;
      const r = await s.refunds.create(
        { payment_intent: ref, amount: Math.round(value * 100), reason: 'requested_by_customer', ...(pi.transfer_data?.destination ? { reverse_transfer: true } : {}), metadata: { bookingId: p.bookingId, paymentId: p.id } },
        { idempotencyKey: `lancora-refund-${p.id}-${done}-${Math.round(value * 100)}` },
      );
      if (r.status === 'failed' || r.status === 'canceled') throw new BookingError(`Stripe non ha eseguito il rimborso (${r.failure_reason ?? r.status}).`);
      providerRef = r.id;
    } catch (e) {
      if (e instanceof BookingError) throw e;
      throw new BookingError(`Stripe: ${(e as Error).message}`);
    }
  }
  const via = providerRef ? ('stripe' as const) : p.provider === 'simulazione' ? ('simulation' as const) : ('manual' as const);
  const out = recordPaymentRefund(p.id, value, actor, { providerRef, notifyGuest, card: via === 'manual' ? null : card });
  return { ...out, via, card: via === 'manual' ? null : card };
}

const BRANDS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', american_express: 'American Express', discover: 'Discover', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay', cartes_bancaires: 'Cartes Bancaires', maestro: 'Maestro' };
const brandName = (b: string) => BRANDS[b.toLowerCase()] ?? (b ? b.charAt(0).toUpperCase() + b.slice(1) : 'Carta');
