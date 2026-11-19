import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { todayISO } from '@/lib/dates';
import { CLOUD, rowCas, rowGet, rowId, rowPut } from './db/cloud-row';

/* cloud mode: the daily totals in Supabase, row "<STORE_ROW>:visits" (each count is a compare-and-set) */
type VisitsDoc = { days: Record<string, VisitDay> };
function cloudChange(update: (days: Record<string, VisitDay>) => void): void {
  try {
    for (let i = 0; i < 3; i++) {
      const row = rowGet<VisitsDoc>(rowId('visits'));
      const days = { ...(row?.data.days ?? {}) };
      update(days);
      const keep = Object.fromEntries(Object.keys(days).sort().slice(-90).map((k) => [k, days[k]!]));
      if (!row) return rowPut(rowId('visits'), 1, { days: keep });
      if (rowCas(rowId('visits'), row.version, row.version + 1, { days: keep })) return;
    }
  } catch (e) {
    console.error('[visite]', (e as Error).message);
  }
}

/**
 * How many people visited the site, per day, for the owner's daily report.
 * No cookies and nothing personal is stored: a visitor is recognised within one day by a salted
 * hash that changes every day and lives only in memory; only the daily totals are written to
 * data/visits.json (last 90 days), outside the hotel document.
 */
export type VisitDay = { visitors: number; views: number; bookingViews: number; roomViews: number };
const EMPTY: VisitDay = { visitors: 0, views: 0, bookingViews: 0, roomViews: 0 };
// same folder as the hotel document (DATA_DIR), so tests and other installs never touch this one
const FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'visits.json');
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|node-fetch|axios/i;

type State = { days: Record<string, VisitDay>; seen: Map<string, Set<string>>; salt: string; timer: ReturnType<typeof setTimeout> | null };
const g = globalThis as typeof globalThis & { __laVisits?: State };

function state(): State {
  if (!g.__laVisits) {
    let days: Record<string, VisitDay> = {};
    try {
      days = (JSON.parse(fs.readFileSync(FILE, 'utf8')) as { days?: Record<string, VisitDay> }).days ?? {};
    } catch {
      /* first run */
    }
    g.__laVisits = { days, seen: new Map(), salt: randomBytes(16).toString('hex'), timer: null };
  }
  return g.__laVisits;
}

function save(s: State) {
  if (s.timer) return;
  s.timer = setTimeout(() => {
    s.timer = null;
    const keep = Object.keys(s.days).sort().slice(-90);
    const days = Object.fromEntries(keep.map((k) => [k, s.days[k]!]));
    s.days = days;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(`${FILE}.tmp`, JSON.stringify({ days }));
      fs.renameSync(`${FILE}.tmp`, FILE);
    } catch (e) {
      console.error('[visite]', (e as Error).message);
    }
  }, 4000);
  s.timer.unref?.();
}

/** One page seen by a person (not a bot) on the public site. */
export function recordVisit(ip: string, userAgent: string, pathname: string): void {
  if (!userAgent || BOTS.test(userAgent) || pathname.startsWith('/admin') || pathname.startsWith('/api')) return;
  const s = state();
  const day = todayISO();
  const d = (s.days[day] ??= { ...EMPTY });
  const who = createHash('sha256').update(`${s.salt}|${day}|${ip}|${userAgent}`).digest('base64url').slice(0, 22);
  let seen = s.seen.get(day);
  if (!seen) {
    s.seen.clear(); // yesterday's visitors are no longer needed
    seen = new Set();
    s.seen.set(day, seen);
  }
  const fresh = !seen.has(who);
  if (fresh) seen.add(who);
  const p = pathname.replace(/^\/(en|pl|de|fr|es)(?=\/|$)/, '') || '/';
  const add = (x: VisitDay) => {
    if (fresh) x.visitors += 1;
    x.views += 1;
    if (p.startsWith('/prenotazione')) x.bookingViews += 1;
    if (p.startsWith('/camere/')) x.roomViews += 1;
  };
  if (CLOUD) return cloudChange((days) => add((days[day] ??= { ...EMPTY })));
  add(d);
  save(s);
}

export function visitsOn(date: string): VisitDay {
  if (CLOUD) {
    try {
      return rowGet<VisitsDoc>(rowId('visits'))?.data.days[date] ?? { ...EMPTY };
    } catch {
      return { ...EMPTY };
    }
  }
  return state().days[date] ?? { ...EMPTY };
}

/** Start counting from zero (the switch from the demo to real data): written at once. */
export function resetVisits(): void {
  if (CLOUD) {
    try {
      rowPut(rowId('visits'), Date.now(), { days: {} });
    } catch (e) {
      console.error('[visite]', (e as Error).message);
    }
    return;
  }
  const s = state();
  s.days = {};
  s.seen.clear();
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify({ days: {} }));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (e) {
    console.error('[visite]', (e as Error).message);
  }
}
