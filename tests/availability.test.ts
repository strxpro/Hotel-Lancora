import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRoomFree, quoteStay, roomConflicts, searchAvailability, isBookingActive, amountDueNow } from '../src/lib/availability';
import { eachNight, rangesOverlap, addDays } from '../src/lib/dates';
import { buildSeed } from '../src/server/db/seed';
import type { Booking, DB } from '../src/lib/types';

const NOW = new Date('2026-11-07T10:00:00Z');

function db(): DB {
  return buildSeed(NOW);
}

function booking(p: Partial<Booking>): Booking {
  return {
    id: 'x', code: 'LA-TEST', token: 't'.repeat(24), roomId: 'room-101',
    guest: { firstName: 'A', lastName: 'B', email: 'a@example.com', phone: '' },
    adults: 1, children: 0, childrenAges: [], checkIn: '2027-02-10', checkOut: '2027-02-13', total: 0, discount: 0, promoCode: null, amountPaid: 0,
    status: 'confirmed', holdExpiresAt: null, source: 'sito', otaRef: null, specialRequests: '', notes: '', consents: { privacy: true, terms: true, marketing: false },
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), cancelledAt: null, simulated: false, demo: false, ...p,
  };
}

test('night logic: check-in night is occupied, check-out day is free (TEST G)', () => {
  assert.deepEqual(eachNight('2027-02-10', '2027-02-13'), ['2027-02-10', '2027-02-11', '2027-02-12']);
  assert.equal(rangesOverlap('2027-02-10', '2027-02-13', '2027-02-13', '2027-02-15'), false, 'back-to-back stays do not overlap');
  assert.equal(rangesOverlap('2027-02-10', '2027-02-13', '2027-02-12', '2027-02-15'), true);
});

test('conflicts: an active booking blocks the room, a cancelled one frees it', () => {
  const d = db();
  d.bookings = [booking({})];
  d.blocks = [];
  assert.equal(isRoomFree(d, 'room-101', '2027-02-12', '2027-02-14'), false);
  assert.equal(isRoomFree(d, 'room-101', '2027-02-13', '2027-02-14'), true, 'next guest may arrive on departure day');
  d.bookings[0]!.status = 'cancelled';
  assert.equal(isRoomFree(d, 'room-101', '2027-02-12', '2027-02-14'), true);
});

test('pending payment holds expire', () => {
  const b = booking({ status: 'pending_payment', holdExpiresAt: '2026-11-07T09:00:00Z' });
  assert.equal(isBookingActive(b, NOW), false);
  assert.equal(isBookingActive({ ...b, holdExpiresAt: '2026-11-07T11:00:00Z' }, NOW), true);
});

test('manual blocks remove the room from search on overlapping dates (TEST D)', () => {
  const d = db();
  d.bookings = [];
  d.blocks = [{ id: 'b', roomId: 'room-103', from: '2027-03-01', to: '2027-03-04', reason: 'test', createdBy: 't', createdAt: '' }];
  const ids = (ci: string, co: string) => searchAvailability(d, { checkIn: ci, checkOut: co, adults: 2, children: 0 }, NOW).filter((r) => r.available).map((r) => r.room.id);
  assert.ok(!ids('2027-03-02', '2027-03-05').includes('room-103'));
  assert.ok(ids('2027-03-04', '2027-03-06').includes('room-103'), 'free again on the block end date');
  assert.equal(roomConflicts(d, 'room-103', '2027-02-28', '2027-03-02')[0]?.kind, 'block');
});

test('search returns only rooms with enough capacity that are free for the whole stay (TEST A)', () => {
  const d = db();
  const q = { checkIn: addDays('2026-11-07', 20), checkOut: addDays('2026-11-07', 23), adults: 2, children: 1 };
  for (const r of searchAvailability(d, q, NOW)) {
    assert.ok(r.room.maxGuests >= 3);
    if (r.available) assert.equal(roomConflicts(d, r.room.id, q.checkIn, q.checkOut, { now: NOW }).length, 0);
  }
});

test('unassigned OTA bookings consume inventory', () => {
  const d = db();
  d.bookings = [];
  d.blocks = [];
  const q = { checkIn: '2027-04-10', checkOut: '2027-04-12', adults: 1, children: 0 };
  const before = searchAvailability(d, q, NOW).filter((r) => r.available).length;
  d.bookings = [booking({ roomId: null, checkIn: '2027-04-10', checkOut: '2027-04-12', source: 'booking' })];
  assert.equal(searchAvailability(d, q, NOW).filter((r) => r.available).length, before - 1);
});

test('price: base, seasonal periods, fixed overrides and promo codes (TEST E logic)', () => {
  const d = db();
  const room = { ...d.rooms[0]!, basePrice: 100 };
  const periods = [
    { id: 'p', label: 'alta', from: '2027-07-01', to: '2027-08-01', roomIds: 'all' as const, mode: 'percent' as const, value: 35, createdAt: '' },
    { id: 'f', label: 'fisso', from: '2027-07-10', to: '2027-07-11', roomIds: [room.id], mode: 'fixed' as const, value: 90, createdAt: '' },
  ];
  const q = quoteStay(room, '2027-07-09', '2027-07-12', periods);
  assert.deepEqual(q.perNight.map((n) => n.price), [135, 90, 135]);
  assert.equal(q.total, 360);
  const promo = { id: 'x', code: 'DIRETTO10', description: '', percent: 10, validFrom: '2027-01-01', validTo: '2027-12-31', active: true, minNights: 2 };
  assert.equal(quoteStay(room, '2027-07-09', '2027-07-12', periods, promo).total, 324);
  assert.equal(amountDueNow(324, { ...d.settings.payments, mode: 'deposit_percent', depositPercent: 30 }), 97.2);
});

test('seed: no double bookings, a real "today" story, OTA booking to assign', () => {
  const d = db();
  for (const room of d.rooms) {
    const stays = d.bookings.filter((b) => b.roomId === room.id && isBookingActive(b, NOW));
    for (let i = 0; i < stays.length; i++)
      for (let j = i + 1; j < stays.length; j++) assert.equal(rangesOverlap(stays[i]!.checkIn, stays[i]!.checkOut, stays[j]!.checkIn, stays[j]!.checkOut), false, `overlap in room ${room.number}`);
    for (const k of d.blocks.filter((x) => x.roomId === room.id)) for (const s of stays) assert.equal(rangesOverlap(k.from, k.to, s.checkIn, s.checkOut), false);
  }
  assert.ok(d.bookings.filter((b) => b.checkIn === '2026-11-07' && b.status !== 'cancelled').length >= 2);
  assert.ok(d.bookings.some((b) => !b.roomId && b.source === 'booking'));
  assert.equal(d.rooms.length, 12);
});
