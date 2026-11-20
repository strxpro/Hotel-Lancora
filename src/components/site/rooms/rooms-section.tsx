'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarSearch, Columns2, LayoutGrid, Plus, Rows3, SlidersHorizontal, Star, X } from 'lucide-react';
import type { AvailabilityResponse, RoomCardData, RoomResult } from '@/lib/room-card';
import type { FloorKey, Locale, RoomType } from '@/lib/types';
import type { TouristTax } from '@/lib/tourist-tax';
import { TaxNote } from './tax-note';
import { amenityLabel } from '@/content/amenities';
import { fmtDate } from '@/lib/dates';
import { fill, plural } from '@/lib/i18n/config';
import { cn, money } from '@/lib/utils';
import { useI18n, useIsDesktop, useLenis } from '../providers';
import { CountUp, Reveal, SplitHeading } from '../motion-kit';
import { RoomCard } from './room-card';
import { PriceHistogram } from './price-histogram';
import type { StayQuery } from '../booking/query';
import { ListSelect } from '../list-select';
import { REVIEWS_T } from '@/lib/i18n/reviews-dict';

const PAGE = 10;
const EASE = [0.22, 0.61, 0.12, 1] as const;
const FEATURES = ['vista_mare', 'balcone', 'patio', 'divano_letto', 'culla', 'salotto', 'insonorizzata', 'accessibile'];
type Sort = 'recommended' | 'priceAsc' | 'priceDesc' | 'popular';
type View = 'grid' | 'masonry' | 'list';
const VIEW_LIST: Record<Locale, string> = { it: 'Elenco', en: 'List', pl: 'Lista', de: 'Liste', fr: 'Liste', es: 'Lista' };
interface Filters {
  price: [number, number] | null;
  guests: number | null;
  types: RoomType[];
  floors: FloorKey[];
  features: string[];
  rated: boolean;
}
const EMPTY: Filters = { price: null, guests: null, types: [], floors: [], features: [], rated: false };

export function RoomsSection({
  rooms,
  results,
  query,
  onPickDates,
  onReset,
  onChangeDates,
  cashPercent = 0,
  tax = null,
}: {
  rooms: RoomCardData[];
  results: AvailabilityResponse | null;
  query: StayQuery;
  onPickDates: (checkIn: string, checkOut: string) => void;
  onReset: () => void;
  onChangeDates: () => void;
  cashPercent?: number;
  /** the town's tax, shown under the filters (not included in the prices) */
  tax?: TouristTax | null;
}) {
  const { t, locale } = useI18n();
  const desktop = useIsDesktop();
  const lenis = useLenis();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<Sort>('recommended');
  const [view, setView] = useState<View>('grid');
  // phones start with the slim strips (photo on the left, name and price on the right): more rooms on one screen
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setView('list');
  }, []);
  const [shown, setShown] = useState(PAGE);
  const [panel, setPanel] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  // the filters popover closes with a click outside it or Esc (desktop; the phone has its sheet)
  useEffect(() => {
    if (!panel || !desktop) return;
    const down = (e: PointerEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setPanel(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(false); };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [panel, desktop]);

  const base: RoomResult[] = useMemo(() => (results ? results.results : rooms.map((room) => ({ room, available: true, nights: 0, total: 0, averageNight: 0 }))), [results, rooms]);
  const priceOf = (r: RoomResult) => (results ? r.averageNight : r.room.basePrice);
  const prices = base.map(priceOf);
  const bounds: [number, number] = prices.length ? [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))] : [0, 100];
  const range = filters.price ?? bounds;

  const match = (r: RoomResult, f: Filters) =>
    (!f.price || (priceOf(r) >= f.price[0] && priceOf(r) <= f.price[1])) &&
    (!f.guests || r.room.maxGuests >= f.guests) &&
    (!f.types.length || f.types.includes(r.room.type)) &&
    (!f.floors.length || f.floors.includes(r.room.floor)) &&
    f.features.every((a) => r.room.amenities.includes(a)) &&
    (!f.rated || (r.room.rating?.avg ?? 0) >= 4);

  const list = useMemo(() => {
    const l = base.filter((r) => match(r, filters));
    if (sort === 'priceAsc') l.sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === 'priceDesc') l.sort((a, b) => priceOf(b) - priceOf(a));
    if (sort === 'popular') l.sort((a, b) => b.room.popularity - a.room.popularity);
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, filters, sort]);

  useEffect(() => setShown(PAGE), [filters, sort, results]);
  // prices show only with dates: a new search (or none) starts from clean filters
  useEffect(() => {
    setFilters(EMPTY);
    if (!results) setSort((s) => (s === 'priceAsc' || s === 'priceDesc' ? 'recommended' : s));
  }, [results]);

  const topId = useMemo(() => { const m = [...base].sort((a, b) => b.room.popularity - a.room.popularity)[0]; return m && m.room.popularity > 0 ? m.room.id : null; }, [base]);
  const visible = list.slice(0, shown);
  const remaining = list.length - visible.length;
  const activeCount = (filters.price ? 1 : 0) + (filters.guests ? 1 : 0) + filters.types.length + filters.floors.length + filters.features.length + (filters.rated ? 1 : 0);
  const hasRatings = base.some((r) => r.room.rating);
  const guests = query.adults + query.children;
  const types = [...new Set(base.map((r) => r.room.type))];
  const floors = [...new Set(base.map((r) => r.room.floor))];
  const features = FEATURES.filter((a) => base.some((r) => r.room.amenities.includes(a)));
  const toggle = <K extends 'types' | 'floors' | 'features'>(k: K, v: Filters[K][number]) => setFilters((f) => ({ ...f, [k]: (f[k] as string[]).includes(v as string) ? (f[k] as string[]).filter((x) => x !== v) : [...(f[k] as string[]), v] }));

  const chips: { key: string; label: string; clear: () => void }[] = [
    ...(filters.price ? [{ key: 'p', label: `${money(filters.price[0], locale)} – ${money(filters.price[1], locale)}`, clear: () => setFilters((f) => ({ ...f, price: null })) }] : []),
    ...(filters.guests ? [{ key: 'g', label: `${filters.guests}+ ${t.search.guests.toLowerCase()}`, clear: () => setFilters((f) => ({ ...f, guests: null })) }] : []),
    ...filters.types.map((v) => ({ key: `t${v}`, label: t.roomTypes[v], clear: () => toggle('types', v) })),
    ...filters.floors.map((v) => ({ key: `f${v}`, label: t.floor[v], clear: () => toggle('floors', v) })),
    ...filters.features.map((v) => ({ key: `a${v}`, label: amenityLabel(v, locale), clear: () => toggle('features', v) })),
    ...(filters.rated ? [{ key: 'r', label: REVIEWS_T[locale].minRating, clear: () => setFilters((f) => ({ ...f, rated: false })) }] : []),
  ];

  const chip = (on: boolean) => cn('rounded-full border px-3 py-1.5 text-[0.75rem] transition-colors duration-300', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50');
  const preview = base.filter((r) => match(r, filters)).length;

  const panelBody = (
    <div className="space-y-5">
      {bounds[1] > bounds[0] && (
        <div>
          <p className="label">{t.rooms.f.price}</p>
          <PriceHistogram points={base.map((r) => ({ price: priceOf(r), weight: r.room.popularity }))} bounds={bounds} value={range} onChange={(v) => setFilters((f) => ({ ...f, price: v }))} />
        </div>
      )}
      <div className="space-y-5">
        <div>
          <p className="label">{t.rooms.f.guests}</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" aria-pressed={filters.guests === n} onClick={() => setFilters((f) => ({ ...f, guests: f.guests === n ? null : n }))} className={chip(filters.guests === n)}>
                {n}
                {n === 4 ? '+' : ''}
              </button>
            ))}
          </div>
        </div>
        {hasRatings && (
          <div>
            <p className="label">{REVIEWS_T[locale].title}</p>
            <button type="button" aria-pressed={filters.rated} onClick={() => setFilters((f) => ({ ...f, rated: !f.rated }))} className={cn(chip(filters.rated), 'inline-flex items-center gap-1.5')}>
              <Star className="h-3.5 w-3.5" fill="currentColor" /> {REVIEWS_T[locale].minRating}
            </button>
          </div>
        )}
        <div>
          <p className="label">{t.rooms.f.type}</p>
          <div className="flex flex-wrap gap-2">
            {types.map((v) => (
              <button key={v} type="button" aria-pressed={filters.types.includes(v)} onClick={() => toggle('types', v)} className={chip(filters.types.includes(v))}>
                {t.roomTypes[v]}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div>
            <p className="label">{t.rooms.f.floor}</p>
            <div className="flex flex-wrap gap-2">
              {floors.map((v) => (
                <button key={v} type="button" aria-pressed={filters.floors.includes(v)} onClick={() => toggle('floors', v)} className={chip(filters.floors.includes(v))}>
                  {t.floor[v]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="label">{t.rooms.f.amenities}</p>
            <div className="flex flex-wrap gap-2">
              {features.map((v) => (
                <button key={v} type="button" aria-pressed={filters.features.includes(v)} onClick={() => toggle('features', v)} className={chip(filters.features.includes(v))}>
                  {amenityLabel(v, locale)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <button type="button" onClick={() => setFilters(EMPTY)} className="link-u text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-mist hover:text-navy">
          {t.rooms.f.reset}
        </button>
        <button type="button" onClick={() => setPanel(false)} className="btn btn-navy h-10 min-h-0 px-5 text-[0.66rem]">
          {plural(locale, preview, t.rooms.f.show)}
        </button>
      </div>
    </div>
  );

  const left = visible.filter((_, i) => i % 2 === 0);
  const right = visible.filter((_, i) => i % 2 === 1);
  // live changes (a room hidden or published from the panel): the others slide to their new place
  const card = (r: RoomResult, i: number, tall = false) => (
    <motion.div key={r.room.id} className="h-full" layout="position" exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.35 } }} transition={{ layout: { type: 'spring', stiffness: 260, damping: 32 } }}>
    <RoomCard room={r.room} index={i} query={results ? query : null} result={results ? r : null} delay={(i % PAGE) < 3 ? (i % 3) * 0.08 : 0} cashPercent={cashPercent} variant={view} tall={tall} top={r.room.id === topId} />
    </motion.div>
  );

  return (
    <section id="camere" aria-labelledby="camere-title" className="relative scroll-mt-24 bg-ivory py-20 md:py-28">
      <div className="container-x">
        <div className="grid gap-8 md:grid-cols-12 md:items-end">
          <div className="md:col-span-7">
            <p className="eyebrow text-gold-2">{t.rooms.eyebrow}</p>
            <SplitHeading as="h2" className="display mt-4 text-headline text-navy">
              <span id="camere-title">{t.rooms.title}</span>
            </SplitHeading>
          </div>
          <Reveal className="md:col-span-5 md:col-start-8 lg:col-span-4 lg:col-start-9">
            {results ? (
              <div aria-live="polite">
                <p className="serif text-[2.6rem] leading-none text-navy">
                  <CountUp value={results.count} />
                  <span className="ml-3 text-xl text-mist">/ {plural(locale, results.count, t.rooms.results).replace(/^\d+\s*/, '')}</span>
                </p>
                <p className="mt-3 text-sm text-mist">
                  {fmtDate(results.query.checkIn, locale, { weekday: 'short', day: 'numeric', month: 'long' })} → {fmtDate(results.query.checkOut, locale, { weekday: 'short', day: 'numeric', month: 'long' })} · {plural(locale, guests, t.search.guestsCount)}
                </p>
                <p className="mt-1 text-xs text-mist/80">{fill(t.rooms.capacityNote, { guests: plural(locale, guests, t.search.guestsCount) })}</p>
                <div className="mt-4 flex gap-6">
                  <button type="button" onClick={onChangeDates} className="link-u text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-navy">
                    {t.rooms.changeDates}
                  </button>
                  <button type="button" onClick={onReset} className="link-u text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-mist">
                    {t.rooms.resetSearch}
                  </button>
                </div>
              </div>
            ) : (
              <p className="max-w-md text-[1.02rem] leading-relaxed text-charcoal/80">{t.rooms.intro}</p>
            )}
          </Reveal>
        </div>

        {base.length > 0 && (
          <div className="mt-10 md:mt-14">
            <div className="flex flex-wrap items-center gap-2.5">
              <div ref={popRef} className="relative">
                <button type="button" onClick={() => setPanel((p) => !p)} aria-expanded={panel} className={cn('flex h-12 items-center gap-2.5 rounded-full border pl-4 pr-3 text-sm font-semibold transition-colors', panel || activeCount ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50')}>
                  <SlidersHorizontal className="h-4 w-4" />
                  {t.rooms.f.title}
                  <span className={cn('flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[0.7rem]', activeCount ? 'bg-gold text-navy-3' : 'bg-navy/[0.07] text-navy')}>{activeCount || <Plus className="h-3 w-3" />}</span>
                </button>
                {desktop && (
                  <AnimatePresence>
                    {panel && (
                      <motion.div
                        role="dialog"
                        aria-label={t.rooms.f.title}
                        data-lenis-prevent
                        initial={{ opacity: 0, y: -8, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.28, ease: EASE }}
                        style={{ transformOrigin: 'top left' }}
                        className="absolute left-0 top-full z-40 mt-2.5 max-h-[min(70vh,40rem)] w-[25rem] overflow-y-auto rounded-[1.4rem] border border-line bg-white p-5 shadow-[0_34px_80px_-36px_rgba(16,40,61,0.55)]"
                      >
                        {panelBody}
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </div>
              <AnimatePresence initial={false}>
                {chips.map((c) => (
                  <motion.button key={c.key} type="button" layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} onClick={c.clear} className="flex h-9 items-center gap-1.5 rounded-full bg-sand-2 pl-3.5 pr-2 text-xs text-navy hover:bg-sand">
                    {c.label}
                    <X className="h-3.5 w-3.5" />
                  </motion.button>
                ))}
              </AnimatePresence>
              <div className="ml-auto flex items-center gap-2">
                <span className="hidden text-xs text-mist sm:block">{fill(t.rooms.f.of, { shown: Math.min(shown, list.length), total: list.length })}</span>
                <ListSelect value={sort} onChange={setSort} label={t.rooms.f.sort} options={(results ? (['recommended', 'priceAsc', 'priceDesc', 'popular'] as Sort[]) : (['recommended', 'popular'] as Sort[])).map((s) => ({ value: s, label: t.rooms.f[s] }))} />
                <div role="radiogroup" aria-label={`${t.rooms.f.grid} / ${t.rooms.f.masonry} / ${VIEW_LIST[locale]}`} className="relative flex h-12 rounded-full border border-line bg-white p-1">
                  {(['grid', 'masonry', 'list'] as View[]).map((v) => {
                    const label = v === 'list' ? VIEW_LIST[locale] : t.rooms.f[v];
                    return (
                      <button key={v} type="button" role="radio" aria-checked={view === v} aria-label={label} title={label} onClick={() => setView(v)} className={cn('relative z-[1] w-10 items-center justify-center rounded-full transition-colors', v === 'masonry' ? 'hidden sm:flex' : 'flex', view === v ? 'text-ivory' : 'text-mist hover:text-navy')}>
                        {view === v && <motion.span layoutId="view-pill" className="absolute inset-0 -z-[1] rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                        {v === 'grid' ? <LayoutGrid className="h-4 w-4" /> : v === 'masonry' ? <Columns2 className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {tax && <TaxNote tax={tax} className="mt-4" />}
          </div>
        )}

        {view === 'list' ? (
          <div key={`list-${sort}`} className="mt-6 flex flex-col gap-3 sm:gap-5 md:mt-8 md:gap-6">
            <AnimatePresence mode="popLayout" initial={false}>{visible.map((r, i) => card(r, i))}</AnimatePresence>
          </div>
        ) : view === 'grid' ? (
          <div key={`grid-${sort}`} className="mt-8 grid gap-5 sm:grid-cols-2 md:gap-6 xl:grid-cols-3">
            <AnimatePresence mode="popLayout" initial={false}>{visible.map((r, i) => card(r, i))}</AnimatePresence>
          </div>
        ) : (
          <div key={`masonry-${sort}`} className="mt-8 grid grid-cols-2 gap-3 sm:gap-6">
            <div className="flex flex-col gap-3 sm:gap-6"><AnimatePresence mode="popLayout" initial={false}>{left.map((r, i) => card(r, i * 2, i % 2 === 0))}</AnimatePresence></div>
            <div className="flex flex-col gap-3 pt-16 sm:gap-6 sm:pt-28"><AnimatePresence mode="popLayout" initial={false}>{right.map((r, i) => card(r, i * 2 + 1, i % 2 === 1))}</AnimatePresence></div>
          </div>
        )}

        {base.length > 0 && list.length === 0 && (
          <div className="mt-10 text-center">
            <p className="text-sm text-mist">{t.rooms.filters.none}</p>
            <button type="button" onClick={() => setFilters(EMPTY)} className="btn btn-line mt-4 text-navy">
              {t.rooms.f.reset}
            </button>
          </div>
        )}
        {remaining > 0 && (
          <div className="mt-12 flex flex-col items-center gap-3">
            <div className="h-1 w-48 overflow-hidden rounded-full bg-sand">
              <motion.div className="h-full rounded-full bg-navy" animate={{ width: `${(visible.length / list.length) * 100}%` }} transition={{ duration: 0.6 }} />
            </div>
            <p className="text-xs text-mist">{fill(t.rooms.f.of, { shown: visible.length, total: list.length })}</p>
            <button type="button" onClick={() => { setShown((s) => s + PAGE); window.setTimeout(() => lenis.current?.resize(), 50); }} className="btn btn-line mt-1 text-navy">
              <Plus className="h-4 w-4" /> {fill(t.rooms.f.more, { n: Math.min(PAGE, remaining) })}
            </button>
          </div>
        )}
        {results && results.count === 0 && <EmptyState results={results} onPick={onPickDates} onChange={onChangeDates} />}
      </div>

      {!desktop &&
        typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {panel && (
              <div className="fixed inset-0 z-[90] flex flex-col justify-end">
                <motion.button type="button" aria-label={t.common.close} className="absolute inset-0 bg-navy-3/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPanel(false)} />
                <motion.div role="dialog" aria-modal="true" aria-label={t.rooms.f.title} data-lenis-prevent className="relative max-h-[88svh] overflow-y-auto rounded-t-[1.75rem] bg-ivory px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.5, ease: EASE }}>
                  <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center justify-between bg-ivory px-4 pb-2 pt-1">
                    <p className="serif text-2xl text-navy">{t.rooms.f.title}</p>
                    <button type="button" onClick={() => setPanel(false)} aria-label={t.common.close} className="flex h-11 w-11 items-center justify-center rounded-full bg-sand-2 text-navy">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  {panelBody}
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </section>
  );
}

function EmptyState({ results, onPick, onChange }: { results: AvailabilityResponse; onPick: (ci: string, co: string) => void; onChange: () => void }) {
  const { t, locale } = useI18n();
  return (
    <Reveal className="mx-auto mt-4 max-w-3xl rounded-[1.75rem] border border-line bg-white/60 px-6 py-14 text-center md:px-16">
      <CalendarSearch className="mx-auto h-9 w-9 text-gold" strokeWidth={1.2} />
      <h3 className="serif mt-6 text-[2.2rem] leading-tight text-navy">{t.rooms.noneTitle}</h3>
      <p className="mx-auto mt-4 max-w-lg text-charcoal/75">{results.alternatives.length ? t.rooms.noneText : t.rooms.noneAlt}</p>
      {results.alternatives.length > 0 && (
        <ul className="mt-10 grid gap-3 sm:grid-cols-3">
          {results.alternatives.map((a) => (
            <li key={a.checkIn}>
              <button type="button" onClick={() => onPick(a.checkIn, a.checkOut)} className="group w-full rounded-2xl border border-line bg-ivory px-4 py-5 text-left transition-colors hover:border-navy">
                <span className="block text-sm text-navy">
                  {fmtDate(a.checkIn, locale, { day: 'numeric', month: 'short' })} → {fmtDate(a.checkOut, locale, { day: 'numeric', month: 'short' })}
                </span>
                <span className="mt-1 block text-xs text-mist">
                  {plural(locale, a.count, t.rooms.results)} · {t.rooms.from} {money(a.from, locale)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onChange} className="btn btn-line mt-10 text-navy">
        {t.rooms.changeDates}
      </button>
    </Reveal>
  );
}
