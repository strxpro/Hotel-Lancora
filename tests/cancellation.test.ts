import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelDeadline, cancelFeeAmount, cancelRefund, cancelText, isFreeCancel } from '../src/lib/cancellation';

// arrival Friday 15 January 2027, free until 3 days before
const ARRIVAL = '2027-01-15';
const RULES = { freeCancellationDays: 3, cancellationFee: { type: 'percent' as const, value: 100 } };

test('the fee starts at 00:00 of the day three days before arrival', () => {
  assert.equal(cancelDeadline(ARRIVAL, 3), '2027-01-12');
  assert.equal(isFreeCancel('2027-01-11', ARRIVAL, 3), true); // Monday, up to 23:59: free
  assert.equal(isFreeCancel('2027-01-12', ARRIVAL, 3), false); // Tuesday from 00:00: fee
  assert.equal(isFreeCancel('2027-01-15', ARRIVAL, 3), false);
  assert.equal(isFreeCancel('2027-01-14', ARRIVAL, 0), true); // 0 days: free until the arrival day
  assert.equal(isFreeCancel('2027-01-15', ARRIVAL, 0), false);
});

test('fee: percent, first night, fixed (never more than the stay)', () => {
  assert.equal(cancelFeeAmount(RULES, 300, 3), 300);
  assert.equal(cancelFeeAmount({ ...RULES, cancellationFee: { type: 'percent', value: 30 } }, 300, 3), 90);
  assert.equal(cancelFeeAmount({ ...RULES, cancellationFee: { type: 'first_night', value: 0 } }, 300, 3), 100);
  assert.equal(cancelFeeAmount({ ...RULES, cancellationFee: { type: 'fixed', value: 50 } }, 300, 3), 50);
  assert.equal(cancelFeeAmount({ ...RULES, cancellationFee: { type: 'fixed', value: 500 } }, 300, 3), 300);
  assert.equal(cancelFeeAmount({ freeCancellationDays: 3 }, 300, 3), 300); // old data without a fee: whole stay
});

test('refund: everything while free, paid minus fee afterwards', () => {
  const b = { checkIn: ARRIVAL, total: 300, amountPaid: 300, nights: 3 };
  const first = { ...RULES, cancellationFee: { type: 'first_night' as const, value: 0 } };
  assert.equal(cancelRefund(first, '2027-01-11', b), 300);
  assert.equal(cancelRefund(first, '2027-01-12', b), 200);
  assert.equal(cancelRefund(first, '2027-01-12', { ...b, amountPaid: 60 }), 0); // only a deposit was paid
  assert.equal(cancelRefund(RULES, '2027-01-12', b), 0);
});

test('the sentence the guest reads names the day and the amount', () => {
  const it = cancelText('it', { freeCancellationDays: 3, cancellationFee: { type: 'first_night', value: 0 } }, { checkIn: ARRIVAL, total: 300, nights: 3 });
  assert.match(it, /fino a lunedì 11 gennaio alle 23:59/);
  assert.match(it, /fino a 3 giorni dal check-in/);
  assert.match(it, /prima notte \(100,00/);
  const pl = cancelText('pl', RULES);
  assert.match(pl, /00:00/);
  assert.match(pl, /3 dni przed przyjazdem/);
  assert.match(pl, /pełną kwotę pobytu/);
});

test('a booking made when the free days were over says so, for cash and card alike', () => {
  const late = cancelText('it', RULES, { checkIn: ARRIVAL, total: 300, nights: 3, bookedAt: '2027-01-13T10:00:00Z' });
  assert.match(late, /a meno di 3 giorni dal check-in/);
  assert.doesNotMatch(late, /gratuita fino a/);
  const early = cancelText('it', RULES, { checkIn: ARRIVAL, total: 300, nights: 3, bookedAt: '2027-01-02T10:00:00Z' });
  assert.match(early, /fino a lunedì 11 gennaio alle 23:59/);
  assert.match(cancelText('en', RULES, { checkIn: ARRIVAL, bookedAt: '2027-01-12T09:00:00Z' }), /less than 3 days before check-in/);
});
