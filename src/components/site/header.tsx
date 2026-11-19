'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, ChevronDown, Mail, Phone, UserRound } from 'lucide-react';
import { LOCALES, LOCALE_NAMES, localePath, stripLocale } from '@/lib/i18n/config';
import { ACCOUNT_T } from '@/lib/i18n/account-dict';
import type { Locale } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useI18n, useLenis } from './providers';
import { TLink } from './transition';
import { Wordmark } from './brand';
import { Magnetic } from './motion-kit';
import { Flag } from './flags';

const EASE = [0.22, 0.61, 0.12, 1] as const;

type NavLink = { key: string; label: string; to: string };

/**
 * One header for every page: a floating "liquid glass" island.
 *  - desktop: logo · quick links in the centre · language + Prenota
 *  - phone/tablet: logo · Prenota · round menu button; the island itself grows into the menu,
 *    so the close (X) button never moves and is always visible.
 */
export function Header({ phone, email }: { phone: string; email: string }) {
  const { t, href, locale } = useI18n();
  const pathname = usePathname();
  const { path } = stripLocale(pathname);
  const lenis = useLenis();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const lastY = useRef(0);
  const islandRef = useRef<HTMLDivElement>(null);

  const links: NavLink[] = [
    { key: 'rooms', label: t.nav.rooms, to: '/camere' },
    { key: 'experiences', label: t.nav.experiences, to: '/esperienze' },
    { key: 'location', label: t.nav.location, to: '/#posizione' },
    { key: 'contact', label: t.nav.contact, to: '/contatti' },
  ];
  const activeKey = links.find((l) => !l.to.includes('#') && path.startsWith(l.to))?.key ?? null;

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const y = window.scrollY;
        setScrolled(y > 24);
        if (y > lastY.current + 6 && y > 260) setHidden(true);
        else if (y < lastY.current - 6 || y < 260) setHidden(false);
        lastY.current = y;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  // sticky UI below the header (rooms search, back pill) follows it through --hdr-h
  useEffect(() => {
    const el = islandRef.current;
    const set = () => {
      const b = el ? el.getBoundingClientRect().height + (window.innerWidth < 640 ? 8 : 12) : 0;
      document.documentElement.style.setProperty('--hdr-h', hidden && !open ? '0px' : `${Math.round(b + 6)}px`);
    };
    set();
    if (!el) return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hidden, open]);

  useEffect(() => {
    const l = lenis.current;
    if (open) {
      l?.stop();
      document.body.style.overflow = 'hidden';
    } else {
      l?.start();
      document.body.style.overflow = '';
    }
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, lenis]);

  return (
    <>
      <a href="#contenuto" className="sr-only z-[100] rounded-full bg-navy px-4 py-3 text-ivory focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        {t.nav.skip}
      </a>
      <AnimatePresence>
        {open && <motion.button type="button" aria-label={t.nav.close} tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default bg-navy-3/45 backdrop-blur-[3px] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
      </AnimatePresence>
      <header className={cn('pointer-events-none fixed inset-x-0 top-0 z-50 px-2 pt-2 transition-transform duration-700 ease-[var(--ease-lux)] sm:px-3 sm:pt-3 lg:px-6', hidden && !open ? '-translate-y-[130%]' : 'translate-y-0')}>
        <div
          ref={islandRef}
          className={cn('glass-island pointer-events-auto relative mx-auto max-w-[1240px] text-navy transition-[border-radius,background-color] duration-500', open ? 'glass-island--solid rounded-[1.75rem]' : 'rounded-[1.6rem]', scrolled && !open && 'glass-island--scrolled')}
        >
          <div className="relative grid h-14 grid-cols-[1fr_auto] items-center gap-3 pl-4 pr-1.5 sm:h-[3.75rem] lg:h-16 lg:grid-cols-[1fr_auto_1fr] lg:pl-5 lg:pr-2">
            <TLink href={href('/')} label="L’Ancora" className="w-fit" aria-label="Hotel L’Ancora — home" onClick={() => setOpen(false)}>
              <Wordmark compact />
            </TLink>

            <nav aria-label="Principale" className="hidden lg:block" onMouseLeave={() => setHover(null)}>
              <ul className="flex items-center gap-0.5 rounded-full bg-navy/[0.04] p-1">
                {links.map((l) => {
                  const shown = (hover ?? activeKey) === l.key;
                  return (
                    <li key={l.key} className="relative">
                      <TLink
                        href={href(l.to)}
                        label={l.label}
                        onMouseEnter={() => setHover(l.key)}
                        onFocus={() => setHover(l.key)}
                        aria-current={activeKey === l.key ? 'page' : undefined}
                        className={cn('group relative block rounded-full px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.16em] transition-colors duration-300', shown ? 'text-ivory' : 'text-navy/80 hover:text-navy')}
                      >
                        {shown && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-navy shadow-[0_8px_20px_-10px_rgba(16,40,61,0.8)]" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                        <span className="relative block overflow-hidden">
                          <span className="block transition-transform duration-500 ease-[var(--ease-lux)] group-hover:-translate-y-full">{l.label}</span>
                          <span className="absolute inset-0 block translate-y-full transition-transform duration-500 ease-[var(--ease-lux)] group-hover:translate-y-0" aria-hidden="true">
                            {l.label}
                          </span>
                        </span>
                      </TLink>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="flex items-center justify-end gap-1.5 sm:gap-2">
              <LanguageSwitcher />
              <TLink
                href={href('/area-ospite')}
                label={ACCOUNT_T[locale].nav}
                aria-current={path.startsWith('/area-ospite') ? 'page' : undefined}
                title={ACCOUNT_T[locale].nav}
                className={cn('hidden h-11 min-w-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] transition-colors lg:flex', path.startsWith('/area-ospite') ? 'bg-navy/[0.07] text-navy' : 'text-navy/80 hover:bg-navy/5 hover:text-navy')}
              >
                <UserRound className="h-[18px] w-[18px]" />
                <span className="hidden 2xl:inline">{ACCOUNT_T[locale].nav}</span>
                <span className="sr-only 2xl:hidden">{ACCOUNT_T[locale].nav}</span>
              </TLink>
              <div className={cn('transition-opacity duration-300', open && 'pointer-events-none opacity-0')}>
                <Magnetic>
                  <TLink href={href('/prenotazione')} label={t.nav.book} className="btn btn-navy h-11 min-h-0 px-4 text-[0.66rem] sm:px-5">
                    {t.nav.book}
                  </TLink>
                </Magnetic>
              </div>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-controls="menu-island"
                aria-label={open ? t.nav.close : t.nav.menu}
                className={cn('flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-300 lg:hidden', open ? 'bg-navy text-ivory' : 'bg-white/70 text-navy ring-1 ring-navy/10')}
              >
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                  <motion.path initial={false} animate={{ d: open ? 'M6 6 L18 18' : 'M4 9 L20 9' }} transition={{ duration: 0.4, ease: EASE }} />
                  <motion.path initial={false} animate={{ d: open ? 'M6 18 L18 6' : 'M4 15 L14 15' }} transition={{ duration: 0.4, ease: EASE }} />
                </svg>
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                id="menu-island"
                role="dialog"
                aria-modal="true"
                aria-label={t.nav.menu}
                data-lenis-prevent
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0, transition: { duration: 0.35, ease: EASE } }}
                transition={{ duration: 0.55, ease: EASE }}
                className="max-h-[calc(100svh-5.5rem)] overflow-y-auto overscroll-contain lg:hidden"
              >
                <MobileMenu links={links} activeKey={activeKey} phone={phone} email={email} locale={locale} path={path} onClose={() => setOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>
    </>
  );
}

function MobileMenu({ links, activeKey, phone, email, locale, path, onClose }: { links: NavLink[]; activeKey: string | null; phone: string; email: string; locale: Locale; path: string; onClose: () => void }) {
  const { t, href } = useI18n();
  const all: NavLink[] = [{ key: 'home', label: t.nav.home, to: '/' }, ...links];
  return (
    <div className="px-4 pb-5 pt-2">
      <div className="h-px bg-navy/10" />
      <ul className="mt-2">
        {all.map((l, i) => {
          const active = l.key === 'home' ? path === '/' : activeKey === l.key;
          return (
            <motion.li key={l.key} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.05, duration: 0.5, ease: EASE }}>
              <TLink href={href(l.to)} label={l.label} onClick={onClose} aria-current={active ? 'page' : undefined} className={cn('group flex items-center gap-4 rounded-2xl px-2 py-2.5 transition-colors active:bg-navy/5', active && 'bg-navy/[0.05]')}>
                <span className="w-6 text-[0.62rem] font-semibold tracking-[0.18em] text-gold-2">0{i + 1}</span>
                <span className="serif flex-1 text-[2rem] leading-none text-navy">{l.label}</span>
                <ArrowUpRight className="h-5 w-5 text-navy/30 transition-transform duration-300 group-active:translate-x-0.5" />
              </TLink>
            </motion.li>
          );
        })}
      </ul>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5 }} className="mt-4 space-y-4">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {LOCALES.map((l) => (
            <a key={l} href={localePath(l, path)} hrefLang={l} lang={l} className={cn('flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-xs transition-colors', l === locale ? 'border-navy bg-navy text-ivory' : 'border-navy/12 bg-white/60 text-navy')}>
              <Flag locale={l} /> {LOCALE_NAMES[l].code}
            </a>
          ))}
        </div>
        <TLink href={href('/prenotazione')} label={t.nav.book} onClick={onClose} className="btn btn-gold h-12 min-h-0 w-full whitespace-nowrap">
          {t.nav.book}
        </TLink>
        <TLink href={href('/area-ospite')} label={ACCOUNT_T[locale].nav} onClick={onClose} aria-current={path.startsWith('/area-ospite') ? 'page' : undefined} className="flex h-12 items-center gap-3 rounded-2xl bg-white/80 px-4 text-sm text-navy ring-1 ring-navy/12 active:bg-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-ivory">
            <UserRound className="h-4 w-4" />
          </span>
          <span className="flex-1 font-semibold">{ACCOUNT_T[locale].nav}</span>
          <ArrowUpRight className="h-4 w-4 text-navy/40" />
        </TLink>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <a href={`tel:${phone.replace(/\s/g, '')}`} className="flex items-center justify-center gap-2 rounded-2xl bg-white/70 px-3 py-3 text-navy ring-1 ring-navy/10">
            <Phone className="h-3.5 w-3.5" /> {phone}
          </a>
          <a href={`mailto:${email}`} className="flex items-center justify-center gap-2 rounded-2xl bg-white/70 px-3 py-3 text-navy ring-1 ring-navy/10">
            <Mail className="h-3.5 w-3.5" /> Email
          </a>
        </div>
      </motion.div>
    </div>
  );
}

function LanguageSwitcher() {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { path } = stripLocale(pathname);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (l: Locale) => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    window.location.assign(localePath(l, path) + search);
  };

  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t.nav.language}: ${LOCALE_NAMES[locale].native}`}
        className="flex h-11 items-center gap-2 rounded-full px-3 text-[0.7rem] font-semibold tracking-[0.14em] transition-colors hover:bg-navy/5"
      >
        <Flag locale={locale} />
        {LOCALE_NAMES[locale].code}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            aria-label={t.nav.language}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="glass-island glass-island--solid absolute right-0 top-full z-[70] mt-3 w-60 origin-top-right rounded-2xl p-2 text-navy"
          >
            {LOCALES.map((l) => (
              <li key={l} role="option" aria-selected={l === locale}>
                <button type="button" onClick={() => go(l)} lang={l} className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/80">
                  <span className="flex items-center gap-3">
                    <Flag locale={l} className="h-4 w-6" />
                    {LOCALE_NAMES[l].native}
                  </span>
                  {l === locale && <Check className="h-4 w-4 text-gold-2" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
