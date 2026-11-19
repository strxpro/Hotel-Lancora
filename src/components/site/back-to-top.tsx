'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n, useLenis } from './providers';

/** Sticky "back to top" with a scroll-progress ring. Level with the booking dock when present. */
export function BackToTop() {
  const { t } = useI18n();
  const lenis = useLenis();
  const [show, setShow] = useState(false);
  const ring = useRef<SVGCircleElement>(null);
  const C = 2 * Math.PI * 22;

  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? window.scrollY / max : 0;
        // only once the visitor is past half of the page
        setShow(p >= 0.5);
        if (ring.current) ring.current.style.strokeDashoffset = String(C * (1 - p));
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      cancelAnimationFrame(raf);
    };
  }, [C]);

  return (
    <button
      type="button"
      aria-label={t.footer.top}
      tabIndex={show ? 0 : -1}
      onClick={() => (lenis.current ? lenis.current.scrollTo(0, { duration: 1.6 }) : window.scrollTo({ top: 0, behavior: 'smooth' }))}
      className={cn(
        'float-left group z-[58] flex h-[52px] w-[52px] items-center justify-center rounded-full bg-ivory/[0.97] text-navy shadow-[0_14px_40px_-14px_rgba(10,28,43,0.55)] ring-1 ring-line',
        show ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-4 scale-75 opacity-0',
      )}
    >
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="2" />
        <circle ref={ring} cx="26" cy="26" r="22" fill="none" stroke="var(--color-gold)" strokeWidth="2" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C} />
      </svg>
      <ArrowUp className="relative h-4 w-4 transition-transform duration-500 group-hover:-translate-y-0.5" />
    </button>
  );
}
