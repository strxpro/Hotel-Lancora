import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSeed } from '../src/server/db/seed';
import { TABLES, TABLE_NAMES, rowCounts, toTables, type Row, type SyncPayload, type TableName, type TableRows } from '../src/server/db/tables';
import { TABLE_COLUMNS } from '../src/server/db/table-columns';
import { compareDocuments } from '../src/server/db/tables-read';
import { missingColumns, startFromTables, syncTables } from '../src/server/db/tables-sync';
import type { DB } from '../src/lib/types';

/**
 * Stage 3b: the site starts from the tables. A stand-in for the Supabase REST API kept in memory
 * (tables, the copy of the document in hotel_state, the API's description of the columns).
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-start-'));
process.env.DATA_DIR = dataDir;
process.env.SUPABASE_URL = 'https://localtestproject.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_local_test_key_0000000000';
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const file = path.join(dataDir, 'db.json');
const backup = path.join(dataDir, 'db.before-tables.json');

let model = Object.fromEntries(TABLE_NAMES.map((t) => [t, [] as Row[]])) as TableRows;
let tablesExist = true;
let copy: { version: number; data: DB } | null = null;
let dropColumn: [string, string] | null = null;
/** each read of hotel_meta adds this to the version (another computer saving all the time) */
let metaDrift = 0;
/** the n-th hotel_sync call fails (a connection lost in the middle of a big copy) */
let failSyncCall = 0;
let syncCalls: SyncPayload[] = [];
const requests: string[] = [];
const keyOf = (t: TableName, r: Row) => TABLES[t].map((c) => String(r[c])).join('|');

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const p = url.pathname.replace('/rest/v1/', '');
  requests.push(p);
  const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
  if (!tablesExist && p !== 'hotel_state') return json({ code: p.startsWith('rpc/') ? 'PGRST202' : 'PGRST205' }, 404);
  if (p === '') {
    // the database created from the current SQL file: every column, also of the empty tables
    const definitions = Object.fromEntries(TABLE_NAMES.map((t) => {
      const keys = new Set([...TABLE_COLUMNS[t], ...TABLES[t]]);
      for (const row of model[t]) for (const k of Object.keys(row)) keys.add(k);
      if (dropColumn && dropColumn[0] === t) keys.delete(dropColumn[1]);
      return [t, { properties: Object.fromEntries([...keys].map((k) => [k, {}])) }];
    }));
    return json({ definitions });
  }
  if (p === 'hotel_state') return json(copy ? [copy] : []);
  if (p === 'rpc/hotel_table_counts') return json(rowCounts(model));
  if (p === 'rpc/hotel_sync') {
    const body = (JSON.parse(init!.body as string) as { p: SyncPayload }).p;
    syncCalls.push(body);
    if (failSyncCall && syncCalls.length === failSyncCall) return json({ code: '08006', message: 'connection lost' }, 503);
    const { upsert = {}, keep = {}, delete: gone = {} } = body;
    for (const t of TABLE_NAMES) {
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
  if (p === 'hotel_meta' && url.searchParams.get('select') !== '*') {
    const m = model.hotel_meta[0];
    if (m && metaDrift) m.version = Number(m.version) + metaDrift;
    return json(m ? [{ version: m.version, updated_at: m.updated_at, synced_at: m.synced_at }] : []);
  }
  if (p in model) {
    // what the REST API gives back: timestamps with an offset, at most 100 rows a page
    const from = Number(url.searchParams.get('offset') ?? 0);
    const all = [...model[p as TableName]].sort((a, b) => keyOf(p as TableName, a).localeCompare(keyOf(p as TableName, b)));
    const page = all.slice(from, from + 100).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /(_at|^at)$/.test(k) && /Z$/.test(v) ? v.replace(/Z$/, '+00:00') : v])));
    return json(page, 200, { 'content-range': `${page.length ? `${from}-${from + page.length - 1}` : '*'}/${all.length}` });
  }
  return json({ code: 'PGRST205' }, 404);
}) as typeof fetch;
after(() => void (globalThis.fetch = realFetch));

function doc(version = 40): DB {
  const db = buildSeed(new Date('2026-11-07T10:00:00Z'));
  Object.assign(db.settings.payments, { cashDiscountPercent: 5, allowCashAtHotel: true, allowOnline: true, cancellationFee: { type: 'percent', value: 100 } });
  db.settings.pricing = { singleUsePercent: 20, board: 'room_only' };
  db.version = version;
  db.updatedAt = new Date(Date.UTC(2026, 10, 12, 20, 0, version)).toISOString();
  return db;
}
/** the tables and the copy in hotel_state as the site leaves them after saving `db` */
async function remoteHolds(db: DB) {
  model = Object.fromEntries(TABLE_NAMES.map((t) => [t, [] as Row[]])) as TableRows;
  for (const t of TABLE_NAMES) model[t] = toTables(db)[t].map((r) => ({ ...r }));
  copy = { version: db.version, data: structuredClone(db) };
}
const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8')) as DB;

beforeEach(() => {
  for (const f of [file, backup]) fs.rmSync(f, { force: true });
  Object.assign(globalThis, { __lancoraTablesState: undefined, __lancoraTablesSnap: undefined });
  tablesExist = true;
  dropColumn = null;
  metaDrift = 0;
  failSyncCall = 0;
  syncCalls = [];
  requests.length = 0;
  delete process.env.TABLES_START;
});

test('a computer without data (new PC, new hosting) starts from the tables, checked against the copy', async () => {
  const db = doc(40);
  db.bookings[0]!.notes = 'arriva tardi';
  await remoteHolds(db);
  const r = await startFromTables();
  assert.equal(r.source, 'tables', r.detail);
  assert.match(r.detail, /v40.*non aveva dati.*verificati/);
  const loaded = readFile();
  const cmp = compareDocuments(db, loaded);
  assert.deepEqual([cmp.real, cmp.order], [[], []]);
  assert.equal(loaded.bookings[0]!.notes, 'arriva tardi');
  assert.equal(fs.existsSync(backup), false, 'nothing to keep');
});

test('this computer as new as the tables: nothing is read, nothing is written', async () => {
  const db = doc(40);
  await remoteHolds(db);
  fs.writeFileSync(file, JSON.stringify(db));
  const before = fs.statSync(file).mtimeMs;
  const r = await startFromTables();
  assert.equal(r.source, 'local');
  assert.deepEqual(requests, ['hotel_meta'], 'one small request');
  assert.equal(fs.statSync(file).mtimeMs, before);
});

test('this computer older than the tables: the tables win, the old file is kept aside', async () => {
  const old = doc(39);
  const db = doc(40);
  db.tasks.unshift({ id: 't-new', label: 'nuovo', done: false, createdAt: db.updatedAt });
  await remoteHolds(db);
  fs.writeFileSync(file, JSON.stringify(old));
  const r = await startFromTables();
  assert.equal(r.source, 'tables', r.detail);
  assert.match(r.detail, /aveva la v39/);
  assert.equal(readFile().version, 40);
  assert.equal(readFile().tasks[0]!.id, 't-new');
  assert.equal((JSON.parse(fs.readFileSync(backup, 'utf8')) as DB).version, 39);
});

test('the copy in hotel_state is newer than the tables: the tables are left aside for the copy', async () => {
  const db = doc(40);
  await remoteHolds(db);
  copy = { version: 41, data: { ...structuredClone(db), version: 41 } };
  const r = await startFromTables();
  assert.equal(r.source, 'rejected');
  assert.match(r.detail, /v41.*più recente/);
  assert.equal(fs.existsSync(file), false, 'cloudHydrate() will load the copy');
});

test('tables and copy of the same version disagree: the tables are not used', async () => {
  const db = doc(40);
  await remoteHolds(db);
  model.bookings.find((b) => b.id === db.bookings[2]!.id)!.total = 1;
  const r = await startFromTables();
  assert.equal(r.source, 'rejected');
  assert.match(r.detail, new RegExp(`bookings\\[${db.bookings[2]!.id}\\]\\.total`));
  assert.equal(fs.existsSync(file), false);
});

test('a column the database lacks (older SQL file): the tables are not used', async () => {
  const db = doc(40);
  await remoteHolds(db);
  dropColumn = ['channel_state', 'calendars'];
  const r = await startFromTables();
  assert.equal(r.source, 'rejected');
  assert.match(r.detail, /channel_state\.calendars.*hotel-tables\.sql/);
});

test('a column missing in a table that is still empty is noticed too (real data starts with no bookings)', async () => {
  const db = doc(40);
  db.bookings = [];
  db.payments = [];
  db.outbox = db.outbox.filter((e) => !e.bookingId);
  await remoteHolds(db);
  dropColumn = ['bookings', 'change_request'];
  assert.deepEqual(await missingColumns(toTables(db)), ['bookings.change_request']);
  const r = await startFromTables();
  assert.equal(r.source, 'rejected');
  assert.match(r.detail, /bookings\.change_request.*hotel-tables\.sql/);
  dropColumn = null;
  assert.deepEqual(await missingColumns(toTables(db)), [], 'a database made from the current SQL file lacks nothing');
});

test('a big copy cut in half is never taken for a complete one', async () => {
  const db = doc(60);
  const html = `<p>${'x'.repeat(40_000)}</p>`;
  for (let i = 0; i < 60; i++) db.outbox.push({ id: `em-big-${i}`, to: 'a@example.com', subject: 's', template: 'campagna', html, text: 't', bookingId: null, status: 'sent', error: null, createdAt: db.updatedAt, sentAt: db.updatedAt });
  await remoteHolds(doc(59));
  copy = null;

  // a complete copy in parts: "version 0" first, the real version last
  assert.equal((await syncTables(db, { full: true })).ok, true);
  assert.ok(syncCalls.length >= 3, `${syncCalls.length} parts`);
  assert.equal(syncCalls[0]!.upsert?.hotel_meta?.[0]?.version, 0);
  assert.equal(syncCalls.at(-1)!.upsert?.hotel_meta?.[0]?.version, 60);
  assert.ok(syncCalls.slice(1, -1).every((c) => !c.upsert?.hotel_meta), 'the parts in between do not touch hotel_meta');
  assert.equal(Number(model.hotel_meta[0]!.version), 60);

  // the same copy, but the connection drops at the third request
  Object.assign(globalThis, { __lancoraTablesState: undefined, __lancoraTablesSnap: undefined });
  await remoteHolds(doc(59));
  copy = null;
  syncCalls = [];
  failSyncCall = 3;
  assert.equal((await syncTables(db, { full: true })).ok, false);
  assert.equal(Number(model.hotel_meta[0]!.version), 0, 'the tables say: incomplete');
  failSyncCall = 0;
  const r = await startFromTables();
  assert.equal(r.source, 'rejected');
  assert.match(r.detail, /interrotta/);
  assert.equal(fs.existsSync(file), false);
});

test('tables that keep changing while they are read: started from the copy instead', async () => {
  await remoteHolds(doc(40));
  metaDrift = 1;
  const r = await startFromTables();
  assert.equal(r.source, 'error');
  assert.match(r.detail, /cambiano mentre vengono lette/);
  assert.equal(fs.existsSync(file), false);
});

test('no tables yet, or TABLES_START=off: the site starts as in stage 3a', async () => {
  await remoteHolds(doc(40));
  tablesExist = false;
  assert.equal((await startFromTables()).source, 'missing');
  tablesExist = true;
  process.env.TABLES_START = 'off';
  requests.length = 0;
  assert.equal((await startFromTables()).source, 'disabled');
  assert.deepEqual(requests, []);
  assert.equal(fs.existsSync(file), false);
});
