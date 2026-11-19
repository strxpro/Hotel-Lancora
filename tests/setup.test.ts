import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';

const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-setup-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('first set-up: wizard for the starter login, ticks from the real data, welcome once right after it', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const { setupState, OWNER_ID } = await import('../src/server/setup');
  const db: DB = buildSeed(new Date());
  db.telegram.linkedChats = [];
  db.channel.calendars = [];
  db.settings.stripeConnect = { ...db.settings.stripeConnect, accountId: null, chargesEnabled: false, simulated: false };

  let s = setupState(db, OWNER_ID);
  assert.equal(s.wizard, true, 'the owner on the starter login gets the wizard');
  assert.equal(s.items.find((i) => i.key === 'account')!.done, false);
  assert.equal(setupState(db, 'u-staff').wizard, false, 'nobody else does');

  // the owner chose his own login and checked the hotel; cash only; Telegram and portals later
  db.users.find((u) => u.id === OWNER_ID)!.email = 'marco@hotel-test.it';
  db.settings.panel = { setup: { accountAt: 'x', hotelAt: 'x', payments: 'hotel', telegramSkipped: true, portalsSkipped: true, wizardDoneAt: 'x' } };
  s = setupState(db, OWNER_ID);
  assert.equal(s.wizard, false);
  assert.deepEqual(s.items.filter((i) => !i.done).map((i) => i.key), ['photos'], 'only the demo photos are left');
  assert.equal(s.celebrate, true, 'the welcome moment plays right after the guided set-up, even with something left');
  assert.equal(setupState(db, 'u-staff').celebrate, false, 'only for the owner');

  // played once → never again; real photos later just tick the last item
  db.settings.panel.setup!.celebratedAt = 'y';
  assert.equal(setupState(db, OWNER_ID).celebrate, false);
  for (const r of db.rooms) r.photos = r.photos.map((p) => ({ ...p, demo: false }));
  for (const r of db.rooms.filter((r) => r.status !== 'draft' && !r.photos.length)) r.photos = [{ id: 'p', src: '/api/media/x.webp', alt: '', width: 10, height: 10, demo: false }];
  s = setupState(db, OWNER_ID);
  assert.equal(s.allDone, true);
  assert.equal(s.celebrate, false);
});

test('Telegram messages: chosen time (on the hour / half past) and days, defaults 08:00 and 21:00', async () => {
  const { reportSchedule, isoWeekday } = await import('../src/server/daily');
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date());
  assert.deepEqual(reportSchedule(db).morning, { time: '08:00', days: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(reportSchedule(db).evening.time, '21:00');
  db.settings.panel = { reports: { morning: { time: '07:30', days: [1, 2, 3, 4, 5] }, evening: { time: '19:15', days: [] } } };
  assert.deepEqual(reportSchedule(db).morning, { time: '07:30', days: [1, 2, 3, 4, 5] });
  assert.equal(reportSchedule(db).evening.time, '21:00', 'only :00 and :30 are accepted');
  assert.equal(isoWeekday('2026-11-16'), 1, '16 November 2026 is a Monday');
  assert.equal(isoWeekday('2026-11-22'), 7);
});
