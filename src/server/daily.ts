import 'server-only';
import type { Booking, DB, NotificationType } from '@/lib/types';
import { HOTEL_TZ, diffDays, todayISO } from '@/lib/dates';
import { mutate, readDb } from './db/store';
import { notify } from './events';
import { arrivalsOn, departuresOn } from './stats';
import { composeReport, dayFacts } from './reports';
import { notti, ospiti } from '@/lib/utils';

/**
 * The owner's day on Telegram, sent by the site itself (checked every minute, once per day each):
 *  · morning (08:00)  arrivals and departures of the day (only if there are any);
 *  · check-out time   rooms to prepare, the ones with a new guest today first;
 *  · evening (21:00)  the evening report (AI), switchable in Automazioni.
 * The owner chooses the time of the morning and evening messages (on the hour or at half past) and
 * the days of the week, in Automazioni (settings.panel.reports).
 * After a restart a message is still sent if its time passed less than 3 hours ago (the report: 90 minutes).
 */
export const MORNING = 8 * 60;
export const REPORT = 21 * 60;
const WINDOW = 3 * 60;
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export type ReportSlot = { time: string; days: number[] };
/** When the morning and evening messages arrive (defaults: 08:00 and 21:00, every day). */
export function reportSchedule(db: DB): { morning: ReportSlot; evening: ReportSlot } {
  const r = db.settings.panel?.reports ?? {};
  const slot = (x: ReportSlot | undefined, time: string): ReportSlot => ({ time: x && /^\d{2}:(00|30)$/.test(x.time) ? x.time : time, days: x?.days?.length ? x.days : ALL_DAYS });
  return { morning: slot(r.morning, '08:00'), evening: slot(r.evening, '21:00') };
}
/** 1 = Monday … 7 = Sunday, for an ISO day. */
export const isoWeekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

function clock(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: HOTEL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now).split(':').map(Number);
  return { date: todayISO(now), minutes: h! * 60 + m! };
}
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 10) * 60 + (m ?? 0);
};
const due = (now: number, at: number, window = WINDOW) => now >= at && now < at + window;

/** Already sent today? Test notifications from the panel do not count. */
export function sentToday(db: DB, type: NotificationType, date: string): boolean {
  return db.notifications.some((n) => n.type === type && todayISO(new Date(n.createdAt)) === date && n.title !== 'Notifica di prova');
}

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const who = (b: Booking) => `${b.guest.firstName} ${b.guest.lastName}`.trim();

export function morningMessages(db: DB, date: string) {
  const room = (b: Booking) => (b.roomId ? `camera ${db.rooms.find((r) => r.id === b.roomId)?.number ?? '?'}` : 'camera da assegnare');
  const arr = arrivalsOn(db, date);
  const dep = departuresOn(db, date);
  const h = db.settings.hotel;
  return {
    arrivals: arr.length
      ? {
          title: `Arrivi di oggi · ${arr.length}`,
          body: `${arr.map((b) => `• ${who(b)} · ${room(b)} · ${ospiti(b.adults + b.children)} · ${notti(diffDays(b.checkIn, b.checkOut))}${b.total - b.amountPaid > 0.009 ? ` · da saldare ${eur(b.total - b.amountPaid)}` : ' · già saldato'}`).join('\n')}\nCheck-in dalle ${h.checkInFrom}.`,
        }
      : null,
    departures: dep.length
      ? {
          title: `Partenze di oggi · ${dep.length}`,
          body: `${dep.map((b) => `• ${who(b)} · ${room(b)}${b.total - b.amountPaid > 0.009 ? ` · da incassare ${eur(b.total - b.amountPaid)}` : ''}`).join('\n')}\nCheck-out entro le ${h.checkOutBy}.`,
        }
      : null,
  };
}

export function roomsToPrepare(db: DB, date: string) {
  const dep = departuresOn(db, date).filter((b) => b.roomId);
  if (!dep.length) return null;
  const arriving = new Set(arrivalsOn(db, date).map((b) => b.roomId));
  const list = dep
    .map((b) => db.rooms.find((r) => r.id === b.roomId))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => Number(arriving.has(b.id)) - Number(arriving.has(a.id)) || a.number.localeCompare(b.number));
  return {
    title: `Camere da preparare · ${list.length}`,
    body: `${list.map((r) => `• ${r.number} ${r.name}${arriving.has(r.id) ? ` — arriva un ospite oggi dalle ${db.settings.hotel.checkInFrom}: prima questa` : ''}`).join('\n')}`,
  };
}

/** The evening report now (also used by "Ricevilo ora" in the panel). */
export async function sendDailyReport(date = todayISO()): Promise<{ title: string; ai: boolean }> {
  const r = await composeReport(dayFacts(readDb(), date));
  mutate((db) => {
    notify(db, 'report_giornaliero', r.title, r.text, '/admin');
  });
  return { title: r.title, ai: r.ai };
}

let running = false;
export async function dailyTick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { date, minutes } = clock(now);
    const db = readDb();
    const plan = reportSchedule(db);
    const wd = isoWeekday(date);
    if (plan.morning.days.includes(wd) && due(minutes, toMinutes(plan.morning.time))) {
      const m = morningMessages(db, date);
      mutate((d) => {
        if (m.arrivals && !sentToday(d, 'nuovo_arrivo', date)) notify(d, 'nuovo_arrivo', m.arrivals.title, m.arrivals.body, '/admin');
        if (m.departures && !sentToday(d, 'partenza_oggi', date)) notify(d, 'partenza_oggi', m.departures.title, m.departures.body, '/admin');
      });
    }
    if (due(minutes, toMinutes(db.settings.hotel.checkOutBy)) && !sentToday(db, 'camera_da_controllare', date)) {
      const r = roomsToPrepare(db, date);
      if (r) mutate((d) => void notify(d, 'camera_da_controllare', r.title, r.body, '/admin/disponibilita'));
    }
    // the report costs an AI call: only when it is switched on and not sent yet
    // a report arriving late at night after a restart would be odd: only within 90 minutes of the chosen time
    // (22:30 with the default 21:00; a time close to midnight stops at midnight, a new day starts)
    if (plan.evening.days.includes(wd) && due(minutes, toMinutes(plan.evening.time), 90) && db.settings.notifications.report_giornaliero !== false && !sentToday(db, 'report_giornaliero', date)) await sendDailyReport(date);
  } catch (e) {
    console.error('[giornata]', (e as Error).message);
  } finally {
    running = false;
  }
}

const g = globalThis as typeof globalThis & { __laDailyTimer?: ReturnType<typeof setInterval> };
export function startDailyJobs() {
  if (g.__laDailyTimer) return;
  g.__laDailyTimer = setInterval(() => void dailyTick(), 60_000);
  g.__laDailyTimer.unref?.();
  setTimeout(() => void dailyTick(), 15_000).unref?.();
}
