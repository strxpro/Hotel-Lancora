import 'server-only';
import type { DB, Locale } from '@/lib/types';
import type { AvailabilityResponse, RoomCardData } from '@/lib/room-card';
import { searchAvailability, stayCashPercent, suggestAlternatives, type SearchQuery } from '@/lib/availability';
import { addDays, todayISO } from '@/lib/dates';
import { localizeRoom, publicRooms, type LocalizedRoom } from './rooms';
import { cashPercentFor, roomPayment } from '@/lib/cash';
import { roomRatings } from './reviews';
import { readDb } from './db/store';
import { onlinePeriods, onlineRoom } from '@/lib/online-price';

export function popularityMap(db: DB): Map<string, number> {
  const since = addDays(todayISO(), -365);
  const m = new Map<string, number>();
  for (const b of db.bookings) if (b.roomId && b.status !== 'cancelled' && b.checkIn >= since) m.set(b.roomId, (m.get(b.roomId) ?? 0) + 1);
  return m;
}

export function toCard(r: LocalizedRoom, popularity = 0, payments?: DB['settings']['payments'], rating: { avg: number; count: number } | null = null): RoomCardData {
  const settings = readDb().settings;
  // the prices the guests see (online increase on the card price, when it is on)
  const o = onlineRoom(r, settings);
  return {
    id: r.id,
    slug: r.slug,
    number: r.numberAuto ? '' : r.number,
    name: r.t.title || r.name,
    type: r.type,
    maxGuests: r.maxGuests,
    beds: r.beds,
    size: r.size,
    floor: r.floor,
    basePrice: o.basePrice,
    cashPrice: typeof o.cashPrice === 'number' ? o.cashPrice : null,
    // a room paid only by card shows no cash price
    cashPercent: payments && roomPayment(r, payments).cash ? cashPercentFor(o, payments) : 0,
    pay: payments ? roomPayment(r, payments) : { card: true, cash: false },
    amenities: r.amenities,
    photo: r.photos[0] ?? null,
    photos: r.photos.slice(0, 5),
    short: r.t.short,
    popularity,
    board: settings.pricing?.board ?? 'room_only',
    rating,
  };
}

export function publicCards(db: DB, locale: Locale): RoomCardData[] {
  const pop = popularityMap(db);
  const rat = roomRatings(db);
  return publicRooms(db, locale).map((r) => toCard(r, pop.get(r.id) ?? 0, db.settings.payments, rat.get(r.id) ?? null));
}

export function availability(db: DB, q: SearchQuery, locale: Locale): AvailabilityResponse {
  const now = new Date();
  const pop = popularityMap(db);
  const rat = roomRatings(db);
  const results = searchAvailability(db, q, now)
    .filter((r) => r.available)
    .map((r) => ({
      room: toCard(localizeRoom(r.room, locale), pop.get(r.room.id) ?? 0, db.settings.payments, rat.get(r.room.id) ?? null),
      available: r.available,
      nights: r.quote.nights,
      total: r.quote.total,
      averageNight: r.quote.averageNight,
      singleUse: r.quote.singleUse,
      cashPercent: roomPayment(r.room, db.settings.payments).cash ? stayCashPercent(onlineRoom(r.room, db.settings), q.checkIn, q.checkOut, onlinePeriods(db.ratePeriods, db.settings), db.settings.payments) : 0,
    }));
  return {
    query: q,
    results,
    count: results.length,
    alternatives: results.length ? [] : suggestAlternatives(db, q, now, todayISO()),
  };
}
