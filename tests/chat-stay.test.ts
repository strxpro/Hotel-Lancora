import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStay, isStayTurn, extractStay } from '../src/server/chat/stay';

const TODAY = '2026-11-09'; // Monday

const dates = (t: string) => {
  const s = parseStay(t, TODAY);
  return [s.checkIn, s.checkOut];
};

test('explicit ranges in six languages', () => {
  assert.deepEqual(dates('Avete camere libere dal 12 al 15 dicembre?'), ['2026-12-12', '2026-12-15']);
  assert.deepEqual(dates('Czy macie wolne pokoje 12-15 grudnia?'), ['2026-12-12', '2026-12-15']);
  assert.deepEqual(dates('Any rooms from December 12 to 15?'), ['2026-12-12', '2026-12-15']);
  assert.deepEqual(dates('Haben Sie vom 12. bis 15. Dezember ein Zimmer frei?'), ['2026-12-12', '2026-12-15']);
  assert.deepEqual(dates('Avez-vous une chambre du 12 au 15 décembre ?'), ['2026-12-12', '2026-12-15']);
  assert.deepEqual(dates('¿Tenéis habitación del 12 al 15 de diciembre?'), ['2026-12-12', '2026-12-15']);
});

test('across months, past months roll to next year, numeric dates', () => {
  assert.deepEqual(dates('dal 30 giugno al 3 luglio'), ['2027-06-30', '2027-07-03']);
  assert.deepEqual(dates('od 28 grudnia do 2 stycznia'), ['2026-12-28', '2027-01-02']);
  assert.deepEqual(dates('12/08 - 16/08'), ['2027-08-12', '2027-08-16']);
  assert.deepEqual(dates('2027-07-01 to 2027-07-05'), ['2027-07-01', '2027-07-05']);
});

test('nights, relative days and weekend', () => {
  assert.deepEqual(dates('12 agosto per 3 notti'), ['2027-08-12', '2027-08-15']);
  assert.deepEqual(dates('jutro na 2 noce'), ['2026-11-10', '2026-11-12']);
  assert.deepEqual(dates('this weekend'), ['2026-11-13', '2026-11-15']);
  assert.deepEqual(dates('dal 20 al 23'), ['2026-11-20', '2026-11-23']);
});

test('guests', () => {
  const a = parseStay('2 adulti e 1 bambino dal 12 al 15 agosto', TODAY);
  assert.equal(a.adults, 2);
  assert.equal(a.children, 1);
  const b = parseStay('wolne pokoje 3-6 lipca dla 4 osób', TODAY);
  assert.equal(b.adults, 4);
  assert.deepEqual([b.checkIn, b.checkOut], ['2027-07-03', '2027-07-06']);
  assert.equal(parseStay('Jesteśmy we dwoje z dzieckiem', TODAY).children, 1);
  assert.equal(parseStay('for a week in July', TODAY).adults, null);
  assert.equal(parseStay('Haben Sie morgen ein Zimmer für 3?', TODAY).adults, 3);
});

test('times and prices are not dates', () => {
  assert.deepEqual(dates('il check-in è alle 14.00?'), [null, null]);
  assert.equal(isStayTurn(['Dove si trova l’hotel?']), false);
});

test('follow-ups reuse the dates of the previous message', async () => {
  const s = await extractStay(['Avete posto dal 12 al 15 agosto?', 'e per 4 persone?'], TODAY, null);
  assert.deepEqual([s?.checkIn, s?.checkOut, s?.adults], ['2027-08-12', '2027-08-15', 4]);
  const p = await extractStay(['Avete posto dal 12 al 15 agosto?', 'E con una notte in più?'], TODAY, null);
  assert.deepEqual([p?.checkIn, p?.checkOut], ['2027-08-12', '2027-08-16']);
});
