import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '@/lib/types';

/**
 * Supabase as the safe copy of the hotel's data.
 *
 * The site keeps working exactly as before (one document, atomic writes: that is what prevents
 * double bookings), and every saved change is also sent to the Supabase project a moment later.
 * When the server starts it first asks Supabase: if the copy there is newer (another computer, a
 * new hosting, a reinstalled PC) it is loaded before anything else. So the data no longer lives
 * only on one disk.
 *
 * Table (one row): hotel_state(id text primary key, version bigint, data jsonb, updated_at timestamptz)
 * with row level security on and no policies: only the server's secret key can read or write it.
 */
type CloudState = { configured: boolean; ok: boolean | null; table: boolean | null; remoteVersion: number | null; lastPushAt: string | null; lastPullAt: string | null; lastError: string | null; pending: boolean };
const g = globalThis as typeof globalThis & { __lancoraCloudState?: CloudState; __lancoraCloudPush?: (db: DB) => void; __lancoraCloudTimer?: ReturnType<typeof setTimeout> | null };

const url = () => (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const key = () => (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
export const cloudConfigured = () => /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url()) && key().length > 20;

const state: CloudState = (g.__lancoraCloudState ??= { configured: false, ok: null, table: null, remoteVersion: null, lastPushAt: null, lastPullAt: null, lastError: null, pending: false });
export function cloudStatus(): CloudState & { project: string | null } {
  state.configured = cloudConfigured();
  return { ...state, project: state.configured ? new URL(url()).hostname.split('.')[0]! : null };
}

/** A request to the project's REST API with the server key (also used by tables-sync.ts). */
export async function cloudRest(pathname: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  return fetch(`${url()}/rest/v1/${pathname}`, {
    ...init,
    headers: { apikey: key(), authorization: `Bearer ${key()}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function note(e: unknown, res?: Response) {
  state.ok = false;
  state.lastError = res ? `Supabase ${res.status}` : (e as Error).message;
  if (res && (res.status === 404 || res.status === 406)) state.table = false;
}

/** Sends the current document (called a moment after every saved change). */
export async function cloudPushNow(db: DB): Promise<boolean> {
  if (!cloudConfigured()) return false;
  try {
    const res = await cloudRest('hotel_state?on_conflict=id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: 'main', version: db.version, data: db, updated_at: new Date().toISOString() }) });
    if (!res.ok) {
      note(null, res);
      return false;
    }
    Object.assign(state, { ok: true, table: true, remoteVersion: db.version, lastPushAt: new Date().toISOString(), lastError: null, pending: false });
    return true;
  } catch (e) {
    note(e);
    return false;
  }
}

/** Registered on globalThis so the store can call it without importing this file. */
g.__lancoraCloudPush = (db: DB) => {
  if (!cloudConfigured()) return;
  state.pending = true;
  if (g.__lancoraCloudTimer) clearTimeout(g.__lancoraCloudTimer);
  // a burst of changes (a booking touches several things) becomes one upload
  g.__lancoraCloudTimer = setTimeout(() => void cloudPushNow(db), 1200);
};

export async function cloudFetch(): Promise<{ version: number; data: DB } | null> {
  const res = await cloudRest('hotel_state?id=eq.main&select=version,data');
  if (!res.ok) {
    note(null, res);
    return null;
  }
  state.table = true;
  state.ok = true;
  const rows = (await res.json()) as { version: number; data: DB }[];
  return rows[0] ?? null;
}

/** On start: take the newer copy (local file or Supabase) and make both sides equal. */
export async function cloudHydrate(): Promise<'off' | 'pulled' | 'pushed' | 'same' | 'error'> {
  if (!cloudConfigured()) return 'off';
  try {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    const file = path.join(dir, 'db.json');
    const local = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as DB) : null;
    const remote = await cloudFetch();
    if (state.table === false) return 'error';
    if (remote && (!local || remote.version > local.version)) {
      fs.mkdirSync(dir, { recursive: true });
      if (local) fs.writeFileSync(path.join(dir, 'db.before-cloud.json'), JSON.stringify(local));
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(remote.data, null, 2));
      fs.renameSync(`${file}.tmp`, file);
      Object.assign(state, { remoteVersion: remote.version, lastPullAt: new Date().toISOString(), lastError: null });
      console.log(`[cloud] dati caricati da Supabase (versione ${remote.version})`);
      return 'pulled';
    }
    if (local && (!remote || local.version > remote.version)) return (await cloudPushNow(local)) ? 'pushed' : 'error';
    state.remoteVersion = remote?.version ?? null;
    return 'same';
  } catch (e) {
    note(e);
    return 'error';
  }
}

export const CLOUD_TABLE_SQL = `create table if not exists public.hotel_state (
  id text primary key,
  version bigint not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.hotel_state enable row level security;`;
