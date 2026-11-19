import type { Metadata } from 'next';
import { isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/types';
import { todayISO } from '@/lib/dates';
import { readDb } from '@/server/db/store';
import { availability, publicCards } from '@/server/public-data';
import { alternates } from '@/server/seo';
import { HomeExperience } from '@/components/site/home/home-experience';
import { IntroSection } from '@/components/site/home/sections';
import { ReviewsSection } from '@/components/site/reviews/reviews-section';
import { LocationFinale } from '@/components/site/home/location-finale';
import { publicReviews } from '@/server/reviews';
import { localizeRoom } from '@/server/rooms';
import { ExploreSection } from '@/components/site/home/explore';
import { queryFromParams } from '@/components/site/booking/query';
import { ContactSection } from '@/components/site/home/contact-section';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const l = (isLocale(locale) ? locale : 'it') as Locale;
  const t = getDictionary(l);
  return { title: { absolute: `Hotel L’Ancora · ${t.hero.eyebrow}` }, description: `${t.hero.title} ${t.hero.subtitle}`, alternates: alternates(l, '/') };
}

export default async function HomePage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const sp = await searchParams;
  const db = readDb();
  const today = todayISO();
  const q = queryFromParams(sp, today);
  const results = q.checkIn && q.checkOut ? availability(db, { checkIn: q.checkIn, checkOut: q.checkOut, adults: q.adults, children: q.children }, locale) : null;
  const { hotel } = db.settings;
  const reviews = publicReviews(db, locale).slice(0, 40);
  const reviewRooms = db.rooms.filter((r) => r.status === 'available' && !r.hidden).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ id: r.id, number: '', name: localizeRoom(r, locale).t.title || r.name }));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Hotel',
    name: hotel.name,
    starRating: { '@type': 'Rating', ratingValue: hotel.stars },
    address: { '@type': 'PostalAddress', addressLocality: hotel.city, postalCode: hotel.postalCode, addressRegion: hotel.province, addressCountry: 'IT', ...(hotel.addressVerified ? { streetAddress: hotel.addressLine } : {}) },
    geo: { '@type': 'GeoCoordinates', latitude: hotel.lat, longitude: hotel.lng },
    checkinTime: hotel.checkInFrom,
    checkoutTime: hotel.checkOutBy,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeExperience rooms={publicCards(db, locale)} initialQuery={q} initialResults={results} today={today} cashPercent={db.settings.payments.allowCashAtHotel ? db.settings.payments.cashDiscountPercent : 0} tax={db.settings.pricing?.touristTax?.enabled ? db.settings.pricing.touristTax : null}>
        <IntroSection hotel={{ phone: hotel.phone, whatsapp: hotel.whatsapp, email: hotel.email }} />
        <ReviewsSection reviews={reviews} rooms={reviewRooms} />
        <ExploreSection lat={hotel.lat} lng={hotel.lng} name={hotel.name} verified={hotel.addressVerified} />
        <ContactSection hotel={{ phone: hotel.phone, whatsapp: hotel.whatsapp, email: hotel.email }} />
        <LocationFinale hotel={{ name: hotel.name, lat: hotel.lat, lng: hotel.lng, addressLine: hotel.addressLine, postalCode: hotel.postalCode, city: hotel.city, province: hotel.province, verified: hotel.addressVerified }} />
      </HomeExperience>
    </>
  );
}
