import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { localePath } from '@/lib/i18n/config';
import { ACCOUNT_T } from '@/lib/i18n/account-dict';
import { CARE_T } from '@/lib/i18n/care-dict';
import { GUEST_COOKIE, readGuest } from '@/server/guest-access';
import { cancelFeeAmount, cancelText, isFreeCancel } from '@/lib/cancellation';
import { cardsAvailable } from '@/server/payments/card';
import { cardPaymentsReady } from '@/server/payments/stripe';
import { fill, isLocale, plural } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/types';
import { addDays, diffDays, eachNight, fmtDateLong, todayISO } from '@/lib/dates';
import { money } from '@/lib/utils';
import { readDb } from '@/server/db/store';
import { findBookingByToken } from '@/server/bookings';
import { localizeRoom } from '@/server/rooms';
import { FeedbackForm, GuestActions } from '@/components/site/guest-area';
import { GuestCare } from '@/components/site/guest-care';
import { ContactTiles } from '@/components/site/contact-tiles';
import { threadOf } from '@/server/booking-care';
import { completeCardSession } from '@/server/payments/card';
import { isBookingActive, occupiedNights } from '@/lib/availability';

export const metadata: Metadata = { title: 'Area ospite', robots: { index: false, follow: false } };

/** Private guest area: reachable only with the unguessable token from the confirmation email. */
export default async function GuestPage({ params, searchParams }: { params: Promise<{ locale: string; token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale: raw, token } = await params;
  const sp = await searchParams;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const t = getDictionary(locale);
  let b = findBookingByToken(token);
  if (!b) notFound();
  // back from the secure payment page with the new card
  const cardSession = typeof sp.carta === 'string' && sp.carta.startsWith('cs_') ? sp.carta : '';
  const cardDone = cardSession ? (await completeCardSession(cardSession, b.id)) === 'done' : false;
  if (cardDone) b = findBookingByToken(token) ?? b;
  const db = readDb();
  const today = todayISO();
  const r = db.rooms.find((x) => x.id === b.roomId);
  const room = r ? localizeRoom(r, locale) : null;
  const h = db.settings.hotel;
  const nights = diffDays(b.checkIn, b.checkOut);
  const canCancel = b.status !== 'cancelled' && isFreeCancel(today, b.checkIn, db.settings.payments.freeCancellationDays);
  const cancelRule = cancelText(locale, db.settings.payments, { checkIn: b.checkIn, total: b.total, nights, bookedAt: b.createdAt });
  const stayed = b.checkOut <= today && b.status === 'confirmed';
  // a request for a new card shows until it is answered (a cancelled booking only for a no-show fee still due)
  const cardRequest = b.cardRequest && !b.cardRequest.outcome && (b.status !== 'cancelled' || b.noShow?.outcome === 'due') ? b.cardRequest : null;
  const change = b.changeRequest ?? null;
  const statusLabel = b.status === 'confirmed' ? `✓ ${ACCOUNT_T[locale].states.upcoming}` : b.status === 'cancelled' ? t.booking.cancelled : t.booking.pendingTitle;
  // signed in to the guest area with this booking's e-mail → a way back to the list
  const signedIn = readGuest((await cookies()).get(GUEST_COOKIE)?.value) === b.guest.email.trim().toLowerCase();
  // the dates can still be changed: a confirmed stay that has not ended
  const canChangeDates = b.status === 'confirmed' && isBookingActive(b) && b.checkOut > today && !stayed;
  // after the free period the guest can still cancel: the fee is kept from what was paid, or paid online
  const fee = cancelFeeAmount(db.settings.payments, b.total, nights);
  const late = b.status === 'confirmed' && !canCancel && b.checkIn >= today ? { fee, due: Math.max(0, Math.round((fee - b.amountPaid) * 100) / 100), refund: Math.max(0, Math.round((b.amountPaid - fee) * 100) / 100), online: cardsAvailable() && cardPaymentsReady(db) } : null;

  return (
    <div className="bg-ivory pb-28 pt-32 md:pt-44">
      <div className="container-x grid gap-10 md:gap-14 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {signedIn && (
            <Link href={localePath(locale, '/area-ospite')} className="link-u mb-8 inline-flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-navy">
              <ArrowLeft className="h-4 w-4" /> {ACCOUNT_T[locale].backToList}
            </Link>
          )}
          <p className="eyebrow text-gold-2">{t.guest.title}</p>
          <h1 className="display mt-4 text-[clamp(2.6rem,5vw,4.6rem)] text-navy">{fill(t.guest.hello, { name: b.guest.firstName })}</h1>
          <div className="mt-10 border border-line bg-white">
            {room?.photos[0] && (
              <div className="relative aspect-[16/8] bg-sand">
                <Image src={room.photos[0].src} alt={room.photos[0].alt} fill sizes="(min-width:1024px) 55vw, 100vw" className="object-cover" />
              </div>
            )}
            <dl className="grid gap-px bg-line sm:grid-cols-2">
              {[
                [t.guest.stay, room ? room.t.title : '—'],
                [t.booking.code, b.code],
                [t.search.arrival, `${fmtDateLong(b.checkIn, locale)} · ${h.checkInFrom}–${h.checkInTo}`],
                [t.search.departure, `${fmtDateLong(b.checkOut, locale)} · ${h.checkOutBy}`],
                [t.search.guests, plural(locale, b.adults + b.children, t.search.guestsCount)],
                [t.guest.status, `${statusLabel} · ${plural(locale, nights, t.booking.nights)}`],
                [t.guest.paid, money(b.amountPaid, locale, 2)],
                [t.guest.toPay, money(Math.max(0, b.total - b.amountPaid), locale, 2)],
              ].map(([k, v]) => (
                <div key={k} className="bg-white p-5">
                  <dt className="label">{k}</dt>
                  <dd className="text-navy">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          {/* one tap: change dates, write to the reception (the owner is told on Telegram), call, WhatsApp, directions */}
          <ContactTiles className="mt-6" contact={{ phone: h.phone, whatsapp: h.whatsapp, email: h.email, lat: h.lat, lng: h.lng }} dates={canChangeDates} write />
          <p className="mt-6 text-sm leading-relaxed text-charcoal/75">
            {h.name} · {h.addressVerified ? `${h.addressLine}, ${h.postalCode} ${h.city}` : `${h.postalCode} ${h.city} (${t.sections.addressPending})`}
          </p>
        </div>
        <div className="space-y-12 lg:col-span-5">
          {b.noShow && <p className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-charcoal/80">{CARE_T[locale].noShow}</p>}
          <GuestCare
            token={b.token}
            active={canChangeDates}
            checkIn={b.checkIn}
            checkOut={b.checkOut}
            total={b.total}
            hotelName={h.name}
            thread={threadOf(db, b.id).map((m) => ({ id: m.id, sender: m.sender, body: m.body, at: m.at }))}
            card={cardRequest ? { deadline: cardRequest.deadline, amount: cardRequest.amount, cancelOnExpiry: cardRequest.cancelOnExpiry, expired: new Date(cardRequest.deadline) <= new Date() } : null}
            cardDone={cardDone}
            busy={b.roomId ? (() => { const mine = new Set(eachNight(b.checkIn, b.checkOut)); return occupiedNights(db, b.roomId, today, addDays(today, 400)).filter((d) => !mine.has(d)); })() : []}
            change={change ? { kind: change.kind, by: change.by, checkIn: change.checkIn, checkOut: change.checkOut, total: change.total, note: change.note, status: change.status, answer: change.answer, recent: Boolean(change.answeredAt && Date.now() - new Date(change.answeredAt).getTime() < 14 * 86_400_000) } : null}
          />
          {stayed ? <FeedbackForm token={b.token} reviewUrl={h.googleReviewUrl} /> : <GuestActions token={b.token} late={late} canCancel={canCancel} cancelled={b.status === 'cancelled'} cancelRule={cancelRule} canAskFree={b.status === 'confirmed' && b.checkIn >= today} asked={b.changeRequest?.status === 'pending'} />}
        </div>
      </div>
    </div>
  );
}
