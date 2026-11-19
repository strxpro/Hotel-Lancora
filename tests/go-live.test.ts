import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the tests
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-golive-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('"Inizia con i dati veri" removes the demo, keeps the hotel, saves a copy and happens once', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date());
  const room = db.rooms[0]!;
  // a night closed by Booking.com's calendar is real and must stay; a hand-made demo block goes
  db.blocks.push({ id: 'blk-ical', roomId: room.id, from: '2030-01-10', to: '2030-01-12', reason: 'Booking.com', createdBy: 'Calendario', createdAt: new Date().toISOString(), source: 'booking', extUid: 'cal-1:uid-1' });
  db.telegram.linkedChats = [{ chatId: '1', userId: 'u-admin', name: 'Titolare', linkedAt: new Date().toISOString() }];
  // today's morning message and report already went out; yesterday's report and other notices are demo history
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 36 * 3600_000).toISOString();
  const n = (id: string, type: DB['notifications'][number]['type'], createdAt: string) => ({ ...structuredClone(db.notifications[0]!), id, type, title: id, createdAt });
  db.notifications = [n('n-arrivi-oggi', 'nuovo_arrivo', now), n('n-report-oggi', 'report_giornaliero', now), n('n-report-ieri', 'report_giornaliero', yesterday), n('n-pagamento', 'nuovo_pagamento', now)];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  fs.writeFileSync(path.join(dataDir, 'visits.json'), JSON.stringify({ days: { '2026-11-14': { visitors: 3, views: 5, bookingViews: 1, roomViews: 1 } } }));

  const { startRealData, demoSummary } = await import('../src/server/go-live');
  const { readDb } = await import('../src/server/db/store');
  const before = readDb();
  const s = demoSummary(before);
  assert.ok(s.bookings > 100 && s.payments > 0 && s.reviews > 0, 'the demo has data to remove');

  const r = startRealData('Titolare');
  const after = readDb();
  assert.equal(after.settings.demoMode, false);
  // the daily messages already sent today stay, so they are not sent again on Telegram (server/daily.ts)
  assert.deepEqual(after.notifications.map((x) => x.id).sort(), ['n-arrivi-oggi', 'n-report-oggi']);
  const { sentToday } = await import('../src/server/daily');
  const { todayISO } = await import('../src/lib/dates');
  assert.equal(sentToday(after, 'report_giornaliero', todayISO()), true);
  assert.equal(sentToday(after, 'nuovo_arrivo', todayISO()), true);
  for (const k of ['bookings', 'payments', 'outbox', 'feedback', 'messages', 'tasks', 'campaigns', 'unsubscribed', 'assistantLog', 'pendingActions', 'promotions'] as const) {
    assert.equal(after[k].length, 0, `${k} emptied`);
  }
  // kept: what describes the hotel
  assert.equal(after.rooms.length, before.rooms.length);
  assert.deepEqual(after.rooms.map((x) => x.photos.length), before.rooms.map((x) => x.photos.length));
  assert.deepEqual(after.ratePeriods, before.ratePeriods);
  assert.deepEqual(after.users.map((u) => u.id), before.users.map((u) => u.id));
  assert.deepEqual(after.settings.payments, before.settings.payments);
  assert.equal(after.telegram.linkedChats.length, 1);
  assert.deepEqual(after.blocks.map((b) => b.id), ['blk-ical']);
  // one line in the activity log, a full copy on disk, visits from zero
  assert.equal(after.audit.length, 1);
  assert.equal(after.audit[0]!.action, 'go_live');
  assert.ok(fs.existsSync(r.backup));
  assert.equal((JSON.parse(fs.readFileSync(r.backup, 'utf8')) as DB).bookings.length, s.bookings);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'visits.json'), 'utf8')), { days: {} });

  // the copy in the database tables follows: one export that deletes the demo rows, nothing else broken
  const { diffPayload, documentIssues, snapshotOf, toTables } = await import('../src/server/db/tables');
  assert.deepEqual(documentIssues(after), []);
  const d = diffPayload(snapshotOf(toTables(before)), toTables(after));
  assert.ok(d.deletes >= s.bookings + s.payments + s.reviews, `deletes ${d.deletes}`);
  assert.equal(d.payload.delete.bookings?.length, s.bookings);
  assert.equal(d.payload.upsert.rooms, undefined, 'rooms untouched');

  // demo reviews are never added back to real data, and it cannot run twice
  const again = readDb();
  assert.equal(again.feedback.length, 0);
  assert.throws(() => startRealData('Titolare'), /già i dati veri/);
});

test('real data of another format is never replaced by the demo', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db = buildSeed(new Date()) as DB & { schemaVersion: number };
  db.settings.demoMode = false;
  db.bookings = db.bookings.slice(0, 3);
  db.schemaVersion = 999;
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  const { readDb } = await import('../src/server/db/store');
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void errors.push(a);
  try {
    const got = readDb();
    assert.equal(got.bookings.length, 3, 'the hotel bookings are still there');
    assert.equal(got.settings.demoMode, false);
  } finally {
    console.error = orig;
  }
  assert.ok(errors.length >= 1, 'the problem is logged');
});
