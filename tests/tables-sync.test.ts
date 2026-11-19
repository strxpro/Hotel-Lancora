import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSeed } from '../src/server/db/seed';
import { TABLES, TABLE_NAMES, rowCounts, toTables, type Row, type SyncPayload, type TableName, type TableRows } from '../src/server/db/tables';
// the exporter reads its settings (URL, key, data folder) when it is called, not when it is imported
import { syncTables, verifyTables, shadowRead, shadowCompare, shadowHistory, tablesStatus } from '../src/server/db/tables-sync';
import type { DB } from '../src/lib/types';

/**
 * The exporter (tables-sync.ts) against a stand-in for the Supabase REST API kept in memory:
 * hotel_sync applies delete / keep / upsert like the SQL function, tables are read back in pages.
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-tables-'));
process.env.DATA_DIR = dataDir;
process.env.SUPABASE_URL = 'https://localtestproject.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_local_test_key_0000000000';
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const model = Object.fromEntries(TABLE_NAMES.map((t) => [t, [] as Row[]])) as TableRows;
const calls: { method: string; path: string; body?: { p: SyncPayload } }[] = [];
/** false = a database created with the first version of the SQL file (no hotel_list_order table) */
let hasListOrder = true;
const known = (t: string) => t !== 'hotel_list_order' || hasListOrder;
const keyOf = (t: TableName, r: Row) => TABLES[t].map((c) => String(r[c])).join('|');
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const p = url.pathname.replace('/rest/v1/', '');
  const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { p: SyncPayload }) : undefined;
  calls.push({ method: init?.method ?? 'GET', path: p, body });
  const json = (data: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
  if (p === 'rpc/hotel_sync') {
    const { upsert = {}, keep = {}, delete: gone = {} } = body!.p;
    for (const t of TABLE_NAMES.filter(known)) {
      const drop = new Set((gone[t] ?? []).map((k) => keyOf(t, k)));
      const stay = keep[t] ? new Set(keep[t]!.map((k) => keyOf(t, k))) : null;
      model[t] = model[t].filter((r) => !drop.has(keyOf(t, r)) && (!stay || stay.has(keyOf(t, r))));
      for (const row of upsert[t] ?? []) {
        const i = model[t].findIndex((r) => keyOf(t, r) === keyOf(t, row));
        if (i >= 0) model[t][i] = { ...model[t][i], ...row };
        else model[t].push(row);
      }
    }
    return json({ ok: true });
  }
  if (p === 'rpc/hotel_table_counts') return json(Object.fromEntries(Object.entries(rowCounts(model)).filter(([t]) => known(t))));
  if (p in model && known(p)) {
    // like a server that hands out at most 100 rows per request, whatever the limit asked for
    const from = Number(url.searchParams.get('offset') ?? 0);
    const all = [...model[p as TableName]].sort((a, b) => keyOf(p as TableName, a).localeCompare(keyOf(p as TableName, b)));
    const page = all.slice(from, from + 100);
    return json(page, { 'content-range': `${page.length ? `${from}-${from + page.length - 1}` : '*'}/${all.length}` });
  }
  return new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 });
}) as typeof fetch;
after(() => void (globalThis.fetch = realFetch));

function doc(): DB {
  const db = buildSeed(new Date('2026-11-07T10:00:00Z'));
  Object.assign(db.settings.payments, { cashDiscountPercent: 5, allowCashAtHotel: true, allowOnline: true, cancellationFee: { type: 'percent', value: 100 } });
  db.settings.pricing = { singleUsePercent: 20, board: 'room_only' };
  return db;
}
const syncCalls = () => calls.filter((c) => c.path === 'rpc/hotel_sync');

test('first export copies everything, later ones only the difference', async () => {
  const v1 = doc();
  const r1 = await syncTables(v1);
  assert.deepEqual([r1.ok, r1.ok && r1.mode], [true, 'full']);
  assert.ok(syncCalls()[0]!.body!.p.keep, 'a full copy lists the keys to keep');
  assert.deepEqual(rowCounts(model), rowCounts(toTables(v1)));

  const v2 = structuredClone(v1);
  v2.version += 1;
  v2.bookings[0]!.notes = 'arriva tardi';
  v2.tasks = v2.tasks.slice(1);
  calls.length = 0;
  const r2 = await syncTables(v2);
  assert.deepEqual([r2.ok, r2.ok && r2.mode, r2.ok && r2.deletes], [true, 'diff', 1]);
  const sent = syncCalls()[0]!.body!.p;
  assert.equal(sent.keep, undefined);
  assert.deepEqual(Object.keys(sent.upsert ?? {}).sort(), ['bookings', 'hotel_meta']);
  assert.equal(tablesStatus().version, v2.version);
});

test('an old snapshot of the same document never overwrites newer rows', async () => {
  const stale = doc(); // version 1 again, same seededAt: somebody read the document, then waited
  calls.length = 0;
  const r = await syncTables(stale);
  assert.deepEqual([r.ok, r.ok && r.mode], [true, 'stale']);
  assert.equal(syncCalls().length, 0, 'nothing is sent');
  assert.equal(model.bookings.find((b) => b.id === stale.bookings[0]!.id)!.notes, 'arriva tardi', 'the newer row is still there');
  assert.equal(tablesStatus().version, stale.version + 1);

  // demo data reset: another document (new seed time) with a lower version replaces everything
  const reset = doc();
  reset.seededAt = '2027-01-01T00:00:00.000Z';
  reset.bookings = reset.bookings.slice(0, 5);
  const ids = new Set(reset.bookings.map((b) => b.id));
  reset.payments = reset.payments.filter((p) => ids.has(p.bookingId));
  const r2 = await syncTables(reset);
  assert.deepEqual([r2.ok, r2.ok && r2.mode], [true, 'full']);
  assert.equal(model.bookings.length, 5);
});

test('counting is read-only on request; on the site it first writes what is waiting', async () => {
  const cur = doc();
  cur.seededAt = '2027-01-01T00:00:00.000Z';
  cur.version = 50;
  calls.length = 0;
  const readOnly = await verifyTables(cur, { readOnly: true });
  assert.equal(syncCalls().length, 0);
  assert.equal(readOnly.ok, false, 'the tables still hold the smaller document');
  const live = await verifyTables(cur);
  assert.equal(syncCalls().length, 1);
  assert.deepEqual([live.ok, live.mismatches], [true, []]);
});

test('trial read: tables read back in pages, document rebuilt, compared, result kept in data/shadow-read.json', async () => {
  const cur = doc();
  cur.seededAt = '2027-01-01T00:00:00.000Z';
  cur.version = 51;
  cur.bookings[1]!.notes = 'culla in camera';
  calls.length = 0;
  const r = await shadowRead(cur);
  assert.equal(r.error, undefined);
  assert.deepEqual([r.ok, r.real, r.version, r.order], [true, 0, 51, []]);
  assert.equal(r.rows, Object.values(rowCounts(toTables(cur))).reduce((a, b) => a + b, 0));
  assert.ok(calls.filter((c) => c.path === 'bookings').length >= 4, 'more than 300 bookings arrive in pages of 100');
  assert.ok(calls.findIndex((c) => c.path === 'rpc/hotel_sync') < calls.findIndex((c) => c.method === 'GET'), 'what is waiting is exported before reading');
  assert.equal(tablesStatus().shadow?.ok, true);
  assert.equal(shadowHistory()[0]!.version, 51);

  // somebody edits a row by hand in Supabase: the next trial read names it, and the site's document is untouched
  model.bookings.find((b) => b.id === cur.bookings[2]!.id)!.total = 1;
  const bad = await shadowCompare(cur);
  assert.deepEqual([bad.ok, bad.real, bad.sample[0]!.path], [false, 1, `bookings[${cur.bookings[2]!.id}].total`]);
  // compared with another version of the document: no verdict instead of a false alarm
  const other = structuredClone(cur);
  other.version = 52;
  const skipped = await shadowCompare(other);
  assert.deepEqual([skipped.ok, skipped.real], [false, 0]);
  assert.match(skipped.error ?? '', /versione 51.*52/);
  assert.equal(shadowHistory().length, 1, 'only trial reads made by the site are logged');
});

test('a database without hotel_list_order: everything works without it, and it is used as soon as it appears', async () => {
  const cur = doc();
  cur.seededAt = '2027-01-01T00:00:00.000Z';
  cur.version = 60;
  assert.equal((await syncTables(cur, { full: true })).ok, true);
  assert.ok(model.hotel_list_order.some((r) => r.list === 'bookings'), 'the order of the demo bookings is stored');

  // the same site against a database created with the first version of the SQL file
  hasListOrder = false;
  model.hotel_list_order = [];
  const check = await verifyTables(cur); // looks at the database again
  assert.deepEqual([check.ok, check.missing, check.tables], [true, ['hotel_list_order'], TABLE_NAMES.length - 1]);
  assert.equal(tablesStatus().listOrder, false);
  calls.length = 0;
  const without = await shadowRead(cur);
  assert.deepEqual([without.ok, without.real, without.error], [true, 0, undefined]);
  assert.ok(without.order.some((o) => o.list === 'bookings'), 'values identical, order of the demo lists reported');
  assert.equal(calls.some((c) => c.path === 'hotel_list_order'), false, 'the missing table is not asked for');

  // the owner runs the updated SQL file: the next check notices, writes the order, and the trial read is exact
  hasListOrder = true;
  const after = await verifyTables(cur);
  assert.deepEqual([after.ok, after.missing, after.tables], [true, [], TABLE_NAMES.length]);
  assert.ok(model.hotel_list_order.some((r) => r.list === 'bookings'));
  const exact = await shadowRead(cur);
  assert.deepEqual([exact.ok, exact.real, exact.order], [true, 0, []]);
});
