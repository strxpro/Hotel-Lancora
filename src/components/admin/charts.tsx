'use client';
import { useState } from 'react';
import { motion } from 'motion/react';
import { fmtDate } from '@/lib/dates';
import { money } from '@/lib/utils';

/** Daily revenue (bars) with occupancy (line). Pure SVG, scales to its container. */
export function RevenueChart({ data }: { data: { date: string; revenue: number; rate: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 960;
  const H = 280;
  const pad = { l: 56, r: 44, t: 16, b: 34 };
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const nice = Math.ceil(max / 500) * 500 || 500;
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const yr = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${pad.l + bw * i + bw / 2},${yr(d.rate)}`).join(' ');
  const step = Math.ceil(data.length / 12);
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ricavi giornalieri e occupazione">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(nice * f)} y2={y(nice * f)} stroke="#E3D8C4" strokeDasharray={f ? '3 4' : undefined} />
            <text x={pad.l - 8} y={y(nice * f) + 4} textAnchor="end" fontSize="11" fill="#6F777A">
              {Math.round(nice * f).toLocaleString('it-IT')}€
            </text>
            <text x={W - pad.r + 8} y={yr(f * 100) + 4} fontSize="11" fill="#9A7A4A">
              {f * 100}%
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={pad.l + bw * i} y={pad.t} width={bw} height={H - pad.t - pad.b} fill={hover === i ? 'rgba(182,149,98,0.08)' : 'transparent'} />
            <motion.rect
              x={pad.l + bw * i + bw * 0.18}
              width={bw * 0.64}
              initial={{ y: H - pad.b, height: 0 }}
              animate={{ y: y(d.revenue), height: H - pad.b - y(d.revenue) }}
              transition={{ duration: 0.7, delay: i * 0.01, ease: [0.22, 0.61, 0.12, 1] }}
              fill={hover === i ? '#0A1C2B' : '#10283D'}
            />
            {i % step === 0 && (
              <text x={pad.l + bw * i + bw / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="#6F777A">
                {fmtDate(d.date, 'it', { day: 'numeric', month: data.length > 40 ? 'short' : undefined })}
              </text>
            )}
          </g>
        ))}
        <motion.path d={line} fill="none" stroke="#B69562" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2 }} />
      </svg>
      {h && (
        <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 border border-line bg-white px-3 py-2 text-xs shadow-sm">
          <p className="font-semibold text-navy">{fmtDate(h.date, 'it', { weekday: 'short', day: 'numeric', month: 'long' })}</p>
          <p className="text-charcoal">Ricavi {money(h.revenue)} · occupazione {h.rate}%</p>
        </div>
      )}
      <div className="mt-2 flex gap-5 text-xs text-mist">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 bg-navy" /> Ricavi maturati
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-4 bg-gold" /> Occupazione
        </span>
      </div>
    </div>
  );
}

export function BarList({ items, unit, unitOne }: { items: { label: string; value: number; sub?: string; accent?: boolean }[]; unit?: string; /** the unit when the value is 1 ("notte") */ unitOne?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={it.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-navy">{it.label}</span>
            <span className="tabular-nums text-charcoal">
              {it.value}{unit ? ` ${it.value === 1 && unitOne ? unitOne : unit}` : ''}
              {it.sub && <span className="ml-2 text-xs text-mist">{it.sub}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2 bg-sand-2">
            <motion.div className={it.accent ? 'h-full bg-gold' : 'h-full bg-navy'} initial={{ width: 0 }} animate={{ width: `${(it.value / max) * 100}%` }} transition={{ duration: 0.8, delay: i * 0.05, ease: [0.22, 0.61, 0.12, 1] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
