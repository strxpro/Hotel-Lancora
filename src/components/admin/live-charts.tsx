'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, useInView, useMotionValue, useTransform } from 'motion/react';
import Link from 'next/link';
import { ArrowUpRight, Banknote, Building2, CreditCard, Landmark, LogIn, LogOut } from 'lucide-react';
import { GuestLink } from './guest-card';
import { fmtDate } from '@/lib/dates';
import { cn, money } from '@/lib/utils';

const EASE = [0.22, 0.61, 0.12, 1] as const;

function Count({ value, format = (n: number) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, value, { duration: 0.8, ease: EASE });
    return () => c.stop();
  }, [inView, value, mv]);
  return <motion.span ref={ref}>{text}</motion.span>;
}

/** Who is sleeping in the hotel tonight. */
export function InHouseCard({ guests, rooms, totalRooms, arrivals, departures, people }: { guests: number; rooms: number; totalRooms: number; arrivals: number; departures: number; people: { id?: string; name: string; room: string; nights: string }[] }) {
  const rate = totalRooms ? rooms / totalRooms : 0;
  return (
    <section className="relative flex flex-col overflow-hidden rounded-3xl bg-navy p-5 text-ivory md:p-6">
      <motion.span aria-hidden="true" className="absolute -right-16 -top-20 h-64 w-64 rounded-full bg-gold/25 blur-3xl" animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }} transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }} />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-ivory/60">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sage opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sage" />
            </span>
            <Link href="/admin/prenotazioni?filtro=in_casa" className="underline-offset-4 hover:text-ivory hover:underline">Ospiti in hotel adesso</Link>
          </p>
          <p className="serif mt-3 text-[3.6rem] leading-none">
            <Count value={guests} />
          </p>
          <p className="mt-1 text-sm text-ivory/70">
            in {rooms} {rooms === 1 ? 'camera' : 'camere'} su {totalRooms}
          </p>
        </div>
        <Ring value={rate} />
      </div>
      <RoomSquares occupied={rooms} total={totalRooms} />
      {people.length > 0 && (
        <ul className="relative mt-4 space-y-1.5">
          {people.slice(0, 5).map((p, i) => (
            <motion.li key={p.name + p.room} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.07, duration: 0.5, ease: EASE }} className="flex items-center gap-3 text-sm">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ivory/10 font-serif text-base">{p.name.charAt(0)}</span>
              <span className="min-w-0 flex-1 truncate">{p.id ? <GuestLink bookingId={p.id}>{p.name}</GuestLink> : p.name}</span>
              <span className="shrink-0 text-xs text-ivory/50">
                cam. {p.room} · {p.nights}
              </span>
            </motion.li>
          ))}
          {people.length > 5 && <li className="pl-11 text-xs text-ivory/50">+ altri {people.length - 5}</li>}
        </ul>
      )}
      <div className="relative mt-auto grid grid-cols-2 gap-2 pt-5 text-xs">
        <Link href="/admin/prenotazioni?filtro=arrivi" className="flex items-center gap-2 rounded-2xl bg-white/[0.07] px-3 py-2.5 transition-colors hover:bg-white/[0.14]">
          <LogIn className="h-4 w-4 text-gold" /> {arrivals} in arrivo oggi
        </Link>
        <Link href="/admin/prenotazioni?filtro=partenze" className="flex items-center gap-2 rounded-2xl bg-white/[0.07] px-3 py-2.5 transition-colors hover:bg-white/[0.14]">
          <LogOut className="h-4 w-4 text-gold" /> {departures} in partenza
        </Link>
      </div>
    </section>
  );
}

/** Tonight, one square per room: gold = occupied, glass = free. */
function RoomSquares({ occupied, total }: { occupied: number; total: number }) {
  if (!total) return null;
  return (
    <div className="relative mt-6">
      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-ivory/45">
        Camere stanotte · {occupied} occupate, {total - occupied} libere
      </p>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(1.6rem,1fr))] gap-1.5">
        {Array.from({ length: total }, (_, i) => {
          const on = i < occupied;
          return (
            <motion.span
              key={i}
              title={on ? 'Camera occupata' : 'Camera libera'}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 + i * 0.035, type: 'spring', stiffness: 380, damping: 22 }}
              className={cn('aspect-square rounded-[0.55rem]', on ? 'bg-gold shadow-[0_0_14px_rgba(182,149,98,0.55)]' : 'bg-white/[0.06] ring-1 ring-inset ring-white/10')}
            />
          );
        })}
      </div>
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(248,245,238,0.12)" strokeWidth="7" />
        <motion.circle cx="38" cy="38" r={r} fill="none" stroke="#B69562" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - value) }} transition={{ duration: 1.6, ease: EASE }} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="serif text-xl leading-none">{Math.round(value * 100)}%</span>
        <span className="text-[0.55rem] uppercase tracking-[0.14em] text-ivory/50">occup.</span>
      </span>
    </div>
  );
}

const METHOD = {
  card: { label: 'Carta', color: '#10283D', icon: CreditCard },
  cash: { label: 'Contanti', color: '#7A8C6E', icon: Banknote },
  transfer: { label: 'Bonifico', color: '#B69562', icon: Landmark },
  ota: { label: 'OTA', color: '#9AA6B2', icon: Building2 },
} as const;
export type MethodKey = keyof typeof METHOD;

/** Month earnings split by payment method — animated donut. */
export function EarningsByMethod({ items, month }: { items: Record<MethodKey, number>; month: string }) {
  const total = Object.values(items).reduce((s, v) => s + v, 0);
  const r = 54;
  const C = 2 * Math.PI * r;
  const [hover, setHover] = useState<MethodKey | null>(null);
  let acc = 0;
  const keys = Object.keys(METHOD) as MethodKey[];
  return (
    <section className="@container flex flex-col rounded-3xl border border-line bg-white p-5 md:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">
          <Link href="/admin/pagamenti" className="inline-flex items-center gap-1 hover:underline">Incassi per metodo <ArrowUpRight className="h-3.5 w-3.5 text-gold-2" /></Link>
        </h2>
        <span className="text-xs capitalize text-mist">{month}</span>
      </div>
      <div className="mt-5 flex flex-1 flex-col items-center justify-center gap-5 @sm:flex-row">
        <div className="relative h-36 w-36 shrink-0">
          <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
            <circle cx="70" cy="70" r={r} fill="none" stroke="#F1EBDF" strokeWidth="16" />
            {keys.map((k, i) => {
              const len = total ? (items[k] / total) * C : 0;
              const offset = -acc;
              acc += len;
              if (!len) return null;
              return (
                <motion.circle
                  key={k}
                  cx="70"
                  cy="70"
                  r={r}
                  fill="none"
                  stroke={METHOD[k].color}
                  strokeWidth={hover === k ? 20 : 16}
                  strokeDashoffset={offset}
                  initial={{ strokeDasharray: `0 ${C}` }}
                  animate={{ strokeDasharray: `${Math.max(0, len - 2)} ${C}` }}
                  transition={{ duration: 1.2, delay: 0.15 + i * 0.15, ease: EASE }}
                  onPointerEnter={() => setHover(k)}
                  onPointerLeave={() => setHover(null)}
                  style={{ transition: 'stroke-width .3s' }}
                />
              );
            })}
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[0.6rem] uppercase tracking-[0.16em] text-mist">{hover ? METHOD[hover].label : 'Totale'}</span>
            <span className="serif text-[1.6rem] leading-none text-navy">
              <Count value={hover ? items[hover] : total} format={(n) => money(n)} />
            </span>
          </span>
        </div>
        <ul className="w-full space-y-2.5">
          {keys.map((k) => {
            const M = METHOD[k];
            const pct = total ? Math.round((items[k] / total) * 100) : 0;
            return (
              <li key={k} onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)} className="rounded-2xl px-2 py-1.5 transition-colors hover:bg-ivory">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl text-white" style={{ background: M.color }}>
                    <M.icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1 text-navy">{M.label}</span>
                  <span className="tabular-nums text-navy">{money(items[k])}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-mist">{pct}%</span>
                </div>
                <div className="ml-11 mt-1.5 h-1 overflow-hidden rounded-full bg-sand-2">
                  <motion.div className="h-full rounded-full" style={{ background: M.color }} initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }} transition={{ duration: 1.1, ease: EASE }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Last days of revenue: card vs everything else, drawn as animated curves. */
export function RevenueArea({ data }: { data: { date: string; card: number; other: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 220;
  const pad = { l: 8, r: 8, t: 18, b: 28 };
  const max = Math.max(1, ...data.map((d) => d.card + d.other));
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, data.length - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const totalPts = useMemo(() => data.map((d, i) => [x(i), y(d.card + d.other)] as [number, number]), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardPts = useMemo(() => data.map((d, i) => [x(i), y(d.card)] as [number, number]), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const line = smooth(totalPts);
  const cardLine = smooth(cardPts);
  const area = `${line} L${x(data.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const cardArea = `${cardLine} L${x(data.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const sum = data.reduce((s, d) => s + d.card + d.other, 0);
  const h = hover !== null ? data[hover] : null;
  const best = data.reduce<{ date: string; v: number } | null>((b, d) => (d.card + d.other > (b?.v ?? 0) ? { date: d.date, v: d.card + d.other } : b), null);
  const cardSum = data.reduce((s, d) => s + d.card, 0);
  return (
    <section className="flex flex-col rounded-3xl border border-line bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">
            <Link href="/admin/pagamenti" className="inline-flex items-center gap-1 hover:underline">Incassi ultimi {data.length} giorni <ArrowUpRight className="h-3.5 w-3.5 text-gold-2" /></Link>
          </h2>
          <p className="serif mt-2 text-[2.2rem] leading-none text-navy">
            <Count value={sum} format={(n) => money(n)} />
          </p>
        </div>
        <div className="flex gap-4 text-xs text-mist">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-navy" /> Carta
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gold" /> Contanti e altri
          </span>
        </div>
      </div>
      <div className="relative mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Incassi giornalieri" onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="ra-total" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#B69562" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#B69562" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="ra-card" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#10283D" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#10283D" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="#EFE7D8" strokeDasharray="3 5" />
          ))}
          <motion.path d={area} fill="url(#ra-total)" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.6 }} />
          <motion.path d={cardArea} fill="url(#ra-card)" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.8 }} />
          <motion.path d={line} fill="none" stroke="#B69562" strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: EASE }} />
          <motion.path d={cardLine} fill="none" stroke="#10283D" strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, delay: 0.2, ease: EASE }} />
          {data.map((d, i) => (
            <g key={d.date}>
              <rect x={x(i) - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent" onPointerEnter={() => setHover(i)} />
              {(i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && (
                <text x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#6F777A">
                  {fmtDate(d.date, 'it', { day: 'numeric', month: 'short' })}
                </text>
              )}
            </g>
          ))}
          {h && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#10283D" strokeOpacity="0.2" />
              <circle cx={x(hover)} cy={y(h.card + h.other)} r="5" fill="#B69562" stroke="#fff" strokeWidth="2" />
              <circle cx={x(hover)} cy={y(h.card)} r="5" fill="#10283D" stroke="#fff" strokeWidth="2" />
            </g>
          )}
        </svg>
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-0 rounded-2xl bg-navy px-3 py-2 text-xs text-ivory shadow-lg" style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > data.length / 2 ? '-105%' : '5%'})` }}>
            <p className="font-semibold">{fmtDate(h.date, 'it', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            <p>Carta {money(h.card)}</p>
            <p className="text-ivory/70">Altro {money(h.other)}</p>
          </div>
        )}
      </div>
      <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
        {[
          ['Media al giorno', money(sum / Math.max(1, data.length))],
          ['Giorno migliore', best ? `${money(best.v)} · ${fmtDate(best.date, 'it', { day: 'numeric', month: 'short' })}` : '—'],
          ['Con carta', sum ? `${Math.round((cardSum / sum) * 100)}%` : '—'],
        ].map(([k, v], i) => (
          <motion.div key={k} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.4 + i * 0.08, duration: 0.6, ease: EASE }}>
            <dt className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-mist">{k}</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums text-navy">{v}</dd>
          </motion.div>
        ))}
      </dl>
    </section>
  );
}
