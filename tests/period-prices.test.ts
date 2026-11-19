import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB, RatePeriod } from '../src/lib/types';

/**
 * Prices by month or dates ("in August rooms 101 and 102 cost 150 €"), from the Prezzi board, the
 * room wizard and the assistant: a new price replaces the old one of those rooms there, "back to
 * base" removes it, hotel-wide variations stay. And the refund e-mail says where the money goes.
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-periods-'));
process.env.DATA_DIR = dataDir;
for (const k of ['GROQ_API_KEY', 'AI_PROVIDER', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const TODAY = '2026-11-07';

test('months become the fewest ranges', async () => {
  const { monthRanges, monthStarts } = await import('../src/lib/period-prices');
  assert.deepEqual(monthRanges(['2027-08-01', '2027-07-01', '2027-09-01', '2027-12-01']), [
    { from: '2027-07-01', to: '2027-10-01' },
    { from: '2027-12-01', to: '2028-01-01' },
  ]);
  assert.deepEqual(monthStarts('2026-11-07', 3), ['2026-11-01', '2026-12-01', '2027-01-01']);
});

test('a new price cuts the older one of the same rooms around its dates', async () => {
  const { carveRooms } = await import('../src/lib/period-prices');
  let n = 0;
  const id = () => `new${++n}`;
  const p = (x: Partial<RatePeriod>): RatePeriod => ({ id: 'p', label: 'x', from: '2027-07-01', to: '2027-10-01', roomIds: ['a', 'b'], mode: 'fixed', value: 140, createdAt: '', ...x });
  // August taken out of July–September for room a only: b keeps the whole period, a keeps July and September
  const out = carveRooms([p({})], ['a'], '2027-08-01', '2027-09-01', id);
  assert.deepEqual(out.map((x) => [x.roomIds, x.from, x.to]), [
    [['b'], '2027-07-01', '2027-10-01'],
    [['a'], '2027-07-01', '2027-08-01'],
    [['a'], '2027-09-01', '2027-10-01'],
  ]);
  // fully covered → gone; other rooms, other dates and hotel-wide variations untouched
  const all = p({ id: 'all', roomIds: 'all', mode: 'percent', value: 15 });
  const out2 = carveRooms([p({ roomIds: ['a'] }), all, p({ id: 'c', roomIds: ['c'] })], ['a'], '2027-06-01', '2027-11-01', id);
  assert.deepEqual(out2.map((x) => x.id), ['all', 'c']);
});

async function seed() {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date(`${TODAY}T10:00:00Z`));
  db.ratePeriods = [];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  const { readDb } = await import('../src/server/db/store');
  return readDb();
}

test('Prezzi: set August for two rooms, change one, back to base', async () => {
  const db0 = await seed();
  const [r1, r2] = db0.rooms;
  const { setPeriodPrice } = await import('../src/server/rooms');
  const { readDb } = await import('../src/server/db/store');
  const { nightlyPrice } = await import('../src/lib/availability');
  const aug = [{ from: '2027-08-01', to: '2027-09-01' }];
  setPeriodPrice({ roomIds: [r1!.id, r2!.id], ranges: aug, price: 150 }, 'test');
  setPeriodPrice({ roomIds: [r1!.id], ranges: aug, price: 120 }, 'test');
  let db = readDb();
  const room = (id: string) => db.rooms.find((r) => r.id === id)!;
  assert.equal(nightlyPrice(room(r1!.id), '2027-08-15', db.ratePeriods), 120);
  assert.equal(nightlyPrice(room(r2!.id), '2027-08-15', db.ratePeriods), 150);
  assert.equal(nightlyPrice(room(r1!.id), '2027-09-01', db.ratePeriods), room(r1!.id).basePrice, 'September is the base price');
  assert.equal(db.ratePeriods.length, 2, 'no stacked dead periods');
  assert.match(db.ratePeriods[0]!.label, /agosto 2027/);

  setPeriodPrice({ roomIds: [r1!.id], ranges: aug, price: null }, 'test');
  db = readDb();
  assert.equal(nightlyPrice(room(r1!.id), '2027-08-15', db.ratePeriods), room(r1!.id).basePrice, 'back to base');
  assert.equal(nightlyPrice(room(r2!.id), '2027-08-15', db.ratePeriods), 150);

  const { monthPrices, priceExceptions } = await import('../src/lib/period-prices');
  const m = monthPrices(room(r2!.id), db.ratePeriods, TODAY);
  assert.equal(m.length, 12);
  assert.deepEqual(m.find((x) => x.m === '2027-08-01'), { m: '2027-08-01', min: 150, max: 150, cash: null });
  const ex = priceExceptions(room(r2!.id), db.ratePeriods, TODAY, '2028-01-01');
  assert.equal(Object.keys(ex).length, 31);
  assert.equal(ex['2027-08-31'], 150);

  assert.throws(() => setPeriodPrice({ roomIds: [r1!.id], ranges: [{ from: '2027-09-01', to: '2027-08-01' }], price: 100 }, 'test'), /Periodo non valido/);
});

test('the hotel’s price list: each season with its own card and cash price', async () => {
  const db0 = await seed();
  const r1 = db0.rooms[0]!;
  const { setPeriodPrice, setRoomsPrice } = await import('../src/server/rooms');
  const { readDb } = await import('../src/server/db/store');
  const { nightlyRate, stayCashPercent, quoteStay } = await import('../src/lib/availability');
  const { cashOf } = await import('../src/lib/cash');
  // base 62 € card / 55 € cash, 9–22 August 126 € / 110 €
  setRoomsPrice([r1.id], 62, 55, 'test');
  setPeriodPrice({ roomIds: [r1.id], ranges: [{ from: '2027-08-09', to: '2027-08-23' }], price: 126, cash: 110 }, 'test');
  const db = readDb();
  const room = db.rooms.find((r) => r.id === r1.id)!;
  const pay = { allowCashAtHotel: true, cashDiscountPercent: 10 };
  assert.deepEqual(nightlyRate(room, '2027-08-10', db.ratePeriods), { price: 126, cash: 110 });
  assert.deepEqual(nightlyRate(room, '2027-08-23', db.ratePeriods), { price: 62, cash: null });
  // 8 August (base) + 9 and 10 August (season): card 62+126+126 = 314, cash 55+110+110 = 275
  const q = quoteStay(room, '2027-08-08', '2027-08-11', db.ratePeriods);
  assert.equal(q.total, 314);
  assert.equal(cashOf(q.total, stayCashPercent(room, '2027-08-08', '2027-08-11', db.ratePeriods, pay)), 275);
  // no cash at the hotel: no cash price at all; a season without its own cash price: the usual discount
  assert.equal(stayCashPercent(room, '2027-08-08', '2027-08-11', db.ratePeriods, { ...pay, allowCashAtHotel: false }), 0);
  assert.equal(cashOf(62, stayCashPercent(room, '2027-03-01', '2027-03-02', db.ratePeriods, pay)), 55);
  // cash dearer than card is refused
  assert.throws(() => setPeriodPrice({ roomIds: [r1.id], ranges: [{ from: '2027-07-01', to: '2027-08-01' }], price: 80, cash: 90 }, 'test'), /contanti/);
  // the month table and the cloud tables keep it
  const { monthPrices } = await import('../src/lib/period-prices');
  assert.equal(monthPrices(room, db.ratePeriods, TODAY).find((x) => x.m === '2027-08-01')?.cash, 110);
});

test('months said in words', async () => {
  const { parseMonthRanges } = await import('../src/server/assistant/dates-it');
  assert.deepEqual(parseMonthRanges('tutte le camere a 150 euro ad agosto', TODAY), [{ from: '2027-08-01', to: '2027-09-01' }]);
  assert.deepEqual(parseMonthRanges('a luglio e agosto', TODAY), [{ from: '2027-07-01', to: '2027-09-01' }]);
  assert.deepEqual(parseMonthRanges('a novembre e a giugno', TODAY), [{ from: '2026-11-01', to: '2026-12-01' }, { from: '2027-06-01', to: '2027-07-01' }]);
  assert.deepEqual(parseMonthRanges('il mese prossimo', TODAY), [{ from: '2026-12-01', to: '2027-01-01' }]);
});

test('assistant sentences → price commands', async () => {
  const { priceIntent } = await import('../src/server/assistant/price-intent');
  const aug = [{ from: '2027-08-01', to: '2027-09-01' }];
  assert.deepEqual(priceIntent('Metti il prezzo di tutte le camere a 150 euro ad agosto', TODAY), { rooms: 'tutte', price: 150, ranges: aug });
  assert.deepEqual(priceIntent('Cambia il prezzo della camera 101 a 85 euro, 80 in contanti', TODAY), { room: '101', price: 85, cash: 80 });
  assert.deepEqual(priceIntent('imposta il prezzo delle camere 101, 102 e 105 a 120 euro dal 10 al 20 luglio', TODAY), { rooms: ['101', '102', '105'], price: 120, ranges: [{ from: '2027-07-10', to: '2027-07-20' }] });
  assert.deepEqual(priceIntent('Riporta la camera 101 al prezzo base ad agosto', TODAY), { room: '101', ranges: aug, base: true });
  assert.deepEqual(priceIntent('metti il prezzo della camera 104 a 99 € a luglio e agosto', TODAY), { room: '104', price: 99, ranges: [{ from: '2027-07-01', to: '2027-09-01' }] });
  // card and cash for some dates ("55 con carta e 30 in contanti dal 23 al 26 novembre")
  assert.deepEqual(priceIntent('metti il prezzo di tutte le camere a 55 euro con carta e 30 euro in contanti dal 23 al 26 novembre', TODAY), { rooms: 'tutte', price: 55, cash: 30, ranges: [{ from: '2026-11-23', to: '2026-11-26' }] });
  assert.equal(priceIntent('chi arriva domani?', TODAY), null);
  assert.equal(priceIntent('cambia il prezzo a 90 euro', TODAY), null, 'no room said');
});

test('the assistant’s command runs on the same function as the panel', async () => {
  await seed();
  const { setPeriodPrice } = await import('../src/server/rooms');
  const { readDb } = await import('../src/server/db/store');
  const { nightlyPrice } = await import('../src/lib/availability');
  const aug = [{ from: '2027-08-01', to: '2027-09-01' }];
  let db = readDb();
  setPeriodPrice({ roomIds: db.rooms.map((r) => r.id), ranges: aug, price: 150 }, 'assistente');
  setPeriodPrice({ roomIds: [db.rooms[0]!.id], ranges: aug, price: null }, 'assistente');
  db = readDb();
  assert.equal(nightlyPrice(db.rooms[0]!, '2027-08-10', db.ratePeriods), db.rooms[0]!.basePrice);
  for (const room of db.rooms.slice(1)) assert.equal(nightlyPrice(room, '2027-08-10', db.ratePeriods), 150, room.number);
  assert.equal(db.ratePeriods.length, 1);
});

test('refund e-mail: back on the same card, when it arrives; by hand for cash', async () => {
  const db = await seed();
  const { renderEmail } = await import('../src/server/email/templates');
  const b = db.bookings.find((x) => x.status === 'confirmed')!;
  const it = renderEmail('rimborso', { booking: { ...b, guest: { ...b.guest, lang: 'it' } }, room: null, settings: db.settings, extra: { amount: 120, refundVia: 'card', card: 'Visa •••• 4242' } });
  assert.match(it.text, /stessa carta con cui hai pagato \(Visa •••• 4242\)/);
  assert.match(it.text, /5–10 giorni lavorativi/);
  const pl = renderEmail('rimborso', { booking: { ...b, guest: { ...b.guest, lang: 'pl' } }, room: null, settings: db.settings, extra: { amount: 50, refundVia: 'hand' } });
  assert.match(pl.text, /gotówką lub przelewem/);
  assert.doesNotMatch(pl.text, /dni roboczych/, 'no bank timing for money given back by hand');
});

test('tourist tax: per adult and night, only in its season, paid at the hotel', async () => {
  const { touristTaxFor, inTaxSeason } = await import('../src/lib/tourist-tax');
  const t = { enabled: true, amount: 2, from: '06-01', to: '09-30', maxNights: 0 };
  // 29 May → 3 June: nights 29, 30, 31 May (no tax) and 1, 2 June (tax) · 2 adults
  assert.deepEqual(touristTaxFor(t, '2027-05-29', '2027-06-03', 2), { total: 8, nights: 2, adults: 2, perNight: 2 });
  assert.equal(touristTaxFor(t, '2027-10-01', '2027-10-05', 2), null, 'out of season');
  assert.equal(touristTaxFor({ ...t, enabled: false }, '2027-07-01', '2027-07-05', 2), null, 'switched off');
  assert.equal(touristTaxFor({ ...t, maxNights: 7 }, '2027-07-01', '2027-07-15', 1)?.total, 14, 'at most 7 nights');
  // a season across New Year
  assert.equal(inTaxSeason('2027-01-05', '12-15', '01-10'), true);
  assert.equal(inTaxSeason('2027-02-05', '12-15', '01-10'), false);
});
