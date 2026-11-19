'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Lock, Phone, Search } from 'lucide-react';
import type { BookingRow, RoomOption } from '@/server/admin-data';
import { addDays, addMonths, diffDays, fmtDate, isWeekend, monthDays, monthName, startOfMonth, startOfWeek, weekdayMon, weekdayShortNames } from '@/lib/dates';
import { cn, notti } from '@/lib/utils';
import { Badge, Button, Segmented, StickyBar } from './ui';
import { NiceSelect } from './nice-select';
import { BlockDetailDialog, BookingDetailDialog, NewBookingDialog, RangeActionDialog, type BlockRow } from './booking-dialogs';
import { BookingView } from './booking-view';
import type { RatePeriod } from '@/lib/types';

type View = 'planning' | 'calendario' | 'booking';
const EASE = [0.22, 0.61, 0.12, 1] as const;
const FLOOR: Record<string, string> = { terra: 'Piano terra', superiore: 'Piano sup.', inferiore: 'Piano inf.' };

function tone(b: BookingRow): { x: string; bar: string; label: string } {
  if (b.status === 'cancelled') return { x: 'text-terracotta/60', bar: 'bg-terracotta/8', label: 'Annullata' };
  if (b.status === 'pending_payment') return { x: 'text-gold-2', bar: 'bg-gold/18', label: 'Pagamento in attesa' };
  return { x: 'text-navy', bar: 'bg-navy/[0.07]', label: 'Prenotazione' };
}

export function PlanningBoard({ rooms, bookings, blocks, today, initialMonth, initialView, openBlock, periods = [] }: { rooms: RoomOption[]; bookings: BookingRow[]; blocks: (BlockRow & { source?: string })[]; today: string; initialMonth: string; initialView: View; openBlock?: boolean; periods?: RatePeriod[] }) {
  const [month, setMonth] = useState(initialMonth);
  const [view, setView] = useState<View>(initialView);
  const [q, setQ] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [sel, setSel] = useState<{ roomId: string; from: string } | null>(null);
  const [blockRange, setBlockRange] = useState<{ roomId: string; from: string; to: string } | null>(null);
  const [newBooking, setNewBooking] = useState<{ roomId?: string; checkIn?: string; checkOut?: string } | null>(null);
  const [detail, setDetail] = useState<BookingRow | null>(null);
  const [blockDetail, setBlockDetail] = useState<BlockRow | null>(null);
  const [hint, setHint] = useState(openBlock ? 'Tocca la prima e l’ultima notte da bloccare sulla riga della camera.' : '');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('m', month.slice(0, 7));
    p.set('view', view);
    p.delete('blocca');
    window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
  }, [month, view]);

  const shownRooms = rooms.filter((r) => r.status !== 'draft' && (!q || `${r.number} ${r.name}`.toLowerCase().includes(q.toLowerCase())));
  const unassigned = bookings.filter((b) => !b.roomId && b.active && b.checkOut > today);
  const roomById = (id: string) => rooms.find((r) => r.id === id) ?? null;

  const onCell = (roomId: string, date: string) => {
    if (!sel || sel.roomId !== roomId) {
      setSel({ roomId, from: date });
      setHint('Ora tocca l’ultima notte (anche la stessa per una sola notte).');
      return;
    }
    const a = sel.from <= date ? sel.from : date;
    const b = sel.from <= date ? date : sel.from;
    setSel(null);
    setHint('');
    setBlockRange({ roomId, from: a, to: addDays(b, 1) });
  };

  return (
    <div>
      <StickyBar className="mb-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className={cn('flex items-center gap-1.5 rounded-full border border-line bg-white p-1 sm:self-start', view === 'booking' && 'invisible')}>
          <button type="button" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mese precedente" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy hover:bg-sand-2 active:scale-90">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <MonthPicker month={month} onChange={setMonth} />
          <button type="button" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mese successivo" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy hover:bg-sand-2 active:scale-90">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setMonth(startOfMonth(today))} className="ml-auto h-9 shrink-0 rounded-full bg-gold px-4 text-xs font-semibold text-navy-3 active:scale-95">
            Oggi
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented id="planning-view" value={view} onChange={setView} options={[{ value: 'planning', label: 'Planning' }, { value: 'calendario', label: 'Calendario' }, { value: 'booking', label: 'Vista Booking' }]} />
          <Button size="sm" onClick={() => setNewBooking({})}>
            <Phone className="h-4 w-4" /> Prenotazione telefonica
          </Button>
        </div>
      </div>
      </StickyBar>

      {unassigned.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-gold/40 bg-gold/[0.07] px-4 py-3">
          <Badge tone="gold">Da assegnare · {unassigned.length}</Badge>
          {unassigned.map((b) => (
            <button key={b.id} type="button" onClick={() => setDetail(b)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-navy hover:border-navy">
              {b.guest} · {fmtDate(b.checkIn)}→{fmtDate(b.checkOut)} · {b.sourceLabel}
              {b.simulated ? ' · SIMULAZIONE' : ''}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: EASE }}>
          {view === 'planning' ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" />
                  <label htmlFor="room-search" className="sr-only">
                    Cerca camera
                  </label>
                  <input id="room-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca camera (es. 105)" className="field py-2 pl-9 text-sm" />
                </div>
                <label className="flex items-center gap-2 text-xs text-mist">
                  <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="accent-[var(--color-navy)]" /> Mostra annullate
                </label>
                <AnimatePresence>
                  {(hint || sel) && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-xs text-gold-2">
                      <Lock className="h-3.5 w-3.5" /> {hint || 'Tocca l’ultima notte da bloccare.'}
                      {sel && (
                        <button type="button" className="underline" onClick={() => { setSel(null); setHint(''); }}>
                          annulla
                        </button>
                      )}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
              <SheetGrid month={month} today={today} rooms={shownRooms} bookings={bookings} blocks={blocks} showCancelled={showCancelled} sel={sel} onCell={onCell} onBooking={setDetail} onBlock={setBlockDetail} />
              <Legend />
            </>
          ) : view === 'booking' ? (
            <BookingView rooms={rooms} bookings={bookings} blocks={blocks} periods={periods} today={today} onBooking={setDetail} />
          ) : (
            <CalendarView month={month} today={today} bookings={bookings} rooms={rooms} onOpen={setDetail} onNew={(d) => setNewBooking({ checkIn: d, checkOut: addDays(d, 1) })} />
          )}
        </motion.div>
      </AnimatePresence>

      {blockRange && <RangeActionDialog key={`${blockRange.roomId}-${blockRange.from}-${blockRange.to}`} open onClose={() => setBlockRange(null)} room={roomById(blockRange.roomId)} from={blockRange.from} to={blockRange.to} rooms={rooms} bookings={bookings} blocks={blocks} />}
      {newBooking && <NewBookingDialog key={JSON.stringify(newBooking)} open onClose={() => setNewBooking(null)} rooms={rooms} bookings={bookings} blocks={blocks} preset={newBooking} />}
      <BookingDetailDialog key={detail?.id} row={detail} onClose={() => setDetail(null)} rooms={rooms} bookings={bookings} blocks={blocks} />
      <BlockDetailDialog block={blockDetail} room={blockDetail ? roomById(blockDetail.roomId) : null} onClose={() => setBlockDetail(null)} />
    </div>
  );
}

function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
      <label className="sr-only" htmlFor="pm">
        Mese
      </label>
      <NiceSelect
        id="pm"
        tone="ghost"
        label="Mese"
        value={String(m)}
        onChange={(v) => onChange(`${y}-${v.padStart(2, '0')}-01`)}
        options={Array.from({ length: 12 }, (_, i) => {
          const n = monthName(`2026-${String(i + 1).padStart(2, '0')}-01`, 'it', false);
          return { value: String(i + 1), label: n.charAt(0).toUpperCase() + n.slice(1) };
        })}
      />
      <label className="sr-only" htmlFor="py">
        Anno
      </label>
      <NiceSelect id="py" tone="ghost" label="Anno" value={String(y)} onChange={(v) => onChange(`${v}-${String(m).padStart(2, '0')}-01`)} options={[y - 2, y - 1, y, y + 1, y + 2].map((v) => ({ value: String(v), label: String(v) }))} />
    </div>
  );
}

function SheetGrid({ month, today, rooms, bookings, blocks, showCancelled, sel, onCell, onBooking, onBlock }: { month: string; today: string; rooms: RoomOption[]; bookings: BookingRow[]; blocks: BlockRow[]; showCancelled: boolean; sel: { roomId: string; from: string } | null; onCell: (roomId: string, d: string) => void; onBooking: (b: BookingRow) => void; onBlock: (b: BlockRow) => void }) {
  const days = monthDays(month);
  const start = days[0]!;
  const end = addDays(days.at(-1)!, 1);
  const wd = weekdayShortNames('it');
  const scroller = useRef<HTMLDivElement>(null);
  const todayIdx = days.indexOf(today);

  useEffect(() => {
    const el = scroller.current;
    if (!el || todayIdx < 0) return;
    const col = el.querySelector<HTMLElement>(`[data-day="${today}"]`);
    if (col) el.scrollTo({ left: Math.max(0, col.offsetLeft - 220), behavior: 'smooth' });
  }, [month, today, todayIdx]);

  const segments = useMemo(() => {
    const out: { key: string; row: number; from: number; to: number; kind: 'booking' | 'block'; booking?: BookingRow; block?: BlockRow; openLeft: boolean; openRight: boolean }[] = [];
    rooms.forEach((r, ri) => {
      for (const b of bookings) {
        if (b.roomId !== r.id || b.checkOut <= start || b.checkIn >= end) continue;
        if (b.status === 'cancelled' && !showCancelled) continue;
        if (b.status === 'pending_payment' && !b.active) continue;
        out.push({ key: b.id, row: ri, from: Math.max(0, diffDays(start, b.checkIn)), to: Math.min(days.length, diffDays(start, b.checkOut)), kind: 'booking', booking: b, openLeft: b.checkIn < start, openRight: b.checkOut > end });
      }
      for (const k of blocks) {
        if (k.roomId !== r.id || k.to <= start || k.from >= end) continue;
        out.push({ key: k.id, row: ri, from: Math.max(0, diffDays(start, k.from)), to: Math.min(days.length, diffDays(start, k.to)), kind: 'block', block: k, openLeft: k.from < start, openRight: k.to > end });
      }
    });
    // cancelled first so active bookings sit on top
    return out.sort((a, b) => (a.booking?.status === 'cancelled' ? -1 : 0) - (b.booking?.status === 'cancelled' ? -1 : 0));
  }, [rooms, bookings, blocks, start, end, days.length, showCancelled]);

  return (
    <div ref={scroller} className="thin-scroll relative max-h-[calc(100svh-17rem)] overflow-auto rounded-2xl border border-line bg-white" style={{ ['--day' as string]: '42px', ['--room' as string]: 'clamp(92px, 16vw, 168px)' }} role="grid" aria-label={`Planning ${monthName(month)}`}>
      <div className="grid w-max min-w-full" style={{ gridTemplateColumns: `var(--room) repeat(${days.length}, var(--day))`, gridTemplateRows: `56px repeat(${Math.max(rooms.length, 1)}, 52px)` }}>
        {/* corner */}
        <div className="sticky left-0 top-0 z-30 flex items-end border-b border-r border-line bg-ivory px-3 pb-2 shadow-[8px_0_14px_-10px_rgba(16,40,61,0.35)] text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-mist" style={{ gridColumn: 1, gridRow: 1 }}>
          Camera
        </div>
        {/* date header */}
        {days.map((d, i) => (
          <div key={d} data-day={d} role="columnheader" className={cn('sticky top-0 z-20 flex flex-col items-center justify-center border-b border-r border-line/70 text-center', d === today ? 'bg-navy text-ivory' : isWeekend(d) ? 'bg-sand-2' : 'bg-ivory')} style={{ gridColumn: i + 2, gridRow: 1 }}>
            <span className={cn('text-[0.58rem] font-semibold uppercase', d === today ? 'text-ivory/70' : 'text-mist')}>{wd[weekdayMon(d)]}</span>
            <span className="text-sm font-semibold tabular-nums">{Number(d.slice(8))}</span>
          </div>
        ))}
        {/* rows */}
        {rooms.map((r, ri) => (
          <div key={r.id} className="contents" role="row">
            <div className="sticky left-0 z-10 flex flex-col justify-center border-b border-r border-line bg-white px-3 shadow-[8px_0_14px_-10px_rgba(16,40,61,0.35)]" style={{ gridColumn: 1, gridRow: ri + 2 }} role="rowheader">
              <span className="serif text-[1.35rem] leading-none text-navy">{r.number}</span>
              <span className="mt-0.5 truncate text-[0.62rem] text-mist">
                {r.name} · {FLOOR[r.floor] ?? r.floor}
              </span>
            </div>
            {days.map((d, i) => {
              const chosen = sel?.roomId === r.id && sel.from === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  aria-label={`Camera ${r.number}, ${fmtDate(d, 'it', { weekday: 'long', day: 'numeric', month: 'long' })}: libera`}
                  onClick={() => onCell(r.id, d)}
                  className={cn('border-b border-r border-line/60 transition-colors hover:bg-gold/10', isWeekend(d) && 'bg-sand-2/45', d === today && 'bg-navy/[0.04]', chosen && 'bg-gold/30 ring-1 ring-inset ring-gold')}
                  style={{ gridColumn: i + 2, gridRow: ri + 2 }}
                />
              );
            })}
          </div>
        ))}
        {/* occupied nights: the paper "X", plus a band joining consecutive nights */}
        {segments.map((s) => {
          const nights = s.to - s.from;
          if (nights <= 0) return null;
          const b = s.booking;
          const t = b ? tone(b) : { x: 'text-charcoal/70', bar: '', label: 'Blocco manuale' };
          const label = b ? `${b.guest} · ${b.code} · ${t.label}` : `Blocco: ${s.block!.reason}`;
          return (
            <button
              key={s.key}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => (b ? onBooking(b) : onBlock(s.block!))}
              className={cn('group relative z-[5] my-[7px] flex items-stretch overflow-hidden text-left transition-transform duration-200 hover:z-[6] hover:-translate-y-px', s.kind === 'block' ? 'bg-[repeating-linear-gradient(135deg,rgba(36,43,45,0.10)_0_6px,transparent_6px_12px)]' : t.bar, s.openLeft ? 'rounded-l-none' : 'rounded-l-full', s.openRight ? 'rounded-r-none' : 'rounded-r-full', b?.status === 'cancelled' && 'opacity-70')}
              style={{ gridColumn: `${s.from + 2} / ${s.to + 2}`, gridRow: s.row + 2 }}
            >
              {Array.from({ length: nights }, (_, i) => (
                <span key={i} className={cn('serif flex w-[var(--day)] shrink-0 items-center justify-center text-[1.45rem] leading-none', t.x, b?.status === 'cancelled' && 'line-through')}>
                  X
                </span>
              ))}
              {nights >= 3 && b && <span className="pointer-events-none absolute bottom-0 left-3 right-3 truncate text-[0.55rem] font-semibold uppercase tracking-[0.06em] text-navy/70 opacity-0 transition-opacity group-hover:opacity-100">{b.guest}</span>}
            </button>
          );
        })}
      </div>
      {rooms.length === 0 && <p className="p-6 text-sm text-mist">Nessuna camera corrisponde alla ricerca.</p>}
    </div>
  );
}

function Legend() {
  const items = [
    { label: 'Prenotazione confermata', cls: 'text-navy', bg: 'bg-navy/[0.07]' },
    { label: 'Pagamento in attesa', cls: 'text-gold-2', bg: 'bg-gold/18' },
    { label: 'Blocco manuale', cls: 'text-charcoal/70', bg: 'bg-[repeating-linear-gradient(135deg,rgba(36,43,45,0.10)_0_6px,transparent_6px_12px)]' },
    { label: 'Annullata (se visibile)', cls: 'text-terracotta/60 line-through', bg: 'bg-terracotta/8' },
  ];
  return (
    <div data-tour="planning-legend" className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-mist">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-2">
          <span className={cn('serif flex h-6 w-8 items-center justify-center rounded-full text-base', i.cls, i.bg)}>X</span>
          {i.label}
        </span>
      ))}
      <span>· La data di partenza non è una notte occupata: la camera è libera per il prossimo arrivo.</span>
    </div>
  );
}

function CalendarView({ month, today, bookings, rooms, onOpen, onNew }: { month: string; today: string; bookings: BookingRow[]; rooms: RoomOption[]; onOpen: (b: BookingRow) => void; onNew: (d: string) => void }) {
  const [mode, setMode] = useState<'mese' | 'settimana' | 'elenco'>('mese');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(month <= today && today < addMonths(month, 1) ? today : month));
  useEffect(() => setWeekStart(startOfWeek(month <= today && today < addMonths(month, 1) ? today : month)), [month, today]);
  const active = bookings.filter((b) => b.active);
  const total = rooms.filter((r) => r.status === 'available').length || 1;
  const inHouse = (d: string) => active.filter((b) => b.roomId && b.checkIn <= d && b.checkOut > d);
  const wd = weekdayShortNames('it');

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented id="cal-mode" value={mode} onChange={setMode} options={[{ value: 'mese', label: 'Mese' }, { value: 'settimana', label: 'Settimana' }, { value: 'elenco', label: 'Elenco' }]} />
        {mode === 'settimana' && (
          <div className="flex items-center gap-2 text-sm text-navy">
            <Button variant="line" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Settimana precedente">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {fmtDate(weekStart)} – {fmtDate(addDays(weekStart, 6))}
            <Button variant="line" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Settimana successiva">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {mode === 'mese' && (
        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-7 border-l border-t border-line bg-white">
            {wd.map((w) => (
              <div key={w} className="border-b border-r border-line bg-ivory px-2 py-2 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-mist">
                {w}
              </div>
            ))}
            {Array.from({ length: weekdayMon(month) }, (_, i) => (
              <div key={`e${i}`} className="border-b border-r border-line bg-ivory/50" />
            ))}
            {monthDays(month).map((d) => {
              const arr = active.filter((b) => b.checkIn === d);
              const dep = active.filter((b) => b.checkOut === d);
              const occ = inHouse(d).length;
              return (
                <div key={d} className={cn('group min-h-[118px] border-b border-r border-line p-2', isWeekend(d) && 'bg-sand-2/35', d === today && 'ring-2 ring-inset ring-navy')}>
                  <div className="flex items-center justify-between">
                    <span className={cn('text-sm font-semibold tabular-nums', d === today ? 'text-navy' : 'text-charcoal')}>{Number(d.slice(8))}</span>
                    <span className="text-[0.62rem] tabular-nums text-mist">
                      {occ}/{total}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {arr.slice(0, 3).map((b) => (
                      <li key={b.id}>
                        <button type="button" onClick={() => onOpen(b)} className="w-full truncate bg-navy px-1.5 py-0.5 text-left text-[0.68rem] text-ivory">
                          → {b.roomNumber ?? '?'} {b.guest.split(' ').at(-1)}
                        </button>
                      </li>
                    ))}
                    {dep.slice(0, 2).map((b) => (
                      <li key={b.id}>
                        <button type="button" onClick={() => onOpen(b)} className="w-full truncate bg-sand px-1.5 py-0.5 text-left text-[0.68rem] text-charcoal">
                          ← {b.roomNumber ?? '?'} {b.guest.split(' ').at(-1)}
                        </button>
                      </li>
                    ))}
                    {arr.length + dep.length > 5 && <li className="text-[0.62rem] text-mist">+{arr.length + dep.length - 5}</li>}
                  </ul>
                  <button type="button" onClick={() => onNew(d)} className="mt-1 hidden text-[0.62rem] font-semibold text-gold-2 group-hover:block" aria-label={`Nuova prenotazione il ${fmtDate(d)}`}>
                    + nuova
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-mist">→ arrivi · ← partenze · numero = camere occupate quella notte</p>
        </div>
      )}

      {mode === 'settimana' && (
        <div className="grid gap-3 md:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => (
            <div key={d} className={cn('border border-line bg-white', d === today && 'border-navy')}>
              <div className={cn('flex items-center justify-between border-b border-line px-3 py-2', d === today ? 'bg-navy text-ivory' : 'bg-ivory')}>
                <span className="text-xs font-semibold uppercase">{fmtDate(d, 'it', { weekday: 'short', day: 'numeric' })}</span>
                <span className="text-[0.65rem]">
                  {inHouse(d).length}/{total}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {inHouse(d)
                  .sort((a, b) => (a.roomNumber ?? '').localeCompare(b.roomNumber ?? ''))
                  .map((b) => (
                    <li key={b.id}>
                      <button type="button" onClick={() => onOpen(b)} className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-ivory">
                        <span className="font-semibold text-navy">{b.roomNumber}</span>
                        <span className="truncate text-charcoal">{b.guest}</span>
                        {b.checkIn === d && <span className="text-[0.6rem] font-bold text-sage">IN</span>}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {mode === 'elenco' && (
        <ul className="divide-y divide-line border border-line bg-white">
          {bookings
            .filter((b) => b.checkIn >= month && b.checkIn < addMonths(month, 1))
            .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
            .map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => onOpen(b)} className="grid w-full grid-cols-[5rem_1fr_auto] items-center gap-3 px-4 py-3 text-left text-sm hover:bg-ivory">
                  <span className="text-mist">{fmtDate(b.checkIn)}</span>
                  <span>
                    <span className="text-navy">{b.guest}</span>
                    <span className="ml-2 text-xs text-mist">
                      {notti(b.nights)} · camera {b.roomNumber ?? 'da assegnare'} · {b.sourceLabel}
                    </span>
                  </span>
                  <span>
                    {b.status === 'cancelled' ? <Badge tone="red">Annullata</Badge> : b.status === 'pending_payment' ? <Badge tone="gold">In attesa</Badge> : <Badge tone="green">Confermata</Badge>}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

