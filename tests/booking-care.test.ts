import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Booking, DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the test
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-care-'));
process.env.DATA_DIR = dataDir;
delete process.env.STRIPE_SECRET_KEY; // no card payments here: cash and the demo card only
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('booking page: no-show, free cancellation, new card deadline, new dates, conversation', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const { addDays, todayISO } = await import('../src/lib/dates');
  const d = (n: number) => addDays(todayISO(), n);
  const db: DB = buildSeed(new Date());
  const [r1, r2] = db.rooms;
  const base = structuredClone(db.bookings[0]!);
  const mk = (id: string, roomId: string, from: number, to: number, paid: number, provider: 'contanti' | 'simulazione'): Booking => ({
    ...base,
    id,
    code: `LA-${id.toUpperCase()}`,
    token: `tok-${id}-0123456789abcdef`,
    roomId,
    guest: { firstName: 'Anna', lastName: 'Rossi', email: `${id}@example.com`, phone: '', lang: 'it' },
    // one guest: fits every room of the sample data (the first sample booking may be for two)
    adults: 1,
    children: 0,
    status: 'confirmed',
    source: 'sito',
    checkIn: d(from),
    checkOut: d(to),
    total: 300,
    amountPaid: paid,
    holdExpiresAt: null,
    cancelledAt: null,
    paymentMethod: provider === 'contanti' ? 'cash' : 'card',
    createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    changeRequest: undefined,
    cardRequest: undefined,
    noShow: undefined,
    card: undefined,
  });
  db.bookings = [mk('ns', r1!.id, 0, 3, 300, 'simulazione'), mk('late', r2!.id, 1, 4, 300, 'simulazione'), mk('dates', r1!.id, 30, 33, 0, 'contanti'), mk('card', r2!.id, 40, 42, 0, 'contanti')];
  db.payments = [
    { id: 'p-ns', bookingId: 'ns', amount: 300, kind: 'full', provider: 'simulazione', status: 'succeeded', reference: 'SIM-1', createdAt: new Date().toISOString() },
    { id: 'p-late', bookingId: 'late', amount: 300, kind: 'full', provider: 'simulazione', status: 'succeeded', reference: 'SIM-2', createdAt: new Date().toISOString() },
  ];
  db.blocks = [];
  db.messages = [];
  db.outbox = [];
  db.notifications = [];
  db.settings.payments.freeCancellationDays = 3;
  db.settings.payments.cancellationFee = { type: 'first_night', value: 0 };
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  const care = await import('../src/server/booking-care');
  const { readDb } = await import('../src/server/db/store');
  const get = (id: string) => readDb().bookings.find((b) => b.id === id)!;
  const mails = (tpl: string, to: string) => readDb().outbox.filter((e) => e.template === tpl && e.to === to);

  // no-show with the fee kept: first night (100) kept, the rest (200) goes back, nights free again
  const ns = await care.markNoShow('ns', 'Test', { waive: false });
  assert.equal(ns.outcome, 'charged');
  assert.equal(ns.fee, 100);
  assert.equal(ns.refunded, 200);
  assert.equal(get('ns').status, 'cancelled');
  assert.equal(get('ns').amountPaid, 100);
  assert.equal(get('ns').noShow?.outcome, 'charged');
  assert.equal(mails('no_show', 'ns@example.com').length, 1);
  await assert.rejects(() => care.markNoShow('dates', 'Test', { waive: false }), /dal giorno di arrivo/);

  // the guest asks a free cancellation after the free days: the hotel accepts → everything back, e-mail says no fee
  care.askFreeCancel('late', 'Volo cancellato');
  assert.equal(get('late').changeRequest?.status, 'pending');
  assert.ok(readDb().notifications.some((n) => /cancellazione gratuita/.test(n.title)));
  const free = await care.answerChange('late', 'hotel', true, 'Test');
  assert.equal(free.accepted, true);
  assert.equal(free.refunded, 300);
  assert.equal(get('late').status, 'cancelled');
  assert.equal(get('late').amountPaid, 0);
  assert.equal(get('late').changeRequest?.status, 'accepted');
  const bye = mails('cancellazione', 'late@example.com')[0]!;
  assert.match(bye.html, /Nessuna penale/);
  assert.equal(mails('rimborso', 'late@example.com').length, 1);

  // new dates asked by the guest: the hotel declines (e-mail), then the hotel proposes and the guest accepts
  care.proposeDates('dates', 'guest', 'Ospite', { checkIn: d(35), checkOut: d(38), note: '' });
  assert.throws(() => care.proposeDates('dates', 'hotel', 'Test', { checkIn: d(10), checkOut: d(12) }), /già una richiesta in attesa/, 'one request at a time');
  await care.answerChange('dates', 'hotel', false, 'Test', 'Siamo al completo');
  assert.equal(get('dates').changeRequest?.status, 'refused');
  assert.match(mails('risposta_modifica', 'dates@example.com')[0]!.html, /Siamo al completo/);
  care.proposeDates('dates', 'hotel', 'Test', { checkIn: d(50), checkOut: d(52), total: 250, note: 'Ti offriamo la vista mare' });
  assert.equal(mails('richiesta_modifica', 'dates@example.com').length, 1);
  await assert.rejects(() => care.answerChange('dates', 'hotel', true, 'Test'), /altra parte/);
  await care.answerChange('dates', 'guest', true, 'Ospite');
  assert.equal(get('dates').checkIn, d(50));
  assert.equal(get('dates').total, 250);
  assert.equal(mails('modifica', 'dates@example.com').length, 1);

  // the card: no card payments here → the charge says so plainly, and a new card is asked within 1 hour
  const charge = await care.chargeBooking('card', 50, 'Test', 'saldo');
  assert.equal(charge.ok, false);
  const req = care.requestNewCard('card', 'Test', { hours: 1, amount: 0, cancelOnExpiry: true, declined: true });
  assert.ok(req.deadline > new Date().toISOString());
  assert.match(mails('carta_da_aggiornare', 'card@example.com')[0]!.html, /cancellata/);
  assert.equal(care.expireCardRequests(new Date()), 0, 'not before the deadline');
  assert.equal(care.expireCardRequests(new Date(Date.now() + 2 * 3_600_000)), 1);
  assert.equal(get('card').status, 'cancelled');
  assert.equal(get('card').cardRequest?.outcome, 'expired');
  assert.ok(readDb().notifications.some((n) => /carta non aggiornata/.test(n.title)));

  // the conversation: the guest writes (owner told), the hotel answers (e-mail to the guest), thread in order
  care.postMessage('dates', 'guest', 'A che ora possiamo arrivare?', 'Ospite');
  assert.equal(readDb().messages.filter((m) => m.bookingId === 'dates' && !m.read).length, 1);
  care.postMessage('dates', 'hotel', 'Dalle 14:00, vi aspettiamo!', 'Reception');
  const thread = care.threadOf(readDb(), 'dates');
  assert.deepEqual(thread.map((m) => m.sender), ['guest', 'hotel']);
  assert.equal(thread[0]!.read, true, 'answered = read');
  assert.match(mails('messaggio_hotel', 'dates@example.com')[0]!.html, /Dalle 14:00/);
});
