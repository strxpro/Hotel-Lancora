import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Booking, DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the tests
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-hold-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const PAST = new Date(Date.now() - 5 * 60_000).toISOString();

test('a payment or a cash choice arriving after the hold ran out never double-books the room', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date());
  db.settings.payments.allowCashAtHotel = true;
  const room = db.rooms[0]!;
  const base = db.bookings[0]!;
  const make = (id: string, over: Partial<Booking>): Booking => ({
    ...structuredClone(base),
    id,
    code: `LA-${id.toUpperCase()}`,
    token: `tok-${id}`,
    roomId: room.id,
    checkIn: '2030-05-10',
    checkOut: '2030-05-12',
    total: 300,
    discount: 0,
    amountPaid: 0,
    cancelledAt: null,
    ...over,
  });
  // A: website hold expired a few minutes ago, not yet released by the sweeper
  // B: another guest booked the same nights in the meantime
  // C: expired hold on other dates, room still free
  db.bookings.push(
    make('hold-a', { status: 'pending_payment', holdExpiresAt: PAST }),
    make('book-b', { status: 'confirmed', holdExpiresAt: null }),
    make('hold-c', { status: 'pending_payment', holdExpiresAt: PAST, checkIn: '2030-06-01', checkOut: '2030-06-03' }),
  );
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  const { confirmPayment, confirmPayAtHotel, releaseExpiredHolds } = await import('../src/server/bookings');
  const { readDb } = await import('../src/server/db/store');
  const find = (id: string) => readDb().bookings.find((b) => b.id === id)!;
  const titles = () => readDb().notifications.map((n) => `${n.title} ${n.body}`);

  // a guest choosing "pay at the hotel" too late: refused, the room stays with the other guest
  assert.throws(() => confirmPayAtHotel('hold-a'), /scaduta/);
  assert.equal(find('hold-a').status, 'pending_payment');

  const paysBefore = readDb().payments.length;
  confirmPayment('hold-a', { amount: 300, provider: 'stripe_test', reference: 'pi_late' });
  assert.equal(find('hold-a').status, 'cancelled', 'the late payment must not confirm a room that is taken');
  assert.equal(readDb().payments.length, paysBefore);
  assert.ok(titles().some((t) => /prenotazione scaduta LA-HOLD-A/.test(t)), 'the owner is told to check and refund');

  // the sweeper must not announce the same guest as "did not complete" afterwards
  releaseExpiredHolds();
  assert.ok(!titles().some((t) => /non complet/.test(t) && /LA-HOLD-A/.test(t)), 'no "Prenotazione non completata" for a guest who paid');
  assert.equal(find('book-b').status, 'confirmed');

  // room still free: the late payment is accepted
  confirmPayment('hold-c', { amount: 300, provider: 'stripe_test', reference: 'pi_ok' });
  assert.equal(find('hold-c').status, 'confirmed');
  assert.equal(find('hold-c').amountPaid, 300);
});
