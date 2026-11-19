import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Banknote, CalendarX2, CheckCircle2, CreditCard, Mail } from 'lucide-react';
import { cancelText, cancelTitle } from '@/lib/cancellation';
import { isLocale, fill, plural } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/types';
import { diffDays, fmtDateLong } from '@/lib/dates';
import { money } from '@/lib/utils';
import { readDb } from '@/server/db/store';
import { smtpConfigured } from '@/server/events';
import { TAX_T, taxDetail, touristTaxFor } from '@/lib/tourist-tax';
import { findBookingByToken } from '@/server/bookings';
import { confirmFromCheckout } from '@/server/payments/confirm';
import { completeCardSession } from '@/server/payments/card';
import { localizeRoom } from '@/server/rooms';
import { PendingRefresher } from '@/components/site/booking/pending-refresher';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: 'Conferma', robots: { index: false } };

export default async function ConfirmPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const t = getDictionary(locale);
  const sp = await searchParams;
  const token = typeof sp.t === 'string' ? sp.t : '';
  let b = findBookingByToken(token);
  if (!b) notFound();
  // back from Stripe: ask Stripe whether this checkout was paid, without waiting for the webhook
  const sessionId = typeof sp.session_id === 'string' ? sp.session_id : '';
  if (sessionId && b.status !== 'confirmed' && (await confirmFromCheckout(sessionId, b.id)) === 'confirmed') b = findBookingByToken(token) ?? b;
  // the card stays with the booking (no-show / late cancellation); cash with a guarantee card is confirmed here
  if (sessionId && !b.card) await completeCardSession(sessionId, b.id);
  const guarantee = typeof sp.g === 'string' ? sp.g : '';
  if (guarantee && b.status !== 'confirmed' && (await completeCardSession(guarantee, b.id)) === 'done') b = findBookingByToken(token) ?? b;
  const db = readDb();
  const r = db.rooms.find((x) => x.id === b.roomId);
  const room = r ? localizeRoom(r, locale) : null;
  const nights = diffDays(b.checkIn, b.checkOut);
  const L = (p: string) => (locale === 'it' ? p : `/${locale}${p}`);

  return (
    <div className="bg-ivory pb-28 pt-32 md:pt-44">
      <div className="container-x grid gap-14 lg:grid-cols-12">
        <div className="lg:col-span-7">
          {b.status === 'confirmed' ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-sage" strokeWidth={1.2} />
              <h1 className="display mt-6 text-[clamp(2.6rem,5vw,4.8rem)] text-navy">{fill(t.booking.confirmedTitle, { name: b.guest.firstName })}</h1>
            </>
          ) : b.status === 'cancelled' ? (
            <h1 className="display text-[clamp(2.6rem,5vw,4.8rem)] text-navy">{t.booking.cancelled}</h1>
          ) : (
            <>
              <span className="block h-8 w-8 animate-spin rounded-full border border-line border-t-navy" />
              <h1 className="display mt-6 text-[clamp(2.6rem,5vw,4.8rem)] text-navy">{t.booking.pendingTitle}</h1>
              <p className="mt-4 text-charcoal/75">{t.booking.pendingText}</p>
              <PendingRefresher />
            </>
          )}
          <div className="mt-10 flex flex-wrap gap-3">
            <div className="inline-flex flex-col rounded-[1.25rem] border border-line bg-white px-6 py-4">
              <span className="eyebrow text-mist">{t.booking.code}</span>
              <span className="serif mt-1 text-[2rem] tracking-wide text-navy">{b.code}</span>
            </div>
            {b.status === 'confirmed' && (
              <div className="inline-flex items-center gap-4 rounded-[1.25rem] border border-line bg-white px-6 py-4">
                <span className={b.paymentMethod === 'cash' ? 'flex h-11 w-11 items-center justify-center rounded-2xl bg-sage/15 text-sage' : 'flex h-11 w-11 items-center justify-center rounded-2xl bg-navy text-ivory'}>
                  {b.paymentMethod === 'cash' ? <Banknote className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
                </span>
                <span>
                  <span className="eyebrow block text-mist">{b.paymentMethod === 'cash' ? t.booking.pay.cash : t.booking.pay.card}</span>
                  <span className="serif mt-1 block text-[1.6rem] leading-none text-navy">{money(b.paymentMethod === 'cash' ? b.total : b.amountPaid, locale, 2)}</span>
                </span>
              </div>
            )}
          </div>
          {b.status === 'confirmed' && b.paymentMethod === 'cash' && <p className="mt-4 max-w-lg text-sm text-charcoal/75">{fill(t.booking.pay.cashInfo, { amount: money(b.total, locale, 2) })}</p>}
          {b.status !== 'cancelled' && (
            <div className="mt-8 flex max-w-lg items-start gap-3 rounded-[1.25rem] border border-line bg-white px-5 py-4 text-sm text-charcoal/80" data-testid="cancel-rule">
              <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-2" />
              <span>
                <span className="eyebrow block text-mist">{cancelTitle(locale)}</span>
                <span className="mt-1 block">{[cancelText(locale, db.settings.payments, { checkIn: b.checkIn, total: b.total, nights, bookedAt: b.createdAt }), db.settings.payments.cancellationPolicy].filter(Boolean).join(' ')}</span>
              </span>
            </div>
          )}
          {b.status === 'confirmed' && (
            <p className="mt-8 flex max-w-lg items-start gap-3 text-sm text-charcoal/80">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-gold-2" />
              <span>
                {t.booking.emailSent}
                {!smtpConfigured() && <span className="text-mist"> {t.booking.emailDemo}</span>}
              </span>
            </p>
          )}
          <div className="mt-12 flex flex-wrap gap-4">
            <Link href={L(`/soggiorno/${b.token}`)} className="btn btn-navy">
              {t.booking.guestArea}
            </Link>
            <Link href={L('/')} className="btn btn-line text-navy">
              {t.booking.home}
            </Link>
          </div>
        </div>
        <aside className="lg:col-span-5">
          <div className="overflow-clip rounded-[1.75rem] border border-line bg-white">
            {room?.photos[0] && (
              <div className="relative aspect-[16/10] bg-sand">
                <Image src={room.photos[0].src} alt={room.photos[0].alt} fill sizes="(min-width:1024px) 40vw, 100vw" className="object-cover" />
              </div>
            )}
            <dl className="divide-y divide-line px-6 text-sm">
              {[
                [t.room.about, room ? `${room.t.title} · N° ${room.number}` : '—'],
                [t.search.arrival, fmtDateLong(b.checkIn, locale)],
                [t.search.departure, fmtDateLong(b.checkOut, locale)],
                [t.search.guests, plural(locale, b.adults + b.children, t.search.guestsCount)],
                [t.booking.nights.other.replace('{n} ', ''), String(nights)],
                [t.booking.total, money(b.total, locale, 2)],
                [t.guest.paid, money(b.amountPaid, locale, 2)],
                ...((tax) => (tax ? [[TAX_T[locale].label, `${money(tax.total, locale, 2)} · ${TAX_T[locale].note} (${taxDetail(locale, tax, (n) => money(n, locale, 2))})`]] : []))(b.status === 'cancelled' ? null : touristTaxFor(db.settings.pricing?.touristTax, b.checkIn, b.checkOut, b.adults)),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-6 py-4">
                  <dt className="text-mist">{k}</dt>
                  <dd className="text-right text-navy">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}
