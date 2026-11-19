'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react';
import { money } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useI18n } from './providers';

/**
 * A price that lives: when the owner changes it in the panel (or by voice on Telegram), the page
 * receives the new value without reloading and the number glides to it, with a soft gold flash
 * and a small ▲/▼. The text is driven by a motion value, so React does not re-render each frame.
 */
export function LiveMoney({ value, decimals = 0, className, badge = true }: { value: number; decimals?: 0 | 2; className?: string; badge?: boolean }) {
  const { locale } = useI18n();
  const mv = useMotionValue(value);
  // whole euros while gliding (no "71,85 €" mid-tween), exact value at rest
  const text = useTransform(mv, (v) => money(decimals ? Math.round(v * 100) / 100 : Math.round(v), locale, decimals));
  const prev = useRef(value);
  const [change, setChange] = useState<{ dir: 1 | -1; at: number } | null>(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (from === value) return;
    setChange({ dir: value > from ? 1 : -1, at: Date.now() });
    const c = animate(mv, value, { duration: 1.2, ease: [0.16, 1, 0.3, 1] });
    const t = window.setTimeout(() => setChange(null), 2800);
    return () => {
      c.stop();
      window.clearTimeout(t);
    };
  }, [value, mv]);

  return (
    <span className={cn('relative inline-flex items-baseline', className)}>
      <AnimatePresence>
        {change && (
          <motion.span
            key={`flash-${change.at}`}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-2 -inset-y-1 rounded-xl bg-gold/30"
            initial={{ opacity: 0.95, scale: 0.92 }}
            animate={{ opacity: 0, scale: 1.12 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <motion.span className="relative tabular-nums">{text}</motion.span>
      <AnimatePresence>
        {badge && change && (
          <motion.span
            key={`b-${change.at}`}
            aria-hidden="true"
            initial={{ opacity: 0, y: change.dir > 0 ? 8 : -8, scale: 0.5 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            className={cn('relative ml-1.5 self-center rounded-full px-1.5 py-0.5 font-sans text-[0.42em] font-semibold leading-none', change.dir > 0 ? 'bg-terracotta/15 text-terracotta' : 'bg-sage/20 text-[#3f5a35]')}
          >
            {change.dir > 0 ? '▲' : '▼'}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
