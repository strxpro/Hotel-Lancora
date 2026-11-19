'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NiceOption<T extends string> = { value: T; label: React.ReactNode; hint?: React.ReactNode; dot?: string; disabled?: boolean };

/**
 * The panel's own drop-down: a button that opens an animated list (instead of the browser's grey
 * <select>). Keyboard: arrows, Enter, Escape, typing a letter jumps to it. The list is drawn in a
 * portal so cards with overflow hidden never cut it.
 */
export function NiceSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
  tone = 'light',
  disabled,
  maxHeight = 280,
  id: buttonId,
  invalid,
}: {
  value: T;
  onChange: (v: T) => void;
  options: NiceOption<T>[];
  label: string;
  className?: string;
  size?: 'sm' | 'md';
  /** ghost = no box, just bold text (month/year pickers) */
  tone?: 'light' | 'dark' | 'ghost';
  disabled?: boolean;
  maxHeight?: number;
  /** id of the button, so a <label htmlFor> still points at it */
  id?: string;
  /** shown with a red border (aria-invalid) */
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + maxHeight + 16 > window.innerHeight && r.top > maxHeight + 16;
    // wide enough for the longest name + the tick, so "Novembre" is never cut to "Novemb…"
    const longest = Math.max(0, ...options.map((o) => (typeof o.label === 'string' ? o.label.length : 0)));
    const width = Math.min(Math.max(r.width, options.some((o) => o.hint) ? 240 : 140, longest * 8.5 + 100), window.innerWidth - 24);
    setPos({ left: Math.min(r.left, window.innerWidth - width - 12), top: up ? r.top - 8 : r.bottom + 8, width, up });
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const at = options.findIndex((o) => o.value === value);
    setHi(at >= 0 ? at : Math.max(0, options.findIndex((o) => !o.disabled)));
    const onScroll = () => place();
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!btn.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const pick = (v: T) => {
    if (options.find((o) => o.value === v)?.disabled) return;
    onChange(v);
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setHi((i) => {
        let k = i;
        for (let n = 0; n < options.length; n++) {
          k = (k + step + options.length) % options.length;
          if (!options[k]!.disabled) return k;
        }
        return i;
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open) pick(options[hi]!.value);
      else setOpen(true);
    } else if (e.key === 'Escape') setOpen(false);
    else if (e.key.length === 1) {
      const k = options.findIndex((o) => !o.disabled && String(typeof o.label === 'string' ? o.label : o.value).toLowerCase().startsWith(e.key.toLowerCase()));
      if (k >= 0) setHi(k);
    }
  };

  return (
    <>
      <button
        ref={btn}
        id={buttonId}
        type="button"
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className={cn(
          'group inline-flex items-center justify-between gap-2 border text-left font-semibold transition-all disabled:opacity-50',
          tone === 'ghost' ? 'h-9 rounded-full px-3 text-sm' : size === 'sm' ? 'h-9 rounded-xl px-3 text-xs' : 'h-11 rounded-xl px-4 text-sm',
          tone === 'dark' ? 'border-white/20 bg-white/10 text-ivory hover:bg-white/15' : tone === 'ghost' ? 'border-transparent bg-transparent text-navy hover:bg-sand-2' : 'border-line bg-white text-navy hover:border-navy/40',
          open && (tone === 'dark' ? 'ring-2 ring-gold/40' : tone === 'ghost' ? 'bg-sand-2' : 'border-navy/50 ring-2 ring-gold/25'),
          invalid && !open && 'border-red-400 ring-2 ring-red-200',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {current?.dot && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: current.dot }} />}
          {current?.label ?? '—'}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }} className="shrink-0 opacity-60">
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.ul
                ref={list}
                id={id}
                role="listbox"
                aria-label={label}
                initial={{ opacity: 0, y: pos.up ? 8 : -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                style={{ position: 'fixed', left: pos.left, width: pos.width, maxHeight, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }), transformOrigin: pos.up ? 'bottom' : 'top' }}
                className="thin-scroll z-[400] overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-[0_24px_60px_-18px_rgba(10,28,43,0.45)]"
              >
                {options.map((o, i) => {
                  const sel = o.value === value;
                  return (
                    <li
                      key={o.value}
                      data-i={i}
                      role="option"
                      aria-selected={sel}
                      aria-disabled={o.disabled || undefined}
                      onMouseEnter={() => !o.disabled && setHi(i)}
                      onClick={() => pick(o.value)}
                      className={cn('relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors', o.disabled ? 'cursor-not-allowed text-mist/70' : 'cursor-pointer', !o.disabled && (i === hi ? 'bg-ivory text-navy' : 'text-charcoal'), sel && 'font-semibold text-navy')}
                    >
                      {i === hi && !o.disabled && <motion.span layoutId={`hl-${id}`} className="absolute inset-0 rounded-xl bg-navy/[0.06]" transition={{ duration: 0.18 }} />}
                      {o.dot && <span className="relative h-2 w-2 shrink-0 rounded-full" style={{ background: o.dot }} />}
                      <span className="relative min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.hint && <span className="block truncate text-[0.7rem] font-normal text-mist">{o.hint}</span>}
                      </span>
                      {sel && <Check className="relative h-4 w-4 shrink-0 text-gold-2" />}
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/** Every half hour of the day, written in full: 00:00, 00:30 … 23:30. */
export const HALF_HOURS = Array.from({ length: 48 }, (_, k) => `${String(Math.floor(k / 2)).padStart(2, '0')}:${k % 2 ? '30' : '00'}`);

const DAYS = [
  [1, 'L', 'Lunedì'],
  [2, 'M', 'Martedì'],
  [3, 'M', 'Mercoledì'],
  [4, 'G', 'Giovedì'],
  [5, 'V', 'Venerdì'],
  [6, 'S', 'Sabato'],
  [7, 'D', 'Domenica'],
] as const;

/** Time (on the hour or at half past) + days of the week. */
export function TimeDaysPicker({ time, days, onChange, tone = 'light', label }: { time: string; days: number[]; onChange: (v: { time: string; days: number[] }) => void; tone?: 'light' | 'dark'; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NiceSelect size="sm" tone={tone} label={`Ora: ${label}`} value={time} onChange={(t) => onChange({ time: t, days })} options={HALF_HOURS.map((h) => ({ value: h, label: h }))} className="w-[5.6rem]" />
      <span className="flex gap-1" role="group" aria-label={`Giorni: ${label}`}>
        {DAYS.map(([n, short, full]) => {
          const on = days.includes(n);
          return (
            <motion.button
              key={n}
              type="button"
              title={full}
              aria-label={full}
              aria-pressed={on}
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                const next = on ? days.filter((d) => d !== n) : [...days, n].sort();
                if (next.length) onChange({ time, days: next });
              }}
              className={cn(
                'h-8 w-8 rounded-full text-[0.7rem] font-semibold transition-colors',
                on ? (tone === 'dark' ? 'bg-gold text-navy-3' : 'bg-navy text-ivory') : tone === 'dark' ? 'bg-white/10 text-ivory/60 hover:bg-white/15' : 'border border-line bg-white text-mist hover:border-navy/40',
              )}
            >
              {short}
            </motion.button>
          );
        })}
      </span>
    </div>
  );
}
