'use client';
import { useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, CalendarDays, Layers, Maximize2, Users } from 'lucide-react';
import { PricePair } from '../price-pair';
import type { RoomCardData } from '@/lib/room-card';
import { amenityLabel } from '@/content/amenities';
import { plural } from '@/lib/i18n/config';
import { cn, money } from '@/lib/utils';
import { gsap, useGSAP, prefersReducedMotion } from '@/lib/gsap';
import { useI18n } from '../providers';
import { AmenityIcon } from '../amenity-icon';
import { launchMorph } from './shared-element';
import { queryToParams, type StayQuery } from '../booking/query';
import { RATES_T } from '@/lib/i18n/reviews-dict';
import { Stars } from '../reviews/reviews-ui';

/**
 * Room box: photo with mask reveal, key facts, amenities, price (per night or whole stay),
 * availability and the two actions. All boxes in a row share the same height.
 */
export function RoomCard({ room, index, query, result, delay = 0, cashPercent = 0, variant = 'grid', tall = false, top = false }: { top?: boolean; room: RoomCardData; index: number; delay?: number; query?: StayQuery | null; result?: { total: number; nights: number; averageNight: number; available: boolean; singleUse?: number; cashPercent?: number } | null; cashPercent?: number; variant?: 'grid' | 'masonry' | 'list'; tall?: boolean }) {
  const { t, locale, href } = useI18n();
  const router = useRouter();
  const card = useRef<HTMLElement>(null);
  const mask = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const detailHref = href(`/camere/${room.slug}`) + (query?.checkIn ? `?${queryToParams(query).toString()}` : '');
  const bookParams = query ? queryToParams(query) : new URLSearchParams();
  bookParams.set('room', room.slug);
  const bookHref = href(`/prenotazione?${bookParams.toString()}`);
  const bookWith = (way: 'card' | 'cash') => {
    const p = new URLSearchParams(bookParams);
    p.set('pay', way);
    router.push(href(`/prenotazione?${p.toString()}`));
  };
  const pct = result?.cashPercent ?? room.cashPercent ?? cashPercent;
  // before any date: the lowest night with card and in cash, side by side (when cash costs less)
  const from = room.fromPrice ?? room.basePrice;
  const fromCash = room.fromCash ?? null;
  const fromPair = fromCash !== null && (room.pay?.card === false || fromCash < from);
  // two prices side by side need the whole row on a phone list card (the arrow goes: the card opens the room anyway)
  const showsPair = result ? pct > 0 : fromPair;
  const cash = (n: number) => Math.round(n * (1 - pct / 100) * 100) / 100;
  const masonry = variant === 'masonry';
  // one under the other: the photo on the left, everything else on the right (stacked on phones)
  const list = variant === 'list';
  const rates = RATES_T[locale];

  useGSAP(
    () => {
      if (prefersReducedMotion() || !card.current) return;
      const st = { trigger: card.current, start: 'top 92%', once: true };
      gsap.fromTo(card.current, { opacity: 0, y: 48 }, { opacity: 1, y: 0, duration: 1.05, delay, ease: 'power3.out', scrollTrigger: st });
      gsap.fromTo(mask.current, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, delay: delay + 0.08, ease: 'expo.inOut', scrollTrigger: st });
      gsap.fromTo(imgRef.current, { scale: 1.16 }, { scale: 1, duration: 1.7, delay: delay + 0.08, ease: 'expo.out', scrollTrigger: st });
    },
    { scope: card },
  );

  const openDetail = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    launchMorph(room.slug, imgRef.current);
    router.push(detailHref);
  };

  return (
    <article
      ref={card}
      data-reveal
      aria-labelledby={`room-${room.id}`}
      className={cn('group/card relative flex h-full overflow-hidden border border-line bg-white transition-[box-shadow,border-color] duration-700 ease-[var(--ease-lux)] hover:border-sand hover:shadow-[0_40px_80px_-48px_rgba(16,40,61,0.55)]', list ? 'flex-row rounded-[1.4rem] md:rounded-[1.75rem]' : 'flex-col rounded-[1.75rem]')}
    >
      {/* phones, list: the whole strip opens the room (its calendar shows the free dates and the price) */}
      {list && <Link href={detailHref} onClick={openDetail} aria-label={`${t.rooms.discover}: ${room.name}`} className="absolute inset-0 z-[1] md:hidden" />}
      <Link href={detailHref} onClick={openDetail} aria-hidden="true" tabIndex={-1} className={cn('relative block overflow-hidden', list && 'w-[36%] shrink-0 sm:w-[40%] md:w-[44%] lg:w-[40%]')}>
        <div ref={mask} className={cn('relative overflow-hidden bg-sand', masonry ? (tall ? 'aspect-[4/5]' : 'aspect-[5/4]') : list ? 'h-full min-h-[9.5rem] md:min-h-[19rem]' : 'aspect-[4/3]')}>
          <div ref={imgRef} className="absolute inset-0">
            <div className="absolute inset-0 transition-transform duration-[1.4s] ease-[var(--ease-lux)] group-hover/card:scale-[1.045]">
              {room.photo && <Image src={room.photo.src} alt={room.photo.alt} fill sizes={list ? '(min-width:1024px) 40vw, (min-width:768px) 44vw, 100vw' : '(min-width:1280px) 31vw, (min-width:640px) 46vw, 100vw'} className="object-cover" quality={75} />}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(10,28,43,0.28)_0%,transparent_30%,transparent_62%,rgba(10,28,43,0.42)_100%)] opacity-80 transition-opacity duration-700 group-hover/card:opacity-100" />
          <span className="absolute left-4 top-4 flex flex-wrap gap-1.5">
            {room.number && <span className="rounded-full bg-ivory/92 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-navy">N° {room.number}</span>}
            {top && <span className="rounded-full bg-gold px-3 py-1 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-navy-3">★ {t.booking.pick.popular}</span>}
          </span>
          {result && (
            <span className={cn('absolute right-4 top-4 items-center gap-1.5 rounded-full bg-sage px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ivory', list ? 'hidden md:flex' : 'flex')}>
              <span className="h-1.5 w-1.5 rounded-full bg-ivory" /> {t.rooms.available}
            </span>
          )}
          <span className={cn('absolute bottom-4 left-4 flex items-center gap-3 text-[0.7rem] font-medium text-ivory/95', masonry && 'hidden sm:flex', list && 'hidden md:flex')}>
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" strokeWidth={1.6} /> {room.maxGuests}
            </span>
            {room.size ? (
              <span className="flex items-center gap-1.5">
                <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.6} /> {room.size} {t.rooms.sqm}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" strokeWidth={1.6} /> {t.floor[room.floor]}
            </span>
          </span>
        </div>
      </Link>

      <div className={cn('flex min-w-0 flex-1 flex-col', list ? 'px-3.5 pb-3.5 pt-3.5 sm:px-5 sm:pb-5 sm:pt-5 md:px-8 md:pb-7 md:pt-7' : masonry ? 'px-3.5 pb-3.5 pt-4 sm:px-6 sm:pb-6 sm:pt-6' : 'px-5 pb-5 pt-6 sm:px-6 sm:pb-6')}>
        <p className={cn('eyebrow text-gold-2', list && 'text-[0.58rem] md:text-[0.66rem]')}>{t.roomTypes[room.type]}</p>
        <h3 id={`room-${room.id}`} className={cn('serif leading-[1.05] text-navy', list ? 'mt-1.5 text-[1.25rem] sm:text-[1.6rem] md:mt-2.5 md:text-[1.95rem]' : 'mt-2.5', masonry ? 'text-[1.35rem] sm:text-[1.95rem]' : !list && 'text-[1.95rem]')}>
          <Link href={detailHref} onClick={openDetail} className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-[position:0_100%] bg-no-repeat transition-[background-size] duration-700 ease-[var(--ease-lux)] hover:bg-[length:100%_1px]">
            {room.name}
          </Link>
        </h3>
        {room.rating && (
          <Link href={`${detailHref}#recensioni`} className="relative z-[2] mt-1.5 inline-flex items-center gap-1.5 text-[0.78rem] text-navy" aria-label={`${room.rating.avg}/5 · ${room.rating.count}`}>
            <Stars value={room.rating.avg} size="h-3.5 w-3.5" />
            <span className="font-semibold">{room.rating.avg.toFixed(1).replace('.', ',')}</span>
            <span className="text-mist">({room.rating.count})</span>
          </Link>
        )}
        <p className={cn('mt-1.5 text-mist', list ? 'line-clamp-2 text-[0.74rem] md:text-[0.8rem]' : 'text-[0.8rem]', masonry && 'hidden sm:block')}>
          {plural(locale, room.maxGuests, t.rooms.upTo)} · {room.beds}
        </p>
        <p className={cn('mt-4 text-[0.93rem] leading-relaxed text-charcoal/80', list ? 'hidden md:line-clamp-3' : 'line-clamp-2', masonry && 'hidden sm:block')}>{room.short}</p>
        <ul className={cn('mt-5 flex-wrap gap-x-4 gap-y-2 text-[0.75rem] text-charcoal/75', masonry ? 'hidden sm:flex' : list ? 'hidden md:flex' : 'flex')}>
          {room.amenities.slice(0, list ? 6 : 4).map((a) => (
            <li key={a} className="flex items-center gap-1.5">
              <AmenityIcon name={a} className="h-3.5 w-3.5 text-gold-2" />
              {amenityLabel(a, locale)}
            </li>
          ))}
        </ul>

        <div className={cn('mt-auto', list ? 'pt-3 md:pt-6' : 'pt-6')}>
          <div className={cn('flex items-end justify-between gap-3 border-t border-line', list ? 'pt-3 md:pt-5' : 'pt-5')}>
            {result ? (
              <div className="min-w-0 flex-1">
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-mist">
                  {t.rooms.total} · {plural(locale, result.nights, t.booking.nights)}
                </p>
                <PricePair className="relative z-[2] mt-2" size={masonry || list ? 'sm' : 'md'} card={result.total} cash={pct > 0 ? cash(result.total) : null} onPick={bookWith} compact />
                <p className={cn('mt-1.5 text-[0.72rem] text-mist', list && 'hidden md:block')}>
                  {money(result.averageNight, locale)} {t.rooms.perNight} · {room.board === 'breakfast' ? rates.breakfast : rates.roomOnly}
                </p>
                {(result.singleUse ?? 0) > 0 && <p className="mt-1.5 inline-flex items-center rounded-full bg-gold/15 px-2.5 py-1 text-[0.7rem] font-semibold text-[#7a5a1f]">{rates.singleUse.replace('{p}', String(result.singleUse))}</p>}
              </div>
            ) : fromPair ? (
              // no dates yet: the lowest night with card and in cash ("da 45 € / 38 €"); a tap on one opens the
              // booking with that way to pay, the exact total comes with the dates (room page calendar)
              <div className="min-w-0 flex-1 leading-tight" data-testid="from-pair">
                <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-mist">
                  {t.rooms.from} · {t.rooms.perNight}
                </span>
                <PricePair className="relative z-[2] mt-1.5" size={masonry || list ? 'sm' : 'md'} card={room.pay?.card === false ? null : from} cash={fromCash} onPick={bookWith} compact />
                <Link href={`${detailHref}#prenota-camera`} onClick={openDetail} className={cn('relative z-[2] mt-1.5 flex items-center gap-1.5 text-[0.72rem] text-charcoal/70 transition-colors hover:text-navy', (list || masonry) && 'hidden md:flex')}>
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-gold-2" strokeWidth={1.6} /> {t.booking.pick.pickDates}
                </Link>
              </div>
            ) : (
              // no dates yet: the lowest night price ("da 55 €"), the exact total comes with the dates (room page calendar)
              <Link href={`${detailHref}#prenota-camera`} onClick={openDetail} className="group/dates relative z-[2] flex min-w-0 items-center gap-3 text-navy">
                <span className={cn('h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sand-2 text-gold-2 transition-colors duration-500 group-hover/dates:bg-navy group-hover/dates:text-gold', list || masonry ? 'hidden md:flex' : 'flex')}>
                  <CalendarDays className="h-4 w-4" strokeWidth={1.6} />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-mist">{t.rooms.from}</span>
                  <span className="mt-0.5 flex items-baseline gap-1">
                    <span className={cn('serif text-navy', list || masonry ? 'text-[1.35rem] md:text-[1.6rem]' : 'text-[1.6rem]')}>{money(from, locale)}</span>
                    <span className="text-[0.72rem] text-mist">{t.rooms.perNight}</span>
                  </span>
                  <span className={cn('mt-0.5 block text-[0.72rem] text-charcoal/70', (list || masonry) && 'hidden md:block')}>{t.booking.pick.pickDates}</span>
                </span>
              </Link>
            )}
            <Link href={detailHref} onClick={openDetail} aria-label={`${t.rooms.discover}: ${room.name}`} className={cn('relative z-[2] shrink-0 items-center justify-center rounded-full border border-line text-navy transition-[background-color,color,border-color] duration-500 hover:border-navy hover:bg-navy hover:text-ivory', masonry ? 'hidden h-11 w-11 sm:flex' : list ? (showsPair ? 'hidden md:flex md:h-11 md:w-11' : 'flex h-9 w-9 md:h-11 md:w-11') : 'flex h-11 w-11')}>
              <ArrowUpRight className="h-4 w-4 transition-transform duration-500 group-hover/card:-translate-y-0.5 group-hover/card:translate-x-0.5" />
            </Link>
          </div>
          <div className={cn('mt-4 gap-2', masonry ? 'grid grid-cols-1 sm:grid-cols-2' : list ? 'hidden md:ml-auto md:grid md:w-[22rem] md:grid-cols-2' : 'grid grid-cols-2')}>
            <Link href={detailHref} onClick={openDetail} className={cn(masonry && 'hidden sm:inline-flex', 'btn btn-line h-11 min-h-0 whitespace-nowrap px-2 text-[0.62rem] tracking-[0.12em] text-navy')}>
              {t.rooms.discover}
            </Link>
            <Link href={bookHref} className="btn btn-navy h-11 min-h-0 whitespace-nowrap px-2 text-[0.62rem] tracking-[0.12em]">
              {t.rooms.book}
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
