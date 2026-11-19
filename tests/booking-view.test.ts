import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-booking-view-'));
process.env.DATA_DIR = dataDir;
for (const k of ['STORE_MODE', 'GROQ_API_KEY', 'TELEGRAM_BOT_TOKEN']) delete process.env[k];
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('Vista Booking: closing blocks only the free nights, opening trims the manual blocks', async () => {
  const { readDb, mutate } = await import('../src/server/db/store');
  const { setRoomsOpen } = await import('../src/server/rooms');
  const db = readDb();
  const room = db.rooms[0]!;
  const guest = db.bookings.find((b) => b.status === 'confirmed');
  assert.ok(guest, 'the demo data has a confirmed booking');
  mutate((d) => {
    d.blocks = d.blocks.filter((k) => k.roomId !== room.id);
    d.bookings = d.bookings.filter((b) => b.roomId !== room.id || b.id === guest!.id);
  });
  // a guest on 2031-07-03 → 05 in the middle of the range
  mutate((d) => {
    const b = d.bookings.find((x) => x.id === guest?.id);
    if (b) Object.assign(b, { roomId: room.id, checkIn: '2031-07-03', checkOut: '2031-07-05', status: 'confirmed' });
  });
  const r = setRoomsOpen({ roomIds: [room.id], from: '2031-07-01', to: '2031-07-08', open: false }, 'test');
  const mine = () => readDb().blocks.filter((k) => k.roomId === room.id).map((k) => `${k.from}>${k.to}`).sort();
  assert.equal(r.changed, 2);
  assert.deepEqual(mine(), ['2031-07-01>2031-07-03', '2031-07-05>2031-07-08']);
  // open the middle of the second block: the two ends stay closed
  setRoomsOpen({ roomIds: [room.id], from: '2031-07-06', to: '2031-07-07', open: true }, 'test');
  assert.deepEqual(mine(), ['2031-07-01>2031-07-03', '2031-07-05>2031-07-06', '2031-07-07>2031-07-08']);
  // open everything
  setRoomsOpen({ roomIds: [room.id], from: '2031-07-01', to: '2031-07-08', open: true }, 'test');
  assert.deepEqual(mine(), []);
});

test('places: the site starts from the original places, the owner list wins, hidden ones stay off', async () => {
  const { defaultPlaces, toPlaceItems, parseLatLng } = await import('../src/lib/places');
  const list = defaultPlaces();
  assert.ok(list.length >= 5);
  assert.ok(list.every((p) => p.photos.length > 0));
  const items = toPlaceItems([{ ...list[0]!, name: 'Spiaggia nuova', text: { it: 'Solo italiano' }, photos: [] }, { ...list[1]!, hidden: true }]);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.name, 'Spiaggia nuova');
  // a missing language shows the Italian text, a place without photos still has a cover
  assert.equal(items[0]!.text.de, 'Solo italiano');
  assert.ok(items[0]!.photo.src);
  assert.deepEqual(parseLatLng('https://www.google.com/maps/place/X/@41.2453,9.1897,15z'), { lat: 41.2453, lng: 9.1897 });
  assert.deepEqual(parseLatLng('41.24531, 9.18972'), { lat: 41.24531, lng: 9.18972 });
  assert.equal(parseLatLng('via Roma 3'), null);
});

test('alternatives: nearby dates first, then a shorter stay on the same arrival', async () => {
  const { readDb } = await import('../src/server/db/store');
  const { suggestAlternatives } = await import('../src/lib/availability');
  const db = readDb();
  const alts = suggestAlternatives(db, { checkIn: '2031-08-10', checkOut: '2031-08-13', adults: 2, children: 0 }, new Date('2031-01-01'), '2031-01-01');
  assert.ok(alts.length >= 1 && alts.length <= 4);
  assert.ok(alts.every((a) => a.checkOut > a.checkIn && a.count > 0 && a.from > 0));
});
