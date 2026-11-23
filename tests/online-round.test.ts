import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onlinePeriods, onlineRoom, onlineRounding, withMarkup } from '../src/lib/online-price';

const s = (round?: boolean) => ({ pricing: { onlineMarkup: { enabled: true, percent: 2, ...(round === undefined ? {} : { round }) } }, payments: { allowCashAtHotel: true, cashDiscountPercent: 0 } });

test('the online increase in whole euro (unless switched off), the cash price unchanged', () => {
  assert.equal(withMarkup(45, 2), 45.9);
  assert.equal(withMarkup(45, 2, true), 46);
  assert.equal(withMarkup(65, 2, true), 66);
  assert.equal(withMarkup(100, 1.5, true), 102);
  // round is on when never chosen, off only when switched off
  assert.equal(onlineRounding(s()), true);
  assert.equal(onlineRounding(s(false)), false);
  assert.deepEqual(onlineRoom({ basePrice: 45, cashPrice: 35 }, s()), { basePrice: 46, cashPrice: 35 });
  assert.deepEqual(onlineRoom({ basePrice: 45, cashPrice: 35 }, s(false)), { basePrice: 45.9, cashPrice: 35 });
  const fixed = { id: 'p', label: '', from: '2026-11-26', to: '2026-11-29', roomIds: [], mode: 'fixed' as const, value: 60 };
  assert.equal(onlinePeriods([fixed], s())[0]!.value, 61);
  assert.equal(onlinePeriods([fixed], s(false))[0]!.value, 61.2);
  // increase off: prices exactly as written
  assert.deepEqual(onlineRoom({ basePrice: 45, cashPrice: 35 }, { payments: { allowCashAtHotel: true, cashDiscountPercent: 0 } }), { basePrice: 45, cashPrice: 35 });
});
