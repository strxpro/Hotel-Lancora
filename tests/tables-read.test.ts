import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeed } from '../src/server/db/seed';
import { TABLE_NAMES, toTables, type Row, type TableRows } from '../src/server/db/tables';
import { compareDocuments, fromTables } from '../src/server/db/tables-read';
import type { DB } from '../src/lib/types';

const NOW = new Date('2026-11-07T10:00:00Z');
const T = NOW.toISOString();

/** A document that uses every optional field at least once. */
function richDb(): DB {
  const db = buildSeed(NOW);
  // what normalize() in store.ts adds when the site reads its document
  Object.assign(db.settings.payments, { cashDiscountPercent: 5, allowCashAtHotel: true, allowOnline: true, cancellationFee: { type: 'percent', value: 100 } });
  db.settings.pricing = { singleUsePercent: 20, board: 'room_only' };
  const user = db.users[0]!.id;
  const room = db.rooms[0]!;
  room.bedConfig = [{ kind: 'matrimoniale', count: 1 }, { kind: 'singolo', count: 1 }];
  room.cashPrice = 60;
  room.photos[0]!.credit = 'Foto demo';
  const b = db.bookings[0]!;
  Object.assign(b.guest, { country: 'PL', lang: 'pl' });
  Object.assign(b, { paymentMethod: 'card', reviewRequestedAt: T, childrenAges: [4, 7], children: 2 });
  // the card and the "pay later" plan share the card column
  b.card = { customer: 'cus_1', paymentMethod: 'pm_1', brand: 'visa', last4: '4242', exp: '12/30', mode: 'test', savedAt: T };
  b.chargePlan = { since: T, outcome: 'failed', at: T, reason: 'fondi insufficienti sulla carta' };
  db.bookings[1]!.chargePlan = { since: T, outcome: null, at: null, reason: null };
  db.feedback.unshift({ id: 'fb-rich', bookingId: b.id, roomId: room.id, photos: ['/api/media/a.jpg'], translations: { en: 'Great' }, replies: [{ id: 'rep-1', author: 'hotel', name: 'Hotel', text: 'Grazie!', lang: 'it', createdAt: T }, { id: 'rep-2', author: 'guest', name: 'Anna', email: 'anna@example.com', text: 'A presto', lang: 'it', translations: { en: 'See you' }, createdAt: T }], verified: true, pending: false, editedAt: T, name: 'Anna K.', rating: 5, comment: 'Ottimo', lang: 'it', publishConsent: true, showOnSite: true, demo: false, createdAt: new Date(NOW.getTime() + 1000).toISOString() });
  db.telegram = { linkedChats: [{ chatId: '42', userId: user, name: '@owner', linkedAt: T }], linkCode: { code: '123456', userId: user, expiresAt: T }, lastTestAt: T, lastError: T };
  db.pendingActions.push({ id: 'pa-1', channel: 'telegram', chatId: '42', userId: user, tool: 'block_room', args: { room: '101', nights: 2 }, summary: 'Bloccare la 101?', createdAt: T, expiresAt: T, lang: 'pl' });
  db.assistantLog.push({ id: 'al-1', userId: user, channel: 'panel', role: 'user', text: 'ciao', voice: true, image: '/api/media/x.jpg', at: T }, { id: 'al-2', userId: user, channel: 'telegram', role: 'assistant', text: 'ecco', pendingId: 'pa-1', resolved: false, engine: 'groq', images: ['/api/media/y.jpg'], ui: [], at: new Date(NOW.getTime() + 1000).toISOString() });
  db.campaigns.push({ id: 'cmp-1', name: 'Primavera', subject: 'Offerta', headline: 'h', body: 'b', ctaLabel: 'Prenota', ctaUrl: '/prenotazione', image: '', audience: 'consent_all', selected: ['a@example.com'], langs: ['pl', 'en'], translate: true, personal: false, theme: { id: 't', name: 'Mare', layout: 'hero', bg: '#fff', card: '#fff', accent: '#000', ink: '#000', headerBg: '#000', headerInk: '#fff', font: 'serif', radius: 12 }, status: 'sent', sentAt: T, recipients: 3, createdAt: T });
  db.unsubscribed.push('no@example.com', 'stop@example.com');
  db.outbox.unshift({ id: 'em-rich', to: 'a@example.com', subject: 's', template: 'campagna', html: '<p>x</p>', text: 'x', bookingId: b.id, status: 'sent', error: null, createdAt: new Date(NOW.getTime() + 5000).toISOString(), sentAt: T, listUnsubscribe: 'https://example.com/u' });
  db.channel.lastSync = T;
  return db;
}

/** What the REST API hands back: timestamps with an offset instead of "Z", date-only timestamps as midnight, objects with their keys in another order. */
function asReadFromPostgres(rows: TableRows): TableRows {
  const out = {} as TableRows;
  const flip = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Row).reverse().map(([k, x]) => [k, flip(x)])) : Array.isArray(v) ? v.map(flip) : v);
  for (const t of TABLE_NAMES) {
    out[t] = rows[t]
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => {
        // only timestamp columns change their spelling; a text column (telegram_state.last_error) comes back as written
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && /(_at|^at|^last_sync)$/.test(k)) return [k, v.replace(/Z$/, '+00:00')];
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && /(_at|^at)$/.test(k)) return [k, `${v}T00:00:00+00:00`];
        return [k, flip(v)];
      })))
      .reverse(); // the order rows arrive in must not matter
  }
  return out;
}

const rebuilt = (db: DB) => fromTables(asReadFromPostgres(toTables(db, NOW)));

test('round trip: a document rebuilt from its own rows has exactly the same values', () => {
  const db = richDb();
  const cmp = compareDocuments(db, rebuilt(db));
  assert.deepEqual(cmp.real, [], 'no value differs');
  assert.deepEqual(cmp.order, [], 'every list comes back in the order the document keeps it');
  // the only things that come back written differently: seed reviews dated with a day only, and lists that were never set
  assert.ok(cmp.format.every((d) => /\.(createdAt|replies)$/.test(d.path)), JSON.stringify(cmp.format.slice(0, 3)));
  const again = rebuilt(db);
  assert.deepEqual(again.bookings.find((x) => x.id === db.bookings[0]!.id), db.bookings[0], 'a booking with every optional field comes back identical');
  assert.deepEqual(again.rooms.find((x) => x.id === db.rooms[0]!.id), db.rooms[0], 'a room with photos, translations, beds and cash price comes back identical');
  assert.deepEqual(again.feedback.find((x) => x.id === 'fb-rich'), db.feedback.find((x) => x.id === 'fb-rich'), 'a review with photos and replies comes back identical');
  assert.deepEqual(again.campaigns, db.campaigns);
  assert.deepEqual(again.telegram, db.telegram);
  assert.deepEqual(again.settings, db.settings);
  assert.deepEqual(again.pendingActions, db.pendingActions);
  assert.deepEqual(again.assistantLog, db.assistantLog);
  assert.deepEqual([again.schemaVersion, again.version, again.seededAt, again.updatedAt], [db.schemaVersion, db.version, db.seededAt, db.updatedAt]);
});

test('a changed, missing or surplus row in the tables is reported with its path', () => {
  const db = richDb();
  const rows = asReadFromPostgres(toTables(db, NOW));
  const id = db.bookings[3]!.id;
  rows.bookings.find((r) => r.id === id)!.total = 1;
  rows.payments = rows.payments.filter((r) => r.id !== db.payments[0]!.id);
  rows.tasks.push({ id: 't-ghost', label: 'x', done: false, created_at: T });
  rows.room_photos = rows.room_photos.filter((r) => !(r.room_id === db.rooms[1]!.id && r.position === 0));
  (rows.settings[0]!.pricing as { singleUsePercent: number }).singleUsePercent = 99;
  const cmp = compareDocuments(db, fromTables(rows));
  assert.deepEqual(cmp.real.map((d) => d.path).sort(), [`bookings[${id}].total`, `payments[${db.payments[0]!.id}]`, `rooms[${db.rooms[1]!.id}].photos`, 'settings.pricing.singleUsePercent', 'tasks[t-ghost]'].sort());
  assert.deepEqual(cmp.real.find((d) => d.path === `bookings[${id}].total`), { path: `bookings[${id}].total`, document: db.bookings[3]!.total, tables: 1 });
});

test('null and "not there" are the same; same instant written differently is only a format note', () => {
  const db = richDb();
  const other = structuredClone(db);
  delete other.bookings[1]!.reviewRequestedAt; // optional field: missing vs null
  other.bookings[1]!.cancelledAt = null;
  other.feedback.at(-1)!.replies = []; // empty list where the document has none
  other.bookings[2]!.createdAt = db.bookings[2]!.createdAt.replace('Z', '+00:00');
  const cmp = compareDocuments(db, other);
  assert.deepEqual(cmp.real, []);
  assert.deepEqual(cmp.format.map((d) => d.path).sort(), [`bookings[${db.bookings[2]!.id}].createdAt`, ...(db.feedback.at(-1)!.replies ? [] : [`feedback[${db.feedback.at(-1)!.id}].replies`])].sort());
});

test('list order: with hotel_list_order every list comes back exactly as the document keeps it', () => {
  const db = richDb();
  // the demo data is the hard case: bookings, payments and reviews are not in creation order
  const again = rebuilt(db);
  for (const list of ['users', 'rooms', 'bookings', 'blocks', 'ratePeriods', 'payments', 'outbox', 'notifications', 'audit', 'pendingActions', 'promotions', 'feedback', 'messages', 'tasks', 'campaigns', 'assistantLog'] as const) {
    assert.deepEqual(again[list].map((x) => x.id), db[list].map((x) => x.id), `${list} keeps its order`);
  }
  assert.deepEqual(again.unsubscribed, db.unsubscribed);
  assert.deepEqual(again.telegram.linkedChats.map((c) => c.chatId), db.telegram.linkedChats.map((c) => c.chatId));

  // a list reordered by hand in the document (nothing else changes): the stored order follows
  const odd = structuredClone(db);
  odd.tasks.reverse();
  odd.promotions.reverse();
  assert.deepEqual(compareDocuments(odd, rebuilt(odd)), { real: [], format: compareDocuments(db, rebuilt(db)).format, order: [] });
});

test('list order: on a database without hotel_list_order the values are all there and the order is reported', () => {
  const db = richDb();
  const rows = asReadFromPostgres(toTables(db, NOW));
  rows.hotel_list_order = []; // the SQL file was not run again yet
  const cmp = compareDocuments(db, fromTables(rows));
  assert.deepEqual(cmp.real, []);
  const moved = new Set(cmp.order.map((o) => o.list));
  for (const list of ['bookings', 'payments', 'feedback']) assert.equal(moved.has(list), true, `${list}: demo rows are not in creation order`);
  for (const list of ['rooms', 'assistantLog', 'campaigns', 'pendingActions', 'telegram.linkedChats']) assert.equal(moved.has(list), false, `${list} keeps its order from its own columns`);
  // newest first where the site prepends
  const again = fromTables(rows);
  assert.equal(again.outbox[0]!.id, 'em-rich');
  assert.equal(again.feedback[0]!.id, 'fb-rich');
  // …and a table that is missing altogether is the same as an empty one
  delete (rows as Partial<TableRows>).hotel_list_order;
  assert.deepEqual(compareDocuments(db, fromTables(rows)).real, []);
});

test('empty tables are refused instead of being read as an empty hotel', () => {
  const rows = toTables(richDb(), NOW);
  rows.hotel_meta = [];
  assert.throws(() => fromTables(rows), /hotel_meta/);
});
