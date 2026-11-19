import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// the server modules read DATA_DIR when they load: set it first, import them inside the tests
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-hotel-tools-'));
process.env.DATA_DIR = dataDir;
for (const k of ['TELEGRAM_BOT_TOKEN', 'GROQ_API_KEY', 'AI_PROVIDER', 'STORE_MODE']) delete process.env[k];
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('the day, prices, payments and the new switches are understood without the AI (it, pl, en)', async () => {
  const { hotelIntent } = await import('../src/server/assistant/hotel-tools');
  const { normIt } = await import('../src/server/assistant/dates-it');
  const ask = (s: string) => hotelIntent(normIt(s), s);
  assert.deepEqual(ask('Oggi'), { tool: 'today', args: {} });
  assert.deepEqual(ask('dzisiaj'), { tool: 'today', args: {} });
  assert.deepEqual(ask('Prezzi'), { tool: 'prices_overview', args: {} });
  assert.deepEqual(ask('che prezzi abbiamo?'), { tool: 'prices_overview', args: {} });
  assert.deepEqual(ask('Pagamenti'), { tool: 'payments_status', args: {} });
  assert.deepEqual(ask('płatności'), { tool: 'payments_status', args: {} });
  assert.deepEqual(ask('quanto posso ricevere subito?'), { tool: 'payments_status', args: {} });
  assert.deepEqual(ask('Accendi l’aumento prezzi online del 2%'), { tool: 'set_online_markup', args: { enabled: true, percent: 2 } });
  assert.deepEqual(ask('spegni l’aumento prezzi online'), { tool: 'set_online_markup', args: { enabled: false } });
  assert.deepEqual(ask('włącz podwyżkę cen online 1,5%'), { tool: 'set_online_markup', args: { enabled: true, percent: 1.5 } });
  assert.deepEqual(ask('accendi la tassa di soggiorno a 2,50 euro'), { tool: 'set_tourist_tax', args: { enabled: true, amount: 2.5 } });
  assert.deepEqual(ask('wyłącz opłatę miejscową'), { tool: 'set_tourist_tax', args: { enabled: false } });
  assert.deepEqual(ask('quanto è la tassa di soggiorno?'), { tool: 'prices_overview', args: {} });
  assert.deepEqual(ask('accendi il bonifico immediato automatico'), { tool: 'set_auto_instant', args: { enabled: true } });
  assert.deepEqual(ask('wyłącz automatyczne wypłaty natychmiastowe'), { tool: 'set_auto_instant', args: { enabled: false } });
  // other subjects go on to the rest of the assistant
  assert.equal(ask('chi arriva domani?'), null);
  assert.equal(ask('cambia il prezzo della camera 101 a 85 euro'), null);
  assert.equal(ask('quanto abbiamo incassato oggi'), null);
});

test('summaries read the hotel: day at a glance, prices with card and cash, tax and increase', async () => {
  const { pricesOverview, todaySummary, setMarkup, setTax } = await import('../src/server/assistant/hotel-tools');
  const { readDb } = await import('../src/server/db/store');
  const { todayISO } = await import('../src/lib/dates');
  const day = todaySummary(readDb(), todayISO());
  assert.match(day, /Arrivi: \d+/);
  assert.match(day, /Camere libere stanotte: \d+/);
  assert.match(pricesOverview(readDb(), todayISO()), /Aumento prezzi online spento/);
  assert.match(setMarkup({ enabled: true, percent: 2 }, 'test'), /^Fatto: .*\+2%/);
  assert.match(setTax({ enabled: true, amount: 2 }, 'test'), /^Fatto: tassa di soggiorno/);
  const after = pricesOverview(readDb(), todayISO());
  assert.match(after, /Aumento prezzi online acceso: \+2%/);
  assert.match(after, /Tassa di soggiorno: 2,00/);
  assert.equal(readDb().settings.pricing?.onlineMarkup?.percent, 2);
});

test('a season: saved with card and cash price, then changed in place, then removed', async () => {
  const { saveRatePeriod, removeRatePeriod } = await import('../src/server/rooms');
  const { readDb } = await import('../src/server/db/store');
  const before = readDb().ratePeriods.length;
  const p = saveRatePeriod({ label: 'Alta stagione', from: '2027-08-01', to: '2027-09-01', roomIds: 'all', mode: 'fixed', value: 150, cash: 140 }, 'test');
  assert.equal(readDb().ratePeriods.length, before + 1);
  assert.deepEqual([p.value, p.cash], [150, 140]);
  // change it: other dates and prices, no own cash price any more; it keeps its place in the list
  const index = readDb().ratePeriods.findIndex((x) => x.id === p.id);
  saveRatePeriod({ id: p.id, label: 'Agosto', from: '2027-08-05', to: '2027-08-25', roomIds: 'all', mode: 'fixed', value: 160, cash: null }, 'test');
  const now = readDb().ratePeriods.find((x) => x.id === p.id)!;
  assert.deepEqual([now.label, now.from, now.to, now.value, now.cash], ['Agosto', '2027-08-05', '2027-08-25', 160, undefined]);
  assert.equal(readDb().ratePeriods.findIndex((x) => x.id === p.id), index);
  assert.equal(readDb().ratePeriods.length, before + 1);
  // what is not allowed
  assert.throws(() => saveRatePeriod({ label: 'x', from: '2027-08-05', to: '2027-08-01', roomIds: 'all', mode: 'fixed', value: 100 }, 'test'), /dopo/);
  assert.throws(() => saveRatePeriod({ label: 'x', from: '2027-08-01', to: '2027-08-05', roomIds: 'all', mode: 'fixed', value: 100, cash: 120 }, 'test'), /contanti/);
  assert.throws(() => saveRatePeriod({ id: 'rp-non-esiste', label: 'x', from: '2027-08-01', to: '2027-08-05', roomIds: 'all', mode: 'fixed', value: 100 }, 'test'), /non esiste/);
  removeRatePeriod(p.id, 'test');
  assert.equal(readDb().ratePeriods.length, before);
});
