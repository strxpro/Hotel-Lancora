import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeExtras, extrasForReception, extraTotal, extrasList, EXTRA_PRESETS, type Extra } from '../src/lib/extras';
import { bedsText, sameBeds, sleepsOf } from '../src/lib/beds';
import { roundedPath } from '../src/lib/route-path';
import { TAX_T, taxNote, touristTaxFor } from '../src/lib/tourist-tax';

test('supplements: per stay, per night, per person, per person per night', () => {
  assert.equal(extraTotal({ price: 20, unit: 'stay' }, 3, 2), 20);
  assert.equal(extraTotal({ price: 10, unit: 'night' }, 3, 2), 30);
  assert.equal(extraTotal({ price: 5, unit: 'person' }, 3, 2), 10);
  assert.equal(extraTotal({ price: 8, unit: 'person_night' }, 3, 2), 48);
  assert.equal(extraTotal({ price: 2.5, unit: 'person' }, 0, 0), 2.5, 'at least one night and one guest');
});

test('supplements: the suggested ones are off until the owner turns them on', () => {
  assert.equal(extrasList(undefined).length, EXTRA_PRESETS.length);
  assert.equal(activeExtras(undefined).length, 0);
  const mine: Extra[] = [
    { ...EXTRA_PRESETS[0]!, enabled: true, price: 6 },
    { id: 'x', name: { it: '' }, price: 3, unit: 'stay', enabled: true },
    { id: 'y', name: { it: 'Bici' }, price: 12, unit: 'night', enabled: false },
  ];
  assert.deepEqual(activeExtras(mine).map((e) => e.id), ['teli-mare'], 'only the ones that are on and have a name');
});

test('supplements: the reception reads what was chosen and the total, priced from the hotel list', () => {
  const towels: Extra = { id: 't', name: { it: 'Teli mare' }, price: 5, unit: 'person', enabled: true };
  const cot: Extra = { id: 'c', name: { it: 'Culla' }, price: 10, unit: 'night', enabled: true };
  const line = extrasForReception([towels, cot], 3, 2);
  assert.match(line, /da pagare in hotel/);
  assert.match(line, /Teli mare \(5 € × 2\) = 10 €/);
  assert.match(line, /Culla \(10 € × 3\) = 30 €/);
  assert.match(line, /totale 40 €/);
  assert.equal(extrasForReception([], 3, 2), '');
});

test('beds: “Matrimoniale · 1 persona” sleeps one and reads as a double bed', () => {
  assert.equal(sleepsOf([{ kind: 'francese', count: 1 }]), 1);
  assert.equal(bedsText([{ kind: 'francese', count: 1 }], 'it'), '1 letto matrimoniale');
  assert.equal(bedsText([{ kind: 'francese', count: 1 }], 'en'), '1 double bed');
  assert.equal(bedsText([{ kind: 'matrimoniale', count: 1 }, { kind: 'francese', count: 1 }], 'it'), '2 letti matrimoniali', 'the same bed is counted once');
  assert.equal(bedsText([{ kind: 'matrimoniale', count: 1 }, { kind: 'singolo', count: 1 }], 'it'), '1 letto matrimoniale + 1 letto singolo');
  assert.ok(!sameBeds([{ kind: 'francese', count: 1 }], [{ kind: 'matrimoniale', count: 1 }]));
  assert.ok(sameBeds([{ kind: 'singolo', count: 2 }], [{ kind: 'singolo', count: 2 }]));
});

test('tourist tax: the guest reads that it is paid apart, in cash', () => {
  const t = { enabled: true, amount: 2, from: '06-01', to: '09-30', maxNights: 0 };
  const q = touristTaxFor(t, '2027-07-01', '2027-07-04', 2)!;
  assert.equal(q.total, 12);
  assert.equal(q.cash, true, 'cash unless the owner says otherwise');
  assert.match(taxNote('it', q.cash), /in contanti/);
  assert.equal(taxNote('it', false), TAX_T.it.note);
  assert.equal(touristTaxFor({ ...t, cash: false }, '2027-07-01', '2027-07-04', 2)!.cash, false);
});

test('map route: bends are rounded, the line still starts at the hotel and ends at the place', () => {
  const d = roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 2);
  assert.ok(d.startsWith('M0 0'));
  assert.ok(d.endsWith('L10 10'));
  assert.match(d, /L8 0Q10 0 10 2/, 'the corner becomes a curve 2 units long on each street');
  // the curve is never wider than half a street
  assert.match(roundedPath([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], 50), /L1 0Q2 0 2 1/);
  // tiny wiggles are merged, the real end is kept
  const merged = roundedPath([{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 5, y: 0 }, { x: 5.05, y: 0.02 }], 1, 0.5);
  assert.equal(merged, 'M0 0L5.05 0.02');
  assert.equal(roundedPath([], 1), '');
});
