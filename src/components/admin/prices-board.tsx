'use client';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Banknote, CalendarDays, CalendarRange, Check, CheckCheck, CreditCard, Infinity as Always, MousePointerClick, RotateCcw, X } from 'lucide-react';
import type { RoomOption } from '@/server/admin-data';
import type { MonthPrice } from '@/lib/period-prices';
import { monthRanges } from '@/lib/period-prices';
import { addDays, fmtDate, todayISO } from '@/lib/dates';
import { cn, money } from '@/lib/utils';
import { Button, useAction } from './ui';
import { setPeriodPriceAction, setRoomsPriceAction } from '@/app/admin/actions/rooms';

type When = 'always' | 'months' | 'dates';

const monthShort = (m: string) => fmtDate(m, 'it', { month: 'short' }).replace('.', '');
const monthLong = (m: string) => fmtDate(m, 'it', { month: 'long', year: 'numeric' });

/**
 * Prices as a board of room tiles: tap one or more rooms, type the price once and say when it
 * applies — always (base price), in some months, or in precise dates. Below, every room month by
 * month: tap a month to change just that one.
 */
export function PricesBoard({ rooms, tonight, canEdit, cash, months = {} }: { rooms: RoomOption[]; tonight: Record<string, number>; canEdit: boolean; cash: { enabled: boolean; percent: number }; months?: Record<string, MonthPrice[]> }) {
  const { run, pending } = useAction();
  const today = todayISO();
  const [sel, setSel] = useState<string[]>([]);
  const [card, setCard] = useState('');
  const [cashV, setCashV] = useState('');
  const [when, setWhen] = useState<When>('always');
  const [picked, setPicked] = useState<string[]>([]);
  const [from, setFrom] = useState(addDays(today, 7));
  const [toIncl, setToIncl] = useState(addDays(today, 9));
  const [done, setDone] = useState<string[]>([]);
  const cashOf = (r: RoomOption) => (r.cashPrice ?? Math.round(r.basePrice * (1 - cash.percent / 100) * 100) / 100);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selected = useMemo(() => rooms.filter((r) => sel.includes(r.id)), [rooms, sel]);
  const columns = useMemo(() => Object.values(months)[0]?.map((x) => x.m) ?? [], [months]);
  const cardN = Number(card.replace(',', '.'));
  const cashN = cashV.trim() ? Number(cashV.replace(',', '.')) : null;
  const period = when !== 'always';
  const ranges = when === 'months' ? monthRanges(picked) : when === 'dates' && toIncl >= from ? [{ from, to: addDays(toIncl, 1) }] : [];
  const priceOk = cardN >= 1 && cardN <= 5000;
  const cashOk = cashN === null || (cashN >= 1 && cashN <= cardN);
  const valid = (period ? priceOk && ranges.length > 0 : priceOk) && cashOk;

  const reset = () => {
    setSel([]);
    setCard('');
    setCashV('');
    setPicked([]);
    setWhen('always');
  };
  const flash = (ids: string[]) => {
    setDone(ids);
    window.setTimeout(() => setDone([]), 1800);
  };

  const pickFirst = (ids: string[]) => {
    setSel(ids);
    const first = rooms.find((r) => r.id === ids[0]);
    if (first && !card) {
      setCard(String(first.basePrice));
      setCashV(first.cashPrice ? String(first.cashPrice) : '');
    }
  };

  /** from the month grid: this room, this month */
  const pickCell = (r: RoomOption, m: MonthPrice) => {
    if (!canEdit) return;
    setSel([r.id]);
    setWhen('months');
    setPicked([m.m]);
    setCard(String(m.max));
    setCashV(m.cash ? String(m.cash) : '');
  };

  const apply = (price: number | null) => {
    const ids = sel;
    run(() => (period ? setPeriodPriceAction({ roomIds: ids, ranges, price, cash: price === null ? null : cashN }) : setRoomsPriceAction(ids, cardN, cashN)), {
      onOk: () => {
        flash(ids);
        reset();
      },
    });
  };

  const whenLabel = when === 'months' ? (picked.length ? monthRanges(picked).map((r) => (addDays(r.to, -1).slice(0, 7) === r.from.slice(0, 7) ? monthLong(r.from) : `${monthShort(r.from)} – ${monthLong(addDays(r.to, -1))}`)).join(', ') : 'scegli i mesi') : when === 'dates' ? `dal ${fmtDate(from)} al ${fmtDate(toIncl)}` : 'sempre (prezzo base)';

  return (
    <section data-tour="prices-board" className="rounded-3xl border border-line bg-white p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="serif text-[1.7rem] leading-tight text-navy">Prezzi per notte</h2>
          <p className="mt-1 flex items-center gap-2 text-sm text-mist">
            <MousePointerClick className="h-4 w-4 text-gold-2" /> Tocca le camere (anche più di una), scrivi il prezzo e scegli quando vale: sempre, in alcuni mesi o in date precise.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" onClick={() => pickFirst(rooms.map((r) => r.id))} className="flex h-10 items-center gap-1.5 rounded-full border border-line px-4 text-xs font-semibold text-navy hover:border-navy/40">
              <CheckCheck className="h-4 w-4" /> Tutte
            </button>
            {sel.length > 0 && (
              <button type="button" onClick={reset} className="flex h-10 items-center gap-1.5 rounded-full px-3 text-xs text-mist hover:text-navy">
                <X className="h-4 w-4" /> Nessuna
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {rooms.map((r, i) => {
          const on = sel.includes(r.id);
          const lit = done.includes(r.id);
          return (
            <motion.button
              key={r.id}
              type="button"
              disabled={!canEdit}
              aria-pressed={on}
              onClick={() => (sel.length === 0 ? pickFirst([r.id]) : toggle(r.id))}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, scale: on ? 0.98 : 1 }}
              transition={{ delay: Math.min(i, 12) * 0.025, type: 'spring', stiffness: 380, damping: 30 }}
              className={cn('relative flex flex-col overflow-hidden rounded-2xl border p-3.5 text-left transition-colors md:p-4', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-ivory hover:border-navy/30')}
            >
              {lit && <motion.span className="absolute inset-0 bg-sage/30" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.6 }} />}
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="serif block text-[1.6rem] leading-none">{r.number}</span>
                  <span className={cn('mt-1 block truncate text-xs', on ? 'text-ivory/70' : 'text-mist')}>{r.name}</span>
                </span>
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors', on ? 'border-gold bg-gold text-navy-3' : 'border-navy/20 bg-white')}>
                  <AnimatePresence>{on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check className="h-3.5 w-3.5" /></motion.span>}</AnimatePresence>
                </span>
              </span>
              {/* card and cash in the same style; cash a touch bigger */}
              <span className="mt-4 grid gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-2 px-2">
                  <span className={cn('flex items-center gap-1 text-[0.6rem] uppercase tracking-[0.12em]', on ? 'text-gold' : 'text-mist')}>
                    <CreditCard className="h-3 w-3" /> carta
                  </span>
                  <span className="serif ml-auto whitespace-nowrap text-[1.3rem] leading-none">{money(r.basePrice)}</span>
                </span>
                {cash.enabled && (
                  <span className={cn('flex flex-wrap items-baseline justify-between gap-x-2 rounded-xl px-2 py-1', on ? 'bg-white/10' : 'bg-sage/10')}>
                    <span className={cn('flex items-center gap-1 text-[0.6rem] uppercase tracking-[0.12em]', on ? 'text-[#b9d1ab]' : 'text-[#3f5a35]')}>
                      <Banknote className="h-3 w-3" /> contanti
                    </span>
                    <span className={cn('serif ml-auto whitespace-nowrap text-[1.5rem] leading-none', on ? 'text-[#d9e8cf]' : 'text-[#3f5a35]')}>{money(cashOf(r))}</span>
                  </span>
                )}
              </span>
              {tonight[r.id] !== undefined && tonight[r.id] !== r.basePrice && <span className={cn('mt-2 text-[0.66rem]', on ? 'text-ivory/60' : 'text-mist')}>stanotte {money(tonight[r.id]!)} (periodo)</span>}
            </motion.button>
          );
        })}
      </div>

      {/* bulk editor: slides up when rooms are selected */}
      <AnimatePresence>
        {sel.length > 0 && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }} className="sticky bottom-28 z-30 mt-5 lg:bottom-4">
            <div className="rounded-[1.6rem] bg-navy p-4 text-ivory shadow-[0_30px_70px_-30px_rgba(10,28,43,0.9)] md:p-5">
              <p className="text-sm">
                <b className="text-gold">{sel.length}</b> {sel.length === 1 ? 'camera' : 'camere'}: {selected.slice(0, 6).map((r) => r.number).join(', ')}
                {selected.length > 6 ? '…' : ''} <span className="text-ivory/55">· {whenLabel}</span>
              </p>

              {/* when does the price apply */}
              <div role="radiogroup" aria-label="Quando vale il prezzo" className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-white/[0.07] p-1">
                {([
                  { v: 'always', icon: Always, t: 'Sempre' },
                  { v: 'months', icon: CalendarRange, t: 'Alcuni mesi' },
                  { v: 'dates', icon: CalendarDays, t: 'Date precise' },
                ] as const).map((o) => (
                  <button key={o.v} type="button" role="radio" aria-checked={when === o.v} onClick={() => setWhen(o.v)} className={cn('relative flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition-colors', when === o.v ? 'text-navy' : 'text-ivory/70 hover:text-ivory')}>
                    {when === o.v && <motion.span layoutId="price-when" className="absolute inset-0 rounded-xl bg-gold" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <o.icon className="relative h-3.5 w-3.5" /> <span className="relative">{o.t}</span>
                  </button>
                ))}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                {when === 'months' && (
                  <motion.div key="m" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                      {columns.map((m) => {
                        const on = picked.includes(m);
                        return (
                          <motion.button key={m} type="button" aria-pressed={on} whileTap={{ scale: 0.94 }} onClick={() => setPicked((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]))} className={cn('rounded-xl border px-2 py-2 text-center text-xs transition-colors', on ? 'border-gold bg-gold font-semibold text-navy' : 'border-white/15 text-ivory/80 hover:border-white/40')}>
                            <span className="block capitalize">{monthShort(m)}</span>
                            <span className={cn('block text-[0.62rem]', on ? 'text-navy/70' : 'text-ivory/45')}>{m.slice(0, 4)}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
                {when === 'dates' && (
                  <motion.div key="d" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-ivory/70">
                        Prima notte
                        <input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} className="mt-1 block w-full bg-transparent text-sm text-ivory outline-none [color-scheme:dark]" />
                      </label>
                      <label className="rounded-2xl bg-white/10 px-3 py-2 text-xs text-ivory/70">
                        Ultima notte
                        <input type="date" value={toIncl} min={from} onChange={(e) => setToIncl(e.target.value)} className="mt-1 block w-full bg-transparent text-sm text-ivory outline-none [color-scheme:dark]" />
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <label className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2.5">
                  <CreditCard className="h-4 w-4 shrink-0 text-gold" />
                  <span className="text-xs text-ivory/70">Carta €</span>
                  <input autoFocus inputMode="decimal" value={card} onChange={(e) => setCard(e.target.value.replace(/[^\d.,]/g, ''))} className="serif min-w-0 flex-1 bg-transparent text-right text-2xl text-ivory outline-none" aria-label="Nuovo prezzo con carta" />
                </label>
                {(
                  <label className={cn('flex items-center gap-2 rounded-2xl px-4 py-2.5', cash.enabled ? 'bg-white/10' : 'bg-white/5 opacity-50')}>
                    <Banknote className="h-4 w-4 shrink-0 text-[#a9c39b]" />
                    <span className="text-xs text-ivory/70">Contanti €</span>
                    <input inputMode="decimal" disabled={!cash.enabled} value={cashV} placeholder={cardN > 0 ? String(Math.round(cardN * (1 - cash.percent / 100) * 100) / 100) : `−${cash.percent}%`} onChange={(e) => setCashV(e.target.value.replace(/[^\d.,]/g, ''))} className="serif min-w-0 flex-1 bg-transparent text-right text-[1.7rem] text-[#d9e8cf] outline-none placeholder:text-ivory/30" aria-label="Nuovo prezzo in contanti" />
                  </label>
                )}
                <Button variant="gold" disabled={pending || !valid} onClick={() => apply(cardN)} className="h-full min-h-12">
                  {pending ? 'Salvo…' : 'Applica'}
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[0.72rem] text-ivory/55">
                  {!cashOk ? 'Il contanti non può costare più della carta.' : period ? (cash.enabled ? 'Contanti vuoto = lo sconto solito della camera. Fuori da questo periodo resta il prezzo base.' : 'Fuori da questo periodo resta il prezzo base.') : 'Vale tutto l’anno, tranne i mesi o le date con un prezzo proprio. Contanti vuoto = sconto standard.'}
                </p>
                {period && ranges.length > 0 && (
                  <button type="button" disabled={pending} onClick={() => apply(null)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.72rem] font-semibold text-ivory/80 ring-1 ring-white/20 transition-colors hover:bg-white/10 hover:text-ivory">
                    <RotateCcw className="h-3.5 w-3.5" /> Torna al prezzo base in questo periodo
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* every room, month by month */}
      {columns.length > 0 && (
        <div className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="serif text-[1.35rem] text-navy">Mese per mese</h3>
            <p className="flex items-center gap-3 text-[0.7rem] text-mist">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-gold/30" /> più caro del base</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sage/25" /> più economico</span>
              {canEdit && <span>· tocca un mese per cambiarlo</span>}
            </p>
          </div>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line" data-lenis-prevent>
            <table className="w-full min-w-[46rem] border-collapse text-center text-xs">
              <thead>
                <tr className="bg-ivory text-[0.62rem] uppercase tracking-[0.1em] text-mist">
                  <th className="sticky left-0 z-[1] bg-ivory px-3 py-2 text-left font-semibold">Camera</th>
                  {columns.map((m, i) => (
                    <th key={m} className="px-1 py-2 font-semibold">
                      <span className="capitalize">{monthShort(m)}</span>
                      {(i === 0 || m.endsWith('-01-01')) && <span className="block text-[0.55rem] text-mist/70">{m.slice(0, 4)}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <th scope="row" className="sticky left-0 z-[1] bg-white px-3 py-1.5 text-left font-normal">
                      <span className="serif text-base text-navy">{r.number}</span>
                    </th>
                    {(months[r.id] ?? []).map((m) => {
                      const up = m.max > r.basePrice;
                      const down = m.min < r.basePrice && !up;
                      const on = sel.length === 1 && sel[0] === r.id && when === 'months' && picked.includes(m.m);
                      return (
                        <td key={m.m} className="p-0.5">
                          <button type="button" disabled={!canEdit} onClick={() => pickCell(r, m)} title={`Camera ${r.number} · ${monthLong(m.m)}`} className={cn('w-full rounded-lg px-1 py-1.5 tabular-nums transition-colors', on ? 'bg-navy text-ivory' : up ? 'bg-gold/20 text-navy hover:bg-gold/35' : down ? 'bg-sage/20 text-[#3f5a35] hover:bg-sage/35' : 'text-mist hover:bg-ivory hover:text-navy')}>
                            {m.min === m.max ? money(m.min) : `${Math.round(m.min)}–${money(m.max)}`}
                            {cash.enabled && m.cash ? <span className={cn('block text-[0.62rem]', on ? 'text-[#d9e8cf]' : 'text-[#3f5a35]')}>contanti {money(m.cash)}</span> : null}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
