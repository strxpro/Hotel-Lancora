'use client';
import { useEffect, useRef } from 'react';

/** When the curtain starts to lift, in ms from the first frame (keep in sync with `.preloader` in globals.css). */
const LIFT_AT = 1250;

/**
 * Opening curtain, once per visit (≈2 s, a tap skips it).
 * It is pure CSS, so it moves from the very first frame: before, the finished logo was painted
 * first and then hidden and replayed when the scripts arrived, which looked like a double intro.
 * The script only tells the page when the curtain lifts ("intro:done") and removes it at the end.
 * Skipped before the first paint (inline script in the root layout) for reduced motion and for
 * the rest of the visit once seen.
 */
export function Preloader() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    const html = document.documentElement;
    if (!el || html.classList.contains('intro-seen') || getComputedStyle(el).display === 'none') {
      window.dispatchEvent(new Event('intro:done'));
      return;
    }
    let lifted = false;
    const lift = () => {
      if (lifted) return;
      lifted = true;
      window.dispatchEvent(new Event('intro:done'));
    };
    const end = () => {
      lift();
      try {
        sessionStorage.setItem('la-intro', '1');
      } catch {
        /* private mode */
      }
      html.classList.add('intro-seen');
    };
    // the CSS animation started at first paint: wait only for what is left of it
    const out = el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'pl-out');
    const elapsed = typeof out?.currentTime === 'number' ? out.currentTime : 0;
    const t = window.setTimeout(lift, Math.max(0, LIFT_AT - elapsed));
    const onEnd = (e: AnimationEvent) => e.target === el && e.animationName === 'pl-out' && end();
    const skip = () => el.getAnimations({ subtree: true }).forEach((a) => a.finish());
    el.addEventListener('animationend', onEnd);
    el.addEventListener('click', skip);
    return () => {
      window.clearTimeout(t);
      el.removeEventListener('animationend', onEnd);
      el.removeEventListener('click', skip);
    };
  }, []);

  return (
    <div ref={root} className="preloader fixed inset-0 z-[100] flex items-center justify-center bg-navy text-ivory" aria-hidden="true">
      <div className="pl-content flex flex-col items-center px-6 text-center">
        {/* every move here is transform/opacity only: the browser plays it on its own, so it stays
            smooth while the page's scripts start (drawn strokes and clip-path stuttered then) */}
        <span className="pl-anchor relative block overflow-hidden">
          <svg viewBox="0 0 48 56" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" className="block h-16 w-14 text-gold md:h-[4.5rem] md:w-16">
            <circle cx="24" cy="7" r="4.2" />
            <path d="M24 11.2V52" />
            <path d="M15 20h18" />
            <path d="M5 34c1.6 10.5 9.4 18 19 18s17.4-7.5 19-18" />
            <path d="M5 34l-2.6 4.4M5 34l5 1.6M43 34l2.6 4.4M43 34l-5 1.6" />
          </svg>
          <span className="pl-anchor-cover pointer-events-none absolute inset-[-2px] bg-navy" />
        </span>
        <p className="pl-word-wrap relative mt-6 overflow-hidden px-1 py-1">
          <span className="pl-word serif block whitespace-nowrap text-[2.15rem] leading-none tracking-[0.01em] md:text-[2.9rem]">
            <span className="italic text-ivory/80">Hotel</span> L’Ancora
          </span>
          <span className="pl-word-cover pointer-events-none absolute inset-0 bg-navy" />
        </p>
        <span className="pl-line mt-6 block h-px w-28 bg-gold" />
        <p className="pl-place mt-4 text-[0.58rem] font-semibold uppercase tracking-[0.42em] text-ivory/55">Santa Teresa Gallura · Sardegna</p>
      </div>
    </div>
  );
}
