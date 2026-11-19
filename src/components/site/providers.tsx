'use client';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import Lenis from 'lenis';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/types';
import { localePath } from '@/lib/i18n/config';
import { markHydrated } from '@/lib/intro';
import { gsap, ScrollTrigger } from '@/lib/gsap';

/* ---------------- i18n ---------------- */
interface I18n {
  locale: Locale;
  t: Dictionary;
  href: (path: string) => string;
}
const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside provider');
  return ctx;
}

/* ---------------- media queries ---------------- */
function subscribeMq(query: string) {
  return (cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
  };
}
export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(subscribeMq(query), () => window.matchMedia(query).matches, () => serverDefault);
}
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
export const useIsDesktop = () => useMediaQuery('(min-width: 768px)', true);

/* ---------------- smooth scroll ---------------- */
const LenisContext = createContext<{ current: Lenis | null }>({ current: null });
export const useLenis = () => useContext(LenisContext);

export function scrollToTarget(lenis: Lenis | null, target: string | HTMLElement, offset = -90, onComplete?: () => void) {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) return onComplete?.();
  if (lenis) {
    lenis.scrollTo(el, { offset, duration: 1.4, easing: (t: number) => 1 - Math.pow(1 - t, 4), onComplete: () => onComplete?.() });
  } else {
    const top = el.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    window.setTimeout(() => onComplete?.(), 700);
  }
}

function SmoothScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<Lenis | null>(null);
  const reduced = useReducedMotion();
  const pathname = usePathname();
  const popRef = useRef(false);

  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ lerp: 0.12, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.4 });
    ref.current = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    const onPop = () => {
      popRef.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener('popstate', onPop);
      lenis.destroy();
      ref.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    const lenis = ref.current;
    if (popRef.current) {
      popRef.current = false;
      lenis?.resize();
    } else if (!window.location.hash) {
      lenis?.scrollTo(0, { immediate: true, force: true });
    }
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 250);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return <LenisContext.Provider value={ref}>{children}</LenisContext.Provider>;
}

export function SiteProviders({ locale, dict, children }: { locale: Locale; dict: Dictionary; children: React.ReactNode }) {
  const [value] = useState<I18n>(() => ({ locale, t: dict, href: (p: string) => localePath(locale, p) }));
  const v = value.locale === locale ? value : { locale, t: dict, href: (p: string) => localePath(locale, p) };
  // passive effect: runs after every layout effect of the first render, so pages mounting during
  // hydration still see "first load" (see lib/intro.ts)
  useEffect(() => markHydrated(), []);
  return (
    <I18nContext.Provider value={v}>
      <VisitBeacon />
      <SmoothScroll>{children}</SmoothScroll>
    </I18nContext.Provider>
  );
}

/** Anonymous page view for the owner's daily report (no cookie, nothing personal: server/visits.ts). */
function VisitBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      if (navigator.webdriver) return;
      navigator.sendBeacon?.('/api/visit', JSON.stringify({ p: pathname }));
    } catch {
      /* beacons are best effort */
    }
  }, [pathname]);
  return null;
}

/* ---------------- live data ---------------- */

type LiveSub = (v: number) => void;
const live = { subs: new Set<LiveSub>(), es: null as EventSource | null, last: null as number | null, poll: 0, fails: 0 };

function liveEmit(v: number) {
  if (live.last !== null && v !== live.last) for (const s of live.subs) s(v);
  live.last = v;
}

const CLOUD_POLL = process.env.NEXT_PUBLIC_STORE_MODE === 'cloud';

/** One connection per page: the server pushes every change (SSE); polling only as a fallback. */
function liveStart() {
  if (live.es || live.poll || typeof window === 'undefined') return;
  const poll = () => {
    if (live.poll) return;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        liveEmit(((await r.json()) as { version: number }).version);
      } catch {
        /* offline */
      }
    };
    tick();
    live.poll = window.setInterval(tick, CLOUD_POLL ? 10000 : 4000);
  };
  // hosting without a long-lived server (Vercel): ask for the version from time to time
  if (CLOUD_POLL || !('EventSource' in window) || window.location.hostname.endsWith('.trycloudflare.com')) return poll();
  const es = new EventSource('/api/live');
  live.es = es;
  es.onmessage = (e) => {
    live.fails = 0;
    const v = Number(e.data);
    if (Number.isFinite(v)) liveEmit(v);
  };
  es.onerror = () => {
    // the browser reconnects by itself; after repeated failures fall back to polling
    if (++live.fails > 4) {
      es.close();
      live.es = null;
      poll();
    }
  };
}

function liveStop() {
  if (live.subs.size) return;
  live.es?.close();
  live.es = null;
  if (live.poll) window.clearInterval(live.poll);
  live.poll = 0;
}

/** Calls onChange as soon as anything changes in the data (panel, assistant, Telegram, bookings). */
export function useLiveVersion(onChange: () => void, _intervalMs = 4000) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let t = 0;
    // several saves in a row (e.g. bulk prices) → one refresh
    const sub: LiveSub = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => cb.current(), 120);
    };
    live.subs.add(sub);
    liveStart();
    return () => {
      window.clearTimeout(t);
      live.subs.delete(sub);
      liveStop();
    };
  }, []);
}
