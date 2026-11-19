/**
 * Date helpers. All calendar dates are ISO strings "YYYY-MM-DD" interpreted in the hotel's
 * time zone (Europe/Rome). Arithmetic is done in UTC to avoid DST drift.
 */
export const HOTEL_TZ = 'Europe/Rome';

export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: HOTEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function diffDays(fromISO: string, toISO_: string): number {
  return Math.round((parseISO(toISO_).getTime() - parseISO(fromISO).getTime()) / 86400000);
}

export function isValidISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return !Number.isNaN(d.getTime()) && toISO(d) === s;
}

/** Nights of a stay: check-in is occupied, check-out is not. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Half-open interval overlap [aStart, aEnd) ∩ [bStart, bEnd) */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + '01';
}

export function addMonths(iso: string, n: number): string {
  const d = parseISO(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return toISO(d);
}

export function daysInMonth(iso: string): number {
  const d = parseISO(startOfMonth(iso));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function monthDays(iso: string): string[] {
  const start = startOfMonth(iso);
  return Array.from({ length: daysInMonth(start) }, (_, i) => addDays(start, i));
}

/** 0 = Monday … 6 = Sunday */
export function weekdayMon(iso: string): number {
  return (parseISO(iso).getUTCDay() + 6) % 7;
}

export function isWeekend(iso: string): boolean {
  const w = weekdayMon(iso);
  return w === 5 || w === 6;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayMon(iso));
}

export function fmtDate(iso: string, locale = 'it', opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: 'UTC', ...opts }).format(parseISO(iso));
}

export function fmtDateLong(iso: string, locale = 'it'): string {
  return fmtDate(iso, locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

export function monthName(iso: string, locale = 'it', withYear = true): string {
  const s = fmtDate(iso, locale, withYear ? { month: 'long', year: 'numeric' } : { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function weekdayShortNames(locale = 'it'): string[] {
  // 2024-01-01 is a Monday
  return Array.from({ length: 7 }, (_, i) => {
    const s = fmtDate(addDays('2024-01-01', i), locale, { weekday: 'short' }).replace('.', '');
    return s.charAt(0).toUpperCase() + s.slice(1, 3);
  });
}

export function intlLocale(locale: string): string {
  const map: Record<string, string> = { it: 'it-IT', en: 'en-GB', pl: 'pl-PL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' };
  return map[locale] ?? locale;
}

export function fmtDateTime(isoDateTime: string, locale = 'it'): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: HOTEL_TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoDateTime));
}
