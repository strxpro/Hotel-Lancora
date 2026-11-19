import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteStay, round2, searchAvailability, stayCashPercent } from '../src/lib/availability';
import { onlineMarkup, onlinePeriods, onlineRoom } from '../src/lib/online-price';
import { cashPercentFor } from '../src/lib/cash';
import { buildSeed } from '../src/server/db/seed';
import type { RatePeriod, Room } from '../src/lib/types';

/**
 * "Aumento prezzi online": the card price on the site goes up by the percent, the cash price at the
 * hotel does not move, and the owner's own prices stay as they were.
 */
const payments = { allowCashAtHotel: true, cashDiscountPercent: 5 };
const on = (percent: number) => ({ payments, pricing: { onlineMarkup: { enabled: true, percent } } });
const room = { id: 'r1', basePrice: 100, cashPrice: null } as unknown as Room;
const cashTotal = (r: Room, from: string, to: string, periods: RatePeriod[]) => {
  const q = quoteStay(r, from, to, periods);
  return round2(q.total * (1 - stayCashPercent(r, from, to, periods, payments) / 100));
};

test('off: the site shows exactly the owner’s prices', () => {
  assert.equal(onlineMarkup({ payments }), 0);
  assert.equal(onlineMarkup({ payments, pricing: { onlineMarkup: { enabled: false, percent: 3 } } }), 0);
  assert.equal(onlineRoom(room, { payments }), room);
});

test('on: 100 € becomes 101 € by card, cash stays 95 €', () => {
  const s = on(1);
  const r = onlineRoom(room, s);
  assert.equal(r.basePrice, 101);
  assert.equal(room.basePrice, 100, 'the owner’s price is untouched');
  assert.equal(quoteStay(r, '2027-03-01', '2027-03-04', []).total, 303);
  assert.equal(cashTotal(r, '2027-03-01', '2027-03-04', []), 285);
  assert.ok(Math.abs(cashPercentFor(r, payments) - (1 - 95 / 101) * 100) < 0.01);
});

test('a room with its own cash price keeps it', () => {
  const r = onlineRoom({ ...room, cashPrice: 90 }, on(2));
  assert.equal(r.basePrice, 102);
  assert.equal(cashTotal(r, '2027-03-01', '2027-03-03', []), 180);
});

test('seasons: a fixed price goes up, its own cash price and percent changes follow', () => {
  const periods: RatePeriod[] = [
    { id: 'p1', label: 'Agosto', from: '2027-08-01', to: '2027-09-01', roomIds: 'all', mode: 'fixed', value: 120, cash: 110 } as RatePeriod,
    { id: 'p2', label: 'Giugno', from: '2027-06-01', to: '2027-07-01', roomIds: 'all', mode: 'fixed', value: 150 } as RatePeriod,
    { id: 'p3', label: 'Pasqua', from: '2027-03-25', to: '2027-03-30', roomIds: 'all', mode: 'percent', value: 10 } as RatePeriod,
  ];
  const s = on(1);
  const r = onlineRoom(room, s);
  const p = onlinePeriods(periods, s);
  assert.equal(periods[0]!.value, 120, 'the owner’s period is untouched');
  // August: 121.20 by card, the period's own 110 in cash
  assert.equal(quoteStay(r, '2027-08-10', '2027-08-12', p).total, 242.4);
  assert.equal(cashTotal(r, '2027-08-10', '2027-08-12', p), 220);
  // June, no own cash price: 151.50 by card, the usual −5% on 150 in cash
  assert.equal(quoteStay(r, '2027-06-10', '2027-06-11', p).total, 151.5);
  assert.ok(Math.abs(cashTotal(r, '2027-06-10', '2027-06-11', p) - 142.5) <= 0.02);
  // Easter +10%: on 101 → 111 by card
  assert.equal(quoteStay(r, '2027-03-26', '2027-03-27', p).total, 111);
});

test('search results use the site’s prices', () => {
  const db = buildSeed();
  const q = { checkIn: '2027-02-02', checkOut: '2027-02-04', adults: 2, children: 0 };
  const plain = searchAvailability(db, q);
  db.settings.pricing = { ...(db.settings.pricing ?? { singleUsePercent: 20, board: 'room_only' }), onlineMarkup: { enabled: true, percent: 1 } };
  const up = searchAvailability(db, q);
  assert.ok(up.length > 0);
  for (const [i, r] of up.entries()) {
    const want = quoteStay(onlineRoom(r.room, db.settings), q.checkIn, q.checkOut, onlinePeriods(db.ratePeriods, db.settings), null, { guests: 2, singleUsePercent: db.settings.pricing.singleUsePercent }).total;
    assert.equal(r.quote.total, want, r.room.id);
    assert.ok(r.quote.total >= plain[i]!.quote.total, `${r.room.id}: never cheaper than the owner's price`);
  }
  assert.ok(up.some((r, i) => r.quote.total > plain[i]!.quote.total), 'the increase shows up');
});
