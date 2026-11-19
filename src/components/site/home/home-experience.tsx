'use client';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { cubicBezier, useAnimate } from 'motion/react';
import { useRouter } from 'next/navigation';
import type { AvailabilityResponse, RoomCardData } from '@/lib/room-card';
import { gsap, ScrollTrigger, useGSAP, prefersReducedMotion } from '@/lib/gsap';
import { onOpening } from '@/lib/intro';
import { useI18n, useLenis, useLiveVersion, scrollToTarget } from '../providers';
import { Hero } from './hero';
import { RoomsSection } from '../rooms/rooms-section';
import type { TouristTax } from '@/lib/tourist-tax';
import { SearchBar } from '../booking/search-bar';
import { queryToParams, type StayQuery } from '../booking/query';

/**
 * Home page orchestration + the "magnetic" booking bar.
 *
 * The bar lives in a track that spans the WHOLE home page (hero → rooms → sections) and is
 * `position: sticky; bottom`. So it:
 *   1. starts lifted into the slot under the hero headline (GSAP transform, scrubbed),
 *   2. glides down and docks at the bottom edge of the viewport,
 *   3. stays docked (compact) while the visitor scrolls the entire page,
 *   4. parks in its own space just above the footer, so it never hides the footer.
 * One element, never re-mounted: focus and open calendars survive every phase.
 */
export function HomeExperience({ rooms, initialQuery, initialResults, today, cashPercent = 0, tax = null, children }: { rooms: RoomCardData[]; initialQuery: StayQuery; initialResults: AvailabilityResponse | null; today: string; cashPercent?: number; tax?: TouristTax | null; children?: React.ReactNode }) {
  const { locale } = useI18n();
  const router = useRouter();
  const lenis = useLenis();
  const [query, setQuery] = useState<StayQuery>(initialQuery);
  const [results, setResults] = useState<AvailabilityResponse | null>(initialResults);
  const [loading, setLoading] = useState(false);
  const [docked, setDocked] = useState(false);
  const lastSearch = useRef<StayQuery | null>(initialResults ? initialQuery : null);
  const wrap = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);

  // the end of the page touches the footer → the bar disappears (and comes back on the way up)
  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    // checked on every scroll frame (an IntersectionObserver misses fast jumps past the line)
    let raf = 0;
    const check = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setGone(el.getBoundingClientRect().top < window.innerHeight - 12));
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  useGSAP(
    () => {
      const w = wrap.current!;
      const b = bar.current!;
      const margin = () => (window.innerWidth < 768 ? 16 : 24);
      ScrollTrigger.create({
        trigger: w,
        start: () => `top+=${window.innerHeight * 0.3} top`,
        end: 'bottom bottom',
        onToggle: (self) => setDocked(self.isActive),
      });
      if (prefersReducedMotion()) return;
      const lift = () => {
        const s = slot.current!;
        const st = stage.current!;
        const slotTop = s.getBoundingClientRect().top - st.getBoundingClientRect().top;
        return Math.min(0, slotTop - (window.innerHeight - b.offsetHeight - margin()));
      };
      gsap.fromTo(b, { y: lift }, { y: 0, ease: 'power2.inOut', scrollTrigger: { trigger: w, start: 'top top', end: () => `+=${window.innerHeight * 0.34}`, scrub: 0.9, invalidateOnRefresh: true } });
      // with the hero's opening only (never hidden and faded in again over an already painted page)
      return onOpening(() => gsap.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 1, delay: 0.7, ease: 'power2.out' }));
    },
    { scope: wrap },
  );

  // Let fixed UI (chat button, cookie banner) sit above the docked bar
  useEffect(() => {
    const root = document.documentElement;
    const el = bar.current;
    // the bar rests at the bottom of the first screen too (centred hero): floating buttons always sit above it
    if (gone || !el) {
      root.style.setProperty('--dock-h', '0px');
      delete root.dataset.dock;
      return;
    }
    let last = '';
    const set = () => {
      const m = window.innerWidth < 768 ? 16 : 24;
      const h = Math.round(el.offsetHeight);
      // a custom property on <html> restyles the whole page: only write it when it really changes
      if (`${h}:${m}` === last) return;
      last = `${h}:${m}`;
      root.style.setProperty('--dock-h', `${h + m}px`);
      root.style.setProperty('--dock-mid', `${m + h / 2}px`);
      root.dataset.dock = '1';
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--dock-h', '0px');
      delete root.dataset.dock;
    };
  }, [gone]);

  /*
   * The goodbye at the footer, as one choreography (and exactly its reverse on the way back):
   * the fields fade, the pill folds from both sides into a round anchor badge, the badge sinks
   * into the footer leaving a gold ripple. Coming back, the badge rises and unfolds into the bar.
   */
  const [scope, animateSeq] = useAnimate();
  const ghost = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const g = ghost.current;
    const c = content.current;
    const b = bar.current;
    if (!g || !c || !b) return;
    const wrap = g.parentElement as HTMLElement;
    const w = b.offsetWidth;
    const h = c.offsetHeight || 64;
    const x = Math.max(0, (w - h) / 2);
    const full = 'inset(0px 0px 0px 0px round 999px)';
    const dot = `inset(0px ${x}px 0px ${x}px round 999px)`;
    const icon = g.querySelector<HTMLElement>('[data-anchor]')!;
    const ring = wrap.querySelector<HTMLElement>('[data-ring]')!;
    if (first.current) {
      first.current = false;
      c.style.opacity = gone ? '0' : '1';
      wrap.style.display = 'none';
      return;
    }
    if (prefersReducedMotion()) {
      c.style.opacity = gone ? '0' : '1';
      return;
    }
    wrap.style.display = 'block';
    // easing functions (not bezier arrays): sequences mix GPU and JS animations
    const out = cubicBezier(0.16, 1, 0.3, 1);
    const fold = cubicBezier(0.76, 0, 0.24, 1);
    const pop = cubicBezier(0.34, 1.56, 0.64, 1);
    const sink = cubicBezier(0.55, 0, 0.8, 0.35);
    const ctrl = gone
      ? animateSeq([
          [g, { opacity: 1, clipPath: full, y: 0, scale: 1 }, { duration: 0 }],
          [icon, { opacity: 0, scale: 0.4, rotate: -40 }, { duration: 0 }],
          [ring, { opacity: 0, scale: 0.3 }, { duration: 0 }],
          [c, { opacity: 0, y: 4 }, { duration: 0.2, ease: 'easeOut', at: 0 }],
          [g, { clipPath: dot }, { duration: 0.55, ease: fold, at: 0.06 }],
          [icon, { opacity: 1, scale: 1, rotate: 0 }, { duration: 0.35, ease: pop, at: 0.4 }],
          [g, { y: [0, -6, 34], scale: [1, 1.04, 0.3], opacity: [1, 1, 0] }, { duration: 0.5, ease: sink, at: 0.78 }],
          [ring, { opacity: 0, scale: 0.3 }, { duration: 0.01, at: 1.1 }], // hold: sequences interpolate between segments
          [ring, { scale: [0.3, 2.6], opacity: [0.9, 0] }, { duration: 0.7, ease: 'easeOut', at: 1.12 }],
        ])
      : animateSeq([
          [g, { opacity: 0, clipPath: dot, y: 34, scale: 0.3 }, { duration: 0 }],
          [icon, { opacity: 1, scale: 1, rotate: 0 }, { duration: 0 }],
          [ring, { scale: [2.2, 0.4], opacity: [0, 0.8, 0] }, { duration: 0.45, ease: 'easeIn', at: 0 }],
          [g, { y: [34, -6, 0], scale: [0.3, 1.04, 1], opacity: [0, 1, 1] }, { duration: 0.5, ease: out, at: 0.25 }],
          [icon, { opacity: 0, scale: 0.4, rotate: 40 }, { duration: 0.22, ease: 'easeIn', at: 0.62 }],
          [g, { clipPath: full }, { duration: 0.6, ease: out, at: 0.66 }],
          [c, { opacity: 1, y: [6, 0] }, { duration: 0.35, ease: 'easeOut', at: 1.0 }],
          [g, { opacity: 0 }, { duration: 0.25, at: 1.15 }],
        ]);
    ctrl.then(() => {
      if (!gone) wrap.style.display = 'none';
    });
    return () => ctrl.stop();
  }, [gone, animateSeq]);

  // Results change the page height: keep every ScrollTrigger (dock, pinned sections) accurate
  useEffect(() => {
    const id = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => cancelAnimationFrame(id);
  }, [results]);

  const fetchResults = useCallback(
    async (q: StayQuery): Promise<AvailabilityResponse | null> => {
      const p = queryToParams(q);
      p.set('locale', locale);
      const res = await fetch(`/api/availability?${p.toString()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as AvailabilityResponse;
    },
    [locale],
  );

  const search = useCallback(
    async (q: StayQuery) => {
      setLoading(true);
      const started = performance.now();
      const data = await fetchResults(q);
      // keep the button morph perceptible but never artificially long
      const wait = Math.max(0, 450 - (performance.now() - started));
      await new Promise((r) => requestAnimationFrame(() => window.setTimeout(r, wait)));
      window.history.replaceState(null, '', `${window.location.pathname}?${queryToParams(q).toString()}`);
      lastSearch.current = q;
      scrollToTarget(lenis.current, '#camere', -10, () => {
        setResults(data);
        setLoading(false);
      });
    },
    [fetchResults, lenis],
  );

  // Live demo: when the owner changes rooms/prices in the panel, the page updates by itself
  useLiveVersion(
    useCallback(async () => {
      if (lastSearch.current) {
        const data = await fetchResults(lastSearch.current);
        if (data) setResults(data);
      }
      router.refresh();
    }, [fetchResults, router]),
  );

  const reset = () => {
    setResults(null);
    lastSearch.current = null;
    window.history.replaceState(null, '', window.location.pathname);
  };

  // Docking the bar (a state change while scrolling) must not re-render the hero and the whole rooms
  // grid: they are built once and only again when what they show changes.
  const heroEl = useMemo(() => <Hero slotRef={slot} stageRef={stage} />, []);
  const roomsEl = useMemo(
    () => (
          <RoomsSection
            rooms={rooms}
            results={results}
            query={query}
            cashPercent={cashPercent}
            tax={tax}
            onReset={reset}
            onChangeDates={() => scrollToTarget(lenis.current, '#hero', 0)}
            onPickDates={(checkIn, checkOut) => {
              const q = { ...query, checkIn, checkOut };
              setQuery(q);
              search(q);
            }}
          />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rooms, results, query, cashPercent, tax],
  );

  return (
    <div ref={wrap} className="relative">
      {heroEl}
      <div className={loading ? 'opacity-40 transition-opacity duration-500' : 'transition-opacity duration-500'}>{roomsEl}</div>
      {children}
      {/* when this line reaches the footer the bar is "sucked in" (its two sides meet and it vanishes) */}
      <div ref={endRef} aria-hidden="true" className="h-px" />

      <div className="pointer-events-none absolute inset-0 z-40 flex flex-col justify-end px-4 pb-4 sm:px-6 md:px-[6.25rem] md:pb-6">
        <div ref={bar} className={`sticky bottom-4 mx-auto w-full max-w-[1120px] will-change-transform md:bottom-6 ${gone ? 'pointer-events-none' : 'pointer-events-auto'}`}>
          <div ref={scope}>
            <div ref={content} aria-hidden={gone} inert={gone}>
              <SearchBar value={query} onChange={setQuery} onSubmit={search} today={today} loading={loading} variant="hero" docked={docked} />
            </div>
            {/* the pill that folds into the anchor badge (only mounted in the layout while it plays) */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ display: 'none' }}>
              <div ref={ghost} className="absolute inset-0 flex items-center justify-center rounded-full border border-line bg-ivory shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" style={{ opacity: 0 }}>
                <span data-anchor className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-gold" style={{ opacity: 0 }}>
                  <svg viewBox="0 0 48 56" width="15" height="18" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round">
                    <circle cx="24" cy="7" r="4.2" />
                    <path d="M24 11.2V52M15 20h18M5 34c1.6 10.5 9.4 18 19 18s17.4-7.5 19-18" />
                  </svg>
                </span>
              </div>
              <span data-ring className="absolute left-1/2 top-1/2 -ml-8 -mt-8 h-16 w-16 rounded-full border border-gold" style={{ opacity: 0 }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
