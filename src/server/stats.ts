import type { Booking, BookingSource, DB } from '@/lib/types';
import { isBookingActive, round2 } from '@/lib/availability';
import { addDays, diffDays, eachNight, rangesOverlap, todayISO } from '@/lib/dates';

export const DIRECT_SOURCES: BookingSource[] = ['sito', 'telefono', 'email', 'walkin'];

const sellableRooms = (db: DB) => db.rooms.filter((r) => r.status !== 'draft');

export function nightRevenue(b: Booking): number {
  const n = diffDays(b.checkIn, b.checkOut);
  return n > 0 ? b.total / n : 0;
}

export function inHouseOn(db: DB, date: string, now = new Date()): Booking[] {
  return db.bookings.filter((b) => b.roomId && isBookingActive(b, now) && b.checkIn <= date && b.checkOut > date);
}

export function arrivalsOn(db: DB, date: string, now = new Date()): Booking[] {
  return db.bookings.filter((b) => isBookingActive(b, now) && b.checkIn === date).sort((a, b) => (a.roomId ?? '').localeCompare(b.roomId ?? ''));
}

export function departuresOn(db: DB, date: string, now = new Date()): Booking[] {
  return db.bookings.filter((b) => isBookingActive(b, now) && b.checkOut === date);
}

export function blockedOn(db: DB, date: string): Set<string> {
  return new Set(db.blocks.filter((k) => k.from <= date && k.to > date).map((k) => k.roomId));
}

export function freeRoomsOn(db: DB, date: string, now = new Date()) {
  const occ = new Set(inHouseOn(db, date, now).map((b) => b.roomId));
  const blocked = blockedOn(db, date);
  return db.rooms.filter((r) => r.status === 'available' && !occ.has(r.id) && !blocked.has(r.id)).sort((a, b) => a.number.localeCompare(b.number));
}

export function paymentsBetween(db: DB, from: string, to: string): number {
  return round2(db.payments.filter((p) => p.status === 'succeeded' && p.createdAt.slice(0, 10) >= from && p.createdAt.slice(0, 10) < to).reduce((s, p) => s + p.amount, 0));
}

export function dashboardStats(db: DB, today = todayISO(), now = new Date()) {
  const monthStart = today.slice(0, 8) + '01';
  const nextMonth = addDays(monthStart, 32).slice(0, 8) + '01';
  const sellable = sellableRooms(db).filter((r) => r.status === 'available');
  const occupied = new Set(inHouseOn(db, today, now).map((b) => b.roomId)).size;
  const blocked = blockedOn(db, today).size;
  const createdThisMonth = db.bookings.filter((b) => b.createdAt.slice(0, 10) >= monthStart && b.status !== 'cancelled');
  const direct = createdThisMonth.filter((b) => DIRECT_SOURCES.includes(b.source)).length;
  return {
    bookingsToday: db.bookings.filter((b) => b.createdAt.slice(0, 10) === today && b.status !== 'cancelled').length,
    arrivals: arrivalsOn(db, today, now).length,
    departures: departuresOn(db, today, now).length,
    occupied,
    available: Math.max(0, sellable.length - occupied - blocked),
    revenueMonth: paymentsBetween(db, monthStart, nextMonth),
    occupancyRate: sellable.length ? Math.round((occupied / sellable.length) * 100) : 0,
    directBookings: direct,
    directShare: createdThisMonth.length ? Math.round((direct / createdThisMonth.length) * 100) : 0,
    unassigned: db.bookings.filter((b) => !b.roomId && isBookingActive(b, now) && b.checkOut > today).length,
    pendingPayments: db.bookings.filter((b) => b.status === 'pending_payment' && isBookingActive(b, now)).length,
  };
}

export interface RangeStats {
  from: string;
  to: string;
  bookings: number;
  cancelled: number;
  revenue: number;
  received: number;
  occupancy: number;
  roomNights: number;
  adr: number;
  sources: { source: BookingSource; count: number; revenue: number }[];
  direct: number;
  directShare: number;
  topRooms: { roomId: string; number: string; name: string; nights: number; revenue: number }[];
  daily: { date: string; revenue: number; occupied: number; rate: number }[];
}

/** Revenue is accrual-based: each night of a stay contributes total/nights on that date. */
export function rangeStats(db: DB, from: string, to: string, now = new Date()): RangeStats {
  const rooms = sellableRooms(db);
  const days = eachNight(from, to);
  const daily = new Map(days.map((d) => [d, { date: d, revenue: 0, occupied: 0, rate: 0 }]));
  const perRoom = new Map<string, { nights: number; revenue: number }>();
  let revenue = 0;
  let roomNights = 0;
  for (const b of db.bookings) {
    if (!isBookingActive(b, now) || b.status === 'pending_payment') continue;
    if (!rangesOverlap(from, to, b.checkIn, b.checkOut)) continue;
    const nr = nightRevenue(b);
    for (const d of eachNight(b.checkIn, b.checkOut)) {
      const day = daily.get(d);
      if (!day) continue;
      day.revenue += nr;
      revenue += nr;
      if (b.roomId) {
        day.occupied += 1;
        roomNights += 1;
        const pr = perRoom.get(b.roomId) ?? { nights: 0, revenue: 0 };
        pr.nights += 1;
        pr.revenue += nr;
        perRoom.set(b.roomId, pr);
      }
    }
  }
  for (const d of daily.values()) {
    d.revenue = round2(d.revenue);
    d.rate = rooms.length ? Math.round((d.occupied / rooms.length) * 100) : 0;
  }
  const created = db.bookings.filter((b) => b.createdAt.slice(0, 10) >= from && b.createdAt.slice(0, 10) < to);
  const valid = created.filter((b) => b.status !== 'cancelled');
  const srcMap = new Map<BookingSource, { count: number; revenue: number }>();
  for (const b of valid) {
    const s = srcMap.get(b.source) ?? { count: 0, revenue: 0 };
    s.count += 1;
    s.revenue += b.total;
    srcMap.set(b.source, s);
  }
  const direct = valid.filter((b) => DIRECT_SOURCES.includes(b.source)).length;
  const capacity = rooms.length * days.length;
  return {
    from,
    to,
    bookings: valid.length,
    cancelled: created.length - valid.length,
    revenue: round2(revenue),
    received: paymentsBetween(db, from, to),
    occupancy: capacity ? Math.round((roomNights / capacity) * 100) : 0,
    roomNights,
    adr: roomNights ? round2(revenue / roomNights) : 0,
    sources: [...srcMap.entries()].map(([source, v]) => ({ source, count: v.count, revenue: round2(v.revenue) })).sort((a, b) => b.count - a.count),
    direct,
    directShare: valid.length ? Math.round((direct / valid.length) * 100) : 0,
    topRooms: [...perRoom.entries()]
      .map(([roomId, v]) => {
        const r = db.rooms.find((x) => x.id === roomId);
        return { roomId, number: r?.number ?? '?', name: r?.name ?? '', nights: v.nights, revenue: round2(v.revenue) };
      })
      .sort((a, b) => b.nights - a.nights)
      .slice(0, 6),
    daily: [...daily.values()],
  };
}

export function periodRange(key: string, today = todayISO()): { from: string; to: string; label: string } {
  const monthStart = today.slice(0, 8) + '01';
  switch (key) {
    case 'oggi':
      return { from: today, to: addDays(today, 1), label: 'Oggi' };
    case '7g':
      return { from: addDays(today, -6), to: addDays(today, 1), label: 'Ultimi 7 giorni' };
    case '30g':
      return { from: addDays(today, -29), to: addDays(today, 1), label: 'Ultimi 30 giorni' };
    case 'mese-scorso': {
      const prev = addDays(monthStart, -1).slice(0, 8) + '01';
      return { from: prev, to: monthStart, label: 'Mese scorso' };
    }
    case 'mese':
    default: {
      const next = addDays(monthStart, 32).slice(0, 8) + '01';
      return { from: monthStart, to: next, label: 'Questo mese' };
    }
  }
}
