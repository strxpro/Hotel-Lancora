import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the tests
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-notice-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('a new booking and its cancellation reach the hotel by e-mail, once each; simulations do not', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date());
  const base = db.bookings[0]!;
  const room = db.rooms[0]!;
  db.settings.hotel.email = 'reception@hotel-lancora.it';
  const hold = (id: string, simulated = false) => ({
    ...structuredClone(base),
    id,
    code: `LA-${id.toUpperCase()}`,
    token: `Token_${id}_0123456789abcdefgh`,
    roomId: room.id,
    status: 'pending_payment' as const,
    holdExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    amountPaid: 0,
    source: 'sito' as const,
    demo: false,
    simulated,
    guest: { firstName: 'Salvatore', lastName: 'Scano', email: 'ospite@gmail.com', phone: '+39 333 1234567', lang: 'en' as const },
    specialRequests: 'Arrivo dopo le 22',
    createdAt: new Date().toISOString(),
  });
  db.bookings = [hold('n1'), hold('s1', true)];
  db.outbox = [];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  const { confirmPayAtHotel, cancelBooking } = await import('../src/server/bookings');
  const { readDb } = await import('../src/server/db/store');

  confirmPayAtHotel('n1');
  let d = readDb();
  const notices = () => readDb().outbox.filter((e) => e.template === 'avviso_hotel');
  const mail = notices()[0];
  assert.ok(mail, 'the hotel gets an e-mail');
  assert.equal(mail.to, 'reception@hotel-lancora.it');
  assert.match(mail.subject, /Nuova prenotazione dal sito · LA-N1/);
  assert.match(mail.html, /<html lang="it"/, 'in Italian, whatever the guest’s language');
  assert.match(mail.html, />Nuova prenotazione<\/h1>/);
  for (const bit of ['Salvatore Scano', 'ospite@gmail.com', '+39 333 1234567', 'In contanti all’arrivo', 'Arrivo dopo le 22', 'Apri nel pannello', '/admin/prenotazioni?id=n1']) assert.ok(mail.html.includes(bit), `shows ${bit}`);
  assert.ok(mail.html.includes(room.number ? `N° ${room.number}` : 'Da assegnare'), 'the room with its number (for the hotel)');
  // the guest still gets their own confirmation, in their language
  assert.ok(d.outbox.some((e) => e.template === 'conferma' && e.to === 'ospite@gmail.com'));

  // a simulated booking (a test from the panel) does not write to the hotel
  confirmPayAtHotel('s1');
  assert.equal(notices().length, 1);

  // cancelled: one more e-mail, and only one even if the cancellation is announced twice
  cancelBooking('n1', 'Reception');
  const { mutate } = await import('../src/server/db/store');
  const { notify } = await import('../src/server/events');
  mutate((x) => notify(x, 'prenotazione_cancellata', 'Cancellata: carta non aggiornata · LA-N1', 'altro avviso', '/admin/prenotazioni?id=n1'));
  d = readDb();
  const all = notices();
  assert.equal(all.length, 2);
  assert.match(all[0]!.html, />Prenotazione cancellata<\/h1>/);
  assert.match(all[0]!.subject, /Prenotazione cancellata · LA-N1/);

  // portals' calendar notices (no booking of the hotel) are not e-mailed
  mutate((x) => notify(x, 'nuova_prenotazione', 'Booking.com: camera 101 occupata', 'Dal 1 al 3', '/admin/disponibilita'));
  assert.equal(notices().length, 2);
});
