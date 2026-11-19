'use client';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import Link, { type LinkProps } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { gsap } from '@/lib/gsap';
import { AnchorMark } from './brand';
import { scrollToTarget, useLenis } from './providers';

type Nav = (href: string, label?: string) => void;
const TransitionContext = createContext<Nav | null>(null);

/**
 * Page transitions: a navy veil rises with the name of the page you are going to, the route
 * changes behind it, then the veil lifts off the new page. Links to a section of the page you
 * are already on (“Posizione”, “Scrivici”) glide there instead of jumping.
 * Back/forward navigation skips the veil (browser history stays instant and reliable).
 */
export function TransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const lenis = useLenis();
  const veil = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const pending = useRef(false);
  const timeout = useRef<number | null>(null);

  const navigate = useCallback<Nav>(
    (href, label) => {
      const el = veil.current;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const target = new URL(href, window.location.href);
      const clean = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p); // "/pl/#posizione" is the /pl page
      const samePage = clean(target.pathname) === clean(window.location.pathname);

      // a section of this very page: smooth scroll, no veil
      if (samePage && target.hash) {
        const id = decodeURIComponent(target.hash);
        if (document.querySelector(id)) {
          window.history.replaceState(null, '', clean(target.pathname) + target.search + target.hash);
          scrollToTarget(lenis.current, id, -80);
          return;
        }
      }
      if (!el || reduced || samePage) {
        router.push(href);
        return;
      }
      pending.current = true;
      if (word.current) word.current.textContent = label?.trim() || '';
      gsap.killTweensOf([el, word.current, line.current]);
      gsap.set(el, { display: 'flex', transformOrigin: '50% 100%' });
      const tl = gsap.timeline({ onComplete: () => router.push(href, { scroll: !target.hash }) });
      tl.fromTo(el, { scaleY: 0 }, { scaleY: 1, duration: 0.55, ease: 'power4.inOut' })
        .fromTo(word.current, { yPercent: 110, opacity: 1 }, { yPercent: 0, duration: 0.5, ease: 'power3.out' }, 0.28)
        .fromTo(line.current, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: 'power2.inOut' }, 0.3);
      timeout.current = window.setTimeout(() => lift(), 4000);
    },
    [router, lenis],
  );

  const lift = () => {
    const el = veil.current;
    if (!el || !pending.current) return;
    pending.current = false;
    if (timeout.current) window.clearTimeout(timeout.current);
    gsap.set(el, { transformOrigin: '50% 0%' });
    gsap
      .timeline({ onComplete: () => void gsap.set(el, { display: 'none' }) })
      .to(word.current, { yPercent: -110, duration: 0.45, ease: 'power3.in' })
      .to(line.current, { scaleX: 0, transformOrigin: '100% 50%', duration: 0.4, ease: 'power2.in' }, 0)
      .to(el, { scaleY: 0, duration: 0.75, ease: 'power4.inOut' }, 0.2)
      .set(line.current, { transformOrigin: '0% 50%' });
  };

  useEffect(() => {
    // arriving on a page with #section: the jump happens under the veil, so it lifts right on the section
    // (pinned sections are measured again ~250 ms after a route change, so the jump waits for that)
    const hash = window.location.hash;
    if (hash && pending.current) {
      const jump = () => {
        const el = document.querySelector<HTMLElement>(decodeURIComponent(hash));
        const l = lenis.current;
        if (el && l) l.scrollTo(el, { offset: -80, immediate: true, force: true });
        else if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80);
      };
      const t = window.setTimeout(() => {
        jump();
        requestAnimationFrame(() => {
          jump();
          lift();
        });
      }, 420);
      return () => window.clearTimeout(t);
    }
    lift();
  }, [pathname, lenis]);

  return (
    <TransitionContext.Provider value={navigate}>
      {children}
      <div ref={veil} aria-hidden="true" className="fixed inset-0 z-[90] hidden flex-col items-center justify-center gap-5 bg-navy text-gold" style={{ transform: 'scaleY(0)' }}>
        <AnchorMark className="h-10 w-8 opacity-80" />
        <span className="block overflow-hidden pb-1">
          <span ref={word} className="serif block text-[clamp(2.4rem,7vw,5.5rem)] leading-none text-ivory" />
        </span>
        <span ref={line} className="block h-px w-24 origin-left bg-gold/70" style={{ transform: 'scaleX(0)' }} />
      </div>
    </TransitionContext.Provider>
  );
}

export function useTransitionNav(): Nav {
  const ctx = useContext(TransitionContext);
  const router = useRouter();
  return ctx ?? ((href: string) => router.push(href));
}

type TLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & LinkProps & { children: React.ReactNode; label?: string };

/** Link with the veil transition (and smooth in-page scrolling). Modified clicks (new tab etc.) behave natively. */
export function TLink({ href, onClick, children, label, ...rest }: TLinkProps) {
  const nav = useTransitionNav();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        const h = typeof href === 'string' ? href : (href.pathname ?? '/');
        if (h.startsWith('#')) return;
        e.preventDefault();
        const text = e.currentTarget.textContent?.trim() ?? '';
        nav(h, label ?? (text.length <= 28 ? text : ''));
      }}
    >
      {children}
    </Link>
  );
}
