import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the tests
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-reports-'));
process.env.DATA_DIR = dataDir;
delete process.env.TELEGRAM_BOT_TOKEN;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const TYPES = ['report_giornaliero', 'nuovo_arrivo', 'partenza_oggi', 'camera_da_controllare'] as const;

test('“spegni il report”, “wyłącz raporty”, “turn off the morning report” are understood without the AI', async () => {
  const { reportsIntent } = await import('../src/server/assistant/day-messages');
  const { normIt } = await import('../src/server/assistant/dates-it');
  const ask = (s: string) => reportsIntent(normIt(s));
  assert.deepEqual(ask('Spegni il report della sera'), { which: 'sera', on: false });
  assert.deepEqual(ask('Non mandarmi più il report'), { which: 'sera', on: false });
  assert.deepEqual(ask('riaccendi i messaggi del mattino'), { which: 'mattina', on: true });
  assert.deepEqual(ask('spegni tutti i report'), { which: 'tutti', on: false });
  assert.deepEqual(ask('disattiva il report delle camere da preparare'), { which: 'camere', on: false });
  // Polish: "wyłącz" = off, "włącz" = on, with or without the Polish letters
  assert.deepEqual(ask('wyłącz raporty'), { which: 'tutti', on: false });
  assert.deepEqual(ask('wylacz raporty'), { which: 'tutti', on: false });
  assert.deepEqual(ask('Wyłącz poranny raport'), { which: 'mattina', on: false });
  assert.deepEqual(ask('włącz raporty'), { which: 'tutti', on: true });
  assert.deepEqual(ask('wlacz raport wieczorny'), { which: 'sera', on: true });
  assert.deepEqual(ask('przestań wysyłać mi raport wieczorny'), { which: 'sera', on: false });
  assert.deepEqual(ask('nie wysyłaj porannych raportów'), { which: 'mattina', on: false });
  // English
  assert.deepEqual(ask('turn off the morning report'), { which: 'mattina', on: false });
  assert.deepEqual(ask('switch on the reports'), { which: 'tutti', on: true });
  // not a command: questions and other subjects go on to the rest of the assistant
  assert.equal(ask('come funziona il report?'), null);
  assert.equal(ask('spegni la luce della camera 101'), null);
  assert.equal(ask('quanto abbiamo incassato'), null);
});

test('switching the messages changes only what was asked, and the time of the evening report can move', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date());
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  const { reportsSummary, setReports } = await import('../src/server/assistant/day-messages');
  const { readDb } = await import('../src/server/db/store');
  const { reportSchedule } = await import('../src/server/daily');
  const notes = () => readDb().settings.notifications;

  assert.match(reportsSummary({ which: 'sera', on: false }, readDb()), /^Spegnere il report della sera\?/);
  assert.match(setReports({ which: 'sera', on: false }, 'Titolare'), /^Fatto: il report della sera spento\. Per riaccenderlo scrivimi “riaccendi il report della sera”/);
  assert.equal(notes().report_giornaliero, false);
  assert.notEqual(notes().nuovo_arrivo, false, 'the morning messages stay as they were');

  setReports({ which: 'tutti', on: false }, 'Titolare');
  for (const k of TYPES) assert.equal(notes()[k], false, `${k} off`);
  setReports({ which: 'tutti', on: true }, 'Titolare');
  for (const k of TYPES) assert.equal(notes()[k], true, `${k} on`);

  assert.match(reportsSummary({ which: 'sera', time: '22:30' }, readDb()), /^Spostare il report della sera alle 22:30\?/);
  setReports({ which: 'sera', time: '22:30' }, 'Titolare');
  const plan = reportSchedule(readDb());
  assert.equal(plan.evening.time, '22:30');
  assert.equal(plan.morning.time, '08:00', 'the morning keeps its time');
  assert.ok(readDb().audit.some((a) => /Assistente: il report della sera alle 22:30/.test(a.details)), 'written in the history');
});
