import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-rooms-nonum-'));
process.env.DATA_DIR = dataDir;
for (const k of ['STORE_MODE', 'GROQ_API_KEY', 'TELEGRAM_BOT_TOKEN']) delete process.env[k];
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const room = (name: string, number = '') => ({ number, name, type: 'matrimoniale' as const, maxGuests: 2, beds: '1 letto matrimoniale', bedsCount: 1, size: null, floor: 'terra' as const, basePrice: 90, status: 'available' as const, hidden: false, amenities: [], photos: [], text: { title: name, short: '', description: '' } });

test('rooms without numbers: the site numbers them inside the panel, guests never see it', async () => {
  const { saveRoom } = await import('../src/server/rooms');
  const { mutate, readDb } = await import('../src/server/db/store');
  const { publicCards } = await import('../src/server/public-data');
  mutate((db) => {
    db.rooms = [];
  });
  const a = saveRoom(room('Maestrale'), 'test');
  const b = saveRoom(room('Libeccio'), 'test');
  const c = saveRoom(room('Suite', '12'), 'test');
  assert.deepEqual([a.number, a.numberAuto, b.number, b.numberAuto, c.number, c.numberAuto], ['1', true, '2', true, '12', false]);
  // saved again without a number: it keeps its own
  const a2 = saveRoom({ ...room('Maestrale vista mare'), id: a.id }, 'test');
  assert.deepEqual([a2.number, a2.numberAuto, a2.name], ['1', true, 'Maestrale vista mare']);
  const cards = publicCards(readDb(), 'it');
  assert.equal(cards.find((x) => x.id === a.id)!.number, '');
  assert.equal(cards.find((x) => x.id === c.id)!.number, '12');
  // a typed number still has to be unique
  assert.throws(() => saveRoom(room('Doppia', '12'), 'test'), /12/);
});
