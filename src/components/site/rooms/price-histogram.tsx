'use client';
import { useMemo } from 'react';
import { motion } from 'motion/react';
import { money } from '@/lib/utils';
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
  const BUCKETS = 18;
  const step = Math.max(1, (hi - lo) / BUCKETS);
  const bars = useMemo(() => {
    const b = Array.from({ length: BUCKETS }, () => 0);
    for (const p of points) {
      const i = Math.min(BUCKETS - 1, Math.max(0, Math.floor((p.price - lo) / step)));
      b[i]! += Math.max(1, p.weight);
    }
    const max = Math.max(1, ...b);
    return b.map((v) => v / max);
  }, [points, lo, step]);
  const pct = (v: number) => ((v - lo) / Math.max(1, hi - lo)) * 100;
  const span = Math.max(1, hi - lo);

  return (
    <div>
      <div className="relative flex h-24 items-end gap-[3px] px-2.5" aria-hidden="true">
        {bars.map((h, i) => {
          const from = lo + i * step;
          const inside = from + step >= value[0] && from <= value[1];
          return (
            <motion.span
              key={i}
              className={inside ? 'flex-1 rounded-t-md bg-navy' : 'flex-1 rounded-t-md bg-sand'}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(6, h * 100)}%` }}
              transition={{ duration: 0.7, delay: i * 0.02, ease: [0.22, 0.61, 0.12, 1] }}
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
      <div className="mt-3 grid grid-cols-2 gap-3">
        {([0, 1] as const).map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-white px-4 py-2.5">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-mist">{i ? t.rooms.f.max : t.rooms.f.min}</p>
            <p className="text-[1.05rem] text-navy">{money(value[i], locale)}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-mist">{t.rooms.f.priceHint}</p>
    </div>
  );
}
