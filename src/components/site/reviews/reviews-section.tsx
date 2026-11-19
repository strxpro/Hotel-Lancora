'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, ArrowUpDown, BadgeCheck, Camera, MessageCircle, PenLine, Star, X } from 'lucide-react';
import { fill } from '@/lib/i18n/config';
import { EXTRA_T, WALL_T } from '@/lib/i18n/reviews-dict';
import { fmtDate } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { useI18n, useLenis } from '../providers';
import { SplitHeading } from '../motion-kit';
import { ListSelect } from '../list-select';
import { ReviewForm, ReviewItem, Stars, useReviewsT, type ReviewView } from './reviews-ui';

/** Bottom sheet on phones, centred card on desktop. */
export function SiteModal({ open, onClose, label, children, wide = false }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode; wide?: boolean }) {
  const lenis = useLenis();
  useEffect(() => {
    if (!open) return;
    lenis.current?.stop();
    const html = document.documentElement;
    html.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      lenis.current?.start();
      html.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, lenis]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center" data-review-full>
          <motion.button type="button" aria-label="×" onClick={onClose} className="absolute inset-0 bg-navy-3/55 backdrop-blur-[4px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            data-review-full
            data-lenis-prevent
            initial={{ y: 60, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 50, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className={cn('thin-scroll relative z-[1] max-h-[92svh] w-full overflow-y-auto overscroll-contain rounded-t-[2rem] bg-ivory p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_40px_120px_-30px_rgba(5,15,25,0.8)] sm:rounded-[2rem] sm:p-7', wide ? 'sm:max-w-2xl' : 'sm:max-w-xl')}
          >
            <button type="button" onClick={onClose} aria-label="×" className="absolute right-4 top-4 z-[2] flex h-10 w-10 items-center justify-center rounded-full bg-navy text-ivory transition-transform hover:rotate-90">
              <X className="h-4 w-4" />
            </button>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

const EASE = [0.16, 1, 0.3, 1] as const;
type Room = { id: string; number: string; name: string };
type StarFilter = 5 | 4 | 3 | null;
const starOk = (r: ReviewView, s: StarFilter) => s === null || (s === 3 ? r.rating <= 3 : r.rating === s);

/**
 * Home: what guests say, at a glance.
 *  · a header with the score (average, how many, % who recommend) and "write a review";
 *  · simple filters (stars, with photos, room);
 *  · a row of clear cards you can swipe or scroll with the arrows; a card opens the full review
 *    (photos, the hotel's answer, reply form);
 *  · "see all" opens the wall with every review.
 */
export function ReviewsSection({ reviews, rooms }: { reviews: ReviewView[]; rooms: Room[] }) {
  const { t, locale } = useI18n();
  const rt = useReviewsT();
  const x = EXTRA_T[locale];
  const [room, setRoom] = useState<string>('all');
  const [stars, setStars] = useState<StarFilter>(null);
  const [photos, setPhotos] = useState(false);
  const [open, setOpen] = useState<ReviewView | null>(null);
  const [write, setWrite] = useState(false);
  const [all, setAll] = useState(false);
  const closeAll = useCallback(() => setAll(false), []);
  const row = useRef<HTMLUListElement>(null);

  const byRoom = useMemo(() => (room === 'all' ? reviews : reviews.filter((r) => r.room?.id === room)), [reviews, room]);
  const list = useMemo(() => byRoom.filter((r) => starOk(r, stars) && (!photos || r.photos.length > 0)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [byRoom, stars, photos]);
  const avg = byRoom.length ? byRoom.reduce((s, r) => s + r.rating, 0) / byRoom.length : 0;
  const rec = byRoom.length ? Math.round((byRoom.filter((r) => r.rating >= 4).length / byRoom.length) * 100) : 0;
  const reviewedRooms = rooms.filter((r) => reviews.some((v) => v.room?.id === r.id));
  const count = (s: StarFilter) => byRoom.filter((r) => starOk(r, s)).length;
  const chips: { k: string; label: React.ReactNode; on: boolean; n: number; act: () => void }[] = [
    { k: 'all', label: x.all, on: stars === null && !photos, n: byRoom.length, act: () => (setStars(null), setPhotos(false)) },
    { k: '5', label: <>5 <Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 5, n: count(5), act: () => setStars(stars === 5 ? null : 5) },
    { k: '4', label: <>4 <Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 4, n: count(4), act: () => setStars(stars === 4 ? null : 4) },
    { k: '3', label: <>≤ 3 <Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 3, n: count(3), act: () => setStars(stars === 3 ? null : 3) },
    { k: 'p', label: <><Camera className="h-3.5 w-3.5" /> {x.withPhotos}</>, on: photos, n: byRoom.filter((r) => r.photos.length > 0).length, act: () => setPhotos((p) => !p) },
  ];
  const slide = (d: number) => {
    const el = row.current;
    const card = el?.querySelector('li');
    if (el && card) el.scrollBy({ left: d * (card.getBoundingClientRect().width + 16), behavior: 'smooth' });
  };

  return (
    <section id="recensioni" aria-labelledby="reviews-title" className="relative bg-ivory-2 py-20 md:py-28">
      <div className="container-x">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow text-gold-2">{t.sections.testimonialsEyebrow}</p>
            <SplitHeading as="h2" className="display mt-4 max-w-[16ch] text-[clamp(2.2rem,3.8vw,3.8rem)] text-navy">
              <span id="reviews-title">{t.sections.testimonialsTitle}</span>
            </SplitHeading>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-full bg-white py-2 pl-2 pr-5 ring-1 ring-line">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy text-[1.05rem] font-semibold text-gold">{avg ? avg.toFixed(1).replace('.', ',') : '—'}</span>
              <span className="leading-tight">
                <Stars value={avg} size="h-4 w-4" />
                <span className="mt-1 block text-xs text-mist">
                  {byRoom.length === 1 ? rt.one : fill(rt.count, { n: byRoom.length })}
                  {byRoom.length > 0 && <> · {fill(x.recommend, { p: rec })}</>}
                </span>
              </span>
            </div>
            <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => setWrite(true)} className="btn btn-navy h-[3.25rem] min-h-0 px-6">
              <PenLine className="h-4 w-4" /> {rt.leave}
            </motion.button>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            {chips.map((c) => (
              <button key={c.k} type="button" aria-pressed={c.on} disabled={!c.n && !c.on} onClick={() => (c.act(), row.current?.scrollTo({ left: 0, behavior: 'smooth' }))} className={cn('relative flex h-10 shrink-0 items-center gap-1 rounded-full px-4 text-[0.8rem] font-semibold transition-colors disabled:opacity-35', c.on ? 'text-ivory' : 'bg-white text-navy ring-1 ring-line hover:ring-navy/30')}>
                {c.on && <motion.span layoutId="rev-chip" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span className="relative flex items-center gap-1">{c.label}</span>
                <span className={cn('relative ml-1 rounded-full px-1.5 text-[0.66rem]', c.on ? 'bg-white/15' : 'bg-sand-2/70 text-mist')}>{c.n}</span>
              </button>
            ))}
          </div>
          {reviewedRooms.length > 0 && (
            <ListSelect
              className="sm:ml-auto"
              label={rt.room}
              value={room}
              onChange={(v) => setRoom(v)}
              options={[{ value: 'all', label: rt.allRooms }, ...reviewedRooms.map((r) => ({ value: r.id, label: r.number ? `${rt.room} ${r.number} · ${r.name}` : r.name }))]}
            />
          )}
        </div>

        {list.length === 0 ? (
          <div className="mt-6 flex min-h-[220px] flex-col items-center justify-center rounded-[2rem] border border-dashed border-line p-10 text-center">
            <p className="text-lg text-navy">{rt.empty}</p>
            <button type="button" onClick={() => setWrite(true)} className="btn btn-line mt-5 h-11 min-h-0 text-navy">
              <PenLine className="h-4 w-4" /> {rt.leave}
            </button>
          </div>
        ) : (
          <>
            <ul ref={row} className="no-scrollbar -mx-4 mt-6 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-3 pt-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
              {list.slice(0, 12).map((r, i) => (
                <motion.li key={r.id} initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-30px' }} transition={{ duration: 0.6, ease: EASE, delay: Math.min(i, 4) * 0.06 }} className="w-[86%] shrink-0 snap-start sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.7rem)]">
                  <ReviewCard r={r} onOpen={() => setOpen(r)} />
                </motion.li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="hidden gap-2 sm:flex">
                <button type="button" aria-label={x.prev} onClick={() => slide(-1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-navy ring-1 ring-line transition-colors hover:bg-navy hover:text-ivory">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button type="button" aria-label={x.next} onClick={() => slide(1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-navy ring-1 ring-line transition-colors hover:bg-navy hover:text-ivory">
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              <button type="button" onClick={() => setAll(true)} className="group ml-auto flex h-11 items-center gap-2 rounded-full pl-5 pr-1.5 text-sm font-semibold text-navy ring-1 ring-navy/20 transition-colors hover:bg-navy hover:text-ivory">
                {fill(x.seeAll, { n: byRoom.length })}
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-ivory transition-transform group-hover:translate-x-0.5 group-hover:bg-gold group-hover:text-navy-3">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      <SiteModal open={Boolean(open)} onClose={() => setOpen(null)} label={rt.title} wide>
        {open && <ReviewItem r={open} />}
      </SiteModal>
      <SiteModal open={write} onClose={() => setWrite(false)} label={rt.leave}>
        <ReviewForm rooms={rooms} title={rt.leave} onDone={() => setWrite(false)} />
      </SiteModal>
      <ReviewsWall open={all} onClose={closeAll} reviews={byRoom} initialStars={stars} onWrite={() => setWrite(true)} />
    </section>
  );
}

/** A review in the row: stars, the words, the photos, who wrote it — one tap opens it all. */
function ReviewCard({ r, onOpen }: { r: ReviewView; onOpen: () => void }) {
  const rt = useReviewsT();
  const { locale } = useI18n();
  const x = EXTRA_T[locale];
  return (
    <button type="button" onClick={onOpen} className="group flex h-full w-full flex-col rounded-[1.6rem] bg-white p-5 text-left ring-1 ring-line transition-[box-shadow,transform] duration-500 hover:-translate-y-1 hover:shadow-[0_28px_50px_-32px_rgba(16,40,61,0.55)] md:p-6">
      <span className="flex items-center justify-between gap-2">
        <Stars value={r.rating} size="h-4 w-4" />
        <span className="text-[0.72rem] text-mist">{fmtDate(r.createdAt.slice(0, 10), locale, { month: 'short', year: 'numeric' })}</span>
      </span>
      <span className="mt-4 line-clamp-5 flex-1 text-[0.98rem] leading-relaxed text-charcoal">{r.text}</span>
      {r.photos.length > 0 && (
        <span className="mt-4 flex gap-1.5">
          {r.photos.slice(0, 3).map((p) => (
            <span key={p} className="relative h-14 w-14 overflow-hidden rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            </span>
          ))}
        </span>
      )}
      <span className="mt-5 flex items-center gap-2.5 border-t border-line pt-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-semibold text-gold">{r.name.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1 truncate text-sm font-semibold text-navy">
            {r.name}
            {r.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sage" aria-label={rt.verified} />}
          </span>
          {r.room && <span className="block truncate text-[0.7rem] text-mist">{r.room.number ? `${rt.room} ${r.room.number} · ` : ''}{r.room.name}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-navy">
          {r.replies.length > 0 && (
            <span className="mr-1 flex items-center gap-0.5 font-normal text-mist">
              <MessageCircle className="h-3.5 w-3.5" /> {r.replies.length}
            </span>
          )}
          {x.read}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </button>
  );
}

type Sort = 'new' | 'best' | 'low';

/**
 * Every review, made for reading and answering.
 *  · desktop: a calm side panel (score, how the stars are spread — each row is a filter —, photos,
 *    "write a review") next to ONE column of reviews at a comfortable reading width;
 *  · phone: full screen, score + filters + sort pinned on top, the same single column;
 *  · every review shows the hotel's answer and its own "Rispondi": the reply opens right there.
 * More reviews load by themselves as you reach the end.
 */
function ReviewsWall({ open, onClose, reviews, initialStars, onWrite }: { open: boolean; onClose: () => void; reviews: ReviewView[]; initialStars: StarFilter; onWrite: () => void }) {
  const rt = useReviewsT();
  const { locale } = useI18n();
  const x = EXTRA_T[locale];
  const w = WALL_T[locale];
  const lenis = useLenis();
  const [stars, setStars] = useState<StarFilter>(initialStars);
  const [photos, setPhotos] = useState(false);
  const [sort, setSort] = useState<Sort>('new');
  const [n, setN] = useState(10);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setStars(initialStars);
    setPhotos(false);
    setSort('new');
    setN(10);
    lenis.current?.stop();
    const html = document.documentElement;
    html.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"][data-review-full]') && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      lenis.current?.start();
      html.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open, initialStars, lenis, onClose]);

  const list = useMemo(() => {
    const l = reviews.filter((r) => starOk(r, stars) && (!photos || r.photos.length > 0));
    const byDate = (a: ReviewView, b: ReviewView) => b.createdAt.localeCompare(a.createdAt);
    return l.sort(sort === 'best' ? (a, b) => b.rating - a.rating || byDate(a, b) : sort === 'low' ? (a, b) => a.rating - b.rating || byDate(a, b) : byDate);
  }, [reviews, stars, photos, sort]);

  // load the next reviews when the end of the list comes into view
  useEffect(() => {
    const el = sentinel.current;
    const root = scroller.current;
    if (!open || !el || !root) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setN((v) => v + 10), { root, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [open, list.length, n]);

  const count = (s: StarFilter) => reviews.filter((r) => starOk(r, s)).length;
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const rec = reviews.length ? Math.round((reviews.filter((r) => r.rating >= 4).length / reviews.length) * 100) : 0;
  const withPhotos = reviews.filter((r) => r.photos.length > 0).length;
  const change = (fn: () => void) => {
    fn();
    setN(10);
    scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const rows: { s: StarFilter; label: React.ReactNode }[] = [
    { s: 5, label: '5' },
    { s: 4, label: '4' },
    { s: 3, label: '1–3' },
  ];
  const sorts: { k: Sort; label: string }[] = [
    { k: 'new', label: w.newest },
    { k: 'best', label: w.best },
    { k: 'low', label: w.lowest },
  ];
  const chips: { k: string; label: React.ReactNode; on: boolean; act: () => void; n: number }[] = [
    { k: 'all', label: x.all, on: stars === null && !photos, act: () => (setStars(null), setPhotos(false)), n: reviews.length },
    { k: '5', label: <>5<Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 5, act: () => setStars(stars === 5 ? null : 5), n: count(5) },
    { k: '4', label: <>4<Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 4, act: () => setStars(stars === 4 ? null : 4), n: count(4) },
    { k: '3', label: <>≤3<Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 3, act: () => setStars(stars === 3 ? null : 3), n: count(3) },
    { k: 'p', label: <><Camera className="h-3.5 w-3.5" /> {x.withPhotos}</>, on: photos, act: () => setPhotos((p) => !p), n: withPhotos },
  ];

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="wall" className="fixed inset-0 z-[125]" role="dialog" aria-modal="true" aria-label={rt.title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <button type="button" aria-label={rt.close} onClick={onClose} className="absolute inset-0 cursor-default bg-navy-3/60 backdrop-blur-[6px]" />
          <motion.div
            className="absolute inset-0 flex overflow-hidden bg-ivory shadow-[0_50px_140px_-40px_rgba(5,15,25,0.85)] md:inset-4 md:rounded-[2rem] lg:inset-y-5 lg:left-[max(1.25rem,calc(50vw-640px))] lg:right-[max(1.25rem,calc(50vw-640px))]"
            initial={{ y: 48, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 36, opacity: 0, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            {/* side panel (tablet/desktop): the score and the filters, always in view */}
            <aside className="hidden w-[300px] shrink-0 flex-col border-r border-line bg-ivory-2 p-7 md:flex lg:w-[330px] lg:p-8">
              <p className="eyebrow text-gold-2">{rt.title}</p>
              <div className="mt-5 flex items-end gap-3">
                <span className="display text-[4.6rem] leading-[0.8] text-navy">{avg ? avg.toFixed(1).replace('.', ',') : '—'}</span>
                <span className="pb-1">
                  <Stars value={avg} size="h-4 w-4" />
                  <span className="mt-1 block text-xs text-mist">{reviews.length === 1 ? rt.one : fill(rt.count, { n: reviews.length })}</span>
                </span>
              </div>
              <p className="mt-4 flex items-center gap-2 rounded-xl bg-sage/10 px-3 py-2 text-[0.8rem] font-medium text-[#3f5a35]">
                <BadgeCheck className="h-4 w-4" /> {fill(x.recommend, { p: rec })}
              </p>

              <p className="label mb-2 mt-8">{w.filters}</p>
              <ul className="space-y-1">
                {rows.map((row) => {
                  const c = count(row.s);
                  const on = stars === row.s;
                  return (
                    <li key={String(row.s)}>
                      <button type="button" disabled={!c && !on} aria-pressed={on} onClick={() => change(() => setStars(on ? null : row.s))} className={cn('group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[0.82rem] transition-colors disabled:opacity-35', on ? 'bg-navy text-ivory' : 'text-navy hover:bg-white')}>
                        <span className="flex w-9 shrink-0 items-center gap-1 font-semibold">
                          {row.label} <Star className={cn('h-3 w-3', on ? 'text-gold' : 'text-gold')} fill="currentColor" strokeWidth={0} />
                        </span>
                        <span className={cn('relative h-1.5 flex-1 overflow-hidden rounded-full', on ? 'bg-white/20' : 'bg-navy/10')}>
                          <motion.span className="absolute inset-y-0 left-0 rounded-full bg-gold" initial={{ width: 0 }} animate={{ width: `${reviews.length ? (c / reviews.length) * 100 : 0}%` }} transition={{ duration: 0.9, ease: EASE, delay: 0.15 }} />
                        </span>
                        <span className={cn('w-6 text-right text-[0.75rem] tabular-nums', on ? 'text-ivory/80' : 'text-mist')}>{c}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" disabled={!withPhotos && !photos} aria-pressed={photos} onClick={() => change(() => setPhotos((p) => !p))} className="mt-3 flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-[0.82rem] text-navy transition-colors hover:bg-white disabled:opacity-35">
                <span className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-gold-2" /> {x.withPhotos} <span className="text-[0.75rem] text-mist">({withPhotos})</span>
                </span>
                <span className={cn('relative h-5 w-9 rounded-full transition-colors', photos ? 'bg-navy' : 'bg-navy/15')}>
                  <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }} className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow', photos ? 'right-0.5' : 'left-0.5')} />
                </span>
              </button>
              {(stars !== null || photos) && (
                <button type="button" onClick={() => change(() => (setStars(null), setPhotos(false)))} className="mt-2 w-fit px-2.5 text-[0.75rem] font-semibold text-navy underline decoration-gold underline-offset-4">
                  {w.clear}
                </button>
              )}

              <button type="button" onClick={onWrite} className="btn btn-navy mt-auto h-12 min-h-0 w-full">
                <PenLine className="h-4 w-4" /> {rt.leave}
              </button>
            </aside>

            {/* the reading column */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="z-[2] border-b border-line bg-ivory/95 px-4 pb-3 pt-[max(0.85rem,env(safe-area-inset-top))] backdrop-blur sm:px-6 md:pt-4">
                <div className="flex items-center gap-3">
                  <span className="display text-[2.5rem] leading-none text-navy md:hidden">{avg ? avg.toFixed(1).replace('.', ',') : '—'}</span>
                  <span className="min-w-0 flex-1">
                    <Stars value={avg} size="h-3.5 w-3.5" className="md:hidden" />
                    <span className="block truncate text-xs text-mist md:text-[0.95rem] md:font-semibold md:text-navy">
                      {list.length === reviews.length ? fill(rt.count, { n: reviews.length }) : fill(x.filtered, { n: list.length, t: reviews.length })}
                    </span>
                  </span>
                  <div className="hidden items-center gap-1 rounded-full bg-white p-1 ring-1 ring-line md:flex" role="group" aria-label={w.sort}>
                    {sorts.map((s) => (
                      <button key={s.k} type="button" aria-pressed={sort === s.k} onClick={() => change(() => setSort(s.k))} className={cn('relative h-8 rounded-full px-3.5 text-[0.75rem] font-semibold transition-colors', sort === s.k ? 'text-ivory' : 'text-navy hover:bg-navy/5')}>
                        {sort === s.k && <motion.span layoutId="wall-sort" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                        <span className="relative">{s.label}</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={onClose} aria-label={rt.close} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-ivory transition-transform duration-300 hover:rotate-90">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {/* phone: filters + sort */}
                <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 md:hidden">
                  {chips.map((c) => (
                    <button key={c.k} type="button" aria-pressed={c.on} disabled={!c.n && !c.on} onClick={() => change(c.act)} className={cn('relative flex h-9 shrink-0 items-center gap-1 rounded-full px-3.5 text-xs font-semibold transition-colors disabled:opacity-35', c.on ? 'text-ivory' : 'bg-white text-navy ring-1 ring-line')}>
                      {c.on && <motion.span layoutId="wall-chip" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                      <span className="relative flex items-center gap-1">{c.label}</span>
                      <span className={cn('relative ml-0.5 rounded-full px-1.5 text-[0.62rem]', c.on ? 'bg-white/15' : 'bg-sand-2/70 text-mist')}>{c.n}</span>
                    </button>
                  ))}
                </div>
                <div className="no-scrollbar -mx-4 mt-2 flex items-center gap-1 overflow-x-auto px-4 md:hidden" role="group" aria-label={w.sort}>
                  <ArrowUpDown className="mr-1 h-3.5 w-3.5 shrink-0 text-mist" />
                  {sorts.map((s) => (
                    <button key={s.k} type="button" aria-pressed={sort === s.k} onClick={() => change(() => setSort(s.k))} className={cn('h-8 shrink-0 rounded-full px-3 text-[0.72rem] font-semibold transition-colors', sort === s.k ? 'bg-gold/20 text-navy' : 'text-mist')}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div ref={scroller} data-lenis-prevent className="thin-scroll flex-1 overflow-y-auto overscroll-contain">
                <div className="mx-auto max-w-[720px] px-3 pb-24 pt-4 sm:px-6 md:pb-10 md:pt-7">
                  {list.length === 0 ? (
                    <div className="mt-10 flex flex-col items-center rounded-3xl border border-dashed border-line p-10 text-center">
                      <p className="text-navy">{w.noMatch}</p>
                      <button type="button" onClick={() => change(() => (setStars(null), setPhotos(false)))} className="btn btn-line mt-4 h-10 min-h-0 px-5 text-navy">
                        {w.clear}
                      </button>
                    </div>
                  ) : (
                    <div key={`${stars}-${photos}-${sort}`} className="space-y-3 sm:space-y-4">
                      {list.slice(0, n).map((r, i) => (
                        <motion.div key={r.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: Math.min(i % 10, 5) * 0.05, ease: EASE }}>
                          <ReviewItem r={r} flat />
                        </motion.div>
                      ))}
                    </div>
                  )}
                  {list.length > n && <div ref={sentinel} className="h-10" aria-hidden="true" />}
                </div>
              </div>

              {/* phone: write a review, always at hand */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-ivory via-ivory/80 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6 md:hidden">
                <button type="button" onClick={onWrite} className="btn btn-navy pointer-events-auto h-12 min-h-0 px-6 shadow-[0_18px_40px_-18px_rgba(16,40,61,0.7)]">
                  <PenLine className="h-4 w-4" /> {rt.leave}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Room page: average, distribution and every review of this room, plus the form. */
export function RoomReviews({ reviews, roomId, roomName }: { reviews: ReviewView[]; roomId: string; roomName: string }) {
  const rt = useReviewsT();
  const { locale } = useI18n();
  const x = EXTRA_T[locale];
  const w = WALL_T[locale];
  const [all, setAll] = useState(false);
  const [write, setWrite] = useState(false);
  const [stars, setStars] = useState<StarFilter>(null);
  const [photos, setPhotos] = useState(false);
  const [sort, setSort] = useState<Sort>('new');
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const rec = reviews.length ? Math.round((reviews.filter((r) => r.rating >= 4).length / reviews.length) * 100) : 0;
  const withPhotos = reviews.filter((r) => r.photos.length > 0).length;
  const list = useMemo(() => {
    const byDate = (a: ReviewView, b: ReviewView) => b.createdAt.localeCompare(a.createdAt);
    return reviews.filter((r) => starOk(r, stars) && (!photos || r.photos.length > 0)).sort(sort === 'best' ? (a, b) => b.rating - a.rating || byDate(a, b) : sort === 'low' ? (a, b) => a.rating - b.rating || byDate(a, b) : byDate);
  }, [reviews, stars, photos, sort]);
  const shown = all ? list : list.slice(0, 3);
  const count = (s: StarFilter) => reviews.filter((r) => starOk(r, s)).length;
  const filtered = stars !== null || photos;
  // how the stars are spread: one bar per star, each bar is also a filter
  const bars = ([5, 4, 3, 2, 1] as const).map((n) => ({ n, c: reviews.filter((r) => r.rating === n).length }));
  const maxBar = Math.max(1, ...bars.map((b) => b.c));
  const chips: { k: string; label: React.ReactNode; on: boolean; act: () => void; n: number }[] = [
    { k: 'all', label: x.all, on: !filtered, act: () => (setStars(null), setPhotos(false)), n: reviews.length },
    { k: '5', label: <>5<Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 5, act: () => setStars(stars === 5 ? null : 5), n: count(5) },
    { k: '4', label: <>4<Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 4, act: () => setStars(stars === 4 ? null : 4), n: count(4) },
    { k: '3', label: <>≤3<Star className="h-3 w-3" fill="currentColor" strokeWidth={0} /></>, on: stars === 3, act: () => setStars(stars === 3 ? null : 3), n: count(3) },
    { k: 'p', label: <><Camera className="h-3.5 w-3.5" /> {x.withPhotos}</>, on: photos, act: () => setPhotos((v) => !v), n: withPhotos },
  ];
  const sorts: { k: Sort; label: string }[] = [
    { k: 'new', label: w.newest },
    { k: 'best', label: w.best },
    { k: 'low', label: w.lowest },
  ];

  return (
    <section id="recensioni" aria-labelledby="room-reviews" className="scroll-mt-28" data-testid="room-reviews">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-gold-2">{rt.title}</p>
          <h2 id="room-reviews" className="display mt-3 text-[clamp(2rem,3.4vw,3rem)] text-navy">
            {roomName}
          </h2>
        </div>
        <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => setWrite(true)} className="btn btn-navy h-11 min-h-0 px-5">
          <PenLine className="h-4 w-4" /> {rt.leave}
        </motion.button>
      </div>

      {reviews.length === 0 ? (
        <div className="mt-6 flex min-h-[160px] flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-line p-8 text-center">
          <p className="text-navy">{rt.empty}</p>
        </div>
      ) : (
        <>
          {/* the score at a glance, with the stars spread as clickable bars */}
          <div className="mt-6 grid gap-5 rounded-[1.75rem] bg-white p-5 ring-1 ring-line sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8 md:p-6">
            <div className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-2">
              <span className="serif text-[3.4rem] leading-none text-navy">{avg.toFixed(1).replace('.', ',')}</span>
              <span>
                <Stars value={avg} size="h-4 w-4" />
                <span className="mt-1 block text-xs text-mist">
                  {reviews.length === 1 ? rt.one : fill(rt.count, { n: reviews.length })} · {fill(x.recommend, { p: rec })}
                </span>
              </span>
            </div>
            <ul className="space-y-1.5" aria-label={w.filters}>
              {bars.map((b) => {
                const key = (b.n >= 4 ? b.n : 3) as StarFilter;
                const on = stars === key && (b.n >= 4 || b.n <= 3);
                return (
                  <li key={b.n}>
                    <button type="button" disabled={!b.c} aria-pressed={on} onClick={() => setStars(on ? null : key)} className={cn('group flex w-full items-center gap-3 rounded-full px-2 py-1 text-left transition-colors disabled:cursor-default disabled:opacity-40', on ? 'bg-navy/[0.06]' : 'enabled:hover:bg-ivory')}>
                      <span className="flex w-7 shrink-0 items-center gap-0.5 text-xs font-semibold text-navy">
                        {b.n}
                        <Star className="h-3 w-3 text-gold" fill="currentColor" strokeWidth={0} />
                      </span>
                      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-sand-2/70">
                        <motion.span className={cn('absolute inset-y-0 left-0 rounded-full', on ? 'bg-gold' : 'bg-navy')} initial={{ width: 0 }} whileInView={{ width: `${(b.c / maxBar) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease: EASE, delay: (5 - b.n) * 0.06 }} />
                      </span>
                      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-mist">{b.c}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* filters + sort */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label={w.filters}>
              {chips.map((c) => (
                <button key={c.k} type="button" aria-pressed={c.on} disabled={!c.n && !c.on} onClick={() => (c.act(), setAll(false))} className={cn('relative flex h-10 shrink-0 items-center gap-1 rounded-full px-4 text-[0.8rem] font-semibold transition-colors disabled:opacity-35', c.on ? 'text-ivory' : 'bg-white text-navy ring-1 ring-line hover:ring-navy/30')}>
                  {c.on && <motion.span layoutId="room-rev-chip" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span className="relative flex items-center gap-1">{c.label}</span>
                  <span className={cn('relative ml-1 rounded-full px-1.5 text-[0.66rem]', c.on ? 'bg-white/15' : 'bg-sand-2/70 text-mist')}>{c.n}</span>
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1 rounded-full bg-white p-1 ring-1 ring-line" role="group" aria-label={w.sort}>
              <ArrowUpDown className="ml-2 h-3.5 w-3.5 text-mist" aria-hidden="true" />
              {sorts.map((o) => (
                <button key={o.k} type="button" aria-pressed={sort === o.k} onClick={() => setSort(o.k)} className={cn('relative h-8 rounded-full px-3 text-[0.72rem] font-semibold transition-colors', sort === o.k ? 'text-ivory' : 'text-navy/70 hover:text-navy')}>
                  {sort === o.k && <motion.span layoutId="room-rev-sort" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span className="relative">{o.label}</span>
                </button>
              ))}
            </div>
          </div>
          {filtered && list.length > 0 && <p className="mt-3 text-xs text-mist">{fill(x.filtered, { n: list.length, t: reviews.length })}</p>}

          <div className="mt-4 grid gap-4">
            {list.length === 0 && (
              <div className="rounded-[1.6rem] border border-dashed border-line p-8 text-center">
                <p className="text-navy">{w.noMatch}</p>
                <button type="button" onClick={() => (setStars(null), setPhotos(false))} className="mt-3 text-sm font-semibold text-navy underline decoration-gold underline-offset-4">
                  {w.clear}
                </button>
              </div>
            )}
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((r) => (
                <motion.div key={r.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.35, ease: EASE }}>
                  <ReviewItem r={r} showRoom={false} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {list.length > 3 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="mt-4 text-sm font-semibold text-navy underline decoration-gold underline-offset-4">
              {all ? rt.less : `${rt.more} (${list.length})`}
            </button>
          )}
        </>
      )}
      <SiteModal open={write} onClose={() => setWrite(false)} label={rt.leave}>
        <ReviewForm roomId={roomId} title={`${rt.leave} · ${roomName}`} onDone={() => setWrite(false)} />
      </SiteModal>
    </section>
  );
}
