import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Booking, DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the test
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-ical-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

// the portal: whatever `feed` holds, or down
let feed = '';
let down = false;
globalThis.fetch = (async () => {
  if (down) throw new Error('down');
  return new Response(feed, { status: 200 });
}) as typeof fetch;
const ics = (events: { uid: string; from: string; to: string; summary?: string }[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flatMap((e) => ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTART;VALUE=DATE:${e.from.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.to.replace(/-/g, '')}`, `SUMMARY:${e.summary ?? 'CLOSED - Not available'}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('portal calendar sync: echoes, double bookings, new stays, cancellations, hiccups', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const { addDays, todayISO } = await import('../src/lib/dates');
  const d = (n: number) => addDays(todayISO(), n);
  const db: DB = buildSeed(new Date());
  const room = db.rooms[0]!;
  const site = (id: string, from: number, to: number, ageMin: number): Booking => ({
    ...structuredClone(db.bookings[0]!),
    id,
    code: `LA-${id.toUpperCase()}`,
    token: `tok-${id}`,
    roomId: room.id,
    status: 'confirmed',
    source: 'sito',
    checkIn: d(from),
    checkOut: d(to),
    holdExpiresAt: null,
    cancelledAt: null,
    createdAt: new Date(Date.now() - ageMin * 60_000).toISOString(),
  });
  db.bookings = [site('site1', 20, 23, 60)];
  db.blocks = [];
  db.notifications = [];
  db.channel.calendars = [{ id: 'cal-t', roomId: room.id, source: 'booking', url: 'https://ical.booking.com/v1/export?t=x', lastSync: null, lastError: null, nights: 0 }];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  const ical = await import('../src/server/channels/ical');
  const { mutate, readDb } = await import('../src/server/db/store');
  const mine = () => readDb().blocks.filter((k) => k.extUid?.startsWith('cal-t:')).map((k) => `${k.from}>${k.to}`).sort();
  const notes = (re: RegExp) => readDb().notifications.filter((n) => re.test(`${n.type}|${n.title}|${n.body}`)).length;

  // 1st round: a portal stay, and one that overlaps the site booking (sold there before reading the site)
  feed = ics([{ uid: 'a', from: d(5), to: d(8) }, { uid: 'b', from: d(18), to: d(21) }]);
  const r = await ical.syncCalendar('cal-t');
  assert.equal(r.ok, true);
  assert.deepEqual(mine(), [`${d(18)}>${d(20)}`, `${d(5)}>${d(8)}`].sort(), 'the nights of the site booking are not closed twice, the rest is');
  assert.equal(r.nights, 5);
  assert.equal(notes(/^nuova_prenotazione/), 0, 'what was already on the portal is not announced as new');
  assert.equal(notes(/venduta due volte.*LA-SITE1/), 1, 'the owner is told about the double booking at once');

  // same calendar again: the alert is not repeated every 15 minutes
  await ical.syncCalendar('cal-t');
  assert.equal(notes(/venduta due volte/), 1);

  // a new stay and a cancellation on the portal reach the owner
  feed = ics([{ uid: 'b', from: d(18), to: d(21) }, { uid: 'c', from: d(40), to: d(42), summary: 'Reserved' }]);
  await ical.syncCalendar('cal-t');
  assert.deepEqual(mine(), [`${d(18)}>${d(20)}`, `${d(40)}>${d(42)}`].sort());
  assert.equal(notes(/^nuova_prenotazione\|Booking\.com: camera/), 1);
  assert.equal(notes(/^prenotazione_cancellata/), 1);

  // the echo: the portal read the site's calendar after the site booking and closes those nights → silent
  mutate((x) => {
    x.bookings.push(site('site2', 60, 62, 10));
  });
  ical.recordCalendarRead(room.id, 'booking');
  assert.ok(ical.lastCalendarRead(room.id, 'booking'));
  feed = ics([{ uid: 'b', from: d(18), to: d(21) }, { uid: 'c', from: d(40), to: d(42), summary: 'Reserved' }, { uid: 'echo', from: d(60), to: d(62) }]);
  await ical.syncCalendar('cal-t');
  assert.equal(notes(/venduta due volte/), 1, 'an echo is not a double booking');
  assert.equal(notes(/^nuova_prenotazione/), 1, 'nor a new stay');
  assert.ok(!mine().includes(`${d(60)}>${d(62)}`));

  // a portal hiccup: an empty calendar reopens the nights only if it is still empty at the next round
  feed = ics([]);
  await ical.syncCalendar('cal-t');
  assert.equal(mine().length, 2, 'sold nights are kept after one empty answer');
  await ical.syncCalendar('cal-t');
  assert.equal(mine().length, 0);

  // the quick check before a booking on the site: a portal that is down never marks the calendar broken
  down = true;
  await ical.refreshRoomCalendars(room.id, 0, 300);
  assert.equal(readDb().channel.calendars![0]!.lastError, null);
  // the 15-minute round does, and says it plainly
  await ical.syncCalendar('cal-t');
  assert.match(readDb().channel.calendars![0]!.lastError ?? '', /riprovo da solo/);
  down = false;

  // unlinking forgets what the sync remembered
  ical.forgetCalendar('cal-t');
  const mem = JSON.parse(fs.readFileSync(path.join(dataDir, 'calendari.json'), 'utf8')) as { seen: Record<string, unknown> };
  assert.equal(mem.seen['cal-t'], undefined);
});
