import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Booking, DB } from '@/lib/types';
import { addDays, eachNight, fmtDate, fmtDateTime, isValidISODate, todayISO } from '@/lib/dates';
import { isBookingActive } from '@/lib/availability';
import { mutate, newId, readDb } from '../db/store';
import { CLOUD, pieceGet, piecePut } from '../db/cloud-row';
import { notify } from '../events';

/**
 * Booking.com / Expedia / Airbnb without a certified connection: calendar sync (iCal).
 *
 *  · import: the owner copies, for each room, the "export calendar" link from the portal's extranet
 *    and pastes it in the panel. Every 15 minutes the site reads it and closes those nights in the
 *    planning (a block named after the portal) — so the site never sells a night the portal sold;
 *  · export: the panel gives, for each room, our own link to paste into the portal ("import
 *    calendar"), so the portal closes the nights sold here. The portal can read it only when the
 *    site is on the internet (https).
 * A calendar carries dates only: no guest names, no prices. Nothing is sent to anyone else.
 */
export type CalSource = 'booking' | 'expedia' | 'airbnb' | 'altro';
export type Calendar = { id: string; roomId: string; source: CalSource; url: string; lastSync: string | null; lastError: string | null; nights: number; returnAt?: string | null };
export const SOURCE_LABEL: Record<CalSource, string> = { booking: 'Booking.com', expedia: 'Expedia', airbnb: 'Airbnb', altro: 'Calendario esterno' };

export function sourceOfUrl(url: string): CalSource {
  const h = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (h.endsWith('booking.com')) return 'booking';
  if (h.includes('expedia') || h.includes('vrbo') || h.includes('homeaway')) return 'expedia';
  if (h.includes('airbnb')) return 'airbnb';
  return 'altro';
}

/** Only public https addresses (never the computer itself or the local network). */
export function safeCalendarUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:') return null;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || /^(127|10|192\.168|169\.254)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** iCal text → stays (date in, date out exclusive). Handles folded lines and DATE / DATE-TIME values. */
export function parseIcs(text: string): { uid: string; from: string; to: string; summary: string }[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out: { uid: string; from: string; to: string; summary: string }[] = [];
  let cur: Record<string, string> | null = null;
  const dateOf = (v: string | undefined) => {
    const m = (v ?? '').match(/(\d{4})(\d{2})(\d{2})/);
    const iso = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    return isValidISODate(iso) ? iso : null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      const from = dateOf(cur.DTSTART);
      let to = dateOf(cur.DTEND);
      if (from && (!to || to <= from)) to = addDays(from, 1);
      if (from && to) out.push({ uid: cur.UID || `${from}-${to}`, from, to, summary: (cur.SUMMARY ?? '').slice(0, 120) });
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i > 0) cur[line.slice(0, i).split(';')[0]!.toUpperCase()] = line.slice(i + 1);
    }
  }
  return out;
}

export function calendarKey(db: DB): string | null {
  return db.channel.icalKey ?? null;
}

/** The secret in our export links (created once). */
export function ensureCalendarKey(): string {
  const k = readDb().channel.icalKey;
  if (k) return k;
  const key = randomBytes(18).toString('base64url');
  mutate((db) => {
    db.channel.icalKey ??= key;
  });
  return readDb().channel.icalKey ?? key;
}

/** Our calendar for one room: every night sold or closed here (except what came from `forSource`). */
export function exportIcs(db: DB, roomId: string, forSource?: string | null): string {
  const room = db.rooms.find((r) => r.id === roomId);
  const today = todayISO();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const d = (iso: string) => iso.replace(/-/g, '');
  const ev: string[] = [];
  for (const b of db.bookings) {
    if (b.roomId !== roomId || !isBookingActive(b) || b.checkOut <= today) continue;
    if (forSource && b.source === forSource) continue;
    ev.push(['BEGIN:VEVENT', `UID:booking-${b.id}@hotel-lancora`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(b.checkIn)}`, `DTEND;VALUE=DATE:${d(b.checkOut)}`, 'SUMMARY:Occupato', 'END:VEVENT'].join('\r\n'));
  }
  for (const k of db.blocks) {
    if (k.roomId !== roomId || k.to <= today) continue;
    if (forSource && k.source === forSource) continue;
    ev.push(['BEGIN:VEVENT', `UID:block-${k.id}@hotel-lancora`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(k.from)}`, `DTEND;VALUE=DATE:${d(k.to)}`, 'SUMMARY:Non disponibile', 'END:VEVENT'].join('\r\n'));
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hotel L Ancora//Calendario camera//IT', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:Camera ${room?.number ?? ''}`, ...ev, 'END:VCALENDAR', ''].join('\r\n');
}

/* ---------- what the sync remembers between rounds (a small file next to the hotel data, not inside it) ---------- */

type Memory = {
  /** `${roomId}:${portal}` → last time that portal read the site's calendar of the room */
  reads: Record<string, string>;
  /** calendar id → the portal's stays seen in the last round (to tell new ones and cancellations apart) */
  seen: Record<string, string[]>;
  /** calendar id → stays already reported as a possible double booking */
  alerted: Record<string, string[]>;
  /** calendar id → rounds in a row the portal sent an empty calendar */
  empty: Record<string, number>;
  /** calendar id → last read already reported as "the portal stopped reading the site" */
  stale: Record<string, string>;
};
const MEMORY_FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'calendari.json');
const gm = globalThis as typeof globalThis & { __laCalMemory?: Memory; __laCalMemoryAt?: number };

function memory(): Memory {
  // hosting without a disk: the memory sits in Supabase and is read again after a minute (another instance may have changed it)
  if (CLOUD && gm.__laCalMemory && Date.now() - (gm.__laCalMemoryAt ?? 0) > 60_000) gm.__laCalMemory = undefined;
  if (!gm.__laCalMemory) {
    let m: Partial<Memory> = {};
    try {
      m = CLOUD ? (pieceGet<Partial<Memory>>('calendars') ?? {}) : (JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) as Partial<Memory>);
    } catch {
      /* first run */
    }
    gm.__laCalMemoryAt = Date.now();
    gm.__laCalMemory = { reads: m.reads ?? {}, seen: m.seen ?? {}, alerted: m.alerted ?? {}, empty: m.empty ?? {}, stale: m.stale ?? {} };
  }
  return gm.__laCalMemory;
}

function saveMemory() {
  try {
    if (CLOUD) return piecePut('calendars', memory());
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(`${MEMORY_FILE}.tmp`, JSON.stringify(memory()));
    fs.renameSync(`${MEMORY_FILE}.tmp`, MEMORY_FILE);
  } catch (e) {
    console.error('[calendari]', (e as Error).message);
  }
}

const portalOf = (per: string | null): CalSource => (per === 'booking' || per === 'expedia' || per === 'airbnb' ? per : 'altro');

/** A portal read the site's calendar of one room (the link pasted in its "import calendar"). */
export function recordCalendarRead(roomId: string, per: string | null): void {
  const m = memory();
  const key = `${roomId}:${portalOf(per)}`;
  const prev = m.reads[key];
  const now = new Date().toISOString();
  m.reads[key] = now;
  // portals may read often: the file is rewritten at most every 10 minutes per room
  if (!prev || Date.parse(now) - Date.parse(prev) > 10 * 60_000) saveMemory();
}

export function lastCalendarRead(roomId: string, source: string): string | null {
  return memory().reads[`${roomId}:${source}`] ?? null;
}

/** A calendar unlinked or replaced: what the sync remembered about it goes too. */
export function forgetCalendar(id: string): void {
  const m = memory();
  delete m.seen[id];
  delete m.alerted[id];
  delete m.empty[id];
  delete m.stale[id];
  saveMemory();
}

/** Consecutive nights → stays [from, to). */
function toRanges(nights: string[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const n of nights) {
    const last = out[out.length - 1];
    if (last && last.to === n) last.to = addDays(n, 1);
    else out.push({ from: n, to: addDays(n, 1) });
  }
  return out;
}

const RESERVED = /reserv|prenot|booked|buchung|réserv/i;

/**
 * Reads one portal calendar and makes the planning match it (its own blocks only, future nights).
 *  · nights already taken in the room are not closed twice: the portal also lists the nights it read
 *    from the site's calendar (an echo, harmless);
 *  · the same nights sold there before the portal could know about the site's booking are a possible
 *    double booking: the owner is told at once (once per stay);
 *  · after the first round, new stays and cancellations on the portal reach the owner as notices;
 *  · a calendar that suddenly comes back empty is trusted only at the next round (a portal hiccup
 *    must never reopen sold nights).
 * `quiet`: a quick check (before a booking on the site) that never marks the calendar as broken.
 */
export async function syncCalendar(id: string, opts: { timeoutMs?: number; quiet?: boolean } = {}): Promise<{ ok: boolean; nights: number; error?: string }> {
  const cal = readDb().channel.calendars?.find((c) => c.id === id);
  if (!cal) return { ok: false, nights: 0, error: 'Calendario non trovato.' };
  let events: ReturnType<typeof parseIcs> = [];
  let error: string | null = null;
  try {
    const res = await fetch(cal.url, { headers: { accept: 'text/calendar, text/plain, */*', 'user-agent': 'HotelLAncora-CalendarSync/1.0' }, signal: AbortSignal.timeout(opts.timeoutMs ?? 20000), redirect: 'follow' });
    const text = res.ok ? await res.text() : '';
    if (!res.ok) error = res.status === 404 || res.status === 410 ? 'Il portale dice che questo link non esiste più: copia di nuovo il link di “Esporta calendario”.' : `Il portale ha risposto ${res.status}: controlla che il link sia quello di “Esporta calendario”.`;
    else if (!/BEGIN:VCALENDAR/i.test(text)) error = 'Questo link apre una pagina, non il calendario. Copia il link che il portale dà in “Esporta calendario”.';
    else events = parseIcs(text);
  } catch (e) {
    error = (e as Error).name === 'TimeoutError' ? 'Il portale non ha risposto in tempo: riprovo da solo tra 15 minuti.' : 'Portale non raggiungibile in questo momento: riprovo da solo tra 15 minuti.';
  }
  if (error && opts.quiet) return { ok: false, nights: 0, error };
  const today = todayISO();
  let nights = 0;
  mutate((db) => {
    const c = db.channel.calendars?.find((x) => x.id === id);
    if (!c) return;
    const wasOk = !c.lastError && c.lastSync !== null; // a wrong link pasted just now is shown in the panel, not sent
    const label = SOURCE_LABEL[c.source];
    const roomNo = db.rooms.find((r) => r.id === c.roomId)?.number ?? '?';

    c.lastSync = new Date().toISOString();
    c.lastError = error;
    if (error) {
      // tell the owner once when a calendar stops working (not every 15 minutes)
      if (wasOk) notify(db, 'errore_sincronizzazione', `${label} non si aggiorna`, `Camera ${roomNo}: ${error}\nFinché non torna a funzionare, controlla le date anche sul portale.`, '/admin/automazioni');
      return;
    }

    const m = memory();
    const tag = `${c.id}:`;
    const horizon = addDays(today, 1100); // a closure "forever" is read as three years
    const stays = events.filter((e) => e.to > today && e.from < horizon).map((e) => ({ ...e, to: e.to > horizon ? horizon : e.to }));
    const mine = db.blocks.filter((k) => k.extUid?.startsWith(tag) && k.to > today);
    if (!stays.length && mine.length >= 2 && (m.empty[c.id] ?? 0) < 1) {
      m.empty[c.id] = 1;
      saveMemory();
      c.nights = mine.reduce((s, k) => s + eachNight(k.from, k.to).length, 0);
      return;
    }
    delete m.empty[c.id];

    const first = !(c.id in m.seen);
    const before = new Set(m.seen[c.id] ?? []);
    const alerted = new Set(m.alerted[c.id] ?? []);
    const oldByUid = new Map<string, { from: string; to: string }>();
    for (const k of mine) {
      const uid = k.extUid!.slice(tag.length);
      const o = oldByUid.get(uid);
      oldByUid.set(uid, o ? { from: o.from < k.from ? o.from : k.from, to: o.to > k.to ? o.to : k.to } : { from: k.from, to: k.to });
    }

    // replace this calendar's blocks with what the portal says now
    db.blocks = db.blocks.filter((k) => !k.extUid?.startsWith(tag));
    const taken = new Map<string, Booking | null>(); // night → the booking there (null: closed for another reason)
    for (const b of db.bookings) if (b.roomId === c.roomId && isBookingActive(b) && b.checkOut > today) for (const n of eachNight(b.checkIn, b.checkOut)) taken.set(n, b);
    for (const k of db.blocks) if (k.roomId === c.roomId && k.to > today) for (const n of eachNight(k.from, k.to)) if (!taken.has(n)) taken.set(n, null);

    const read = m.reads[`${c.roomId}:${c.source}`];
    const now = new Date().toISOString();
    const fresh: { from: string; to: string; summary: string }[] = [];
    const clashes: { from: string; to: string; booking: Booking }[] = [];
    for (const e of stays) {
      const free: string[] = [];
      const clashNights: string[] = [];
      let clash: Booking | null = null;
      for (const n of eachNight(e.from, e.to)) {
        const holder = taken.get(n);
        if (holder === undefined) {
          free.push(n);
          taken.set(n, null);
        } else if (holder && n >= today && holder.source !== c.source) {
          clash ??= holder;
          clashNights.push(n);
        }
      }
      for (const r of toRanges(free)) {
        db.blocks.push({ id: newId('blk-'), roomId: c.roomId, from: r.from, to: r.to, reason: `${label} (calendario)`, createdBy: label, createdAt: now, source: c.source, extUid: `${tag}${e.uid}` });
        if (r.to > today) nights += eachNight(r.from < today ? today : r.from, r.to).length;
      }
      if (!first && !before.has(e.uid) && free.some((n) => n >= today)) fresh.push({ from: e.from, to: e.to, summary: e.summary });
      // an echo needs the portal to have read the site's calendar after that booking was made
      const echo = !RESERVED.test(e.summary) && read !== undefined && Date.parse(read) > Date.parse(clash?.createdAt ?? '');
      if (clash && !echo && !alerted.has(e.uid)) {
        const r = toRanges(clashNights)[0]!;
        clashes.push({ ...r, booking: clash });
        alerted.add(e.uid);
      }
    }
    const uids = new Set(stays.map((e) => e.uid));
    const gone = first ? [] : [...before].filter((u) => !uids.has(u)).flatMap((u) => (oldByUid.get(u) ? [oldByUid.get(u)!] : []));
    m.seen[c.id] = [...uids];
    m.alerted[c.id] = [...alerted].filter((u) => uids.has(u));
    saveMemory();

    for (const x of clashes) {
      notify(db, 'errore_sincronizzazione', `Camera ${roomNo}: forse venduta due volte`, `${label} segna occupate le notti dal ${fmtDate(x.from)} al ${fmtDate(x.to)}, dove c’è già la prenotazione ${x.booking.code} (${x.booking.guest.lastName}). Controlla subito su ${label}: se è una doppia prenotazione, sposta uno dei due ospiti in un’altra camera.`, '/admin/disponibilita');
    }
    if (fresh.length > 3) notify(db, 'nuova_prenotazione', `${label}: ${fresh.length} nuove date occupate · camera ${roomNo}`, `Le notti sono già chiuse nel planning e sul sito. Nomi degli ospiti e prezzi li trovi su ${label}.`, '/admin/disponibilita');
    else for (const f of fresh) notify(db, 'nuova_prenotazione', `${label}: camera ${roomNo} occupata`, `Dal ${fmtDate(f.from)} al ${fmtDate(f.to)}${RESERVED.test(f.summary) ? ' (prenotazione)' : ''}. Le notti sono già chiuse nel planning e sul sito; nome e prezzo li trovi su ${label}.`, '/admin/disponibilita');
    for (const g of gone) notify(db, 'prenotazione_cancellata', `${label}: camera ${roomNo} di nuovo libera`, `Le notti dal ${fmtDate(g.from)} al ${fmtDate(g.to)} non sono più occupate su ${label} (cancellazione o cambio date): ora si possono vendere anche sul sito.`, '/admin/disponibilita');

    c.nights = nights;
    db.channel.lastSync = c.lastSync;
    db.channel.log.unshift({ at: c.lastSync, level: 'info', message: `${label} · camera ${roomNo}: ${nights === 1 ? '1 notte occupata' : `${nights} notti occupate`} dal portale` });
    db.channel.log = db.channel.log.slice(0, 60);
  });
  return error ? { ok: false, nights: 0, error } : { ok: true, nights };
}

/**
 * Right before a guest books a room on the site: the portals' calendars of that room are read again
 * (only if older than 2 minutes, a few seconds at most). A slow portal never blocks the booking.
 */
export async function refreshRoomCalendars(roomId: string, maxAgeMs = 120_000, timeoutMs = 3500): Promise<void> {
  const stale = (readDb().channel.calendars ?? []).filter((c) => c.roomId === roomId && (!c.lastSync || Date.now() - Date.parse(c.lastSync) > maxAgeMs));
  if (stale.length) await Promise.allSettled(stale.map((c) => syncCalendar(c.id, { timeoutMs, quiet: true })));
}

/** The other direction: tell the owner once when a portal stops reading the site's calendar. */
async function watchReturnSide(): Promise<void> {
  const { stablePublicUrl } = await import('../telegram/poller');
  if (!stablePublicUrl()) return;
  const m = memory();
  const late = (readDb().channel.calendars ?? []).flatMap((c) => {
    const r = m.reads[`${c.roomId}:${c.source}`];
    if (!r) return [];
    if (Date.now() - Date.parse(r) <= 30 * 3600_000) {
      if (m.stale[c.id]) {
        delete m.stale[c.id];
        saveMemory();
      }
      return [];
    }
    return m.stale[c.id] === r ? [] : [{ c, r }];
  });
  if (!late.length) return;
  mutate((db) => {
    for (const { c, r } of late) {
      const label = SOURCE_LABEL[c.source];
      notify(db, 'errore_sincronizzazione', `${label} non legge più il calendario del sito`, `Camera ${db.rooms.find((x) => x.id === c.roomId)?.number ?? '?'}: ${label} non controlla le date del sito dal ${fmtDateTime(r)}. Finché non torna, le prenotazioni fatte sul sito non si chiudono su ${label}: controlla che in “Importa calendario” ci sia ancora il link del sito.`, '/admin/automazioni');
      m.stale[c.id] = r;
    }
  });
  saveMemory();
}

export async function syncAllCalendars(): Promise<void> {
  for (const c of readDb().channel.calendars ?? []) await syncCalendar(c.id).catch(() => null);
  await watchReturnSide().catch(() => null);
}

const g = globalThis as typeof globalThis & { __lancoraCalTimer?: ReturnType<typeof setInterval> };
/** Every 15 minutes while the site runs (started once from instrumentation). */
export function startCalendarSync() {
  if (g.__lancoraCalTimer) return;
  g.__lancoraCalTimer = setInterval(() => void syncAllCalendars(), 15 * 60 * 1000);
  g.__lancoraCalTimer.unref?.();
  setTimeout(() => void syncAllCalendars(), 20_000).unref?.();
}

export const calendarId = () => newId('cal-');
