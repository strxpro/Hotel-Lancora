import { NextResponse } from 'next/server';
import { statusFromAccount, stripeMode, verifyWebhook } from '@/server/payments/stripe';
import { cancelBooking, confirmPayment } from '@/server/bookings';
import { mutate, readDb } from '@/server/db/store';
import { completeCardSession } from '@/server/payments/card';
import { notify } from '@/server/events';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhook — the ONLY place where a card payment confirms a booking (the success page
 * merely waits for this). Signature verified with STRIPE_WEBHOOK_SECRET.
 * Local: stripe listen --forward-to localhost:3000/api/stripe/webhook --forward-connect-to localhost:3000/api/stripe/webhook
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event;
  try {
    event = verifyWebhook(raw, req.headers.get('stripe-signature'));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object;
    const bookingId = s.metadata?.bookingId;
    // the owner deleted the booking while the guest was still paying: the money is on Stripe, tell the owner
    if (bookingId && !readDb().bookings.some((x) => x.id === bookingId)) {
      if (s.payment_status === 'paid' && s.amount_total) {
        const who = s.customer_details?.email ?? s.customer_email ?? 'un ospite';
        mutate((db) => void notify(db, 'nuovo_pagamento', 'Pagamento per una prenotazione eliminata', `${who} ha pagato € ${(s.amount_total! / 100).toFixed(2)} con la carta per una prenotazione che è stata eliminata. Registrala di nuovo oppure restituisci i soldi da Stripe.`, '/admin/pagamenti'));
      }
      return NextResponse.json({ received: true });
    }
    // the booking's own payment (the card pages of the guest area have a purpose: completeCardSession records them)
    if (bookingId && s.payment_status === 'paid' && !s.metadata?.purpose) {
      confirmPayment(bookingId, { amount: (s.amount_total ?? 0) / 100, provider: stripeMode() === 'live' ? 'stripe' : 'stripe_test', reference: String(s.payment_intent ?? s.id) });
    }
    // keeps the card with the booking; confirms a cash booking with a guarantee card; closes a "new card" request
    if (bookingId) await completeCardSession(s.id, bookingId);
  }
  if (event.type === 'checkout.session.expired') {
    const bookingId = event.data.object.metadata?.bookingId;
    const b = readDb().bookings.find((x) => x.id === bookingId);
    if (b && b.status === 'pending_payment') cancelBooking(b.id, 'Stripe', { reason: 'Sessione di pagamento scaduta', notifyGuest: false });
  }
  // Connect: the hotel finished (or changed) its Stripe onboarding
  if (event.type === 'account.updated') {
    const acc = event.data.object;
    mutate((db) => {
      const c = db.settings.stripeConnect;
      if (c.accountId !== acc.id) return;
      const s = statusFromAccount(acc);
      Object.assign(c, { ...s, updatedAt: new Date().toISOString() });
    });
  }
  return NextResponse.json({ received: true });
}
