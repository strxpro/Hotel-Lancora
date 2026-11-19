'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const EASE = [0.22, 0.61, 0.12, 1] as const;
export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/* ---------------- toasts ---------------- */
type Toast = { id: number; kind: 'ok' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[450] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.35, ease: EASE }} className={cn('pointer-events-auto flex max-w-md items-start gap-3 border px-4 py-3 text-sm shadow-[0_20px_50px_-20px_rgba(16,40,61,0.45)]', t.kind === 'error' ? 'border-terracotta/30 bg-[#fbf1ee] text-terracotta' : 'border-line bg-white text-navy')}>
              {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" /> : t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-2" />}
              <span>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/** Run a server action with pending state + toast feedback. */
export function useAction() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = useCallback(
    <T,>(fn: () => Promise<ActionResult<T>>, opts: { success?: string; onOk?: (data?: T) => void } = {}) =>
      start(async () => {
        try {
          const r = await fn();
          if (r.ok) {
            if (opts.success || r.message) toast('ok', r.message ?? opts.success!);
            opts.onOk?.(r.data);
          } else toast('error', r.error);
        } catch (e) {
          toast('error', (e as Error).message || 'Operazione non riuscita');
        }
      }),
    [toast],
  );
  return { run, pending };
}

/* ---------------- the page title that stays in view ---------------- */
type TitleEntry = { eyebrow?: string; title: string; past: boolean };
type TitleCtx = { update: (id: number, e: TitleEntry | null) => void; current: TitleEntry | null };
const PageTitleCtx = createContext<TitleCtx | null>(null);
let titleSeq = 0;

/** Mounted once in the shell: knows which page title has scrolled under the top bar. */
export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Map<number, TitleEntry>>(new Map());
  const update = useCallback((id: number, e: TitleEntry | null) => {
    setEntries((m) => {
      const prev = m.get(id);
      if (e && prev && prev.past === e.past && prev.title === e.title && prev.eyebrow === e.eyebrow) return m;
      if (!e && !prev) return m;
      const n = new Map(m);
      if (e) n.set(id, e);
      else n.delete(id);
      return n;
    });
  }, []);
  // the last header (in page order) that went under the top bar is the one to show
  const current = [...entries.entries()].sort((a, b) => a[0] - b[0]).filter(([, e]) => e.past).at(-1)?.[1] ?? null;
  return <PageTitleCtx.Provider value={{ update, current }}>{children}</PageTitleCtx.Provider>;
}

export const usePageTitle = () => useContext(PageTitleCtx)?.current ?? null;

/** Height of the sticky top bar: 3.5rem on phones, 4rem from md. */
const topBarPx = () => (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches ? 64 : 56);

/**
 * A row of filters/tabs that stays pinned under the top bar while the page scrolls (the page title
 * goes into the top bar). Full-bleed background only once it is actually stuck.
 */
export function StickyBar({ children, className }: { children: React.ReactNode; className?: string }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    let io: IntersectionObserver | null = null;
    const watch = () => {
      io?.disconnect();
      io = new IntersectionObserver(([e]) => setStuck(Boolean(e && !e.isIntersecting && e.boundingClientRect.top < topBarPx() + 2)), { rootMargin: `-${topBarPx() + 1}px 0px 0px 0px` });
      io.observe(el);
    };
    watch();
    window.addEventListener('resize', watch);
    return () => {
      io?.disconnect();
      window.removeEventListener('resize', watch);
    };
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="-mb-px h-px" />
      <div data-sticky-bar data-stuck={stuck || undefined} className={cn('sticky top-14 z-20 -mx-4 border-b px-4 py-3 transition-[background-color,box-shadow,border-color] duration-300 md:top-16 md:-mx-8 md:px-8', stuck ? 'border-line bg-ivory/90 shadow-[0_14px_30px_-26px_rgba(16,40,61,0.5)] backdrop-blur-xl' : 'border-transparent', className)}>
        {children}
      </div>
    </>
  );
}

/* ---------------- layout primitives ---------------- */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  const ctx = useContext(PageTitleCtx);
  const h1 = useRef<HTMLHeadingElement>(null);
  const label = typeof title === 'string' ? title : (eyebrow ?? '');
  const update = ctx?.update;
  useEffect(() => {
    const el = h1.current;
    if (!update || !el || !label) return;
    const id = ++titleSeq;
    update(id, { eyebrow, title: label, past: false });
    let io: IntersectionObserver | null = null;
    const watch = () => {
      io?.disconnect();
      io = new IntersectionObserver(([e]) => e && update(id, { eyebrow, title: label, past: !e.isIntersecting && e.boundingClientRect.top < topBarPx() + 4 }), { rootMargin: `-${topBarPx()}px 0px 0px 0px` });
      io.observe(el);
    };
    watch();
    window.addEventListener('resize', watch);
    return () => {
      io?.disconnect();
      window.removeEventListener('resize', watch);
      update(id, null);
    };
  }, [update, label, eyebrow]);
  return (
    <header className="flex flex-col gap-5 pb-8 md:flex-row md:items-end md:justify-between md:pb-10">
      <div>
        {eyebrow && <p className="eyebrow text-gold-2">{eyebrow}</p>}
        <h1 ref={h1} className="serif mt-2 text-[clamp(2rem,4vw,3.1rem)] leading-[1.02] text-navy">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-mist">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className, title, action, padded = true }: { children: React.ReactNode; className?: string; title?: React.ReactNode; action?: React.ReactNode; padded?: boolean }) {
  return (
    <section className={cn('overflow-clip rounded-3xl border border-line bg-white', className)}>
      {title && (
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">{title}</h2>
          {action}
        </div>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: 'neutral' | 'navy' | 'gold' | 'green' | 'red' | 'gray'; className?: string }) {
  const tones = {
    neutral: 'bg-sand-2 text-charcoal',
    navy: 'bg-navy text-ivory',
    gold: 'bg-gold/15 text-gold-2',
    green: 'bg-sage/15 text-sage',
    red: 'bg-terracotta/12 text-terracotta',
    gray: 'bg-charcoal/8 text-mist',
  };
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em]', tones[tone], className)}>{children}</span>;
}

export function Button({ children, variant = 'navy', size = 'md', className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'navy' | 'gold' | 'line' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  const v = { navy: 'bg-navy text-ivory hover:bg-navy-3', gold: 'bg-gold text-navy-3 hover:bg-[#c5a674]', line: 'border border-line bg-white text-navy hover:border-navy', ghost: 'text-navy hover:bg-sand-2', danger: 'bg-terracotta text-ivory hover:bg-terracotta/90' }[variant];
  return (
    <button type="button" {...rest} className={cn('inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[background-color,border-color,color,transform] active:scale-[0.97] disabled:opacity-40', size === 'sm' ? 'h-9 px-3.5 text-xs' : 'h-11 px-5 text-[0.8rem]', v, className)}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={cn('relative shrink-0 rounded-full transition-colors duration-300 disabled:opacity-40', size === 'sm' ? 'h-5 w-9' : 'h-6 w-11', checked ? 'bg-navy' : 'bg-sand')}>
      <motion.span className={cn('absolute top-0.5 rounded-full bg-white shadow', size === 'sm' ? 'h-4 w-4' : 'h-5 w-5')} initial={false} animate={{ left: checked ? (size === 'sm' ? 18 : 22) : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, id, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; id: string; className?: string }) {
  return (
    <div role="tablist" className={cn('relative inline-flex rounded-full border border-line bg-white p-1', className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={cn('relative z-[1] rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-colors', value === o.value ? 'text-ivory' : 'text-mist hover:text-navy')}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 -z-[1] rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-mist">{hint}</span>}
    </label>
  );
}

/* ---------------- dialogs ---------------- */
function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  // the latest onClose, without re-running the effect: an inline `() => setX(null)` changes at every
  // render, and re-running would move the cursor back to the first field while the person types
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      const box = ref.current;
      if (!box || box.contains(document.activeElement)) return;
      (box.querySelector<HTMLElement>('[data-autofocus]') ?? box.querySelector<HTMLElement>('input,select,textarea,button'))?.focus();
    }, 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea')];
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f.at(-1)?.focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);
  return ref;
}

export function Dialog({ open, onClose, title, children, width = 560, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; width?: number; footer?: React.ReactNode }) {
  const ref = useOverlay(open, onClose);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center sm:p-6">
          <motion.button type="button" aria-label="Chiudi" onClick={onClose} className="absolute inset-0 bg-navy-3/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} initial={{ opacity: 0, y: 30, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.98 }} transition={{ duration: 0.4, ease: EASE }} style={{ maxWidth: width }} className="relative flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-[2rem] bg-ivory shadow-[0_40px_100px_-30px_rgba(10,28,43,0.6)] sm:rounded-[2rem]">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="serif text-[1.6rem] leading-tight text-navy">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Chiudi" className="-mr-2 flex h-10 w-10 items-center justify-center text-navy">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="thin-scroll overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useOverlay(open, onClose);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[110] flex justify-end">
          <motion.button type="button" aria-label="Chiudi" onClick={onClose} className="absolute inset-0 bg-navy-3/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside ref={ref} role="dialog" aria-modal="true" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.5, ease: EASE }} className="relative flex h-full w-full max-w-xl flex-col overflow-hidden bg-ivory shadow-[-30px_0_80px_-30px_rgba(10,28,43,0.5)] sm:my-3 sm:mr-3 sm:h-[calc(100%-1.5rem)] sm:rounded-[2rem]">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="serif text-[1.7rem] leading-tight text-navy">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Chiudi" className="-mr-2 flex h-10 w-10 items-center justify-center text-navy">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="thin-scroll flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-white px-5 py-4">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Empty({ icon: Icon, title, text, action }: { icon?: React.ComponentType<{ className?: string }>; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {Icon && <Icon className="h-8 w-8 text-gold" />}
      <p className="serif mt-4 text-[1.5rem] text-navy">{title}</p>
      {text && <p className="mt-2 max-w-sm text-sm text-mist">{text}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'gold' | 'navy'; href?: string }) {
  const cls = cn('flex flex-col justify-between rounded-3xl border border-line p-4 md:p-5', tone === 'navy' ? 'bg-navy text-ivory' : 'bg-white', href && 'transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-navy/30 hover:shadow-[0_18px_40px_-30px_rgba(16,40,61,0.6)]');
  const inner = (
    <>
      <p className={cn('text-[0.66rem] font-semibold uppercase tracking-[0.16em]', tone === 'navy' ? 'text-ivory/60' : 'text-mist')}>{label}</p>
      <p className={cn('serif mt-3 text-[2.3rem] leading-none md:text-[2.6rem]', tone === 'navy' ? 'text-ivory' : 'text-navy')}>{value}</p>
      {sub && <p className={cn('mt-2 text-xs', tone === 'navy' ? 'text-ivory/60' : 'text-mist')}>{sub}</p>}
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/**
 * Number field that behaves like people expect: it can be emptied while typing (no stubborn "0"),
 * accepts "85,50", and clamps to min/max only when you leave it. Empty on blur = previous value,
 * unless `allowEmpty` (then onChange(null)).
 */
export function NumInput({
  value,
  onChange,
  min,
  max,
  decimals = 2,
  allowEmpty = false,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; decimals?: number; allowEmpty?: boolean }) {
  const show = (v: number | null) => (v === null || Number.isNaN(v) ? '' : String(v).replace('.', ','));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);
  const parse = (s: string) => {
    const n = Number(s.replace(/\s/g, '').replace(',', '.'));
    return s.trim() === '' || !Number.isFinite(n) ? null : n;
  };
  return (
    <input
      {...rest}
      type="text"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      autoComplete="off"
      className={className}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        const s = e.target.value.replace(/[^\d.,]/g, '');
        setText(s);
        const n = parse(s);
        if (n !== null) onChange(n);
        else if (allowEmpty) onChange(null);
      }}
      onBlur={(e) => {
        focused.current = false;
        const n = parse(text);
        if (n === null) {
          if (allowEmpty) onChange(null);
          else setText(show(value));
        } else {
          const k = Math.pow(10, decimals);
          const c = Math.round(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)) * k) / k;
          onChange(c);
          setText(show(c));
        }
        rest.onBlur?.(e);
      }}
    />
  );
}

/**
 * Whole-admin habit: tapping an amount selects it all, so typing replaces it (no fighting with the
 * caret or a leftover "0"). Mounted once in the shell.
 */
export function useSelectNumbersOnFocus() {
  useEffect(() => {
    const isNum = (el: EventTarget | null): el is HTMLInputElement =>
      el instanceof HTMLInputElement && (el.type === 'number' || el.inputMode === 'decimal' || el.inputMode === 'numeric') && !el.readOnly && !el.disabled;
    let armed: HTMLInputElement | null = null;
    const onFocus = (e: FocusEvent) => {
      if (!isNum(e.target)) return;
      const el = e.target;
      armed = el;
      requestAnimationFrame(() => {
        try {
          el.select();
        } catch {
          /* some input types refuse select() */
        }
      });
    };
    // the mouseup that follows the focusing click would drop the selection: swallow it once
    const onUp = (e: MouseEvent) => {
      if (armed && e.target === armed) {
        e.preventDefault();
        armed = null;
      }
    };
    const onDown = (e: PointerEvent) => {
      if (armed && e.target !== armed) armed = null;
      if (e.target instanceof HTMLInputElement && document.activeElement === e.target) armed = null;
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
}
