import { NextResponse } from 'next/server';
import { readDb } from '@/server/db/store';
import { amountDueNow, findPromo, isPubliclyBookable, quoteStay, roomConflicts, stayCashPercent } from '@/lib/availability';
import { roomPayment } from '@/lib/cash';
import { touristTaxFor } from '@/lib/tourist-tax';
import { onlinePeriods, onlineRoom } from '@/lib/online-price';
import { diffDays, isValidISODate, todayISO } from '@/lib/dates';
import { ipOf, rateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Price + availability of one room for one stay (room page, booking summary). */
export async function GET(req: Request) {
  const ip = ipOf(req.headers);
  if (!rateLimit(`quote:${ip}`, 120, 60_000)) return NextResponse.json({ error: 'Troppe richieste' }, { status: 429 });
  const sp = new URL(req.url).searchParams;
  const db = readDb();
  const room = db.rooms.find((r) => r.slug === sp.get('room') || r.id === sp.get('room'));
  if (!room || !isPubliclyBookable(room)) return NextResponse.json({ error: 'Camera non trovata' }, { status: 404 });
  const checkIn = sp.get('checkIn') ?? '';
  const checkOut = sp.get('checkOut') ?? '';
  if (!isValidISODate(checkIn) || !isValidISODate(checkOut) || checkOut <= checkIn || checkIn < todayISO() || diffDays(checkIn, checkOut) > 30) {
    return NextResponse.json({ error: 'Date non valide' }, { status: 400 });
  }
  const guests = (Number(sp.get('adults')) || 1) + (Number(sp.get('children')) || 0);
  const promo = findPromo(db, sp.get('promo'));
  // the prices the guests see (online increase on the card price, when it is on)
  const priced = onlineRoom(room, db.settings);
  const periods = onlinePeriods(db.ratePeriods, db.settings);
  const quote = quoteStay(priced, checkIn, checkOut, periods, promo, { guests, singleUsePercent: db.settings.pricing?.singleUsePercent });
  const conflicts = roomConflicts(db, room.id, checkIn, checkOut);
  const reason = guests > room.maxGuests ? 'capacity' : conflicts.length ? 'occupied' : null;
  return NextResponse.json(
    {
      available: !reason,
      reason,
      quote,
      promoValid: Boolean(quote.promo),
      promoRequested: Boolean(sp.get('promo')),
      dueNow: amountDueNow(quote.total, db.settings.payments),
      // cash discount of these nights (the hotel's own cash prices of the season, when set)
      cashPercent: roomPayment(room, db.settings.payments).cash ? stayCashPercent(priced, checkIn, checkOut, periods, db.settings.payments) : 0,
      // the town's tax, paid at the hotel (not in the total)
      touristTax: touristTaxFor(db.settings.pricing?.touristTax, checkIn, checkOut, Number(sp.get('adults')) || 1),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
