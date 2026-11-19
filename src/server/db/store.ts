import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/types';
import { buildSeed } from './seed';
import { demoRoomReviews } from './demo-reviews';
import { todayISO } from '@/lib/dates';
import { after as afterResponse } from 'next/server';
import { CLOUD, CloudStoreError, rowCas, rowGet, rowId, rowVersion } from './cloud-row';

/**
 * Demo persistence: a single JSON document on disk, written atomically (tmp file + rename).
 * Every mutation is a synchronous read-modify-write inside one tick of the Node event loop,
 * so two requests can never interleave: this is what prevents double bookings in demo mode.
 * Production: replace with the PostgreSQL schema in /supabase (EXCLUDE constraint on stays).
 */
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SCHEMA_VERSION = 1;

type Cache = { mtimeMs: number; size: number; db: DB; norm?: number };
const g = globalThis as unknown as { __lancoraDb?: Cache; __lancoraAfter?: (() => void | Promise<void>)[] | null; __lancoraLive?: Set<(v: number) => void>; __lancoraCloudPush?: (db: DB) => void; __lancoraTablesPush?: (db: DB) => void };

function ensureFile(): void {
  if (fs.existsSync(DB_FILE)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeAtomic(buildSeed());
}

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function writeAtomic(db: DB): void {
  const json = JSON.stringify(db);
  const tmp = `${DB_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, json, 'utf8');
  let renamed = false;
  // Windows can briefly refuse a rename while another process (antivirus, indexer) reads the file
  for (let i = 0; i < 6 && !renamed; i++) {
    try {
      fs.renameSync(tmp, DB_FILE);
      renamed = true;
    } catch {
      pause(25 * (i + 1));
    }
  }
  if (!renamed) {
    fs.writeFileSync(DB_FILE, json, 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
  const st = fs.statSync(DB_FILE);
  g.__lancoraDb = { mtimeMs: st.mtimeMs, size: st.size, db, norm: NORMALIZE_VERSION };
}

/** Parse the file, tolerating a reader that races a writer from another process. */
function parseFile(): DB {
  let lastError: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as DB;
    } catch (e) {
      lastError = e;
      pause(30 * (i + 1));
    }
  }
  if (g.__lancoraDb) return g.__lancoraDb.db;
  // unreadable and nothing cached: keep the broken file for inspection, start from fresh demo data
  try { fs.renameSync(DB_FILE, `${DB_FILE}.corrupt-${Date.now()}`); } catch { /* ignore */ }
  console.error('[store] database file unreadable, regenerated demo data', lastError);
  const fresh = buildSeed();
  writeAtomic(fresh);
  return fresh;
}

const NORMALIZE_VERSION = 6;

/** Forward-compatible defaults for data written by older versions of the app. */
function normalize(db: DB): DB {
  const p = db.settings.payments as Partial<DB['settings']['payments']>;
  p.cashDiscountPercent ??= 5;
  p.allowCashAtHotel ??= true;
  p.allowOnline ??= true;
  p.cancellationFee ??= { type: 'percent', value: 100 };
  db.settings.pricing = { singleUsePercent: 20, board: 'room_only', ...(db.settings.pricing ?? {}) };
  db.settings.stripeConnect = { ...({ accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, payoutInterval: 'weekly', weeklyAnchor: 'monday', monthlyAnchor: 1, updatedAt: null, simulated: false, businessName: null, bankLast4: null, requirements: [] }), ...db.settings.stripeConnect };
  db.campaigns ??= [];
  db.unsubscribed ??= [];
  db.assistantLog ??= [];
  db.settings.customAmenities ??= [];
  db.settings.reviews ??= { autoRequest: true, delayDays: 1 };
  // older demo data had no room reviews: add the demo ones once (persisted with the next write)
  if (db.settings.demoMode && !db.feedback.some((f) => f.roomId)) db.feedback.push(...demoRoomReviews(db.rooms, todayISO()));
  return db;
}

/* ------------------------------------------------------------------ */
/* cloud mode (Vercel): the document lives in Supabase (cloud-row.ts)   */
/* ------------------------------------------------------------------ */

/** How long a copy is trusted before asking Supabase for its version again (one tiny query). */
const CLOUD_TTL = Number(process.env.STORE_TTL_MS || 1000);
type CloudCache = { db: DB; checkedAt: number };
const cg = globalThis as unknown as { __lancoraCloudDb?: CloudCache };

function cloudRead(force = false): DB {
  const c = cg.__lancoraCloudDb;
  if (c && !force && Date.now() - c.checkedAt < CLOUD_TTL) return c.db;
  if (c && !force) {
    let v: number | null = null;
    try {
      v = rowVersion(rowId());
    } catch (e) {
      // Supabase did not answer: keep showing the last copy for a few seconds (writes still check)
      console.error('[store]', (e as Error).message);
      c.checkedAt = Date.now() - CLOUD_TTL + 3000;
      return c.db;
    }
    if (v === c.db.version) {
      c.checkedAt = Date.now();
      return c.db;
    }
  }
  const row = rowGet<DB>(rowId());
  if (!row) throw new CloudStoreError(`Nessun dato in Supabase (hotel_state "${rowId()}"): copia prima i dati dell’hotel.`);
  const db = normalize(row.data);
  db.version = row.version;
  if (db.schemaVersion !== SCHEMA_VERSION) console.error(`[db] dati nel formato ${db.schemaVersion}, il sito si aspetta ${SCHEMA_VERSION}: usati così come sono.`);
  cg.__lancoraCloudDb = { db, checkedAt: Date.now() };
  return db;
}

/** Runs what was registered with afterCommit(): after the answer, kept alive by the host (waitUntil). */
function runAfter(cbs: (() => void | Promise<void>)[]): void {
  if (!cbs.length) return;
  const job = async () => {
    for (const cb of cbs) {
      try {
        await cb();
      } catch (e) {
        console.error('[afterCommit]', e);
      }
    }
  };
  if (CLOUD) {
    try {
      afterResponse(job);
      return;
    } catch {
      /* outside a request (tests, scripts): run it now */
    }
  }
  for (const cb of cbs) {
    Promise.resolve()
      .then(cb)
      .catch((e) => console.error('[afterCommit]', e));
  }
}

/** Read-only snapshot. Never mutate the returned object — use mutate(). */
export function readDb(): DB {
  if (CLOUD) return cloudRead();
  ensureFile();
  const st = fs.statSync(DB_FILE);
  const c = g.__lancoraDb;
  // `norm` invalidates snapshots cached (across hot reloads) by an older normalize()
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size && c.norm === NORMALIZE_VERSION) return c.db;
  const db = normalize(parseFile());
  if (db.schemaVersion !== SCHEMA_VERSION) {
    // demo data of another format: start again from fresh demo data. Real data is NEVER replaced
    // by the demo: it is used as it is (normalize() adds what is missing) and the problem is logged.
    if (db.settings?.demoMode !== false) {
      const fresh = buildSeed();
      writeAtomic(fresh);
      return fresh;
    }
    console.error(`[db] dati veri nel formato ${db.schemaVersion}, il sito si aspetta ${SCHEMA_VERSION}: usati così come sono, serve un aggiornamento dei dati.`);
  }
  g.__lancoraDb = { mtimeMs: st.mtimeMs, size: st.size, db, norm: NORMALIZE_VERSION };
  return db;
}

/**
 * Atomic mutation. `fn` receives a private copy; on success it is persisted and the global
 * data version is bumped (clients poll it to refresh live). Callbacks registered with
 * afterCommit() run once the write succeeded (e.g. Telegram, SMTP).
 */
export function mutate<T>(fn: (db: DB) => T): T {
  if (CLOUD) return cloudMutate(fn);
  const db = structuredClone(readDb());
  const prev = g.__lancoraAfter;
  const after: (() => void | Promise<void>)[] = [];
  g.__lancoraAfter = after;
  let result: T;
  try {
    result = fn(db);
  } finally {
    g.__lancoraAfter = prev ?? null;
  }
  db.version += 1;
  db.updatedAt = new Date().toISOString();
  writeAtomic(db);
  // the safe copy in the cloud follows a moment later (server/db/cloud.ts, when Supabase is connected)
  g.__lancoraCloudPush?.(db);
  // …and the rows that changed are written to the real tables (server/db/tables-sync.ts, one-way export)
  g.__lancoraTablesPush?.(db);
  // push the new version to every open page (/api/live)
  for (const l of liveListeners()) {
    try {
      l(db.version);
    } catch {
      /* a closed stream */
    }
  }
  runAfter(after);
  return result;
}

/**
 * The same atomic change, against Supabase: made on a fresh copy and saved only if nobody saved in
 * between (compare-and-set on the version). If somebody did, the change is made again on their
 * newer data, so a booking can never overwrite another one.
 */
function cloudMutate<T>(fn: (db: DB) => T): T {
  for (let attempt = 0; attempt < 4; attempt++) {
    const base = cloudRead(attempt > 0);
    const db = structuredClone(base);
    const prev = g.__lancoraAfter;
    const after: (() => void | Promise<void>)[] = [];
    g.__lancoraAfter = after;
    let result: T;
    try {
      result = fn(db);
    } finally {
      g.__lancoraAfter = prev ?? null;
    }
    db.version = base.version + 1;
    db.updatedAt = new Date().toISOString();
    if (rowCas(rowId(), base.version, db.version, db)) {
      cg.__lancoraCloudDb = { db, checkedAt: Date.now() };
      runAfter(after);
      return result;
    }
  }
  throw new CloudStoreError('Troppe modifiche nello stesso momento: riprova tra un attimo.');
}

export function afterCommit(cb: () => void | Promise<void>): void {
  if (g.__lancoraAfter) g.__lancoraAfter.push(cb);
  else runAfter([cb]);
}

export function resetDb(): DB {
  if (CLOUD) {
    // the demo reset in the cloud: the seed replaces the document, with the next version
    const cur = cloudRead(true);
    const next: DB = { ...buildSeed(), version: cur.version + 1 };
    if (!rowCas(rowId(), cur.version, next.version, next)) throw new CloudStoreError('Dati cambiati nel frattempo: riprova.');
    cg.__lancoraCloudDb = { db: next, checkedAt: Date.now() };
    return next;
  }
  const db = buildSeed();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeAtomic(db);
  return db;
}

/** Pages listening for changes (Server-Sent Events in /api/live). */
export function liveListeners(): Set<(v: number) => void> {
  return (g.__lancoraLive ??= new Set());
}

export function dataVersion(): number {
  return readDb().version;
}

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
}

export { SCHEMA_VERSION };
