'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, Banknote, BedDouble, CalendarDays, Expand, Layers, Maximize2, Users, X } from 'lucide-react';
import { PricePair } from '../price-pair';
import { TaxLine } from '../booking/tax-line';
import type { TaxQuote } from '@/lib/tourist-tax';
import { PRICE_T } from '@/lib/i18n/price-dict';
import { RoomReviews } from '../reviews/reviews-section';
import type { ReviewView } from '../reviews/reviews-ui';
import type { FloorKey, Photo, RoomType } from '@/lib/types';
import type { RoomCardData } from '@/lib/room-card';
import type { StayQuote } from '@/lib/availability';
import { amenityLabel } from '@/content/amenities';
import { diffDays, fmtDate } from '@/lib/dates';
import { plural } from '@/lib/i18n/config';
import { cn, money } from '@/lib/utils';
import { useI18n, useLenis, useLiveVersion, useMediaQuery } from '../providers';
import { AmenityIcon } from '../amenity-icon';
import { ImageReveal, Reveal, SplitHeading } from '../motion-kit';
import { TLink } from '../transition';
import { RangeCalendar } from '../booking/calendar';
import { GuestSelector } from '../booking/guests';
import { Popover } from '../booking/popover';
import { queryToParams, type StayQuery } from '../booking/query';
import { RoomGallery } from './gallery';
import { landMorph } from './shared-element';
import { useRouter } from 'next/navigation';

export interface RoomDetailData {
  id: string;
  slug: string;
  number: string;
  title: string;
  type: RoomType;
  maxGuests: number;
  beds: string;
  size: number | null;
  floor: FloorKey;
  basePrice: number;
  cashPercent?: number;
  /** false = this room is paid only in cash at the hotel */
  cardOk?: boolean;
  amenities: string[];
  photos: Photo[];
  short: string;
  description: string;
}

type QuoteResponse = { available: boolean; reason: 'capacity' | 'occupied' | null; quote: StayQuote; dueNow: number; cashPercent?: number; touristTax?: TaxQuote | null };

const GLANCE = { h: { opacity: 0, y: 10, scale: 0.96 }, v: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 380, damping: 28 } } };

export function RoomDetail({ room, occupied, nightly = {}, similar, today, initialQuery, policies, reviews = [] }: { room: RoomDetailData; occupied: string[]; nightly?: Record<string, number>; similar: RoomCardData[]; today: string; initialQuery: StayQuery; policies: { checkInFrom: string; checkInTo: string; checkOutBy: string; cancellation: string }; reviews?: ReviewView[] }) {
  const { t, locale, href } = useI18n();
  const P = PRICE_T[locale];
  const router = useRouter();
  const [query, setQuery] = useState<StayQuery>({ ...initialQuery, adults: Math.min(initialQuery.adults, room.maxGuests), children: Math.min(initialQuery.children, Math.max(0, room.maxGuests - initialQuery.adults)) });
  const [panel, setPanel] = useState<'guests' | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const calRef = useRef<HTMLDivElement>(null);
  const guestsRef = useRef<HTMLButtonElement>(null);
  const blocked = useMemo(() => new Set(occupied), [occupied]);
  // price of each night (card): the base price, or the owner's price for that period
  const priceOf = useMemo(() => (d: string) => nightly[d] ?? room.basePrice, [nightly, room.basePrice]);
  // the season's own cash prices of the chosen nights, when the hotel set them
  const pct = quote?.cashPercent ?? room.cashPercent ?? 0;
  const cashTotal = quote?.available && (pct > 0 || room.cardOk === false) ? Math.round(quote.quote.total * (1 - pct / 100) * 100) / 100 : null;
  const asideRef = useRef<HTMLElement>(null);
  const [asideVisible, setAsideVisible] = useState(false);
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setAsideVisible(Boolean(e?.isIntersecting)), { rootMargin: '0px 0px -20% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useLiveVersion(() => router.refresh());

  // Shared-element morph: the photo of the card the visitor clicked lands on this page's main photo
  const lenis = useLenis();
  useLayoutEffect(() => {
    landMorph(room.slug, mainRef.current, () => {
      lenis.current?.scrollTo(0, { immediate: true, force: true });
      window.scrollTo(0, 0);
    });
  }, [room.slug, lenis]);

  useEffect(() => {
    if (!query.checkIn || !query.checkOut) return setQuote(null);
    const p = queryToParams(query);
    p.set('room', room.slug);
    let alive = true;
    fetch(`/api/quote?${p}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setQuote(d));
    return () => {
      alive = false;
    };
  }, [query, room.slug]);

  const bookParams = queryToParams(query);
  bookParams.set('room', room.slug);
  const nights = query.checkIn && query.checkOut ? diffDays(query.checkIn, query.checkOut) : 0;
  const facts = [
    { icon: Users, label: t.room.guests, value: plural(locale, room.maxGuests, t.rooms.upTo) },
    { icon: BedDouble, label: t.room.beds, value: room.beds },
    { icon: Maximize2, label: t.room.size, value: room.size ? `${room.size} m²` : '—' },
    { icon: Layers, label: t.room.floor, value: t.floor[room.floor] },
  ];

  return (
    <article className="bg-ivory pb-28 pt-28 md:pt-36">
      <div className="container-x">
        <div className="pointer-events-none sticky z-30 -mb-10 h-10" style={{ top: 'calc(var(--hdr-h, 0px) + 12px)' }}>
          <TLink href={href('/camere')} className="group pointer-events-auto inline-flex h-10 items-center gap-2.5 rounded-full bg-ivory/85 pl-3 pr-4 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-navy shadow-[0_12px_30px_-18px_rgba(16,40,61,0.6)] ring-1 ring-line backdrop-blur-md transition-colors hover:bg-navy hover:text-ivory">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy/[0.07] transition-colors group-hover:bg-ivory/15">
              <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-500 group-hover:-translate-x-0.5" />
            </span>
            {t.room.back}
          </TLink>
        </div>
        <div className="mt-20 grid gap-6 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <p className="eyebrow flex items-center gap-3 text-gold-2">
              N° {room.number} <span className="h-px w-6 bg-gold/60" /> {t.floor[room.floor]}
            </p>
            <SplitHeading as="h1" immediate className="display mt-5 text-headline text-navy">
              {room.title}
            </SplitHeading>
          </div>
          <p className="text-sm text-mist md:col-span-4 md:text-right">
            {t.roomTypes[room.type]} · {plural(locale, room.maxGuests, t.rooms.upTo)}
          </p>
        </div>

        {/* at a glance: what the room has, before anything else */}
        <motion.ul initial="h" animate="v" variants={{ v: { transition: { staggerChildren: 0.035, delayChildren: 0.35 } } }} className="mt-7 flex flex-wrap gap-2" aria-label={t.room.amenities}>
          {facts.map((f) => (
            <motion.li key={f.label} variants={GLANCE} className="flex items-center gap-2 rounded-full bg-navy px-3.5 py-2 text-[0.82rem] text-ivory">
              <f.icon className="h-4 w-4 text-gold" strokeWidth={1.6} />
              <span className="sr-only">{f.label}: </span>
              {f.value}
            </motion.li>
          ))}
          {room.amenities.map((a) => (
            <motion.li key={a} variants={GLANCE} className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[0.82rem] text-navy ring-1 ring-line">
              <AmenityIcon name={a} className="h-4 w-4 text-gold-2" />
              {amenityLabel(a, locale)}
            </motion.li>
          ))}
        </motion.ul>

        {/* gallery: swap photos, zoom with a morph */}
        <RoomGallery photos={room.photos} mainRef={mainRef} />

        <div className="mt-20 grid gap-16 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <Reveal>
              <p className="eyebrow text-gold-2">{t.room.about}</p>
              <p className="serif mt-5 text-[clamp(1.7rem,2.6vw,2.4rem)] leading-snug text-navy">{room.short}</p>
              <div className="mt-8 space-y-5 text-[1.03rem] leading-[1.85] text-charcoal/85">
                {room.description.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </Reveal>
            <Reveal as="ul" stagger={0.06} className="mt-14 grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
              {facts.map((f) => (
                <li key={f.label} className="bg-ivory p-5">
                  <f.icon className="h-5 w-5 text-gold-2" strokeWidth={1.3} />
                  <p className="label mb-0 mt-4">{f.label}</p>
                  <p className="mt-1 text-navy">{f.value}</p>
                </li>
              ))}
            </Reveal>
            <Reveal className="mt-16">
              <h2 className="serif text-[2rem] text-navy">{t.room.amenities}</h2>
              <ul className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {room.amenities.map((a) => (
                  <li key={a} className="flex items-center gap-3 border-b border-line pb-4 text-[0.95rem] text-charcoal/85">
                    <AmenityIcon name={a} className="h-5 w-5 text-gold-2" />
                    {amenityLabel(a, locale)}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal className="mt-16">
              <h2 className="serif text-[2rem] text-navy">{t.room.policies}</h2>
              <dl className="mt-6 grid gap-6 text-sm sm:grid-cols-3">
                <div>
                  <dt className="label">{t.room.checkIn}</dt>
                  <dd className="text-navy">
                    {policies.checkInFrom} – {policies.checkInTo}
                  </dd>
                </div>
                <div>
                  <dt className="label">{t.room.checkOut}</dt>
                  <dd className="text-navy">{policies.checkOutBy}</dd>
                </div>
                <div className="sm:col-span-3">
                  <dt className="label">{t.room.cancellation}</dt>
                  <dd className="leading-relaxed text-charcoal/80">{policies.cancellation}</dd>
                </div>
              </dl>
            </Reveal>
            <div className="mt-16">
              <RoomReviews reviews={reviews} roomId={room.id} roomName={room.title} />
            </div>
          </div>

          {/* booking card: the calendar is open right away, with the price of each night under the day */}
          <aside ref={asideRef} id="prenota-camera" className="scroll-mt-28 lg:col-span-5">
            {/* not sticky: with the calendar open the card is taller than the screen */}
            <div className="rounded-[1.75rem] border border-line bg-white p-5 md:p-7">
              <p className="eyebrow flex items-center gap-2 text-gold-2">
                <CalendarDays className="h-3.5 w-3.5" /> {P.title}
              </p>
              <p className="mt-1.5 text-xs text-mist">{P.hint}</p>
              <div ref={calRef} className="mt-4">
                <RangeCalendar checkIn={query.checkIn} checkOut={query.checkOut} minDate={today} months={1} blockedNights={blocked} priceOf={priceOf} onChange={(ci, co) => setQuery({ ...query, checkIn: ci, checkOut: co })} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="flex min-h-[3.4rem] flex-col justify-center rounded-2xl bg-ivory px-4 py-2">
                  <span className="eyebrow text-mist">
                    {t.search.arrival} → {t.search.departure}
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-sm leading-tight text-navy">
                    <span>{query.checkIn ? stayDates(query.checkIn, query.checkOut, locale) : t.search.addDate}</span>
                    {query.checkIn && (
                      <button type="button" onClick={() => setQuery({ ...query, checkIn: null, checkOut: null })} aria-label={t.search.clear} title={t.search.clear} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-mist hover:bg-white hover:text-navy">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
                <button ref={guestsRef} type="button" onClick={() => setPanel(panel === 'guests' ? null : 'guests')} className="flex min-h-[3.4rem] flex-col justify-center rounded-2xl bg-ivory px-4 py-2 text-left transition-colors hover:bg-sand-2" aria-expanded={panel === 'guests'}>
                  <span className="eyebrow flex items-center gap-2 text-mist">
                    <Users className="h-3.5 w-3.5" /> {t.search.guests}
                  </span>
                  <span className="mt-0.5 text-sm text-navy">{plural(locale, query.adults + query.children, t.search.guestsCount)}</span>
                </button>
              </div>
              <div className="mt-5 min-h-[6.5rem]" aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  {quote ? (
                    quote.available ? (
                      <motion.div key={`q${quote.quote.total}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35 }}>
                        <p className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2 text-sage">
                            <span className="h-1.5 w-1.5 rounded-full bg-sage" /> {t.room.availableStay}
                          </span>
                          <span className="text-mist">{plural(locale, nights, t.booking.nights)}</span>
                        </p>
                        <PricePair className="mt-3" size="lg" card={room.cardOk === false ? null : quote.quote.total} cash={cashTotal} />
                        {quote.touristTax && <TaxLine className="mt-3" tax={quote.touristTax} />}
                      </motion.div>
                    ) : (
                      <motion.p key="no" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm text-terracotta">
                        {quote.reason === 'capacity' ? t.booking.noRooms : t.room.unavailableStay}
                      </motion.p>
                    )
                  ) : (
                    <motion.p key="pick" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-start gap-2 text-sm text-mist">
                      <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-gold-2" /> {t.booking.pick.pickDates}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
              {quote?.available ? (
                <Link href={href(`/prenotazione?${bookParams}`)} className="btn btn-navy mt-4 w-full">
                  {P.bookThis}
                </Link>
              ) : (
                <button type="button" onClick={() => calRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="btn btn-line mt-4 w-full text-navy">
                  <CalendarDays className="h-4 w-4" /> {t.search.chooseDates}
                </button>
              )}
              <Popover open={panel === 'guests'} onClose={() => setPanel(null)} anchor={guestsRef} label={t.search.guests} width={380} align="end" closeLabel={t.common.close}>
                <GuestSelector value={query} maxGuests={room.maxGuests} onChange={(g) => setQuery({ ...query, ...g })} />
                <button type="button" onClick={() => setPanel(null)} className="btn btn-navy mt-4 h-11 min-h-0 w-full">
                  {t.search.done}
                </button>
              </Popover>
            </div>
          </aside>
        </div>

        {similar.length > 0 && (
          <section className="mt-32 border-t border-line pt-20" aria-labelledby="similar">
            <h2 id="similar" className="display text-[clamp(2.2rem,4vw,3.6rem)] text-navy">
              {t.room.similar}
            </h2>
            <ul className="mt-12 grid gap-10 md:grid-cols-3">
              {similar.map((s, i) => (
                <li key={s.id}>
                  <TLink href={href(`/camere/${s.slug}`)} className="group block">
                    <ImageReveal className={cn('bg-sand', i === 1 ? 'aspect-[4/5]' : 'aspect-[4/3]')} delay={i * 0.1}>
                      {s.photo && <Image src={s.photo.src} alt={s.photo.alt} fill sizes="(min-width:768px) 30vw, 100vw" className="object-cover transition-transform duration-[1.4s] group-hover:scale-[1.04]" />}
                    </ImageReveal>
                    <p className="eyebrow mt-5 text-gold-2">N° {s.number}</p>
                    <p className="serif mt-2 text-[1.8rem] leading-tight text-navy">{s.name}</p>
                    <p className="mt-1 text-sm text-mist">
                      {plural(locale, s.maxGuests, t.rooms.upTo)} · {s.beds}
                    </p>
                  </TLink>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <MobileBookBar
        hidden={asideVisible}
        price={quote?.available ? money(cashTotal !== null && room.cardOk === false ? cashTotal : quote.quote.total, locale) : P.title}
        caption={quote?.available ? plural(locale, nights, t.booking.nights) : t.search.chooseDates}
        cta={quote?.available ? t.rooms.book : t.search.chooseDates}
        href={quote?.available ? href(`/prenotazione?${bookParams}`) : null}
        onCheck={() => calRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      />
    </article>
  );
}

/** "20–23 nov", "30 nov – 2 dic", "20 nov → …" while the departure is still to pick. */
function stayDates(checkIn: string, checkOut: string | null, locale: string): string {
  const day = (d: string) => fmtDate(d, locale, { day: 'numeric' });
  const dm = (d: string) => fmtDate(d, locale, { day: 'numeric', month: 'short' });
  if (!checkOut) return `${dm(checkIn)} → …`;
  return checkIn.slice(0, 7) === checkOut.slice(0, 7) ? `${day(checkIn)}–${dm(checkOut)}` : `${dm(checkIn)} – ${dm(checkOut)}`;
}

/** Phone/tablet only: price + book button always at hand, level with the floating assistant button. */
function MobileBookBar({ hidden, price, caption, cta, href, onCheck }: { hidden: boolean; price: string; caption: string; cta: string; href: string | null; onCheck: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const desktop = useMediaQuery('(min-width: 1024px)', true);
  const show = !desktop && !hidden;
  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!show || !el) return;
    const apply = () => {
      root.style.setProperty('--dock-h', `${el.offsetHeight + 16}px`);
      root.style.setProperty('--dock-mid', `${16 + el.offsetHeight / 2}px`);
      root.dataset.dock = '1';
    };
    apply();
    return () => {
      root.style.setProperty('--dock-h', '0px');
      delete root.dataset.dock;
    };
  }, [show]);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          ref={ref}
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 0.61, 0.12, 1] }}
          className="fixed bottom-4 left-4 right-[4.6rem] z-[55] flex h-[60px] items-center justify-between gap-3 rounded-full bg-white/95 pl-5 pr-1.5 shadow-[0_24px_50px_-20px_rgba(16,40,61,0.55)] ring-1 ring-line backdrop-blur-md sm:left-6 sm:right-[5.1rem]"
        >
          <span className="min-w-0 leading-tight">
            <span className="serif block truncate text-[1.45rem] leading-none text-navy">{price}</span>
            <span className="block truncate text-[0.65rem] uppercase tracking-[0.14em] text-mist">{caption}</span>
          </span>
          {href ? (
            <Link href={href} className="btn btn-navy h-12 min-h-0 shrink-0 px-4 text-[0.66rem] tracking-[0.14em]">
              {cta}
            </Link>
          ) : (
            <button type="button" onClick={onCheck} className="btn btn-navy h-12 min-h-0 shrink-0 px-4 text-[0.66rem] tracking-[0.14em]">
              <CalendarDays className="h-4 w-4" /> {cta}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
