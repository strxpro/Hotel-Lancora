import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Booking, DB, SavedCard } from '../src/lib/types';
import { cardDueNow, chargeDay, DEFAULT_CHARGE_LATER, laterChargeDay, plannedCharge } from '../src/lib/charge-later';

/**
 * "Paga dopo": the guest saves the card and pays nothing; N days before arrival the stay is charged
 * on that card, by itself (from 9:00 Italian time) or with "Addebita ora". Stripe is a stand-in here:
 * no network, no money.
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-later-'));
process.env.DATA_DIR = dataDir;
process.env.STRIPE_SECRET_KEY = `sk_test_${'x'.repeat(30)}`;
delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const T = '2026-11-20T08:00:00.000Z';
const CARD: SavedCard = { customer: 'cus_1', paymentMethod: 'pm_1', brand: 'visa', last4: '4242', exp: '12/30', mode: 'test', savedAt: T };
const P = (x: Partial<DB['settings']['payments']> = {}): DB['settings']['payments'] => ({ mode: 'deposit_percent', depositPercent: 30, depositFixed: 100, freeCancellationDays: 7, cancellationPolicy: '', refundPolicy: 'Rimborsi entro 14 giorni.', holdMinutes: 15, cashDiscountPercent: 5, allowCashAtHotel: true, allowOnline: true, ...x });

test('pay later: the charge day and what the guest pays now', () => {
  const on = P({ chargeLater: { enabled: true, daysBefore: 3, auto: true } });
  // arrival in 10 days: nothing now, the card is charged 3 days before
  assert.equal(laterChargeDay(on, '2026-11-30', '2026-11-20', true), '2026-11-27');
  assert.equal(cardDueNow(300, on, '2026-11-30', '2026-11-20', true), 0);
  // arrival in 3 days: the charge day is today, so the whole stay is paid now
  assert.equal(laterChargeDay(on, '2026-11-23', '2026-11-20', true), null);
  assert.equal(cardDueNow(300, on, '2026-11-23', '2026-11-20', true), 300);
  // card payments off, setting off, online payments off: the deposit rule as before
  assert.equal(laterChargeDay(on, '2026-11-30', '2026-11-20', false), null);
  assert.equal(cardDueNow(300, on, '2026-11-30', '2026-11-20', false), 90);
  assert.equal(cardDueNow(300, P(), '2026-11-30', '2026-11-20', true), 90);
  assert.equal(laterChargeDay(P({ chargeLater: { enabled: true, daysBefore: 3, auto: true }, allowOnline: false }), '2026-11-30', '2026-11-20', true), null);
  assert.equal(chargeDay('2026-12-01', { ...DEFAULT_CHARGE_LATER, daysBefore: 5 }), '2026-11-26');
  // what is still to charge
  const b: Pick<Booking, 'chargePlan' | 'status' | 'total' | 'amountPaid'> = { chargePlan: { since: T, outcome: null, at: null, reason: null }, status: 'confirmed', total: 300, amountPaid: 0 };
  assert.equal(plannedCharge(b), 300);
  assert.equal(plannedCharge({ ...b, amountPaid: 100 }), 200);
  assert.equal(plannedCharge({ ...b, amountPaid: 300 }), 0);
  assert.equal(plannedCharge({ ...b, status: 'cancelled' }), 0);
  assert.equal(plannedCharge({ ...b, chargePlan: { ...b.chargePlan!, outcome: 'charged' } }), 0);
  assert.equal(plannedCharge({ ...b, chargePlan: null }), 0);
});

test('pay later: card saved → confirmed with nothing paid; charged by itself on the day from 9:00, once; refused → owner told, guest asked for another card', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date('2026-11-07T10:00:00Z'));
  db.settings.payments.chargeLater = { enabled: true, daysBefore: 3, auto: true };
  const [b, far] = db.bookings.filter((x) => x.status === 'confirmed' && x.roomId);
  assert.ok(b && far);
  Object.assign(b, { status: 'pending_payment', holdExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), checkIn: '2026-11-23', checkOut: '2026-11-26', total: 300, amountPaid: 0, card: null, chargePlan: null, cardRequest: null, noShow: null, source: 'sito' });
  Object.assign(b.guest, { email: 'mario.dopo@example.com', lang: 'it' });
  Object.assign(far, { checkIn: '2026-12-20', checkOut: '2026-12-22', total: 200, amountPaid: 0, paymentMethod: 'card', card: CARD, chargePlan: { since: T, outcome: null, at: null, reason: null }, cardRequest: null, noShow: null });
  far.guest.email = 'lontano@example.com';
  db.payments = db.payments.filter((p) => p.bookingId !== b.id && p.bookingId !== far.id);
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  // Stripe's answers
  const { stripe } = await import('../src/server/payments/stripe');
  const s = stripe() as unknown as { checkout: { sessions: { retrieve: unknown } }; paymentIntents: { create: unknown } };
  s.checkout.sessions.retrieve = async () => ({ id: 'cs_test_later', mode: 'setup', metadata: { bookingId: b.id, purpose: 'pay_later' }, setup_intent: { status: 'succeeded', customer: 'cus_1', payment_method: { id: 'pm_1', type: 'card', customer: 'cus_1', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } } } });
  const calls: { params: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
  let answer: 'ok' | 'refuse' | 'same' | 'key' = 'ok';
  s.paymentIntents.create = async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
    calls.push({ params, opts });
    if (answer === 'key') throw Object.assign(new Error('The provided key does not have the required permissions for this endpoint'), { type: 'StripePermissionError' });
    if (answer === 'refuse') throw Object.assign(new Error('Your card has insufficient funds.'), { type: 'StripeCardError', code: 'card_declined', decline_code: 'insufficient_funds', payment_intent: { id: 'pi_refused' } });
    return { id: answer === 'same' ? 'pi_same' : `pi_ok_${calls.length}`, status: 'succeeded' };
  };

  // back from the secure page: confirmed, nothing paid, the card kept, the plan set
  const { completeCardSession } = await import('../src/server/payments/card');
  assert.equal(await completeCardSession(`cs_test_${'a'.repeat(20)}`, b.id), 'done');
  const { readDb, mutate } = await import('../src/server/db/store');
  const one = () => readDb().bookings.find((k) => k.id === b.id)!;
  assert.equal(one().status, 'confirmed');
  assert.equal(one().paymentMethod, 'card');
  assert.equal(one().amountPaid, 0);
  assert.equal(one().card?.last4, '4242');
  assert.deepEqual(one().chargePlan && { outcome: one().chargePlan!.outcome }, { outcome: null });
  // the confirmation e-mail says when and how much
  const mail = readDb().outbox.find((e) => e.bookingId === b.id && e.template === 'conferma');
  assert.ok(mail);
  assert.match(mail.html, /Addebito sulla carta/);
  assert.match(mail.html, /20 novembre 2026/);
  // the owner is told
  assert.ok(readDb().notifications.some((n) => n.title === `Nuova prenotazione dal sito · ${b.code}` && n.body.includes('carta salvata')));

  const { chargePlanned, pendingCharges, runPlannedCharges } = await import('../src/server/payments/charge-later');
  // the list in Pagamenti: today's first
  const list = pendingCharges(new Date('2026-11-20T06:00:00Z'));
  assert.deepEqual(
    list.map((r) => [r.code, r.on, r.due, r.amount, r.card]),
    [
      [b.code, '2026-11-20', true, 300, 'VISA •••• 4242 (scad. 12/30)'],
      [far.code, '2026-12-17', false, 200, 'VISA •••• 4242 (scad. 12/30)'],
    ],
  );
  // 7:00 in Italy: not yet
  assert.equal(await runPlannedCharges(new Date('2026-11-20T06:00:00Z')), 'niente da addebitare');
  assert.equal(calls.length, 0);
  // 11:30: the stay is charged on the saved card, off-session, once
  assert.equal(await runPlannedCharges(new Date('2026-11-20T10:30:00Z')), '1 addebitati · 0 non riusciti');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.params.amount, 30000);
  assert.equal(calls[0]!.params.off_session, true);
  assert.equal(calls[0]!.params.payment_method, 'pm_1');
  assert.equal(one().amountPaid, 300);
  assert.equal(one().chargePlan?.outcome, 'charged');
  assert.equal(readDb().payments.filter((p) => p.bookingId === b.id && p.status === 'succeeded').length, 1);
  assert.ok(readDb().notifications.some((n) => n.title.startsWith('Addebito riuscito')));
  assert.equal(await runPlannedCharges(new Date('2026-11-20T12:30:00Z')), 'niente da addebitare');
  assert.equal(calls.length, 1);

  // a key without permissions is the site's problem: the guest is NOT asked for another card
  answer = 'key';
  const k = await chargePlanned(far.id, 'Titolare');
  assert.equal(k.ok, false);
  assert.equal(!k.ok && k.declined, false);
  assert.match(readDb().bookings.find((x) => x.id === far.id)!.chargePlan?.reason ?? '', /permesso/);
  assert.equal(readDb().bookings.find((x) => x.id === far.id)!.cardRequest ?? null, null);

  // "Addebita ora" on the far one, refused by the bank
  answer = 'refuse';
  const r = await chargePlanned(far.id, 'Titolare');
  assert.equal(r.ok, false);
  const f = () => readDb().bookings.find((k) => k.id === far.id)!;
  assert.equal(f().chargePlan?.outcome, 'failed');
  assert.equal(f().chargePlan?.reason, 'fondi insufficienti sulla carta');
  assert.equal(f().amountPaid, 0);
  assert.equal(f().cardRequest?.amount, 200);
  assert.equal(f().cardRequest?.outcome, null);
  assert.ok(readDb().outbox.some((e) => e.bookingId === far.id && e.template === 'carta_da_aggiornare'));
  assert.ok(readDb().notifications.some((n) => n.title === `Addebito non riuscito · ${far.code}`));
  assert.equal(pendingCharges(new Date('2026-12-18T10:00:00Z'))[0]?.failed, 'fondi insufficienti sulla carta');
  // the hourly job does not try a refused card again by itself
  assert.equal(await runPlannedCharges(new Date('2026-12-18T10:00:00Z')), 'niente da addebitare');
  assert.equal(calls.length, 3);

  // two clicks at the same moment: one Stripe payment, recorded once
  answer = 'same';
  await Promise.all([chargePlanned(far.id, 'Titolare'), chargePlanned(far.id, 'Titolare')]);
  assert.equal(f().amountPaid, 200);
  assert.equal(readDb().payments.filter((p) => p.bookingId === far.id && p.status === 'succeeded').length, 1);
  assert.equal(f().chargePlan?.outcome, 'charged');

  // "Solo quando clicco io": the job leaves everything to the owner
  mutate((d) => {
    d.settings.payments.chargeLater = { enabled: true, daysBefore: 3, auto: false };
  });
  assert.equal(await runPlannedCharges(new Date('2026-12-18T10:00:00Z')), 'solo a mano');
});
