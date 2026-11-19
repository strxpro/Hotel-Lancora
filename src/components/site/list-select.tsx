'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A select that looks like the rest of the site: pill button, floating rounded list with a
 * sliding highlight, full keyboard support (↑ ↓ Enter Esc, type-ahead by first letter).
 */
export function ListSelect<T extends string>({ value, onChange, options, label, className, icon = true }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0]!;

  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, options, value]);

  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => (h + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => (h - 1 + options.length) % options.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(options[hi]!.value);
    } else if (e.key.length === 1) {
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setHi(i);
    }
  };

  return (
    <div ref={ref} className={cn('relative', className)} onKeyDown={onKey}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-12 items-center gap-2.5 rounded-full border bg-white pl-4 pr-3 text-sm text-navy transition-[border-color,box-shadow] duration-300', open ? 'border-navy/40 shadow-[0_10px_30px_-18px_rgba(16,40,61,0.6)]' : 'border-line hover:border-navy/30')}
      >
        {icon && <ArrowUpDown className="h-3.5 w-3.5 text-mist" />}
        <span className="relative h-5 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={current.value} className="block whitespace-nowrap" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '-100%' }} transition={{ duration: 0.3, ease: [0.22, 0.61, 0.12, 1] }}>
              {current.label}
            </motion.span>
          </AnimatePresence>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-mist transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            aria-activedescendant={`${id}-o${hi}`}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.12, 1] }}
            className="absolute right-0 top-full z-[60] mt-2 min-w-full origin-top-right overflow-hidden rounded-[1.25rem] border border-line bg-white p-1.5 shadow-[0_24px_60px_-24px_rgba(16,40,61,0.45)]"
          >
            {options.map((o, i) => (
              <li key={o.value} id={`${id}-o${i}`} role="option" aria-selected={o.value === value}>
                <button type="button" tabIndex={-1} onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)} className="relative flex w-full items-center justify-between gap-6 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-left text-sm text-navy">
                  {hi === i && <motion.span layoutId={`${id}-hl`} className="absolute inset-0 rounded-xl bg-sand-2" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                  <span className="relative">{o.label}</span>
                  {o.value === value && <Check className="relative h-4 w-4 text-gold-2" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
