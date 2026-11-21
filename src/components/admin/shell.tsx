'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Bell, BedDouble, CalendarRange, ClipboardList, CreditCard, Euro, ExternalLink, Inbox, LayoutDashboard, LogOut, Mail, Megaphone, MoreHorizontal, Plus, Settings, Sparkles, TrendingUp, Users, X, Zap } from 'lucide-react';
import type { AppNotification } from '@/lib/types';
import { fmtDateTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { AnchorMark } from '@/components/site/brand';
import { useLiveVersion } from '@/components/site/providers';
import { NewVersionReload } from '@/components/site/new-version';
import { PageTitleProvider, ToastProvider, usePageTitle, useSelectNumbersOnFocus } from './ui';
import { AssistantPanel } from './assistant-panel';
import { GuideTour, HelpButton } from './guide-tour';
import { SetupWizard, WelcomeCelebration, type SetupView } from './setup';
import { PanelSearch } from './panel-search';
import { AssistCursor } from './assist-cursor';
import { GuestCardProvider } from './guest-card';
import { logout } from '@/app/admin/auth-actions';
import { markNotificationsRead, markSectionRead } from '@/app/admin/actions/misc';

const NAV = [
  { href: '/admin', label: 'Oggi', icon: LayoutDashboard, exact: true },
  { href: '/admin/disponibilita', label: 'Planning camere', icon: CalendarRange },
  { href: '/admin/prenotazioni', label: 'Prenotazioni', icon: ClipboardList, badge: 'unassigned' as const },
  { href: '/admin/camere', label: 'Camere', icon: BedDouble },
  { href: '/admin/prezzi', label: 'Prezzi', icon: Euro },
  { href: '/admin/clienti', label: 'Clienti', icon: Users },
  { href: '/admin/pagamenti', label: 'Pagamenti', icon: CreditCard },
  { href: '/admin/messaggi', label: 'Messaggi', icon: Mail, badge: 'messages' as const },
  { href: '/admin/posta', label: 'Posta', icon: Inbox, badge: 'mail' as const },
  { href: '/admin/statistiche', label: 'Statistiche', icon: TrendingUp },
  { href: '/admin/marketing', label: 'Recensioni e Marketing', icon: Megaphone },
  { href: '/admin/automazioni', label: 'Automazioni', icon: Zap },
  { href: '/admin/assistente', label: 'Assistente', icon: Sparkles },
  { href: '/admin/impostazioni', label: 'Impostazioni', icon: Settings },
];

const MOBILE = [
  { href: '/admin', label: 'Oggi', icon: LayoutDashboard, exact: true },
  { href: '/admin/disponibilita', label: 'Planning', icon: CalendarRange },
  { href: '#azioni', label: 'Nuovo', icon: Plus },
  { href: '/admin/prenotazioni', label: 'Prenotaz.', icon: ClipboardList },
  { href: '#assistente', label: 'Assistente', icon: Sparkles },
];

export interface ShellProps {
  user: { name: string; role: 'admin' | 'staff' };
  counts: { notifications: number; messages: number; unassigned: number; mail?: number; sections?: Record<string, number> };
  notifications: AppNotification[];
  demo: boolean;
  whisper?: boolean;
  /** the owner's first set-up (admins only) */
  setup?: SetupView;
  /** the live voice conversation is connected */
  live?: boolean;
  children: React.ReactNode;
}

export function AdminShell({ user, counts, notifications, demo, whisper = false, setup, live = false, children }: ShellProps) {
  const [assistant, setAssistant] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [quick, setQuick] = useState(false);
  useLiveVersion(() => router.refresh(), 4000);
  useSelectNumbersOnFocus();
  useGlassLight();
  useEffect(() => {
    setMenu(false);
    setQuick(false);
    setAssistant(false);
  }, [pathname]);
  useEffect(() => {
    const open = () => setAssistant(true);
    const close = () => setAssistant(false);
    window.addEventListener('assistant:open', open);
    window.addEventListener('assistant:close', close);
    return () => {
      window.removeEventListener('assistant:open', open);
      window.removeEventListener('assistant:close', close);
    };
  }, []);

  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));
  const badgeFor = (b?: 'unassigned' | 'messages' | 'mail') => (b === 'unassigned' ? counts.unassigned : b === 'messages' ? counts.messages : b === 'mail' ? (counts.mail ?? 0) : 0);
  // new things per menu item (red); Messaggi and Posta already count their unread items (gold)
  const freshFor = (n: { href: string; badge?: string }) => (n.badge === 'messages' || n.badge === 'mail' ? 0 : (counts.sections?.[n.href] ?? 0));
  const moreFresh = NAV.filter((n) => !MOBILE.some((m) => m.href === n.href)).some((n) => freshFor(n) > 0 || (n.badge && n.badge !== 'unassigned' && badgeFor(n.badge) > 0));
  // opening a section marks what was new there as seen
  const seen = useRef('');
  useEffect(() => {
    const here = NAV.find((n) => active(n.href, n.exact));
    if (!here || !(counts.sections?.[here.href] ?? 0) || seen.current === here.href + pathname) return;
    seen.current = here.href + pathname;
    void markSectionRead(here.href).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, counts.sections]);

  return (
    <ToastProvider>
      <PageTitleProvider>
      <GuestCardProvider>
      <div className="lg-panel isolate min-h-dvh overflow-x-clip bg-ivory text-charcoal">
        <NewVersionReload area="panel" />
        {/* the soft colours behind the glass cards (they drift very slowly) */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden">
          <div className="lg-blob absolute -left-[12%] top-[6%] h-[40rem] w-[40rem] rounded-full bg-[radial-gradient(circle,rgba(182,149,98,0.32),transparent_66%)]" />
          <div className="lg-blob lg-blob-2 absolute -right-[10%] top-[28%] h-[46rem] w-[46rem] rounded-full bg-[radial-gradient(circle,rgba(70,120,170,0.22),transparent_66%)]" />
          <div className="lg-blob lg-blob-3 absolute -bottom-[14%] left-[28%] h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(circle,rgba(111,128,106,0.24),transparent_66%)]" />
        </div>
        {/* desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[264px] flex-col bg-navy text-ivory lg:flex print:!hidden">
          <Link href="/admin" className="flex items-center gap-3 px-6 pb-8 pt-7">
            <AnchorMark className="h-8 w-7 text-gold" />
            <span>
              <span className="block text-[0.55rem] font-semibold tracking-[0.4em] text-ivory/60">HOTEL</span>
              <span className="serif block text-[1.45rem] leading-none">L’Ancora</span>
            </span>
          </Link>
          <nav aria-label="Pannello" data-tour="nav" className="thin-scroll flex-1 overflow-y-auto px-3">
            <ul className="space-y-0.5">
              {NAV.map((n) => {
                const on = active(n.href, n.exact);
                const b = badgeFor(n.badge);
                return (
                  <li key={n.href}>
                    <Link href={n.href} aria-current={on ? 'page' : undefined} className={cn('relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.86rem] transition-colors', on ? 'text-ivory' : 'text-ivory/60 hover:text-ivory')}>
                      {on && <motion.span layoutId="admin-nav" className="absolute inset-0 rounded-xl bg-white/[0.08]" transition={{ type: 'spring', stiffness: 400, damping: 36 }} />}
                      {on && <motion.span layoutId="admin-nav-bar" className="absolute inset-y-2.5 left-1 w-1 rounded-full bg-gold" />}
                      <n.icon className="relative h-4 w-4" strokeWidth={1.6} />
                      <span className="relative flex-1">{n.label}</span>
                      {freshFor(n) > 0 && <FreshPill n={freshFor(n)} />}
                      {b > 0 && <span className="relative min-w-5 rounded-full bg-gold px-1.5 text-center text-[0.65rem] font-bold text-navy-3">{b}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="border-t border-white/10 px-6 py-5 text-sm">
            <p className="text-ivory">{user.name}</p>
            <p className="text-xs text-ivory/50">{user.role === 'admin' ? 'Amministratore' : 'Staff'}</p>
            <div className="mt-4 flex items-center justify-between">
              <Link href="/" target="_blank" className="inline-flex items-center gap-1.5 text-xs text-ivory/60 hover:text-ivory">
                Vedi il sito <ExternalLink className="h-3 w-3" />
              </Link>
              <form action={logout}>
                <button className="inline-flex items-center gap-1.5 text-xs text-ivory/60 hover:text-ivory" aria-label="Esci">
                  <LogOut className="h-3.5 w-3.5" /> Esci
                </button>
              </form>
            </div>
          </div>
        </aside>

        <div className="lg:pl-[264px] print:!pl-0">
          {/* top bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-ivory/90 px-4 backdrop-blur-xl md:h-16 md:px-8 print:hidden">
            <TopBarTitle demo={demo} />
            <PanelSearch />
            <div className="flex items-center gap-1">
              {demo && <span className="mr-1 bg-gold/15 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-gold-2 lg:hidden">Demo</span>}
              <HelpButton />
              <Notifications items={notifications} unread={counts.notifications} />
              <button type="button" onClick={() => setMenu(true)} aria-label={moreFresh ? 'Menu (novità)' : 'Menu'} className="relative flex h-10 w-10 items-center justify-center rounded-full text-navy hover:bg-navy/5 lg:hidden">
                <MoreHorizontal className="h-5 w-5" />
                {moreFresh && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-terracotta ring-2 ring-ivory" />}
              </button>
              <button type="button" data-tour="assistant" onClick={() => setAssistant(true)} aria-expanded={assistant} className="group hidden h-10 items-center gap-2 rounded-full bg-navy pl-3 pr-4 text-xs font-semibold text-ivory transition-transform active:scale-95 md:inline-flex">
                <Sparkles className="h-4 w-4 text-gold transition-transform duration-500 group-hover:rotate-12 group-hover:scale-110" /> Chiedi all’assistente
              </button>
            </div>
          </header>
          <main className="mx-auto max-w-[1500px] px-4 pb-36 pt-6 md:px-8 md:pt-10 lg:pb-16 print:max-w-none print:p-0">{children}</main>
        </div>

        {/* mobile: floating island tab bar, designed for one-handed use */}
        <nav aria-label="Navigazione rapida" data-tour="tabbar" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 lg:hidden print:hidden">
          <ul className="grid grid-cols-5 items-center rounded-[1.6rem] bg-navy/95 p-1.5 text-ivory shadow-[0_24px_50px_-18px_rgba(10,28,43,0.75)] ring-1 ring-white/10 backdrop-blur-xl">
            {MOBILE.map((n) => {
              const on = !n.href.startsWith('#') && active(n.href, n.exact);
              const inner =
                n.href === '#azioni' ? (
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gold text-navy-3 shadow-[0_10px_24px_-10px_rgba(182,149,98,0.9)] transition-transform active:scale-90">
                    <Plus className="h-5 w-5" />
                  </span>
                ) : (
                  <span className={cn('relative flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[0.6rem] font-semibold transition-colors', on ? 'text-navy-3' : 'text-ivory/70')}>
                    {on && <motion.span layoutId="mobile-tab" className="absolute inset-0 rounded-2xl bg-ivory" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <span className="relative">
                      <n.icon className="h-5 w-5" strokeWidth={1.7} />
                      {(counts.sections?.[n.href] ?? 0) > 0 && <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-terracotta ring-2 ring-navy" aria-label="Novità" />}
                    </span>
                    <span className="relative">{n.label}</span>
                  </span>
                );
              return (
                <li key={n.href}>
                  {n.href.startsWith('#') ? (
                    <button type="button" className="w-full" data-tour={n.href === '#assistente' ? 'assistant' : undefined} onClick={() => (n.href === '#assistente' ? setAssistant(true) : setQuick(true))} aria-label={n.label}>
                      {n.href === '#assistente' ? (
                        <span className={cn('relative flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[0.6rem] font-semibold', assistant ? 'text-gold' : 'text-ivory/70')}>
                          <Sparkles className="h-5 w-5 text-gold" strokeWidth={1.7} />
                          {n.label}
                        </span>
                      ) : (
                        inner
                      )}
                    </button>
                  ) : (
                    <Link href={n.href} aria-current={on ? 'page' : undefined}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        <AssistantPanel open={assistant} onClose={() => setAssistant(false)} whisper={whisper} live={live} />
        <GuideTour />
        <AssistCursor />
        {/* full-screen layers drawn in the browser only (after the first paint): no server/browser mismatch */}
        {mounted && setup?.wizard && <SetupWizard view={setup} />}
        {mounted && setup && !setup.wizard && setup.celebrate && <WelcomeCelebration name={setup.ownerName} hotel={setup.hotelName} />}

        <Sheet open={quick} onClose={() => setQuick(false)} title="Azioni rapide">
          <div className="grid grid-cols-2 gap-3">
            {[
              { href: '/admin/prenotazioni?nuova=1', label: 'Nuova prenotazione', icon: ClipboardList },
              { href: '/admin/disponibilita?blocca=1', label: 'Blocca date', icon: CalendarRange },
              { href: '/admin/prezzi', label: 'Cambia prezzo', icon: Euro },
              { href: '/admin/camere/nuova', label: 'Aggiungi camera', icon: BedDouble },
            ].map((a) => (
              <Link key={a.href} href={a.href} className="flex flex-col items-start gap-6 rounded-2xl border border-line bg-white p-4 text-sm font-semibold text-navy">
                <a.icon className="h-5 w-5 text-gold-2" />
                {a.label}
              </Link>
            ))}
          </div>
        </Sheet>
        <Sheet open={menu} onClose={() => setMenu(false)} title="Menu">
          <ul className="grid grid-cols-2 gap-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className={cn('flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm', active(n.href, n.exact) ? 'border-navy text-navy' : 'border-line bg-white text-charcoal')}>
                  <n.icon className="h-4 w-4 shrink-0 text-gold-2" /> <span className="min-w-0 flex-1 truncate">{n.label}</span>
                  {freshFor(n) > 0 && <FreshPill n={freshFor(n)} />}
                  {badgeFor(n.badge) > 0 && <span className="min-w-5 rounded-full bg-gold px-1.5 text-center text-[0.65rem] font-bold text-navy-3">{badgeFor(n.badge)}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <form action={logout} className="mt-5">
            <button className="flex items-center gap-2 text-sm text-mist">
              <LogOut className="h-4 w-4" /> Esci ({user.name})
            </button>
          </form>
        </Sheet>
      </div>
      </GuestCardProvider>
      </PageTitleProvider>
    </ToastProvider>
  );
}

/**
 * Left side of the top bar: the logo (phones) / the demo label (desktop), replaced by the page
 * title as soon as the page's own title scrolls under the bar, so you always know where you are.
 */
function TopBarTitle({ demo }: { demo: boolean }) {
  const page = usePageTitle();
  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <AnimatePresence mode="wait" initial={false}>
        {page ? (
          <motion.button
            key={`t-${page.title}`}
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            title="Torna su"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: [0.22, 0.61, 0.12, 1] }}
            className="flex min-w-0 items-baseline gap-2.5 text-left"
            data-testid="topbar-title"
          >
            {page.eyebrow && <span className="hidden shrink-0 text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-gold-2 sm:inline">{page.eyebrow}</span>}
            <span className="serif truncate text-[1.35rem] leading-none text-navy md:text-[1.55rem]">{page.title}</span>
          </motion.button>
        ) : (
          <motion.div key="brand" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.24 }} className="flex items-center">
            <Link href="/admin" className="flex items-center gap-2 text-navy lg:hidden">
              <AnchorMark className="h-6 w-5 text-gold-2" />
              <span className="serif text-xl">L’Ancora</span>
            </Link>
            <span className="hidden items-center gap-3 lg:flex">{demo && <span className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-gold-2">Modalità demo · dati di esempio</span>}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end lg:hidden">
          <motion.button type="button" aria-label="Chiudi" className="absolute inset-0 bg-navy-3/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[85svh] w-full overflow-y-auto rounded-t-[2rem] bg-ivory px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.45, ease: [0.22, 0.61, 0.12, 1] }}>
            <div className="mb-4 flex items-center justify-between">
              <p className="serif text-2xl text-navy">{title}</p>
              <button type="button" onClick={onClose} aria-label="Chiudi" className="flex h-10 w-10 items-center justify-center">
                <X className="h-5 w-5" />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Notifications({ items, unread }: { items: AppNotification[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Notifiche (${unread} non lette)`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread) start(() => void markNotificationsRead());
        }}
        className="relative flex h-10 w-10 items-center justify-center text-navy"
      >
        <Bell className="h-5 w-5" strokeWidth={1.6} />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-terracotta px-1 text-[0.6rem] font-bold text-white">{unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="fixed inset-x-3 top-16 z-50 max-h-[70svh] overflow-y-auto rounded-3xl border border-line bg-white shadow-[0_30px_80px_-30px_rgba(16,40,61,0.5)] md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-[380px]">
            <p className="border-b border-line px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-navy">Notifiche</p>
            <ul className="divide-y divide-line">
              {items.length === 0 && <li className="px-4 py-6 text-sm text-mist">Nessuna notifica.</li>}
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={n.href ?? '/admin'} onClick={() => setOpen(false)} className={cn('block px-4 py-3 hover:bg-ivory', !n.read && 'bg-gold/[0.06]')}>
                    <p className="text-sm font-medium text-navy">{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-mist">{n.body}</p>
                    <p className="mt-1 text-[0.65rem] uppercase tracking-[0.1em] text-mist/80">
                      {fmtDateTime(n.createdAt)} · Telegram: {n.telegram.replace('_', ' ')}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The cards of the panel (see .lg-panel in globals.css): the same list the CSS uses. */
const GLASS = '.lg-panel :is(.rounded-3xl, .rounded-2xl, .rounded-\\[2rem\\], .rounded-\\[1\\.75rem\\]):is(.bg-white.border-line, .bg-navy)';

/** A soft light follows the pointer over the glass cards (one listener for the whole panel). */
function useGlassLight() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    let raf = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      raf = 0;
      const e = last;
      if (!e) return;
      let n = (e.target as Element | null)?.closest?.(GLASS) as HTMLElement | null;
      while (n) {
        const r = n.getBoundingClientRect();
        n.style.setProperty('--mx', `${e.clientX - r.left}px`);
        n.style.setProperty('--my', `${e.clientY - r.top}px`);
        n = n.parentElement?.closest(GLASS) as HTMLElement | null;
      }
    };
    const on = (e: PointerEvent) => {
      last = e;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    window.addEventListener('pointermove', on, { passive: true });
    return () => {
      window.removeEventListener('pointermove', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}

/** "Something new here": a red number next to the menu item, with a soft pulse. */
function FreshPill({ n }: { n: number }) {
  return (
    <span className="relative flex min-w-5 items-center justify-center" title={`${n} ${n === 1 ? 'novità' : 'novità'}`}>
      <span className="absolute inset-0 animate-ping rounded-full bg-terracotta/50" />
      <span className="relative min-w-5 rounded-full bg-terracotta px-1.5 text-center text-[0.65rem] font-bold text-white">{n}</span>
    </span>
  );
}
