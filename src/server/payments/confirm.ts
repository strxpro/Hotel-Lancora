import 'server-only';
import { confirmPayment } from '../bookings';
import { stripe, stripeMode } from './stripe';

/**
 * Confirms a booking when the guest comes back from Stripe, by asking Stripe directly whether that
 * checkout was paid. The webhook does the same job in the background, but it only exists once the
 * site has a public https address — and even then it can arrive late. With this check the booking
 * is confirmed the moment the guest lands on the confirmation page, on a local computer too.
 *
 * Safe to call many times: the payment is recorded once (idempotent on Stripe's payment id), and a
 * session that belongs to another booking, or is not paid, changes nothing.
 */
export async function confirmFromCheckout(sessionId: string, bookingId: string): Promise<'confirmed' | 'unpaid' | 'skipped'> {
  if (stripeMode() === 'off' || !/^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(sessionId)) return 'skipped';
  try {
    const s = await stripe().checkout.sessions.retrieve(sessionId);
    if (s.metadata?.bookingId !== bookingId) return 'skipped';
    if (s.payment_status !== 'paid') return 'unpaid';
    confirmPayment(bookingId, { amount: (s.amount_total ?? 0) / 100, provider: stripeMode() === 'live' ? 'stripe' : 'stripe_test', reference: String(s.payment_intent ?? s.id) });
    return 'confirmed';
  } catch (e) {
    console.error('[stripe] verifica del pagamento non riuscita:', (e as Error).message);
    return 'skipped';
  }
}
