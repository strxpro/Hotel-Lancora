'use client';
import { useMemo, useRef, useState } from 'react';
import { LiveMoney } from '../live-money';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, BedDouble, CalendarSearch, Check, Maximize2, ShieldCheck, Sparkles, Star, Users, Waves } from 'lucide-react';
import type { AvailabilityResponse, RoomCardData, RoomResult } from '@/lib/room-card';
import { diffDays, fmtDate } from '@/lib/dates';
import { fill, plural } from '@/lib/i18n/config';
import { amenityLabel } from '@/content/amenities';
import { cn, money } from '@/lib/utils';
import { useI18n } from '../providers';
import { AmenityIcon } from '../amenity-icon';
import { SearchBar } from './search-bar';
import { PricePair } from '../price-pair';
import type { StayQuery } from './query';
import { Stars } from '../reviews/reviews-ui';

const EASE = [0.22, 0.61, 0.12, 1] as const;
type Sort = 'best' | 'price' | 'popular';

/**
 * Step 1 of the booking: the stay bar on top, the guests' favourite room as a tip, then every
 * available room as a rich card (swipeable photos, badges, card/cash price). Picking a room
 * plays a short confirmation before moving on.
 */
export function ChooseRoom({
  query,
  onQuery,
  onSearch,
  today,
  busy,
  rooms,
  available,
  alternatives = [],
  selected,
  onPick,
  cashPercent,
}: {
  query: StayQuery;
  onQuery: (q: StayQuery) => void;
  onSearch: (q: StayQuery) => void;
  today: string;
  busy: boolean;
  rooms: RoomCardData[];
  available: RoomResult[] | null;
  /** nearest stays with free rooms, when these dates have none */
  alternatives?: AvailabilityResponse['alternatives'];
  selected: string | null;
  onPick: (slug: string) => void;
  cashPercent: number;
}) {
  const { t, locale } = useI18n();
  const hasDates = Boolean(query.checkIn && query.checkOut && available);
  const [sort, setSort] = useState<Sort>('best');
  const [picked, setPicked] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);

  const list: RoomResult[] = useMemo(() => (hasDates && available ? available : rooms.map((room) => ({ room, available: true, nights: 0, total: 0, averageNight: 0 }))), [hasDates, available, rooms]);
  const price = (r: RoomResult) => (hasDates ? r.total : r.room.basePrice);
  const top = useMemo(() => [...list].sort((a, b) => b.room.popularity - a.room.popularity)[0], [list]);
  const topId = top && top.room.popularity > 0 ? top.room.id : null;
  const cheapest = useMemo(() => [...list].sort((a, b) => price(a) - price(b))[0]?.room.id, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => {
    const l = [...list];
    if (sort === 'price') l.sort((a, b) => price(a) - price(b));
    else if (sort === 'popular') l.sort((a, b) => b.room.popularity - a.room.popularity);
    else l.sort((a, b) => (a.room.id === topId ? -1 : b.room.id === topId ? 1 : 0));
    return l;
  }, [list, sort, topId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (slug: string) => {
    if (!hasDates) {
      setNudge((n) => n + 1);
      barRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setPicked(slug);
    window.setTimeout(() => onPick(slug), 750);
  };

  return (
    <section aria-labelledby="choose-title">
      <motion.div ref={barRef} key={nudge} animate={nudge ? { x: [0, -10, 10, -6, 6, 0] } : undefined} transition={{ duration: 0.5 }} className="relative z-20">
        <SearchBar value={query} onChange={onQuery} onSubmit={onSearch} today={today} loading={busy} variant="inline" className="shadow-[0_30px_70px_-45px_rgba(16,40,61,0.55)]" />
      </motion.div>
      <AnimatePresence>
        {!hasDates && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={cn('mt-3 text-center text-sm', nudge ? 'font-semibold text-terracotta' : 'text-mist')}>
            {t.booking.pick.pickDates}
          </motion.p>
        )}
      </AnimatePresence>

      {/* guests' tip */}
      {top && topId && (
        <motion.button
          type="button"
          onClick={() => pick(top.room.slug)}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.1 }}
          className="group relative mt-8 flex w-full items-center gap-4 overflow-hidden rounded-[1.6rem] bg-navy p-3 pr-5 text-left text-ivory"
        >
          <motion.span aria-hidden="true" className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-gold/30 blur-3xl" animate={{ opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 4, repeat: Infinity }} />
          <span className="relative h-20 w-24 shrink-0 overflow-hidden rounded-2xl bg-navy-2 sm:h-24 sm:w-32">
            {top.room.photo && <Image src={top.room.photo.src} alt="" fill sizes="128px" className="object-cover transition-transform duration-700 group-hover:scale-110" />}
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold">
              <Sparkles className="h-3.5 w-3.5" /> {t.booking.pick.tip}
            </span>
            <span className="serif mt-1 line-clamp-2 block text-[1.35rem] leading-tight sm:text-[1.8rem]">
              {t.booking.pick.mostChosen}: {top.room.name}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ivory/70">
              <span className="flex items-center gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className="h-3 w-3 text-gold" fill="currentColor" />
                ))}
              </span>
              {fill(t.booking.pick.chosenTimes, { n: top.room.popularity })}
            </span>
          </span>
          {hasDates && (
            <span className="relative hidden shrink-0 text-right sm:block">
              <span className="block text-[0.6rem] uppercase tracking-[0.16em] text-ivory/60">{t.booking.pick.stayTotal}</span>
              <span className="serif block text-[1.8rem] leading-none text-gold"><LiveMoney value={price(top)} /></span>
            </span>
          )}
        </motion.button>
      )}

      <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
        <h2 id="choose-title" className="serif text-[2rem] leading-tight text-navy md:text-[2.4rem]">
          {hasDates ? fill(t.booking.pick.free, { n: list.length }) : t.booking.pick.allRooms}
        </h2>
        <div role="radiogroup" className="relative flex rounded-full border border-line bg-white p-1 text-xs font-semibold">
          {(
            [
              ['best', t.booking.pick.sortBest],
              ['price', t.booking.pick.sortPrice],
              ['popular', t.booking.pick.sortPopular],
            ] as [Sort, string][]
          ).filter(([k]) => hasDates || k !== 'price').map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={sort === k} onClick={() => setSort(k)} className={cn('relative z-[1] rounded-full px-3 py-2 transition-colors', sort === k ? 'text-ivory' : 'text-mist hover:text-navy')}>
              {sort === k && <motion.span layoutId="choose-sort" className="absolute inset-0 -z-[1] rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              {l}
            </button>
          ))}
        </div>
      </div>
      {hasDates && list.length === 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="mt-6 overflow-hidden rounded-[1.75rem] border border-line bg-white p-6 md:p-8">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sand-2 text-gold-2">
              <CalendarSearch className="h-6 w-6" strokeWidth={1.4} />
            </span>
            <div className="min-w-0">
              <p className="serif text-[1.7rem] leading-tight text-navy">{t.rooms.noneTitle}</p>
              <p className="mt-1.5 text-[0.9rem] leading-relaxed text-charcoal/75">{alternatives.length ? t.rooms.noneText : t.rooms.noneAlt}</p>
            </div>
          </div>
          {alternatives.length > 0 && (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {alternatives.map((a, i) => {
                const n = diffDays(a.checkIn, a.checkOut);
                return (
                  <motion.li key={a.checkIn + a.checkOut} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.07, duration: 0.5, ease: EASE }}>
                    <button type="button" disabled={busy} onClick={() => onSearch({ ...query, checkIn: a.checkIn, checkOut: a.checkOut })} className="group flex w-full items-center gap-4 rounded-2xl border border-line bg-ivory px-4 py-4 text-left transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-navy hover:bg-white">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.95rem] font-semibold text-navy">
                          {fmtDate(a.checkIn, locale, { weekday: 'short', day: 'numeric', month: 'short' })} → {fmtDate(a.checkOut, locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                        </span>
                        <span className="mt-1 block text-xs text-mist">
                          {plural(locale, n, t.booking.nights)} · {plural(locale, a.count, t.rooms.results)} · {t.rooms.from} {money(a.from, locale)}
                        </span>
                      </span>
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-ivory transition-transform duration-300 group-hover:translate-x-0.5">
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </button>
                  </motion.li>
                );
              })}
            </ul>
          )}
        </motion.div>
      )}

      <motion.ul layout className="mt-6 space-y-4">
        <AnimatePresence initial={false}>
          {sorted.map((r, i) => {
            const isTop = r.room.id === topId;
            const isCheap = hasDates && r.room.id === cheapest && list.length > 2;
            const sea = r.room.amenities.includes('vista_mare');
            const chosen = picked === r.room.slug || selected === r.room.slug;
            const pct = r.cashPercent ?? r.room.cashPercent ?? cashPercent;
            const cash = pct > 0 ? Math.round(price(r) * (1 - pct / 100) * 100) / 100 : null;
            return (
              <motion.li key={r.room.id} layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.55, ease: EASE, delay: Math.min(i, 6) * 0.05 }}>
                <article className={cn('relative grid overflow-hidden rounded-[1.6rem] border bg-white transition-[border-color,box-shadow] duration-500 sm:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]', chosen ? 'border-navy shadow-[0_30px_70px_-40px_rgba(16,40,61,0.7)]' : 'border-line hover:shadow-[0_30px_70px_-50px_rgba(16,40,61,0.6)]')}>
                  <Gallery photos={r.room.photos.length ? r.room.photos : r.room.photo ? [r.room.photo] : []} name={r.room.name} />
                  <div className="absolute left-3 top-3 z-[2] flex flex-wrap gap-1.5">
                    {isTop && (
                      <span className="flex items-center gap-1 rounded-full bg-gold px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-navy-3 shadow">
                        <Star className="h-3 w-3" fill="currentColor" /> {t.booking.pick.popular}
                      </span>
                    )}
                    {isCheap && <span className="rounded-full bg-sage px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-white shadow">{t.booking.pick.bestPrice}</span>}
                    {sea && (
                      <span className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-navy shadow">
                        <Waves className="h-3 w-3" /> {t.booking.pick.seaView}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col p-5 md:p-6">
                    <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold-2">
                      {r.room.number ? `N° ${r.room.number} · ` : ''}{t.roomTypes[r.room.type]} · {t.floor[r.room.floor]}
                    </p>
                    <h3 className="serif mt-1 text-[1.9rem] leading-tight text-navy">{r.room.name}</h3>
                    {r.room.rating && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-navy">
                        <Stars value={r.room.rating.avg} size="h-3.5 w-3.5" /> <b>{r.room.rating.avg.toFixed(1).replace('.', ',')}</b> <span className="text-mist">({r.room.rating.count})</span>
                      </p>
                    )}
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" /> {plural(locale, r.room.maxGuests, t.rooms.upTo)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <BedDouble className="h-3.5 w-3.5" /> {r.room.beds}
                      </span>
                      {r.room.size && (
                        <span className="flex items-center gap-1.5">
                          <Maximize2 className="h-3.5 w-3.5" /> {r.room.size} m²
                        </span>
                      )}
                    </p>
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-charcoal/80">{r.room.short}</p>
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {r.room.amenities.slice(0, 4).map((a) => (
                        <li key={a} className="flex items-center gap-1.5 rounded-full bg-ivory px-2.5 py-1 text-[0.7rem] text-charcoal/80">
                          <AmenityIcon name={a} className="h-3.5 w-3.5 text-gold-2" /> {amenityLabel(a, locale)}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-5">
                      {hasDates ? (
                        <div className="min-w-[13rem] flex-1">
                          <p className="text-[0.6rem] uppercase tracking-[0.16em] text-mist">
                            {plural(locale, r.nights, t.booking.nights)} · {t.booking.pick.stayTotal}
                          </p>
                          <PricePair className="mt-2 max-w-[22rem]" card={r.room.pay?.card === false ? null : price(r)} cash={cash ?? (r.room.pay?.card === false ? price(r) : null)} />
                        </div>
                      ) : (
                        <p className="max-w-[16rem] text-xs leading-relaxed text-mist">{t.booking.pick.pickDates}</p>
                      )}
                      <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => pick(r.room.slug)} disabled={Boolean(picked)} className={cn('relative flex h-12 items-center gap-2 overflow-hidden rounded-full px-6 text-[0.72rem] font-semibold uppercase tracking-[0.16em] transition-colors', chosen ? 'bg-sage text-white' : 'bg-navy text-ivory hover:bg-navy-3')}>
                        <AnimatePresence mode="wait" initial={false}>
                          {chosen ? (
                            <motion.span key="ok" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex items-center gap-2">
                              <Check className="h-4 w-4" /> {t.booking.pick.chosen}
                            </motion.span>
                          ) : (
                            <motion.span key="go" exit={{ y: -16, opacity: 0 }}>
                              {hasDates ? t.booking.pick.choose : t.search.chooseDates}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {picked === r.room.slug && (
                      <motion.div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center bg-navy/75 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }} className="text-center text-ivory">
                          <motion.svg viewBox="0 0 52 52" className="mx-auto h-16 w-16 text-gold" initial="h" animate="v">
                            <motion.circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="2" variants={{ h: { pathLength: 0 }, v: { pathLength: 1, transition: { duration: 0.45 } } }} />
                            <motion.path d="M15 27l7 7 15-16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" variants={{ h: { pathLength: 0 }, v: { pathLength: 1, transition: { delay: 0.3, duration: 0.3 } } }} />
                          </motion.svg>
                          <p className="serif mt-3 text-[1.8rem]">{t.booking.pick.great}</p>
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </article>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ul>
      <p className="mt-6 flex items-center justify-center gap-2 text-xs text-mist">
        <ShieldCheck className="h-4 w-4 text-sage" /> {t.booking.pick.secure}
      </p>
    </section>
  );
}

/** Swipeable photos with dots (drag on touch, arrows via dots on desktop). */
function Gallery({ photos, name }: { photos: { src: string; alt: string }[]; name: string }) {
  const [i, setI] = useState(0);
  const n = photos.length;
  if (!n) return <div className="aspect-[4/3] bg-sand sm:aspect-auto" />;
  const p = photos[i % n]!;
  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-sand sm:aspect-auto sm:min-h-[300px]">
      <AnimatePresence initial={false}>
        <motion.div
          key={p.src}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          drag={n > 1 ? 'x' : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.25}
          onDragEnd={(_, info) => {
            if (Math.abs(info.offset.x) > 40) setI((x) => (x + (info.offset.x < 0 ? 1 : n - 1)) % n);
          }}
        >
          <Image src={p.src} alt={p.alt || name} fill sizes="(min-width:1024px) 30vw, (min-width:640px) 45vw, 100vw" className="pointer-events-none object-cover" draggable={false} />
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-navy-3/45 to-transparent" />
      {n > 1 && (
        <div className="absolute bottom-3 left-1/2 z-[2] flex -translate-x-1/2 gap-1.5">
          {photos.map((ph, k) => (
            <button key={ph.src + k} type="button" aria-label={`${k + 1} / ${n}`} onClick={() => setI(k)} className={cn('h-1.5 rounded-full transition-[width,background-color] duration-500', k === i % n ? 'w-6 bg-ivory' : 'w-1.5 bg-ivory/50')} />
          ))}
        </div>
      )}
    </div>
  );
}
