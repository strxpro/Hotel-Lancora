import 'server-only';
import { syncFetch } from './sync-http';

/**
 * Hosting without a disk (Vercel): the hotel's data lives in Supabase, table `hotel_state`
 * (id, version, data jsonb). `STORE_MODE=cloud` turns this on; `STORE_ROW` names the row of the
 * document (`main` for the real site, e.g. `staging` for a preview), and the other pieces sit in rows
 * next to it (`main:integrations`, `main:visits`). RLS is on with no policies: only the server's
 * secret key reads and writes.
 *
 * Every call is synchronous (see sync-http.ts), so the rest of the site keeps its simple
 * readDb()/mutate() and every write is a compare-and-set on the row's version: two writers can
 * never overwrite each other.
 */
export const CLOUD = process.env.STORE_MODE === 'cloud';
export const ROW = (process.env.STORE_ROW || 'main').trim();
export const rowId = (piece?: string) => (piece ? `${ROW}:${piece}` : ROW);

export class CloudStoreError extends Error {}

const endpoint = () => `${(process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '')}/rest/v1/hotel_state`;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const k = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  return { apikey: k, authorization: `Bearer ${k}`, 'content-type': 'application/json', ...extra };
}
const q = (id: string) => `id=eq.${encodeURIComponent(id)}`;

function parse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CloudStoreError('Risposta di Supabase non leggibile.');
  }
}

/** The row's version, or null when the row does not exist. Throws when Supabase does not answer. */
export function rowVersion(id: string): number | null {
  const r = syncFetch(`${endpoint()}?${q(id)}&select=version`, { headers: headers() }, 8000);
  if (!r.ok) throw new CloudStoreError(`Supabase non risponde (${r.status || r.text}).`);
  const rows = parse<{ version: number }[]>(r.text);
  return rows[0] ? Number(rows[0].version) : null;
}

export function rowGet<T>(id: string): { version: number; data: T } | null {
  const r = syncFetch(`${endpoint()}?${q(id)}&select=version,data`, { headers: headers() }, 15000);
  if (!r.ok) throw new CloudStoreError(`Supabase non risponde (${r.status || r.text}).`);
  const rows = parse<{ version: number; data: T }[]>(r.text);
  return rows[0] ? { version: Number(rows[0].version), data: rows[0].data } : null;
}

/** Writes `data` as `version` only if the row is still at `expected`. false = someone wrote first. */
export function rowCas(id: string, expected: number, version: number, data: unknown): boolean {
  const r = syncFetch(
    `${endpoint()}?${q(id)}&version=eq.${expected}&select=version`,
    { method: 'PATCH', headers: headers({ prefer: 'return=representation' }), body: JSON.stringify({ version, data, updated_at: new Date().toISOString() }) },
    20000,
  );
  if (!r.ok) throw new CloudStoreError(`Salvataggio non riuscito (Supabase ${r.status || r.text}).`);
  return parse<unknown[]>(r.text).length === 1;
}

/** Creates or replaces a row (for pieces where the last writer may win, e.g. settings keys). */
export function rowPut(id: string, version: number, data: unknown): void {
  const r = syncFetch(
    `${endpoint()}?on_conflict=id`,
    { method: 'POST', headers: headers({ prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ id, version, data, updated_at: new Date().toISOString() }) },
    20000,
  );
  if (!r.ok) throw new CloudStoreError(`Salvataggio non riuscito (Supabase ${r.status || r.text}).`);
}

/** Small pieces kept next to the document (photo library list, calendar memory, backups): last writer wins. */
export function pieceGet<T>(piece: string): T | null {
  const r = rowGet<T>(rowId(piece));
  return r ? r.data : null;
}
export function piecePut(piece: string, data: unknown): void {
  rowPut(rowId(piece), Date.now(), data);
}
