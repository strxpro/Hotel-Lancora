import { addDays, addMonths, diffDays, isValidISODate, startOfMonth, startOfWeek, weekdayMon } from '@/lib/dates';

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const WEEKDAYS = ['lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato', 'domenica'];
const MONTH_RX = MONTHS.join('|');

export const normIt = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Build a date from day/month(/year); without a year pick the nearest sensible one. */
function dayMonth(day: number, month: number, year: number | null, today: string, prefer: 'future' | 'past' = 'future'): string | null {
  const y0 = Number(today.slice(0, 4));
  const make = (y: number) => `${y}-${pad(month)}-${pad(day)}`;
  if (year) {
    const iso = make(year < 100 ? 2000 + year : year);
    return isValidISODate(iso) ? iso : null;
  }
  let iso = make(y0);
  if (!isValidISODate(iso)) return null;
  if (prefer === 'future' && iso < addDays(today, -45)) iso = make(y0 + 1);
  if (prefer === 'past' && iso > addDays(today, 45)) iso = make(y0 - 1);
  return isValidISODate(iso) ? iso : null;
}

/** A single day: oggi, domani, sabato, il 12, 12 novembre, 12/11 … */
export function parseDay(text: string, today: string, prefer: 'future' | 'past' = 'future'): string | null {
  const t = normIt(text);
  if (/\bdopodomani\b/.test(t)) return addDays(today, 2);
  if (/\bdomani\b/.test(t)) return addDays(today, 1);
  if (/\bieri\b/.test(t)) return addDays(today, -1);
  if (/\b(oggi|stasera|stanotte)\b/.test(t)) return today;
  let m = t.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RX})(?:\\s+(\\d{4}))?`));
  if (m) return dayMonth(Number(m[1]), MONTHS.indexOf(m[2]!) + 1, m[3] ? Number(m[3]) : null, today, prefer);
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) return dayMonth(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, today, prefer);
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) {
      const diff = (i - weekdayMon(today) + 7) % 7;
      return addDays(today, diff);
    }
  }
  m = t.match(/\b(?:il|del|per il)\s+(\d{1,2})\b/);
  if (m) {
    const d = Number(m[1]);
    const thisMonth = `${today.slice(0, 8)}${pad(d)}`;
    if (isValidISODate(thisMonth)) return thisMonth >= today || prefer === 'past' ? thisMonth : addMonths(thisMonth, 1).slice(0, 8) + pad(d);
  }
  return null;
}

/**
 * Stay/block range. Hotel semantics: "dal 12 al 15" = arrival 12, the room is free again on 15
 * (nights 12, 13, 14). The confirmation message always spells this out.
 */
export function parseRange(text: string, today: string): { from: string; to: string } | null {
  const t = normIt(text);
  let m = t.match(new RegExp(`dal(?:l[a-z]*)?\\s+(\\d{1,2})(?:\\s+(${MONTH_RX}))?\\s+al(?:l[a-z]*)?\\s+(\\d{1,2})\\s+(${MONTH_RX})(?:\\s+(\\d{4}))?`));
  if (m) {
    const toMonth = MONTHS.indexOf(m[4]!) + 1;
    const fromMonth = m[2] ? MONTHS.indexOf(m[2]) + 1 : toMonth;
    const year = m[5] ? Number(m[5]) : null;
    const to = dayMonth(Number(m[3]), toMonth, year, today);
    let from = dayMonth(Number(m[1]), fromMonth, year, today);
    if (from && to && from > to) from = dayMonth(Number(m[1]), fromMonth, Number(to.slice(0, 4)) - 1, today);
    return from && to && to > from ? { from, to } : null;
  }
  m = t.match(/dal(?:l[a-z]*)?\s+(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\s+al(?:l[a-z]*)?\s+(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    const from = dayMonth(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, today);
    const to = dayMonth(Number(m[4]), Number(m[5]), m[6] ? Number(m[6]) : null, today);
    return from && to && to > from ? { from, to } : null;
  }
  m = t.match(new RegExp(`\\b(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s+(${MONTH_RX})`));
  if (m) {
    const month = MONTHS.indexOf(m[3]!) + 1;
    const from = dayMonth(Number(m[1]), month, null, today);
    const to = dayMonth(Number(m[2]), month, null, today);
    return from && to && to > from ? { from, to } : null;
  }
  m = t.match(/per\s+(\d{1,2})\s+nott/);
  const start = parseDay(text, today);
  if (m && start) return { from: start, to: addDays(start, Number(m[1])) };
  return null;
}

/** Reporting period: oggi, questa settimana, mese scorso, dicembre, ultimi 30 giorni … */
export function parsePeriod(text: string, today: string, prefer: 'past' | 'future' = 'past'): { from: string; to: string; label: string } | null {
  const t = normIt(text);
  const monthStart = startOfMonth(today);
  if (/\boggi\b/.test(t)) return { from: today, to: addDays(today, 1), label: 'oggi' };
  if (/\bieri\b/.test(t)) return { from: addDays(today, -1), to: today, label: 'ieri' };
  if (/settimana scorsa|scorsa settimana/.test(t)) {
    const s = addDays(startOfWeek(today), -7);
    return { from: s, to: addDays(s, 7), label: 'la settimana scorsa' };
  }
  if (/(questa|in) settimana/.test(t)) {
    const s = startOfWeek(today);
    return { from: s, to: addDays(s, 7), label: 'questa settimana' };
  }
  if (/prossima settimana|settimana prossima/.test(t)) {
    const s = addDays(startOfWeek(today), 7);
    return { from: s, to: addDays(s, 7), label: 'la prossima settimana' };
  }
  const last = t.match(/ultim[ie]\s+(\d{1,3})\s+giorn/);
  if (last) return { from: addDays(today, -Number(last[1]) + 1), to: addDays(today, 1), label: `gli ultimi ${last[1]} giorni` };
  if (/mese scorso|scorso mese/.test(t)) {
    const s = addMonths(monthStart, -1);
    return { from: s, to: monthStart, label: 'il mese scorso' };
  }
  if (/mese prossimo|prossimo mese/.test(t)) {
    const s = addMonths(monthStart, 1);
    return { from: s, to: addMonths(s, 1), label: 'il mese prossimo' };
  }
  if (/questo mese|(nel|il) mese\b/.test(t)) return { from: monthStart, to: addMonths(monthStart, 1), label: 'questo mese' };
  if (/quest\s?anno/.test(t)) return { from: `${today.slice(0, 4)}-01-01`, to: `${Number(today.slice(0, 4)) + 1}-01-01`, label: 'quest’anno' };
  const m = t.match(new RegExp(`\\b(${MONTH_RX})(?:\\s+(\\d{4}))?\\b`));
  if (m) {
    const month = MONTHS.indexOf(m[1]!) + 1;
    let year = m[2] ? Number(m[2]) : Number(today.slice(0, 4));
    const cur = Number(today.slice(5, 7));
    if (!m[2]) {
      if (prefer === 'past' && month > cur) year -= 1;
      if (prefer === 'future' && month < cur) year += 1;
    }
    const s = `${year}-${pad(month)}-01`;
    return { from: s, to: addMonths(s, 1), label: `${m[1]} ${year}` };
  }
  return null;
}

export function nightsLabel(from: string, to: string): string {
  const n = diffDays(from, to);
  return `${n} ${n === 1 ? 'notte' : 'notti'}`;
}

/**
 * Whole months named in the text ("ad agosto", "luglio e agosto", "settembre 2027") as date ranges
 * [from, to), next months first: a month already gone this year means next year's.
 */
export function parseMonthRanges(text: string, today: string): { from: string; to: string }[] {
  const t = normIt(text);
  const cur = Number(today.slice(5, 7));
  const starts: string[] = [];
  for (const m of t.matchAll(new RegExp(`\\b(${MONTH_RX})(?:\\s+(\\d{4}))?\\b`, 'g'))) {
    const month = MONTHS.indexOf(m[1]!) + 1;
    const year = m[2] ? Number(m[2]) : Number(today.slice(0, 4)) + (month < cur ? 1 : 0);
    starts.push(`${year}-${pad(month)}-01`);
  }
  if (!starts.length) {
    if (/questo mese/.test(t)) starts.push(startOfMonth(today));
    if (/mese prossimo|prossimo mese/.test(t)) starts.push(addMonths(startOfMonth(today), 1));
  }
  const out: { from: string; to: string }[] = [];
  for (const s of [...new Set(starts)].sort()) {
    const last = out[out.length - 1];
    if (last && last.to === s) last.to = addMonths(s, 1);
    else out.push({ from: s, to: addMonths(s, 1) });
  }
  return out;
}
