import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { isLocale } from '@/lib/i18n/config';
import type { Locale } from '@/lib/types';
import { REVIEWS_T } from '@/lib/i18n/reviews-dict';
import { readDb } from '@/server/db/store';
import { findBookingByToken } from '@/server/bookings';
import { localizeRoom } from '@/server/rooms';
import { ReviewForm } from '@/components/site/reviews/reviews-ui';

export const metadata: Metadata = { title: 'Recensione', robots: { index: false, follow: false } };

/** "Rate your room" page opened from the post-stay email: the review is verified. */
export default async function ReviewPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale: raw, token } = await params;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const t = REVIEWS_T[locale];
  const b = findBookingByToken(token);
  if (!b || b.status === 'cancelled') notFound();
  const db = readDb();
  const r = db.rooms.find((x) => x.id === b.roomId);
  const room = r ? localizeRoom(r, locale) : null;
  const done = db.feedback.some((f) => f.bookingId === b.id && f.verified);
  return (
    <div className="bg-ivory pb-24 pt-28 md:pt-36">
      <div className="container-x grid max-w-5xl gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          {room?.photos[0] && (
            <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] bg-sand">
              <Image src={room.photos[0].src} alt={room.photos[0].alt} fill sizes="(min-width:1024px) 40vw, 100vw" className="object-cover" priority />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-3/85 to-transparent p-6 text-ivory">
                <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-gold">
                  {t.room} {room.number}
                </p>
                <p className="serif mt-1 text-[2rem] leading-tight">{room.t.title}</p>
              </div>
            </div>
          )}
        </div>
        <div className="lg:col-span-7">
          <p className="eyebrow text-gold-2">{b.guest.firstName}</p>
          <h1 className="display mt-4 text-[clamp(2.4rem,5vw,4rem)] text-navy">{t.pageTitle}</h1>
          <p className="mt-3 max-w-md text-mist">{t.pageIntro}</p>
          <div className="mt-8 rounded-[2rem] bg-white p-5 ring-1 ring-line md:p-8">{done ? <p className="text-navy">{t.already}</p> : <ReviewForm token={token} />}</div>
        </div>
      </div>
    </div>
  );
}
