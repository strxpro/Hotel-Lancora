import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the tests
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-delete-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('the bin removes a booking with what belongs to it, keeps the review and leaves no loose rows for the cloud copy', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date());
  const b = db.bookings.find((x) => x.amountPaid > 0) ?? db.bookings[0]!;
  const other = db.bookings.find((x) => x.id !== b.id)!;
  const now = new Date().toISOString();
  db.payments.push({ id: 'pay-del-1', bookingId: b.id, amount: 100, kind: 'deposit', provider: 'contanti', status: 'succeeded', reference: null, createdAt: now });
  db.messages.push({ id: 'msg-del-1', bookingId: b.id, name: 'Ospite', email: b.guest.email, subject: 'Domanda', body: 'Ciao', source: 'area_ospite', read: false, createdAt: now });
  db.outbox.push({ id: 'out-del-1', to: b.guest.email, subject: 'Conferma', template: 'conferma', html: '', text: '', bookingId: b.id, status: 'demo_outbox', error: null, createdAt: now, sentAt: null });
  db.feedback.push({ id: 'fb-del-1', bookingId: b.id, name: 'Ospite', rating: 5, comment: 'Bello', lang: 'it', publishConsent: true, showOnSite: true, demo: false, createdAt: now });
  db.notifications.push({ id: 'n-del-1', type: 'nuova_prenotazione', title: 'Nuova', body: '', href: `/admin/prenotazioni?id=${b.id}`, read: false, telegram: 'non_configurato', createdAt: now });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  const { deleteBooking } = await import('../src/server/bookings');
  const { readDb } = await import('../src/server/db/store');
  const { documentIssues } = await import('../src/server/db/tables');

  const res = deleteBooking(b.id, 'Titolare');
  assert.equal(res.code, b.code);
  const d = readDb();
  assert.ok(!d.bookings.some((x) => x.id === b.id), 'the booking is gone');
  assert.ok(d.bookings.some((x) => x.id === other.id), 'the other bookings stay');
  assert.equal(d.payments.filter((p) => p.bookingId === b.id).length, 0);
  assert.equal(d.messages.filter((m) => m.bookingId === b.id).length, 0);
  assert.equal(d.outbox.filter((m) => m.bookingId === b.id).length, 0);
  assert.equal(d.notifications.filter((n) => n.href?.includes(b.id)).length, 0);
  const fb = d.feedback.find((f) => f.id === 'fb-del-1');
  assert.ok(fb, 'the review stays');
  assert.equal(fb.bookingId, null);
  assert.equal(d.audit[0]?.action, 'delete');
  assert.match(d.audit[0]!.details, new RegExp(b.code));
  assert.deepEqual(documentIssues(d).filter((i) => i.includes('collegate')), [], 'no rows pointing at the deleted booking');

  // pressed twice (two tabs): a plain message, nothing else changes
  assert.throws(() => deleteBooking(b.id, 'Titolare'), /già stata eliminata/);
});

test('only the owner may delete a booking', async () => {
  const { can } = await import('../src/server/auth/permissions');
  assert.equal(can('admin', 'bookings.delete'), true);
  assert.equal(can('staff', 'bookings.delete'), false);
});
