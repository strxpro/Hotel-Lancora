import type { Metadata } from 'next';
import { isLocale } from '@/lib/i18n/config';
import { houseRules, ruleLines } from '@/lib/house-rules';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/types';
import { todayISO } from '@/lib/dates';
import { readDb } from '@/server/db/store';
import { publicCards } from '@/server/public-data';
import { publishableKey, simulationAllowed, stripeMode, cardPaymentsReady } from '@/server/payments/stripe';
import { releaseExpiredHolds, resumeDetails } from '@/server/bookings';
import { BookingFlow } from '@/components/site/booking/booking-flow';
import { activeExtras, extraName } from '@/lib/extras';
import { queryFromParams } from '@/components/site/booking/query';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = getDictionary(isLocale(locale) ? locale : 'it');
  return { title: t.booking.title, robots: { index: false } };
}

export default async function BookingPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const t = getDictionary(locale);
  const sp = await searchParams;
  releaseExpiredHolds();
  const db = readDb();
  const today = todayISO();
  const q = queryFromParams(sp, today);
  const roomParam = typeof sp.room === 'string' ? sp.room : null;
  // a tap on "con carta" / "in contanti" of a room (home page, room page) comes with the way to pay
  const payParam = sp.pay === 'cash' || sp.pay === 'card' ? sp.pay : null;
  // "Finisci la prenotazione" (the e-mail after an unpaid hold): the details typed last time
  const resume = typeof sp.riprendi === 'string' ? resumeDetails(sp.riprendi) : null;
  const rooms = publicCards(db, locale);
  const p = db.settings.payments;
  // real site without Stripe: no pretend card payment, the guest pays at the hotel
  // real keys: card payments only once the hotel's own account is connected (the money goes to the hotel)
  const cardPossible = stripeMode() === 'off' ? simulationAllowed() : cardPaymentsReady(db);
  return (
    <div className="bg-ivory pb-28 pt-32 md:pt-44">
      <div className="container-x">
        <p className="eyebrow text-gold-2">Hotel L’Ancora</p>
        <h1 className="display mt-4 text-title text-navy">{t.booking.title}</h1>
        <div className="mt-12 md:mt-16">
          <BookingFlow
            key={`${q.checkIn}|${q.checkOut}|${q.adults}|${q.children}|${roomParam}|${payParam}`}
            today={today}
            initialQuery={q}
            rooms={rooms}
            initialRoomSlug={rooms.some((r) => r.slug === roomParam) ? roomParam : null}
            initialMethod={payParam}
            initialGuest={resume}
            payments={{ mode: p.mode, depositPercent: p.depositPercent, depositFixed: p.depositFixed, cancellationPolicy: p.cancellationPolicy, holdMinutes: p.holdMinutes, freeCancellationDays: p.freeCancellationDays, cancellationFee: p.cancellationFee }}
            provider={stripeMode() === 'off' ? 'simulated' : 'stripe'}
            stripeKey={publishableKey()}
            cash={{ enabled: p.allowCashAtHotel, percent: p.cashDiscountPercent, guarantee: p.cardGuarantee === true && cardPaymentsReady(db) }}
            online={(p.allowOnline !== false || !p.allowCashAtHotel) && (cardPossible || !p.allowCashAtHotel)}
            extras={activeExtras(db.settings.pricing?.extras).map((e) => ({ id: e.id, name: extraName(e, locale), price: e.price, unit: e.unit }))}
            times={{ checkInFrom: db.settings.hotel.checkInFrom, checkInTo: db.settings.hotel.checkInTo, checkOutBy: db.settings.hotel.checkOutBy, rules: ruleLines(houseRules(db.settings), locale) }}
          />
        </div>
      </div>
    </div>
  );
}
