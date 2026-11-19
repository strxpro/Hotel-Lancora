import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSeed } from '../src/server/db/seed';
import { TABLES, TABLE_NAMES, diffPayload, documentIssues, fullPayload, rowCounts, snapshotOf, toTables, type TableName } from '../src/server/db/tables';
import { TABLE_COLUMNS } from '../src/server/db/table-columns';
import type { Booking, DB } from '../src/lib/types';

const NOW = new Date('2026-11-07T10:00:00Z');
const SQL = fs.readFileSync(path.join(process.cwd(), 'supabase', 'hotel-tables.sql'), 'utf8');

/** A document with at least one row for every table (the demo seed leaves a few lists empty). */
function fullDb(): DB {
  const db = buildSeed(NOW);
  const user = db.users[0]!.id;
  const fb = db.feedback[0]!;
  fb.replies = [{ id: 'rep-1', author: 'hotel', name: 'Hotel', text: 'Grazie!', lang: 'it', createdAt: NOW.toISOString() }, { id: 'rep-2', author: 'guest', name: 'Anna', email: 'anna@example.com', text: 'A presto', lang: 'it', translations: { en: 'See you' }, createdAt: NOW.toISOString() }];
  db.telegram.linkedChats.push({ chatId: '42', userId: user, name: '@owner', linkedAt: NOW.toISOString() });
  db.pendingActions.push({ id: 'pa-1', channel: 'telegram', chatId: '42', userId: user, tool: 'block_room', args: { room: '101' }, summary: 'Bloccare la 101?', createdAt: NOW.toISOString(), expiresAt: NOW.toISOString(), lang: 'pl' });
  db.assistantLog.push({ id: 'al-1', userId: user, channel: 'panel', role: 'user', text: 'ciao', at: NOW.toISOString() });
  db.campaigns.push({ id: 'cmp-1', name: 'Primavera', subject: 'Offerta', headline: '', body: '', ctaLabel: '', ctaUrl: '', image: '', audience: 'consent_all', status: 'draft', sentAt: null, recipients: 0, createdAt: NOW.toISOString() });
  db.unsubscribed.push('no@example.com');
  db.outbox.push({ id: 'em-1', to: 'a@example.com', subject: 's', template: 'conferma', html: '<p>x</p>', text: 'x', bookingId: db.bookings[0]!.id, status: 'demo_outbox', error: null, createdAt: NOW.toISOString(), sentAt: null });
  db.notifications.push({ id: 'n-1', type: 'nuova_prenotazione', title: 't', body: 'b', href: null, read: false, telegram: 'non_configurato', createdAt: NOW.toISOString() });
  db.audit.push({ id: 'a-1', at: NOW.toISOString(), actor: 'Test', action: 'x', entity: 'y', entityId: null, details: '' });
  return db;
}

/** Column names and primary key of every `create table` in the SQL file. */
function sqlTables(): Record<string, { columns: string[]; pk: string[] }> {
  const out: Record<string, { columns: string[]; pk: string[] }> = {};
  const re = /create table if not exists public\.(\w+) \(\n([\s\S]*?)\n\);/g;
  for (let m = re.exec(SQL); m; m = re.exec(SQL)) {
    const columns: string[] = [];
    let pk: string[] = [];
    let depth = 0;
    for (const raw of m[2]!.split('\n')) {
      const line = raw.replace(/--.*$/, '').replace(/'[^']*'/g, "''").trim();
      if (depth === 0 && line) {
        const first = line.split(/\s+/)[0]!;
        const tablePk = /^primary key \(([^)]+)\)/.exec(line);
        if (tablePk) pk = tablePk[1]!.split(',').map((s) => s.trim());
        else if (!['constraint', 'check', 'unique', 'foreign', 'exclude'].includes(first)) {
          columns.push(first);
          if (/\bprimary key\b/.test(line)) pk = [first];
        }
      }
      depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    }
    out[m[1]!] = { columns, pk };
  }
  return out;
}

/** columns the database fills by itself */
const DB_ONLY: Partial<Record<TableName, string[]>> = { unsubscribed: ['added_at'] };

test('SQL file and mapper describe the same tables, keys and columns', () => {
  const sql = sqlTables();
  const listed = /select array\[([\s\S]*?)\]::text\[\]/.exec(SQL)![1]!.match(/'(\w+)'/g)!.map((s) => s.slice(1, -1));
  assert.deepEqual(listed, TABLE_NAMES, 'hotel_tables() lists the tables in the mapper’s order (parents before children)');
  assert.deepEqual(Object.keys(sql).sort(), [...TABLE_NAMES, 'hotel_state'].sort(), 'one create table per table');

  const rows = toTables(fullDb(), NOW);
  for (const t of TABLE_NAMES) {
    assert.ok(rows[t].length > 0, `${t}: the test document has rows`);
    assert.deepEqual(sql[t]!.pk, [...TABLES[t]], `${t}: primary key`);
    const sent = Object.keys(rows[t][0]!).sort();
    assert.deepEqual(sent, sql[t]!.columns.filter((c) => !DB_ONLY[t]?.includes(c)).sort(), `${t}: columns`);
    assert.deepEqual([...TABLE_COLUMNS[t]].sort(), sent, `${t}: TABLE_COLUMNS (src/server/db/table-columns.ts) lists the same columns`);
    for (const row of rows[t]) {
      assert.deepEqual(Object.keys(row).sort(), sent, `${t}: every row carries the same columns`);
      for (const [k, v] of Object.entries(row)) assert.notEqual(v, undefined, `${t}.${k} is never undefined (null instead)`);
    }
  }
});

test('every table has row level security and the stays cannot overlap', () => {
  assert.match(SQL, /foreach t in array public\.hotel_tables\(\) \|\| array\['hotel_state'\] loop\s+execute format\('alter table public\.%I enable row level security', t\);/);
  assert.doesNotMatch(SQL, /create policy/i, 'no policy: only the server key reads or writes');
  assert.match(SQL, /constraint bookings_no_overlap exclude using gist \(\s*room_id with =,\s*daterange\(check_in, check_out, '\[\)'\) with &&\s*\) where \(occupies_room and room_id is not null\)/);
});

test('settings always satisfy the checks of the settings table, also for older documents', () => {
  const db = fullDb();
  delete (db.settings as Partial<DB['settings']>).pricing;
  delete (db.settings.payments as Partial<DB['settings']['payments']>).allowOnline;
  const s = toTables(db, NOW).settings[0] as { payments: Record<string, unknown>; pricing: Record<string, unknown> };
  assert.equal(typeof s.payments.allowOnline, 'boolean');
  assert.equal(typeof s.payments.allowCashAtHotel, 'boolean');
  assert.ok(['full', 'deposit_percent', 'deposit_fixed'].includes(s.payments.mode as string));
  assert.ok(['room_only', 'breakfast'].includes(s.pricing.board as string));
  assert.equal(typeof s.pricing.singleUsePercent, 'number');
});

test('rooms carry beds and cash price; photos, translations and replies become child rows', () => {
  const db = fullDb();
  const room = db.rooms[0]!;
  room.bedConfig = [{ kind: 'matrimoniale', count: 1 }];
  room.cashPrice = 60;
  const rows = toTables(db, NOW);
  const r = rows.rooms.find((x) => x.id === room.id)!;
  assert.deepEqual(r.bed_config, [{ kind: 'matrimoniale', count: 1 }]);
  assert.equal(r.cash_price, 60);
  assert.equal(rows.room_photos.filter((p) => p.room_id === room.id).length, room.photos.length);
  assert.equal(rows.room_translations.filter((p) => p.room_id === room.id).length, Object.keys(room.translations).length);
  const fbId = db.feedback[0]!.id;
  assert.deepEqual(rows.review_replies.filter((x) => x.review_id === fbId).map((x) => [x.id, x.position, x.email]), [['rep-1', 0, null], ['rep-2', 1, 'anna@example.com']]);
  assert.equal(rows.rate_periods.every((p) => p.room_ids === null || Array.isArray(p.room_ids)), true, '"all" rooms is stored as null');
});

function stay(p: Partial<Booking>): Booking {
  return {
    id: 'bk-t', code: 'LA-TEST1', token: 't'.repeat(24), roomId: 'room-101', guest: { firstName: 'A', lastName: 'B', email: 'a@example.com', phone: '' },
    adults: 1, children: 0, childrenAges: [], checkIn: '2029-02-10', checkOut: '2029-02-13', total: 100, discount: 0, promoCode: null, amountPaid: 0,
    status: 'confirmed', holdExpiresAt: null, source: 'sito', otaRef: null, specialRequests: '', notes: '', consents: { privacy: true, terms: true, marketing: false },
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), cancelledAt: null, simulated: false, demo: false, ...p,
  };
}

test('occupies_room follows the app’s rule: cancelled stays and expired payment holds free the room', () => {
  const db = fullDb();
  const hold = new Date(NOW.getTime() + 20 * 60000).toISOString();
  db.bookings.push(stay({ id: 'b-ok' }), stay({ id: 'b-cancelled', code: 'LA-TEST2', token: 'u'.repeat(24), status: 'cancelled' }), stay({ id: 'b-hold', code: 'LA-TEST3', token: 'v'.repeat(24), roomId: 'room-102', status: 'pending_payment', holdExpiresAt: hold }));
  const at = (now: Date) => Object.fromEntries(toTables(db, now).bookings.map((b) => [b.id, b.occupies_room]));
  assert.deepEqual([at(NOW)['b-ok'], at(NOW)['b-cancelled'], at(NOW)['b-hold']], [true, false, true]);
  const later = new Date(NOW.getTime() + 21 * 60000);
  assert.equal(at(later)['b-hold'], false, 'the hold ran out');

  // nothing changed in the document, yet the next export tells the database that the room is free again
  const d = diffPayload(snapshotOf(toTables(db, NOW)), toTables(db, later));
  assert.deepEqual(d.payload.upsert.bookings?.map((b) => b.id), ['b-hold']);
});

test('diff: only what changed is sent; full copy lists every key to keep', () => {
  const db = fullDb();
  const before = snapshotOf(toTables(db, NOW));
  const next = structuredClone(db);
  next.version += 1;
  next.bookings[0]!.notes = 'arriva tardi';
  next.payments.push({ id: 'pay-new', bookingId: next.bookings[0]!.id, amount: 50, kind: 'deposit', provider: 'contanti', status: 'succeeded', reference: null, createdAt: NOW.toISOString() });
  const gone = next.blocks.shift()!;
  const removedRoom = next.rooms.pop()!;
  const d = diffPayload(before, toTables(next, NOW));

  assert.deepEqual(Object.keys(d.payload.upsert).sort(), ['bookings', 'hotel_list_order', 'hotel_meta', 'payments']);
  // the demo payments are not in time order, so their order is stored: the new payment is appended to it
  assert.deepEqual(d.payload.upsert.hotel_list_order!.map((r) => r.list), ['payments']);
  assert.equal((d.payload.upsert.hotel_list_order![0]!.ids as string[]).at(-1), 'pay-new');
  assert.deepEqual(d.payload.upsert.bookings!.map((b) => b.id), [next.bookings[0]!.id]);
  assert.deepEqual(d.payload.upsert.payments!.map((b) => b.id), ['pay-new']);
  assert.deepEqual(d.payload.delete.room_blocks, [{ id: gone.id }]);
  assert.deepEqual(d.payload.delete.rooms, [{ id: removedRoom.id }]);
  assert.equal(d.payload.delete.room_photos!.length, removedRoom.photos.length);
  assert.deepEqual(Object.keys(d.payload.delete.room_photos![0]!), ['room_id', 'id'], 'child rows are removed by their full key');

  const same = diffPayload(snapshotOf(toTables(next, NOW)), toTables(next, NOW));
  assert.equal(same.upserts + same.deletes, 0, 'no change → nothing to send');

  const rows = toTables(db, NOW);
  const full = fullPayload(rows);
  for (const t of TABLE_NAMES) assert.equal(full.keep![t]!.length, rowCounts(rows)[t], `${t}: keep list`);
});

test('list order is stored only where the rows alone would not give it back', () => {
  const db = fullDb();
  const stored = () => Object.fromEntries(toTables(db, NOW).hotel_list_order.map((r) => [r.list as string, r.ids as string[]]));
  // the site's own lists in time order need nothing…
  db.tasks = [{ id: 't-b', label: 'b', done: false, createdAt: '2026-11-07T09:00:00.000Z' }, { id: 't-a', label: 'a', done: false, createdAt: '2026-11-07T08:00:00.000Z' }]; // newest first, as unshift() leaves them
  db.audit = [{ id: 'a-2', at: '2026-11-07T09:00:00.000Z', actor: 'x', action: 'x', entity: 'x', entityId: null, details: '' }, { id: 'a-1', at: '2026-11-07T08:00:00.000Z', actor: 'x', action: 'x', entity: 'x', entityId: null, details: '' }];
  assert.equal(stored().tasks, undefined);
  assert.equal(stored().audit, undefined);
  assert.equal(stored().rooms, undefined, 'rooms follow sortOrder');
  // …two rows of the same instant do (the one added last is first in the document)
  db.audit.unshift({ id: 'a-0', at: db.audit[0]!.at, actor: 'x', action: 'x', entity: 'x', entityId: null, details: '' }, { id: 'a-9', at: db.audit[0]!.at, actor: 'x', action: 'x', entity: 'x', entityId: null, details: '' });
  assert.deepEqual(stored().audit, ['a-0', 'a-9', 'a-2', 'a-1']);
  // …and so does a list whose order is not by time at all
  assert.deepEqual(stored().bookings, db.bookings.map((b) => b.id), 'demo bookings are not in creation order');
  db.promotions = [{ id: 'pr-z', code: 'ZETA10', description: '', percent: 10, validFrom: '2027-01-01', validTo: '2027-12-31', active: true, minNights: 1 }, { id: 'pr-a', code: 'ALFA10', description: '', percent: 10, validFrom: '2027-01-01', validTo: '2027-12-31', active: true, minNights: 1 }];
  assert.deepEqual(stored().promotions, ['pr-z', 'pr-a']);
});

test('duplicate ids never reach the database twice', () => {
  const db = fullDb();
  db.unsubscribed.push('no@example.com');
  db.tasks.push({ ...db.tasks[0]! });
  const rows = toTables(db, NOW);
  assert.equal(rows.unsubscribed.length, 1);
  assert.equal(new Set(rows.tasks.map((t) => t.id)).size, rows.tasks.length);
});

test('documentIssues: a clean document passes, a double booking is named', () => {
  const db = fullDb();
  assert.deepEqual(documentIssues(db, NOW), []);
  db.bookings.push(stay({ id: 'b-1' }), stay({ id: 'b-2', code: 'LA-TEST9', token: 'z'.repeat(24), checkIn: '2029-02-12', checkOut: '2029-02-14' }));
  const issues = documentIssues(db, NOW);
  assert.equal(issues.length, 1);
  assert.match(issues[0]!, /doppia prenotazione.*LA-TEST1.*LA-TEST9/);
  // back-to-back stays are fine: the departure day is free
  db.bookings.at(-1)!.checkIn = '2029-02-13';
  assert.deepEqual(documentIssues(db, NOW), []);
});
