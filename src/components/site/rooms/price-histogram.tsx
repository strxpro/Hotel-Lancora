'use client';
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { cn, money } from '@/lib/utils';
import { useI18n } from '../providers';

export interface PricePoint {
  price: number;
  weight: number;
}

/**
 * Dual-thumb price range with a histogram behind it. Bar height = how often guests chose that
 * price band (bookings over the last year); bars inside the selected range are highlighted.
 */
export function PriceHistogram({ points, bounds, value, onChange }: { points: PricePoint[]; bounds: [number, number]; value: [number, number]; onChange: (v: [number, number]) => void }) {
  const { t, locale } = useI18n();
  const [lo, hi] = bounds;
  const BUCKETS = 36;
  const span = Math.max(1, hi - lo);
  const step = span / BUCKETS;
  // a smooth hill, not jagged blocks: every price spreads over its neighbours (Gaussian kernel), so
  // the tallest bar is where most guests book and the height falls off gently on both sides
  const bars = useMemo(() => {
    const h = Math.max(span / 9, 4);
    const b = Array.from({ length: BUCKETS }, (_, i) => {
      const x = lo + (i + 0.5) * step;
      return points.reduce((s, p) => s + (1 + Math.max(0, p.weight)) * Math.exp(-0.5 * ((x - p.price) / h) ** 2), 0);
    });
    const max = Math.max(1e-9, ...b);
    return b.map((v) => v / max);
  }, [points, lo, step, span]);
  const pct = (v: number) => ((v - lo) / span) * 100;

  return (
    <div>
      <div className="relative flex h-20 items-end gap-[2px] px-2.5" aria-hidden="true">
        {bars.map((h, i) => {
          const from = lo + i * step;
          const inside = from + step >= value[0] && from <= value[1];
          return (
            <motion.span
              key={i}
              className={cn('flex-1 rounded-t-[3px] transition-colors duration-300', inside ? 'bg-navy' : 'bg-sand')}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(4, h * 100)}%` }}
              transition={{ duration: 0.8, delay: i * 0.012, ease: [0.22, 0.61, 0.12, 1] }}
            />
          );
        })}
      </div>
      <div className="relative mx-2.5 h-8">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-sand" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-navy" style={{ left: `${pct(value[0])}%`, right: `${100 - pct(value[1])}%` }} />
        <input
          type="range"
          aria-label={t.rooms.f.min}
          min={lo}
          max={hi}
          step={span > 200 ? 5 : 1}
          value={value[0]}
          onChange={(e) => onChange([Math.min(Number(e.target.value), value[1] - 1), value[1]])}
          className="range-thumb absolute inset-0 w-full"
        />
        <input
          type="range"
          aria-label={t.rooms.f.max}
          min={lo}
          max={hi}
          step={span > 200 ? 5 : 1}
          value={value[1]}
          onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0] + 1)])}
          className="range-thumb absolute inset-0 w-full"
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {([0, 1] as const).map((i) => (
          <div key={i} className="rounded-xl border border-line bg-white px-3 py-2">
            <p className="text-[0.56rem] font-semibold uppercase tracking-[0.18em] text-mist">{i ? t.rooms.f.max : t.rooms.f.min}</p>
            <p className="text-[0.95rem] text-navy">{money(value[i], locale)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[0.7rem] leading-snug text-mist">{t.rooms.f.priceHint}</p>
    </div>
  );
}
