import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { estimatePayout, nextPayoutDay, previousPayoutDay, scheduleLabel, type PayoutSchedule } from '../src/lib/payout';
import type { DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the tests
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-guest-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const WEEKLY: PayoutSchedule = { interval: 'weekly', weeklyAnchor: 'monday', monthlyAnchor: 1 };

test('payout calendar: weekly, daily (business days), monthly (short months), manual', () => {
  // 12 November 2026 is a Thursday
  assert.equal(nextPayoutDay('2026-11-12', WEEKLY), '2026-11-16');
  assert.equal(nextPayoutDay('2026-11-16', WEEKLY), '2026-11-16'); // today is the payout day
  assert.equal(previousPayoutDay('2026-11-16', WEEKLY), '2026-11-09');
  assert.equal(nextPayoutDay('2026-11-12', { ...WEEKLY, interval: 'daily' }), '2026-11-12');
  assert.equal(nextPayoutDay('2026-11-14', { ...WEEKLY, interval: 'daily' }), '2026-11-16'); // Saturday → Monday
  assert.equal(nextPayoutDay('2027-02-03', { ...WEEKLY, interval: 'monthly', monthlyAnchor: 31 }), '2027-02-28');
  assert.equal(nextPayoutDay('2026-11-12', { ...WEEKLY, interval: 'monthly', monthlyAnchor: 1 }), '2026-12-01');
  assert.equal(nextPayoutDay('2026-11-12', { ...WEEKLY, interval: 'manual' }), null);
  assert.equal(scheduleLabel({ ...WEEKLY, weeklyAnchor: 'friday' }), 'ogni settimana, il venerdì');
});

test('payout estimate: card payments since the last payout day, minus card refunds; cash and failed ones left out', () => {
  const pays = [
    { amount: 100, provider: 'stripe_test' as const, status: 'succeeded' as const, createdAt: '2026-11-10T10:00:00Z' },
    { amount: 50, provider: 'simulazione' as const, status: 'succeeded' as const, createdAt: '2026-11-12T08:00:00Z' },
    { amount: -20, provider: 'stripe_test' as const, status: 'succeeded' as const, createdAt: '2026-11-11T08:00:00Z' },
    { amount: 999, provider: 'contanti' as const, status: 'succeeded' as const, createdAt: '2026-11-11T08:00:00Z' },
    { amount: 400, provider: 'pos' as const, status: 'succeeded' as const, createdAt: '2026-11-11T08:00:00Z' },
    { amount: 70, provider: 'stripe' as const, status: 'succeeded' as const, createdAt: '2026-11-09T08:00:00Z' }, // already in Monday's payout
    { amount: 30, provider: 'stripe' as const, status: 'failed' as const, createdAt: '2026-11-11T08:00:00Z' },
  ];
  assert.deepEqual(estimatePayout(pays, '2026-11-12', WEEKLY), { date: '2026-11-16', from: '2026-11-10', count: 2, gross: 150, refunds: 20, amount: 130 });
});

test('demo guests on reserved test domains are never mailed', async () => {
  const { isTestAddress } = await import('../src/server/events');
  for (const a of ['anna@example.com', 'x@mail.example.org', 'b@hotel.test', 'anonimo-bk-1@invalid', 'd@localhost', 'senza-dominio']) assert.equal(isTestAddress(a), true, a);
  for (const a of ['anna@gmail.com', 'x@example.it', 'y@myexample.com', 'z@testing.com']) assert.equal(isTestAddress(a), false, a);
});

test('refund of one payment: partial then full, never more than what is left, audit + e-mail, guest card', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date('2026-11-07T10:00:00Z'));
  const b = db.bookings.find((x) => x.status === 'confirmed')!;
  Object.assign(b, { total: 300, amountPaid: 300 });
  b.guest.email = 'anna.rimborso@example.com';
  db.payments = db.payments.filter((p) => p.bookingId !== b.id);
  db.payments.push(
    { id: 'pay-a', bookingId: b.id, amount: 200, kind: 'deposit', provider: 'contanti', status: 'succeeded', reference: null, createdAt: '2026-11-01T10:00:00Z' },
    { id: 'pay-b', bookingId: b.id, amount: 100, kind: 'balance', provider: 'simulazione', status: 'succeeded', reference: null, createdAt: '2026-11-02T10:00:00Z' },
    { id: 'pay-ota', bookingId: b.id, amount: 1, kind: 'deposit', provider: 'ota', status: 'succeeded', reference: null, createdAt: '2026-11-02T11:00:00Z' },
  );
  db.messages.push({ id: 'msg-solo', bookingId: null, name: 'Carla Bianchi', email: 'carla.solo@example.com', subject: 'Parcheggio', body: 'C’è un parcheggio?', source: 'contatti', read: false, createdAt: '2026-11-05T09:00:00Z' });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  const { paymentRefundable, recordPaymentRefund } = await import('../src/server/bookings');
  const { readDb } = await import('../src/server/db/store');
  const { guestCard } = await import('../src/server/guest-card');
  const { refundGuestPayment } = await import('../src/server/payments/refund');
  const pay = (id: string) => readDb().payments.find((p) => p.id === id)!;

  assert.equal(paymentRefundable(readDb(), pay('pay-a')), 200);
  assert.equal(paymentRefundable(readDb(), pay('pay-ota')), 0); // portal money: refunded on the portal
  await assert.rejects(() => refundGuestPayment('pay-ota', 1, 'Test', false), /portale/);

  const r1 = recordPaymentRefund('pay-a', 50, 'Test', { notifyGuest: true });
  assert.equal(r1.full, false);
  assert.equal(r1.booking.amountPaid, 250);
  assert.equal(paymentRefundable(readDb(), pay('pay-a')), 150);
  assert.throws(() => recordPaymentRefund('pay-a', 151, 'Test', { notifyGuest: false }), /al massimo € 150\.00/);

  const r2 = await refundGuestPayment('pay-a', 150, 'Test', false); // cash: recorded, given back by hand
  assert.equal(r2.full, true);
  assert.equal(r2.via, 'manual');
  const d = readDb();
  assert.equal(paymentRefundable(d, pay('pay-a')), 0);
  assert.equal(paymentRefundable(d, pay('pay-b')), 100);
  assert.equal(d.bookings.find((x) => x.id === b.id)!.amountPaid, 100);
  assert.match(d.audit[0]!.details, /rimborso totale € 150\.00 .*Contanti.*restituiti a mano/);
  assert.match(d.audit[1]!.details, /rimborso parziale € 50\.00 .*email all’ospite/);
  assert.equal(d.outbox.filter((e) => e.template === 'rimborso' && e.bookingId === b.id).length, 1);
  assert.equal(d.outbox[0]!.status, 'demo_outbox');

  const card = guestCard(d, { email: 'ANNA.rimborso@example.com' })!;
  assert.equal(card.testAddress, true);
  const a = card.payments.find((p) => p.id === 'pay-a')!;
  assert.deepEqual([a.refunded, a.refundable, a.refundVia], [200, 0, 'manual']);
  assert.equal(card.payments.find((p) => p.id === 'pay-ota')!.refundVia, 'portal');
  assert.equal(card.payments.filter((p) => p.refundOf === 'pay-a').length, 2);
  assert.equal(card.history.filter((h) => h.action === 'Rimborso').length, 2);
  assert.ok(card.messages.some((m) => m.dir === 'out' && m.label === 'Conferma rimborso'));
  // the same card from the booking id
  assert.equal(guestCard(d, { bookingId: b.id })!.key, 'anna.rimborso@example.com');
  // someone who only wrote from the contact form still has a card
  const solo = guestCard(d, { email: 'carla.solo@example.com' })!;
  assert.deepEqual([solo.name, solo.bookings.length, solo.messages.length], ['Carla Bianchi', 0, 1]);
  assert.equal(guestCard(d, { email: 'nessuno@example.com' }), null);
});
