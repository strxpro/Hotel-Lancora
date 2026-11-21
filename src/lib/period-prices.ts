import type { RatePeriod, Room } from './types';
import { addMonths, eachNight, startOfMonth } from './dates';
import { nightlyRate } from './availability';

/**
 * Prices by period, the way the owner thinks about them: "in August room 101 costs 150 €".
 * A price set for some rooms in some dates replaces what those rooms had there before (older
 * per-room periods are cut around the new dates, so the list never fills with dead entries).
 * Hotel-wide variations ("all rooms +15%") are left alone.
 */

/** First day of `n` months starting with the month of `from` (YYYY-MM-01). */
export function monthStarts(from: string, n = 12): string[] {
  const first = startOfMonth(from);
  return Array.from({ length: n }, (_, i) => addMonths(first, i));
}

/** Months (first days) → the fewest date ranges [from, to): August + September = one range. */
export function monthRanges(months: string[]): { from: string; to: string }[] {
  const sorted = [...new Set(months.map(startOfMonth))].sort();
  const out: { from: string; to: string }[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && last.to === m) last.to = addMonths(m, 1);
    else out.push({ from: m, to: addMonths(m, 1) });
  }
  return out;
}

/**
 * Takes `roomIds` out of the per-room periods inside [from, to): the rest of each period stays,
 * in the same place of the list (later periods win, so the order matters).
 */
export function carveRooms(periods: RatePeriod[], roomIds: string[], from: string, to: string, newId: () => string): RatePeriod[] {
  const sel = new Set(roomIds);
  return periods.flatMap((p) => {
    if (p.roomIds === 'all' || p.to <= from || p.from >= to) return [p];
    const inside = p.roomIds.filter((id) => sel.has(id));
    if (!inside.length) return [p];
    const rest = p.roomIds.filter((id) => !sel.has(id));
    const out: RatePeriod[] = [];
    if (rest.length) out.push({ ...p, roomIds: rest });
    if (p.from < from) out.push({ ...p, id: out.length ? newId() : p.id, roomIds: inside, to: from });
    if (p.to > to) out.push({ ...p, id: out.length ? newId() : p.id, roomIds: inside, from: to });
    return out;
  });
}

export interface MonthPrice {
  /** first day of the month */
  m: string;
  min: number;
  max: number;
  /** the season's own cash price on the dearest night of the month (null = usual cash discount) */
  cash?: number | null;
}

/** The lowest and highest nightly price of a room in each month (from today on in the current month). */
export function monthPrices(room: Room, periods: RatePeriod[], today: string, n = 12): MonthPrice[] {
  return monthStarts(today, n).map((m) => {
    const start = m < today ? today : m;
    const rates = eachNight(start, addMonths(m, 1)).map((d) => nightlyRate(room, d, periods));
    const prices = rates.map((x) => x.price);
    const max = Math.max(...prices);
    return { m, min: Math.min(...prices), max, cash: rates.find((x) => x.price === max)?.cash ?? null };
  });
}

/**
 * The lowest price of a night in cash in the same months as monthPrices ("da 38 € in contanti" before
 * any date): a period's own cash price where there is one, otherwise the card price less `percent`.
 */
export function lowestCashNight(room: Room, periods: RatePeriod[], today: string, percent: number, n = 12): number {
  const months = monthStarts(today, n);
  let min = Infinity;
  for (const d of eachNight(today, addMonths(months[months.length - 1], 1))) {
    const r = nightlyRate(room, d, periods);
    const c = r.cash ?? r.price * (1 - percent / 100);
    if (c < min) min = c;
  }
  return Math.round((Number.isFinite(min) ? min : room.basePrice * (1 - percent / 100)) * 100) / 100;
}

/** Nights in the next `days` days whose price is not the base price (the room page calendar). */
export function priceExceptions(room: Room, periods: RatePeriod[], from: string, to: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!periods.length) return out;
  for (const d of eachNight(from, to)) {
    const p = nightlyRate(room, d, periods).price;
    if (p !== room.basePrice) out[d] = p;
  }
  return out;
}
