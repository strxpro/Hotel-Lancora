import type { Block, Booking, DB, Promotion, RatePeriod, Room } from './types';
import { addDays, diffDays, eachNight, rangesOverlap } from './dates';
import { cashPercentFor } from './cash';
import { onlinePeriods, onlineRoom } from './online-price';

/**
 * Night logic (shared by search, booking, planning, assistant):
 *  - the check-in date IS an occupied night
 *  - the check-out date is NOT an occupied night (next guest may arrive that day)
 *  - cancelled bookings and expired payment holds free the room
 */
export function isBookingActive(b: Booking, now: Date = new Date()): boolean {
  if (b.status === 'cancelled') return false;
  if (b.status === 'pending_payment' && b.holdExpiresAt && new Date(b.holdExpiresAt) <= now) return false;
  return true;
}

export function isPubliclyBookable(room: Room): boolean {
  return room.status === 'available' && !room.hidden;
}

export interface Conflict {
  kind: 'booking' | 'block';
  id: string;
  from: string;
  to: string;
  label: string;
}

export function roomConflicts(
  db: Pick<DB, 'bookings' | 'blocks'>,
  roomId: string,
  from: string,
  to: string,
  opts: { ignoreBookingId?: string; now?: Date } = {},
): Conflict[] {
  const out: Conflict[] = [];
  for (const b of db.bookings) {
    if (b.roomId !== roomId || b.id === opts.ignoreBookingId || !isBookingActive(b, opts.now)) continue;
    if (rangesOverlap(from, to, b.checkIn, b.checkOut)) out.push({ kind: 'booking', id: b.id, from: b.checkIn, to: b.checkOut, label: `${b.code} ${b.guest.lastName}` });
  }
  for (const k of db.blocks) {
    if (k.roomId !== roomId) continue;
    if (rangesOverlap(from, to, k.from, k.to)) out.push({ kind: 'block', id: k.id, from: k.from, to: k.to, label: k.reason });
  }
  return out;
}

export function isRoomFree(db: Pick<DB, 'bookings' | 'blocks'>, roomId: string, from: string, to: string, opts: { ignoreBookingId?: string; now?: Date } = {}): boolean {
  return roomConflicts(db, roomId, from, to, opts).length === 0;
}

/** A night's card price and, when the period has one, its own cash price (the last period that matches wins). */
export function nightlyRate(room: Room, date: string, periods: RatePeriod[]): { price: number; cash: number | null } {
  let price = room.basePrice;
  let cash: number | null = null;
  for (const p of periods) {
    if (date < p.from || date >= p.to) continue;
    if (p.roomIds !== 'all' && !p.roomIds.includes(room.id)) continue;
    price = p.mode === 'fixed' ? p.value : Math.round(room.basePrice * (1 + p.value / 100));
    cash = p.mode === 'fixed' && typeof p.cash === 'number' && p.cash > 0 && p.cash <= p.value ? p.cash : null;
  }
  return { price: Math.max(0, Math.round(price * 100) / 100), cash };
}

export function nightlyPrice(room: Room, date: string, periods: RatePeriod[]): number {
  return nightlyRate(room, date, periods).price;
}

/**
 * How much less a stay costs in cash, in percent of the card price: nights of a period with its own
 * cash price count at that price, the others at the room's usual cash discount. 0 when the hotel
 * does not take cash. Not rounded, so card total × (1 − percent) gives the cash total to the cent.
 */
export function stayCashPercent(room: Room, checkIn: string, checkOut: string, periods: RatePeriod[], payments: { allowCashAtHotel: boolean; cashDiscountPercent: number }): number {
  if (!payments.allowCashAtHotel) return 0;
  // the room's own cash price as an exact percent (cashPercentFor rounds it for display): the cash
  // total of the stay comes out to the cent
  const ownCash = typeof room.cashPrice === 'number' && room.cashPrice > 0 && room.cashPrice < room.basePrice && room.basePrice > 0;
  const base = ownCash ? (1 - room.cashPrice! / room.basePrice) * 100 : cashPercentFor(room, payments);
  let card = 0;
  let cash = 0;
  let own = false;
  for (const d of eachNight(checkIn, checkOut)) {
    const r = nightlyRate(room, d, periods);
    card += r.price;
    if (r.cash !== null) {
      cash += r.cash;
      own = true;
    } else cash += r.price * (1 - base / 100);
  }
  if (!own || card <= 0) return base;
  return Math.max(0, (1 - cash / card) * 100);
}

export interface StayQuote {
  nights: number;
  perNight: { date: string; price: number }[];
  subtotal: number;
  discount: number;
  total: number;
  averageNight: number;
  promo: Promotion | null;
  /** percent taken off because one guest uses a double / twin room ("uso singola"), 0 when not applied */
  singleUse: number;
}

/** One guest in a double or twin room pays less ("uso singola"). */
export function singleUsePercent(room: Pick<Room, 'type' | 'maxGuests'>, guests: number | undefined, percent: number | undefined): number {
  if (guests !== 1 || !percent || percent <= 0) return 0;
  return room.maxGuests >= 2 && (room.type === 'matrimoniale' || room.type === 'doppia') ? Math.min(90, percent) : 0;
}

export function quoteStay(room: Room, checkIn: string, checkOut: string, periods: RatePeriod[], promo?: Promotion | null, opts?: { guests?: number; singleUsePercent?: number }): StayQuote {
  const su = singleUsePercent(room, opts?.guests, opts?.singleUsePercent);
  const perNight = eachNight(checkIn, checkOut).map((date) => ({ date, price: round2(nightlyPrice(room, date, periods) * (1 - su / 100)) }));
  const subtotal = round2(perNight.reduce((s, n) => s + n.price, 0));
  const validPromo = promo && promoApplies(promo, checkIn, perNight.length) ? promo : null;
  const discount = validPromo ? round2((subtotal * validPromo.percent) / 100) : 0;
  const total = round2(subtotal - discount);
  return { nights: perNight.length, perNight, subtotal, discount, total, averageNight: perNight.length ? round2(subtotal / perNight.length) : room.basePrice, promo: validPromo, singleUse: su };
}

export function promoApplies(p: Promotion, checkIn: string, nights: number): boolean {
  return p.active && checkIn >= p.validFrom && checkIn <= p.validTo && nights >= p.minNights;
}

export function findPromo(db: Pick<DB, 'promotions'>, code: string | null | undefined): Promotion | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  return db.promotions.find((p) => p.code.toUpperCase() === c) ?? null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface SearchQuery {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

export interface SearchResult {
  room: Room;
  available: boolean;
  quote: StayQuote;
}

/**
 * Public availability search.
 * Unassigned OTA bookings ("da assegnare") still consume inventory: each one reserves the
 * smallest compatible free room so the website cannot oversell the hotel.
 */
export function searchAvailability(db: DB, q: SearchQuery, now: Date = new Date()): SearchResult[] {
  const guests = q.adults + q.children;
  const rooms = db.rooms.filter(isPubliclyBookable).sort((a, b) => a.sortOrder - b.sortOrder);
  const free = new Set(rooms.filter((r) => isRoomFree(db, r.id, q.checkIn, q.checkOut, { now })).map((r) => r.id));

  const unassigned = db.bookings.filter((b) => !b.roomId && isBookingActive(b, now) && rangesOverlap(q.checkIn, q.checkOut, b.checkIn, b.checkOut));
  for (const b of unassigned) {
    const need = b.adults + b.children;
    const candidate = rooms.filter((r) => free.has(r.id) && r.maxGuests >= need).sort((a, b2) => a.maxGuests - b2.maxGuests || a.basePrice - b2.basePrice)[0];
    if (candidate) free.delete(candidate.id);
  }

  return rooms
    .filter((r) => r.maxGuests >= guests)
    .map((room) => ({ room, available: free.has(room.id), quote: quoteStay(onlineRoom(room, db.settings), q.checkIn, q.checkOut, onlinePeriods(db.ratePeriods, db.settings), null, { guests, singleUsePercent: db.settings.pricing?.singleUsePercent }) }));
}

/** Suggest nearby date windows with at least one free room for the guests. */
export function suggestAlternatives(db: DB, q: SearchQuery, now: Date = new Date(), today?: string): { checkIn: string; checkOut: string; count: number; from: number }[] {
  const nights = diffDays(q.checkIn, q.checkOut);
  const out: { checkIn: string; checkOut: string; count: number; from: number }[] = [];
  const tryStay = (checkIn: string, checkOut: string) => {
    if ((today && checkIn < today) || out.some((o) => o.checkIn === checkIn && o.checkOut === checkOut)) return;
    const res = searchAvailability(db, { ...q, checkIn, checkOut }, now).filter((r) => r.available);
    if (res.length) out.push({ checkIn, checkOut, count: res.length, from: Math.min(...res.map((r) => r.quote.averageNight)) });
  };
  // the same nights a few days earlier or later (nearest first), up to three weeks away
  for (const shift of [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 7, -7, 10, 14, 21]) {
    tryStay(addDays(q.checkIn, shift), addDays(q.checkIn, shift + nights));
    if (out.length >= 3) break;
  }
  // or a shorter stay on the same arrival day (the last nights are the busy ones)
  for (let n = nights - 1; n >= 1 && out.length < 4; n--) {
    const before = out.length;
    tryStay(q.checkIn, addDays(q.checkIn, n));
    if (out.length > before) break;
  }
  return out.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || b.checkOut.localeCompare(a.checkOut));
}

/** Occupied nights of a room in a window — used by the room page calendar. */
export function occupiedNights(db: DB, roomId: string, from: string, to: string, now: Date = new Date()): string[] {
  const set = new Set<string>();
  for (const b of db.bookings) {
    if (b.roomId !== roomId || !isBookingActive(b, now)) continue;
    for (const d of eachNight(b.checkIn, b.checkOut)) if (d >= from && d < to) set.add(d);
  }
  for (const k of db.blocks as Block[]) {
    if (k.roomId !== roomId) continue;
    for (const d of eachNight(k.from, k.to)) if (d >= from && d < to) set.add(d);
  }
  return [...set].sort();
}

export function amountDueNow(total: number, s: DB['settings']['payments']): number {
  if (s.mode === 'full') return round2(total);
  if (s.mode === 'deposit_percent') return round2(Math.min(total, (total * s.depositPercent) / 100));
  return round2(Math.min(total, s.depositFixed));
}
