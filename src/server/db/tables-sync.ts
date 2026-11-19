import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/types';
import { cloudConfigured, cloudFetch, cloudRest } from './cloud';
import { TABLES, TABLE_NAMES, diffPayload, documentIssues, fullPayload, rowCounts, snapshotOf, toTables, type Row, type Snapshot, type SyncPayload, type TableName, type TableRows } from './tables';
import { compareDocuments, fromTables, type Comparison, type Difference } from './tables-read';
import { TABLE_COLUMNS } from './table-columns';

/**
 * Stage 2 of the move to real tables: a one-way export.
 *
 * The site still reads and writes its single document (store.ts) and `hotel_state` stays the source
 * of truth. A moment after every saved change, the rows that changed are also written to the tables
 * of supabase/hotel-tables.sql through hotel_sync(): one request, one transaction. If the tables
 * refuse a change (for example two stays in the same room on the same night) nothing is written
 * there and the reason is kept in `lastError`; the site itself is never blocked by this copy.
 *
 * Stage 3a adds a trial read (shadowRead): the document is rebuilt from the tables and compared with
 * the one the site uses. The result is only logged (data/shadow-read.json); the site keeps serving
 * its own document.
 */
type TablesState = {
  /** null = not checked yet · false = the SQL file was not run in Supabase · true = the tables are there */
  ready: boolean | null;
  /** version of the document the tables hold */
  version: number | null;
  /** which document that version belongs to (demo data reset gives a new one) */
  seededAt: string | null;
  /** last trial read of the tables (stage 3a) */
  shadow: ShadowResult | null;
  /** does the database have hotel_list_order (added to the SQL file later)? null = not asked yet */
  listOrder: boolean | null;
  /** how the site started (stage 3b): from the tables, from its own copy, or why the tables were not used */
  start: StartResult | null;
  schemaCheckedAt: number;
  lastSyncAt: string | null;
  lastError: string | null;
  pending: boolean;
  checkedAt: number;
  fails: number;
};
const g = globalThis as typeof globalThis & {
  __lancoraTablesState?: TablesState;
  __lancoraTablesSnap?: Snapshot | null;
  __lancoraTablesNext?: DB | null;
  __lancoraTablesChain?: Promise<unknown>;
  __lancoraTablesTimer?: ReturnType<typeof setTimeout> | null;
  __lancoraTablesPush?: (db: DB) => void;
};

const state: TablesState = (g.__lancoraTablesState ??= { ready: null, version: null, seededAt: null, shadow: null, listOrder: null, start: null, schemaCheckedAt: 0, lastSyncAt: null, lastError: null, pending: false, checkedAt: 0, fails: 0 });
export const tablesStatus = (): TablesState & { configured: boolean } => ({ ...state, configured: cloudConfigured() });

/** one request stays well under the API's body limit; a bigger full copy is sent in parts */
const MAX_BODY = 1_500_000;
/** while the SQL file has not been run, look again this often (not on every click) */
const RECHECK_MS = 5 * 60_000;

class TablesError extends Error {
  constructor(message: string, public missing = false) {
    super(message);
  }
}

async function rpc<T>(fn: string, args: unknown, timeoutMs = 60_000): Promise<T> {
  let res: Response;
  try {
    res = await cloudRest(`rpc/${fn}`, { method: 'POST', body: typeof args === 'string' ? args : JSON.stringify(args) }, timeoutMs);
  } catch (e) {
    throw new TablesError(`Supabase non raggiungibile: ${(e as Error).message}`);
  }
  if (res.ok) return (await res.json()) as T;
  const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string; details?: string | null };
  // PGRST202 / PGRST205 / 42883 / 42P01: the function or a table does not exist → the SQL file was not run
  const missing = res.status === 404 || ['PGRST202', 'PGRST205', '42883', '42P01'].includes(err.code ?? '');
  if (missing) throw new TablesError('Le tabelle non esistono ancora in Supabase.', true);
  if (err.code === '23P01') throw new TablesError(`Il database ha rifiutato una doppia prenotazione: ${err.details ?? err.message ?? ''}`.trim());
  throw new TablesError(`Supabase ${res.status}${err.code ? ` (${err.code})` : ''}: ${[err.message, err.details].filter(Boolean).join(' · ') || 'errore'}`);
}

/** Tables added to the SQL file after its first version: until the updated file is run in Supabase they are left out. */
const OPTIONAL_TABLES: readonly TableName[] = ['hotel_list_order'];

/**
 * Asks the database which of the newer tables it has: one small call, repeated at most every few
 * minutes while one is missing, so the site starts using it by itself once the SQL file was run again.
 */
async function learnSchema(force = false): Promise<Record<string, number> | null> {
  if (!force && (state.listOrder === true || (state.listOrder === false && Date.now() - state.schemaCheckedAt < RECHECK_MS))) return null;
  const counts = await rpc<Record<string, number>>('hotel_table_counts', {});
  state.listOrder = 'hotel_list_order' in counts;
  state.schemaCheckedAt = Date.now();
  return counts;
}

/** The document as rows, without the tables this database does not have yet. */
function rowsFor(db: DB, now: Date): TableRows {
  const rows = toTables(db, now);
  if (!state.listOrder) rows.hotel_list_order = [];
  return rows;
}

async function send(payload: SyncPayload): Promise<void> {
  const body = JSON.stringify({ p: payload });
  if (Buffer.byteLength(body) <= MAX_BODY) {
    await rpc('hotel_sync', body);
    return;
  }
  // too big for one request: removals first, then the rows in table order (parents before children).
  // While the parts are on their way hotel_meta says "version 0", and the real version is written
  // last: a copy cut in half (connection lost, server stopped) is never taken for a complete one when
  // the site starts from the tables.
  const meta = payload.upsert?.hotel_meta?.[0];
  await rpc('hotel_sync', { p: { delete: payload.delete, keep: payload.keep, ...(meta ? { upsert: { hotel_meta: [{ ...meta, version: 0 }] } } : {}) } });
  let part: Partial<Record<TableName, Row[]>> = {};
  let size = 0;
  for (const t of TABLE_NAMES) {
    if (t === 'hotel_meta') continue;
    for (const row of payload.upsert?.[t] ?? []) {
      const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (size && size + bytes > MAX_BODY) {
        await rpc('hotel_sync', { p: { upsert: part } });
        part = {};
        size = 0;
      }
      (part[t] ??= []).push(row);
      size += bytes;
    }
  }
  if (size) await rpc('hotel_sync', { p: { upsert: part } });
  if (meta) await rpc('hotel_sync', { p: { upsert: { hotel_meta: [meta] } } });
}

export type SyncResult = { ok: true; mode: 'full' | 'diff' | 'stale'; upserts: number; deletes: number } | { ok: false; error: string; missing: boolean };

async function doSync(db: DB, full: boolean): Promise<SyncResult> {
  if (!cloudConfigured()) return { ok: false, error: 'Supabase non collegato.', missing: false };
  const older = state.version !== null && db.version < state.version;
  // a caller holding an old snapshot of the same document (it read it, then waited for something else):
  // the tables already have newer rows, so there is nothing to write and nothing may be overwritten
  if (older && !full && state.seededAt === db.seededAt) return { ok: true, mode: 'stale', upserts: 0, deletes: 0 };
  const snap = g.__lancoraTablesSnap ?? null;
  // no known state of the tables, or another document altogether (demo data reset): copy everything
  const everything = full || !snap || older;
  try {
    await learnSchema();
    const rows = rowsFor(db, new Date());
    let upserts = 0;
    let deletes = 0;
    if (everything) {
      await send(fullPayload(rows));
      upserts = Object.values(rowCounts(rows)).reduce((a, b) => a + b, 0);
    } else {
      const d = diffPayload(snap, rows);
      await send(d.payload);
      upserts = d.upserts;
      deletes = d.deletes;
    }
    g.__lancoraTablesSnap = snapshotOf(rows);
    Object.assign(state, { ready: true, version: db.version, seededAt: db.seededAt, lastSyncAt: new Date().toISOString(), lastError: null, checkedAt: Date.now(), fails: 0 });
    return { ok: true, mode: everything ? 'full' : 'diff', upserts, deletes };
  } catch (e) {
    const err = e instanceof TablesError ? e : new TablesError((e as Error).message);
    Object.assign(state, { lastError: err.message, checkedAt: Date.now(), fails: state.fails + 1 });
    if (err.missing) {
      state.ready = false;
      g.__lancoraTablesSnap = null;
    }
    return { ok: false, error: err.message, missing: err.missing };
  }
}

/** Runs the exports one after the other, in the order they were asked for: an older state never lands on top of a newer one. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = (g.__lancoraTablesChain ?? Promise.resolve()).then(job, job);
  g.__lancoraTablesChain = next.catch(() => undefined);
  return next;
}

/** Writes the document's changes to the tables now (`full`: every row, and whatever is not in the document is removed). */
export function syncTables(db: DB, opts: { full?: boolean } = {}): Promise<SyncResult> {
  return enqueue(() => doSync(db, opts.full ?? false));
}

function schedule(ms: number): void {
  if (g.__lancoraTablesTimer) clearTimeout(g.__lancoraTablesTimer);
  const timer = setTimeout(() => {
    g.__lancoraTablesTimer = null;
    const db = g.__lancoraTablesNext;
    if (!db) return;
    g.__lancoraTablesNext = null;
    void syncTables(db).then((r) => {
      if (r.ok) {
        state.pending = Boolean(g.__lancoraTablesNext);
        return;
      }
      console.error('[tables]', r.error);
      if (r.missing) {
        state.pending = false; // nothing to do until the SQL file is run
        return;
      }
      // a refused or failed change: try again later with the newest document (20 s, 40 s … 10 min)
      g.__lancoraTablesNext ??= db;
      schedule(Math.min(600_000, 20_000 * 2 ** Math.min(5, state.fails - 1)));
    });
  }, ms);
  timer.unref?.();
  g.__lancoraTablesTimer = timer;
}

/** Registered on globalThis so the store can call it without importing this file (same pattern as cloud.ts). */
g.__lancoraTablesPush = (db: DB) => {
  if (!cloudConfigured()) return;
  if (state.ready === false && Date.now() - state.checkedAt < RECHECK_MS) return;
  g.__lancoraTablesNext = db;
  state.pending = true;
  // a burst of changes (a booking touches several things) becomes one transaction
  schedule(1500);
};

/**
 * On start: when the tables already hold exactly this version of the document nothing is sent and
 * later changes are exported as small differences; otherwise everything is copied once.
 */
export async function tablesHydrate(db: DB): Promise<'off' | 'missing' | 'same' | 'synced' | 'error'> {
  if (!cloudConfigured()) return 'off';
  return enqueue(async () => {
    try {
      const res = await cloudRest('hotel_meta?id=eq.1&select=version,updated_at,synced_at');
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { code?: string };
        if (res.status === 404 || err.code === 'PGRST205' || err.code === '42P01') {
          Object.assign(state, { ready: false, checkedAt: Date.now(), lastError: 'Le tabelle non esistono ancora in Supabase.' });
          return 'missing';
        }
        throw new Error(`Supabase ${res.status}`);
      }
      const meta = ((await res.json()) as { version: number; updated_at: string; synced_at: string }[])[0];
      if (meta && Number(meta.version) === db.version && Date.parse(meta.updated_at) === Date.parse(db.updatedAt)) {
        const counts = (await learnSchema(true)) ?? {};
        // rows as they were written at the last export: a payment hold that ran out since then is noticed by the next export
        const rows = rowsFor(db, new Date(meta.synced_at));
        const local = rowCounts(rows);
        // same version and the same number of rows in every table (a table added by a later SQL file starts empty: then copy)
        if (TABLE_NAMES.every((t) => (counts[t] ?? 0) === local[t])) {
          g.__lancoraTablesSnap = snapshotOf(rows);
          Object.assign(state, { ready: true, version: db.version, seededAt: db.seededAt, lastSyncAt: meta.synced_at, lastError: null, checkedAt: Date.now(), fails: 0 });
          return 'same';
        }
      }
      const r = await doSync(db, true);
      if (r.ok) console.log(`[tables] tabelle Supabase allineate alla versione ${db.version} (${r.upserts} righe)`);
      return r.ok ? 'synced' : r.missing ? 'missing' : 'error';
    } catch (e) {
      Object.assign(state, { lastError: (e as Error).message, checkedAt: Date.now() });
      return 'error';
    }
  });
}

export type TablesCheck = {
  ok: boolean;
  tables: number;
  rows: number;
  mismatches: { table: TableName; document: number; database: number | null }[];
  /** newer tables this database does not have yet (run the SQL file again to add them) */
  missing: TableName[];
  /** columns the site writes that this database does not have (an older SQL file): they would be lost */
  columns: string[];
};

/**
 * Compares the number of rows in every table with the document. On the site what is still waiting to
 * be exported is written first, so the two are compared at the same version; `readOnly` only counts.
 */
export async function verifyTables(db: DB, opts: { readOnly?: boolean } = {}): Promise<TablesCheck> {
  const remote = await enqueue(async () => {
    const counts = (await learnSchema(true))!; // also notices a table added since the last look
    if (opts.readOnly) return counts;
    await doSync(db, false);
    return rpc<Record<string, number>>('hotel_table_counts', {});
  });
  const local = rowCounts(rowsFor(db, new Date()));
  const missing = OPTIONAL_TABLES.filter((t) => !(t in remote));
  const columns = await missingColumns(rowsFor(db, new Date()));
  const compared = TABLE_NAMES.filter((t) => !missing.includes(t));
  const mismatches = compared.filter((t) => remote[t] !== local[t]).map((t) => ({ table: t, document: local[t], database: remote[t] ?? null }));
  return { ok: mismatches.length === 0 && columns.length === 0, tables: compared.length, rows: compared.reduce((sum, t) => sum + local[t], 0), mismatches, missing, columns };
}

// ── stage 3a: trial read ─────────────────────────────────────────────────────

async function readTable(t: TableName): Promise<Row[]> {
  const out: Row[] = [];
  for (;;) {
    // the API returns at most a page at a time: `count=exact` says how many rows there are in all
    const res = await cloudRest(`${t}?select=*&order=${TABLES[t].join(',')}&limit=1000&offset=${out.length}`, { headers: { prefer: 'count=exact' } }, 30_000);
    if (!res.ok) throw new TablesError(`Lettura della tabella ${t} non riuscita: Supabase ${res.status}`, res.status === 404);
    const page = (await res.json()) as Row[];
    out.push(...page);
    const total = Number((res.headers.get('content-range') ?? '').split('/')[1]);
    if (page.length === 0 || (Number.isFinite(total) ? out.length >= total : page.length < 1000)) return out;
  }
}

/** Every row of every table (a few tables at a time). */
export async function readTables(): Promise<TableRows> {
  await learnSchema();
  const rows = {} as TableRows;
  for (let i = 0; i < TABLE_NAMES.length; i += 6) {
    await Promise.all(TABLE_NAMES.slice(i, i + 6).map(async (t) => void (rows[t] = OPTIONAL_TABLES.includes(t) && !state.listOrder ? [] : await readTable(t))));
  }
  return rows;
}

export type ShadowResult = {
  at: string;
  /** version of the document that was compared */
  version: number;
  /** true = the document rebuilt from the tables has exactly the values of the site's document */
  ok: boolean;
  rows: number;
  ms: number;
  /** values that differ, rows missing or one too many */
  real: number;
  /** same value written differently (a date-only timestamp, an empty list for a missing one) */
  format: number;
  /** lists that come back complete but in another order */
  order: Comparison['order'];
  /** the first differences, for the log */
  sample: Difference[];
  /** why nothing could be compared (tables missing, export refused, the document changed while reading) */
  error?: string;
};

/** Reads the tables, rebuilds the document and compares it with `db`. Writes nothing. */
export async function shadowCompare(db: DB): Promise<ShadowResult> {
  const started = Date.now();
  const base = { at: new Date().toISOString(), version: db.version, rows: 0, real: 0, format: 0, order: [], sample: [] };
  try {
    const rows = await readTables();
    const total = Object.values(rowCounts(rows)).reduce((a, b) => a + b, 0);
    const rebuilt = fromTables(rows);
    if (rebuilt.version !== db.version) return { ...base, ok: false, rows: total, ms: Date.now() - started, error: `Le tabelle contengono la versione ${rebuilt.version}, il documento la ${db.version}.` };
    const cmp = compareDocuments(db, rebuilt);
    return { ...base, ok: cmp.real.length === 0, rows: total, ms: Date.now() - started, real: cmp.real.length, format: cmp.format.length, order: cmp.order, sample: [...cmp.real.slice(0, 20), ...cmp.format.slice(0, 5)] };
  } catch (e) {
    return { ...base, ok: false, ms: Date.now() - started, error: (e as Error).message };
  }
}

const shadowFile = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'shadow-read.json');

/** The last trial reads (newest first), kept next to the document. */
export function shadowHistory(): ShadowResult[] {
  try {
    return JSON.parse(fs.readFileSync(shadowFile(), 'utf8')) as ShadowResult[];
  } catch {
    return [];
  }
}

export function describeShadow(r: ShadowResult): string {
  if (r.error) return `lettura di prova non eseguita: ${r.error}`;
  const notes = [r.format ? `${r.format} valori scritti in altro formato` : '', r.order.length ? `ordine diverso in ${r.order.map((o) => `${o.list} (${o.outOfPlace}/${o.rows})`).join(', ')}` : ''].filter(Boolean).join('; ');
  return r.ok
    ? `documento ricostruito dalle tabelle identico al documento del sito (v${r.version}, ${r.rows} righe, ${(r.ms / 1000).toFixed(1)} s)${notes ? ` · ${notes}` : ''}`
    : `${r.real} DIFFERENZE tra tabelle e documento (v${r.version}): ${r.sample.slice(0, 5).map((d) => `${d.path}: ${JSON.stringify(d.document)} ≠ ${JSON.stringify(d.tables)}`).join(' | ')}`;
}

/**
 * Trial read on the site: first whatever is waiting to be exported is written, then the tables are
 * read back and compared with the same document. The result goes to the log and to
 * data/shadow-read.json; the site keeps using its own document whatever the outcome.
 */
export function shadowRead(db: DB): Promise<ShadowResult> {
  return enqueue(async () => {
    const synced = await doSync(db, false);
    const result: ShadowResult = !synced.ok
      ? { at: new Date().toISOString(), version: db.version, ok: false, rows: 0, ms: 0, real: 0, format: 0, order: [], sample: [], error: synced.error }
      : await shadowCompare(db);
    state.shadow = result;
    try {
      fs.writeFileSync(shadowFile(), JSON.stringify([result, ...shadowHistory()].slice(0, 60), null, 1));
    } catch {
      /* the log is a convenience: never fail because of it */
    }
    (result.ok ? console.log : console.error)(`[tables] ${describeShadow(result)}`);
    return result;
  });
}

/** A trial read shortly after the start and then every six hours. */
export function startShadowReads(currentDb: () => DB): void {
  const gs = globalThis as typeof globalThis & { __lancoraShadowTimer?: ReturnType<typeof setInterval> };
  if (gs.__lancoraShadowTimer || !cloudConfigured()) return;
  const run = () => {
    if (state.ready === false) return; // the SQL file was not run: nothing to read
    void shadowRead(currentDb()).catch((e) => console.error('[tables]', (e as Error).message));
  };
  setTimeout(run, 20_000).unref?.();
  gs.__lancoraShadowTimer = setInterval(run, 6 * 3600_000);
  gs.__lancoraShadowTimer.unref?.();
}

/** The SQL file the owner pastes in Supabase (null when the site does not run from the project folder). */
export function tablesSql(): string | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'supabase', 'hotel-tables.sql'), 'utf8');
  } catch {
    return null;
  }
}

// ── stage 3b: the site starts from the tables ────────────────────────────────

/**
 * Columns of the database, from the API's own description of it (null when it cannot be read).
 * hotel_sync() quietly skips a column the table does not have, so a column added to the site after
 * the SQL file was run would never reach the tables: this is how that is noticed.
 */
async function columnsInDatabase(): Promise<Map<string, Set<string>> | null> {
  try {
    const res = await cloudRest('', { headers: { accept: 'application/openapi+json' } }, 20_000);
    if (!res.ok) return null;
    const spec = (await res.json()) as { definitions?: Record<string, { properties?: Record<string, unknown> }> };
    if (!spec.definitions) return null;
    return new Map(Object.entries(spec.definitions).map(([t, d]) => [t, new Set(Object.keys(d.properties ?? {}))]));
  } catch {
    return null;
  }
}

/**
 * "table.column" for every column the site writes that the database lacks ([] when all are there or it
 * cannot be told). Empty tables are checked too (TABLE_COLUMNS): with real data most tables start
 * empty, and a missing column must be noticed before the first booking, not after it was lost.
 */
export async function missingColumns(rows: TableRows): Promise<string[]> {
  const have = await columnsInDatabase();
  if (!have) return [];
  const out: string[] = [];
  for (const t of TABLE_NAMES) {
    const cols = have.get(t);
    if (!cols) {
      out.push(t);
      continue;
    }
    const wanted = new Set([...TABLE_COLUMNS[t], ...Object.keys(rows[t][0] ?? {})]);
    for (const c of wanted) if (!cols.has(c)) out.push(`${t}.${c}`);
  }
  return out;
}

export type StartResult = {
  /**
   * off: Supabase not connected · disabled: TABLES_START=off · missing: no tables (or empty) ·
   * local: this computer's copy is as new as the tables · tables: the document was loaded from the tables ·
   * rejected: the tables were newer but did not pass the checks (the backup copy decides) · error
   */
  source: 'off' | 'disabled' | 'missing' | 'local' | 'tables' | 'rejected' | 'error';
  /** version of the document the site starts with (null when unknown) */
  version: number | null;
  detail: string;
  at: string;
};

/** TABLES_START=off in .env.local brings back the behaviour of stage 3a (start from the copy of the document). */
export const startFromTablesEnabled = (): boolean => (process.env.TABLES_START ?? '').trim().toLowerCase() !== 'off';

async function tablesMeta(): Promise<{ version: number; updatedAt: string } | null | 'missing'> {
  const res = await cloudRest('hotel_meta?id=eq.1&select=version,updated_at', {}, 20_000);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { code?: string };
    if (res.status === 404 || err.code === 'PGRST205' || err.code === '42P01') return 'missing';
    throw new Error(`Supabase ${res.status}`);
  }
  const row = ((await res.json()) as { version: number; updated_at: string }[])[0];
  return row ? { version: Number(row.version), updatedAt: row.updated_at } : null;
}

/** All the tables, read while nobody writes to them: the version must be the same before and after. */
async function readStable(): Promise<{ rows: TableRows; version: number }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await tablesMeta();
    if (!before || before === 'missing') throw new Error('Le tabelle sono vuote.');
    const rows = await readTables();
    const after = await tablesMeta();
    const inRows = Number(rows.hotel_meta[0]?.version);
    if (after && after !== 'missing' && after.version === before.version && inRows === before.version) return { rows, version: before.version };
    await new Promise((done) => setTimeout(done, 1500)); // another computer is writing: read again
  }
  throw new Error('Le tabelle cambiano mentre vengono lette (un altro computer sta salvando).');
}

function writeDocument(file: string, db: DB, backup: string | null): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (backup && fs.existsSync(file)) fs.copyFileSync(file, backup);
  const tmp = `${file}.${process.pid}.tables.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, JSON.stringify(db), 'utf8');
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Stage 3b, run once when the server starts, before the copy of the document (cloud.ts) is looked at.
 *
 * When the tables hold a newer version than this computer's document (or this computer has none:
 * a new PC, a new hosting), the document is rebuilt from the tables and written to data/db.json;
 * the previous file is kept as data/db.before-tables.json. It is used only after these checks:
 *  · the tables did not change while they were read, and say they hold a complete copy (version > 0)
 *  · same schema version as the site, no double booking, no row pointing at nothing
 *  · the database has every column the site writes (nothing was silently dropped)
 *  · when the copy of the document in hotel_state has the same version, the two agree value by value
 * Otherwise the tables are left aside and cloudHydrate() takes the newer of this computer's file and
 * the copy in hotel_state, exactly as before: that copy stays the backup.
 */
export async function startFromTables(): Promise<StartResult> {
  const done = (source: StartResult['source'], version: number | null, detail: string): StartResult => {
    const r = { source, version, detail, at: new Date().toISOString() };
    state.start = r;
    const line = `[tables] avvio: ${detail}`;
    if (source === 'rejected' || source === 'error') console.error(line);
    else if (source !== 'off') console.log(line);
    return r;
  };
  if (!cloudConfigured()) return done('off', null, 'Supabase non collegato.');
  if (!startFromTablesEnabled()) return done('disabled', null, 'disattivato (TABLES_START=off): si parte dalla copia del documento.');
  const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'db.json');
  let local: DB | null = null;
  try {
    if (fs.existsSync(file)) local = JSON.parse(fs.readFileSync(file, 'utf8')) as DB;
  } catch {
    local = null; // unreadable: the tables may replace it (the broken file is kept as the backup below)
  }
  try {
    const meta = await tablesMeta();
    if (meta === 'missing' || !meta) return done('missing', local?.version ?? null, meta === 'missing' ? 'le tabelle non esistono ancora.' : 'le tabelle sono vuote.');
    if (local && meta.version <= local.version) return done('local', local.version, `il documento di questo computer (v${local.version}) è aggiornato quanto le tabelle (v${meta.version}).`);

    const { rows, version } = await readStable();
    if (version <= 0) return done('rejected', local?.version ?? null, 'le tabelle contengono una copia interrotta a metà (versione 0).');
    const rebuilt = fromTables(rows);
    const { SCHEMA_VERSION } = await import('./store');
    if (rebuilt.schemaVersion !== SCHEMA_VERSION) return done('rejected', local?.version ?? null, `schema delle tabelle ${rebuilt.schemaVersion}, del sito ${SCHEMA_VERSION}.`);
    const issues = documentIssues(rebuilt);
    if (issues.length) return done('rejected', local?.version ?? null, `dati non validi nelle tabelle: ${issues.slice(0, 3).join(' · ')}`);
    const lost = await missingColumns(toTables(rebuilt));
    if (lost.length) return done('rejected', local?.version ?? null, `al database mancano colonne (${lost.slice(0, 5).join(', ')}): esegui di nuovo supabase/hotel-tables.sql.`);
    const copy = await cloudFetch().catch(() => null);
    if (copy && copy.version > version) return done('rejected', local?.version ?? null, `la copia del documento (v${copy.version}) è più recente delle tabelle (v${version}): si usa quella.`);
    if (copy && copy.version === version) {
      const cmp = compareDocuments(copy.data, rebuilt);
      if (cmp.real.length) return done('rejected', local?.version ?? null, `tabelle e copia del documento (v${version}) non coincidono: ${cmp.real.slice(0, 3).map((d) => d.path).join(', ')}.`);
    }
    writeDocument(file, rebuilt, local || fs.existsSync(file) ? path.join(path.dirname(file), 'db.before-tables.json') : null);
    return done('tables', version, `dati caricati dalle tabelle (v${version}${local ? `, questo computer aveva la v${local.version}` : ', questo computer non aveva dati'}${copy?.version === version ? ', verificati con la copia del documento' : ''}).`);
  } catch (e) {
    return done('error', local?.version ?? null, `tabelle non lette (${(e as Error).message}): si parte dalla copia del documento.`);
  }
}

export { documentIssues };
