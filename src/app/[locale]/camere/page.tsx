import type { Metadata } from 'next';
import Image from 'next/image';
import { isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/types';
import { todayISO } from '@/lib/dates';
import { readDb } from '@/server/db/store';
import { availability, publicCards } from '@/server/public-data';
import { alternates } from '@/server/seo';
import { MEDIA } from '@/content/media';
import { RoomsExplorer } from '@/components/site/rooms/rooms-explorer';
import { queryFromParams } from '@/components/site/booking/query';
import { ReviewsSection } from '@/components/site/reviews/reviews-section';
import { publicReviews } from '@/server/reviews';
import { localizeRoom } from '@/server/rooms';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const l = (isLocale(locale) ? locale : 'it') as Locale;
  const t = getDictionary(l);
  return { title: t.rooms.title, description: t.rooms.intro, alternates: alternates(l, '/camere') };
}

export default async function RoomsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const t = getDictionary(locale);
  const sp = await searchParams;
  const db = readDb();
  const today = todayISO();
  const q = queryFromParams(sp, today);
  const results = q.checkIn && q.checkOut ? availability(db, { checkIn: q.checkIn, checkOut: q.checkOut, adults: q.adults, children: q.children }, locale) : null;
  return (
    <>
      <section className="bg-ivory p-2 sm:p-3">
        <div className="relative overflow-hidden rounded-[1.6rem] bg-navy pb-20 pt-32 text-ivory sm:rounded-[2.2rem] md:pb-28 md:pt-44">
          <Image src={MEDIA.vistaMare.src} alt="" fill preload sizes="100vw" className="object-cover opacity-30" />
          <div className="relative px-5 sm:px-8 md:px-12 lg:px-16">
            <p className="eyebrow text-gold">{t.rooms.eyebrow}</p>
            <h1 className="display mt-6 max-w-[12ch] text-display">{t.rooms.title}</h1>
            <p className="mt-8 max-w-xl text-[1.05rem] leading-relaxed text-ivory/80">{t.rooms.intro}</p>
          </div>
        </div>
      </section>
      <RoomsExplorer key={`${q.checkIn}|${q.checkOut}|${q.adults}|${q.children}`} rooms={publicCards(db, locale)} initialQuery={q} initialResults={results} today={today} cashPercent={db.settings.payments.allowCashAtHotel ? db.settings.payments.cashDiscountPercent : 0} />
      <ReviewsSection reviews={publicReviews(db, locale).slice(0, 40)} rooms={db.rooms.filter((r) => r.status === 'available' && !r.hidden).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ id: r.id, number: r.numberAuto ? '' : r.number, name: localizeRoom(r, locale).t.title || r.name }))} />
    </>
  );
}
