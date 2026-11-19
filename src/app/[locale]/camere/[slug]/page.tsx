import type { Metadata } from 'next';
import { cancelText } from '@/lib/cancellation';
import { notFound } from 'next/navigation';
import { cashPercentFor, roomPayment } from '@/lib/cash';
import { priceExceptions } from '@/lib/period-prices';
import { onlinePeriods, onlineRoom } from '@/lib/online-price';
import { publicReviews } from '@/server/reviews';
import { isLocale } from '@/lib/i18n/config';
import type { Locale } from '@/lib/types';
import { addDays, todayISO } from '@/lib/dates';
import { occupiedNights } from '@/lib/availability';
import { readDb } from '@/server/db/store';
import { findPublicRoom, publicRooms } from '@/server/rooms';
import { toCard } from '@/server/public-data';
import { alternates } from '@/server/seo';
import { RoomDetail } from '@/components/site/rooms/room-detail';
import { queryFromParams } from '@/components/site/booking/query';

type Props = { params: Promise<{ locale: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const l = (isLocale(locale) ? locale : 'it') as Locale;
  const room = findPublicRoom(slug, l);
  if (!room) return {};
  return { title: room.t.title, description: room.t.short, alternates: alternates(l, `/camere/${slug}`), openGraph: { images: room.photos[0] ? [{ url: room.photos[0].src }] : [] } };
}

export default async function RoomPage({ params, searchParams }: Props) {
  const { locale: raw, slug } = await params;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const room = findPublicRoom(slug, locale);
  if (!room) notFound();
  const db = readDb();
  const today = todayISO();
  const q = queryFromParams(await searchParams, today);
  const similar = publicRooms(db, locale)
    .filter((r) => r.id !== room.id)
    .sort((a, b) => Math.abs(a.maxGuests - room.maxGuests) - Math.abs(b.maxGuests - room.maxGuests) || Math.abs(a.basePrice - room.basePrice) - Math.abs(b.basePrice - room.basePrice))
    .slice(0, 3)
    .map((r) => toCard(r, 0, db.settings.payments));
  const h = db.settings.hotel;
  const pay = roomPayment(room, db.settings.payments);
  // the prices the guests see (online increase on the card price, when it is on)
  const priced = onlineRoom(room, db.settings);
  return (
    <RoomDetail
      room={{ id: room.id, slug: room.slug, number: '', title: room.t.title, type: room.type, maxGuests: room.maxGuests, beds: room.beds, size: room.size, floor: room.floor, basePrice: priced.basePrice, cashPercent: pay.cash ? cashPercentFor(priced, db.settings.payments) : 0, cardOk: pay.card, amenities: room.amenities, photos: room.photos, short: room.t.short, description: room.t.description }}
      nightly={priceExceptions(priced, onlinePeriods(db.ratePeriods, db.settings), today, addDays(today, 400))}
      occupied={room.status === 'available' ? occupiedNights(db, room.id, today, addDays(today, 400)) : []}
      similar={similar}
      today={today}
      initialQuery={q}
      reviews={publicReviews(db, locale, room.id)}
      policies={{ checkInFrom: h.checkInFrom, checkInTo: h.checkInTo, checkOutBy: h.checkOutBy, cancellation: [cancelText(locale, db.settings.payments), db.settings.payments.cancellationPolicy].filter(Boolean).join(' ') }}
    />
  );
}
