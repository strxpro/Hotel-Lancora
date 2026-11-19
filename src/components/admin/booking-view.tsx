'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarCheck, ChevronLeft, ChevronRight, Lock, LockOpen, RotateCcw, X } from 'lucide-react';
import type { BookingRow, RoomOption } from '@/server/admin-data';
import type { RatePeriod, Room } from '@/lib/types';
import { nightlyRate } from '@/lib/availability';
import { addDays, diffDays, fmtDate, isWeekend } from '@/lib/dates';
import { cn, notti } from '@/lib/utils';
import { Button, Segmented, Toggle, useAction } from './ui';
import type { BlockRow } from './booking-dialogs';
import { setPeriodPriceAction, setRoomsOpenAction } from '@/app/admin/actions/rooms';

const EASE = [0.22, 0.61, 0.12, 1] as const;
const COL = 68;
const LEFT = 176;

type Sel = { roomId: string; a: string; b: string };
type Night = { kind: 'open' | 'sold' | 'closed' | 'portal'; booking?: BookingRow; block?: BlockRow & { source?: string } };

/**
 * "Vista Booking": the extranet calendar the owner knows from Booking.com. One block per room with
 * its state (open / closed / sold), its bookings and its price for every night; drag over the
 * nights (or tap the first and the last) and change price or open/close them in one go.
 */
export function BookingView({ rooms, bookings, blocks, periods, today, onBooking }: { rooms: RoomOption[]; bookings: BookingRow[]; blocks: (BlockRow & { source?: string })[]; periods: RatePeriod[]; today: string; onBooking: (b: BookingRow) => void }) {
  const { run, pending } = useAction();
  const [from, setFrom] = useState(today);
  const [span, setSpan] = useState<'14' | '30'>('14');
  const [sel, setSel] = useState<Sel | null>(null);
  const [dragging, setDragging] = useState(false);
  const [all, setAll] = useState(false);
  const [price, setPrice] = useState('');
  const [cash, setCash] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  const days = useMemo(() => Array.from({ length: Number(span) }, (_, i) => addDays(from, i)), [from, span]);
  const list = rooms.filter((r) => r.status !== 'draft');

  // what every night of every room is: sold, closed by hand, closed by a portal, or open
  const nights = useMemo(() => {
    const m = new Map<string, Night>();
    for (const r of list)
      for (const d of days) {
        const b = bookings.find((x) => x.roomId === r.id && x.active && x.checkIn <= d && x.checkOut > d);
        const k = b ? undefined : blocks.find((x) => x.roomId === r.id && x.from <= d && x.to > d);
        m.set(`${r.id}|${d}`, b ? { kind: 'sold', booking: b } : k ? { kind: k.source ? 'portal' : 'closed', block: k } : { kind: 'open' });
      }
    return m;
  }, [list, days, bookings, blocks]);
  const rate = (r: RoomOption, d: string) => {
    const x = nightlyRate({ id: r.id, basePrice: r.basePrice } as Room, d, periods);
    const own = x.cash ?? (x.price === r.basePrice && r.cashPrice ? r.cashPrice : null);
    return { price: x.price, cash: own, custom: x.price !== r.basePrice };
  };
  const free = (d: string) => list.filter((r) => nights.get(`${r.id}|${d}`)?.kind === 'open').length;

  const range = sel ? (sel.a <= sel.b ? [sel.a, sel.b] : [sel.b, sel.a]) : null;
  const inSel = (roomId: string, d: string) => Boolean(sel && range && (all || sel.roomId === roomId) && d >= range[0]! && d <= range[1]!);
  const selRoom = sel ? list.find((r) => r.id === sel.roomId) ?? null : null;

  useEffect(() => {
    const up = () => setDragging(false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
  // a new selection proposes the price it has now
  useEffect(() => {
    if (!sel || dragging || !selRoom || !range) return;
    const r = rate(selRoom, range[0]!);
    setPrice(String(r.price));
    setCash(r.cash ? String(r.cash) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.roomId, sel?.a, dragging]);

  const down = (e: React.PointerEvent, roomId: string, d: string) => {
    if (e.button !== 0) return;
    // phones: the second tap on the same room closes the range (the finger also scrolls the table)
    if (e.pointerType !== 'mouse' && sel && sel.roomId === roomId && sel.a === sel.b && d !== sel.a) return setSel({ ...sel, b: d });
    setSel({ roomId, a: d, b: d });
    if (e.pointerType === 'mouse') setDragging(true);
  };
  const enter = (roomId: string, d: string) => {
    if (dragging && sel && sel.roomId === roomId) setSel({ ...sel, b: d });
  };

  const ids = all ? list.map((r) => r.id) : sel ? [sel.roomId] : [];
  const nightsN = range ? diffDays(range[0]!, range[1]!) + 1 : 0;
  const to = range ? addDays(range[1]!, 1) : '';
  const done = () => setSel(null);
  const savePrice = (reset: boolean) => {
    if (!range) return;
    const p = Number(price.replace(',', '.'));
    const c = cash.trim() ? Number(cash.replace(',', '.')) : null;
    run(() => setPeriodPriceAction({ roomIds: ids, ranges: [{ from: range[0]!, to }], price: reset ? null : p, cash: reset ? null : c }), { success: reset ? 'Tornato il prezzo base.' : 'Prezzo salvato: già sul sito.', onOk: done });
  };
  const setOpen = (open: boolean) => {
    if (!range) return;
    run(() => setRoomsOpenAction({ roomIds: ids, from: range[0]!, to, open }), { success: open ? 'Aperta: si può prenotare.' : 'Chiusa: non si può prenotare in quelle notti.', onOk: done });
  };
  const priceOk = Number(price.replace(',', '.')) >= 1 && (!cash.trim() || (Number(cash.replace(',', '.')) >= 1 && Number(cash.replace(',', '.')) <= Number(price.replace(',', '.'))));

  const width = LEFT + days.length * COL;
  const month = (d: string, i: number) => i === 0 || d.endsWith('-01');

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-line bg-white p-1">
          <button type="button" onClick={() => setFrom(addDays(from, -7))} aria-label="Settimana precedente" className="flex h-9 w-9 items-center justify-center rounded-full text-navy hover:bg-sand-2 active:scale-90">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[10.5rem] px-1 text-center text-sm font-semibold text-navy">
            {fmtDate(days[0]!, 'it', { day: 'numeric', month: 'short' })} – {fmtDate(days[days.length - 1]!, 'it', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <button type="button" onClick={() => setFrom(addDays(from, 7))} aria-label="Settimana successiva" className="flex h-9 w-9 items-center justify-center rounded-full text-navy hover:bg-sand-2 active:scale-90">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setFrom(today)} className="h-9 rounded-full bg-gold px-4 text-xs font-semibold text-navy-3 active:scale-95">
            Oggi
          </button>
        </div>
        <Segmented id="bv-span" value={span} onChange={setSpan} options={[{ value: '14', label: '14 giorni' }, { value: '30', label: '30 giorni' }]} />
        <p className="text-xs text-mist">Trascina sulle notti (o tocca la prima e l’ultima) per cambiare prezzo o aprire / chiudere.</p>
      </div>

      <div ref={scroller} className="overflow-x-auto rounded-3xl border border-line bg-white" data-lenis-prevent>
        <div style={{ width }} className="select-none text-[0.78rem]">
          {/* days */}
          <div className="sticky top-0 z-[3] flex border-b border-line bg-white">
            <div style={{ width: LEFT }} className="sticky left-0 z-[2] flex shrink-0 items-end bg-white px-4 pb-2 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-mist">Camere libere</div>
            {days.map((d, i) => (
              <div key={d} style={{ width: COL }} className={cn('shrink-0 border-l border-line/70 px-1 py-2 text-center', isWeekend(d) && 'bg-sand-2/60', d === today && 'bg-gold/15')}>
                <p className="h-3 text-[0.56rem] font-semibold uppercase tracking-[0.12em] text-gold-2">{month(d, i) ? fmtDate(d, 'it', { month: 'short' }) : ''}</p>
                <p className="text-[0.6rem] uppercase text-mist">{fmtDate(d, 'it', { weekday: 'short' })}</p>
                <p className="serif text-lg leading-none text-navy">{Number(d.slice(8))}</p>
                <p className={cn('mt-1 text-[0.66rem] font-semibold', free(d) ? 'text-sage' : 'text-terracotta')}>{free(d)}</p>
              </div>
            ))}
          </div>

          {list.map((r) => (
            <div key={r.id} className="border-b border-line last:border-b-0">
              <div className="flex items-center bg-ivory/70">
                <div style={{ width: LEFT }} className="sticky left-0 z-[2] shrink-0 bg-ivory px-4 py-2">
                  <p className="truncate text-[0.85rem] font-semibold text-navy">{r.name || `Camera ${r.number}`}</p>
                  <p className="text-[0.66rem] text-mist">N. {r.number} · base € {r.basePrice}</p>
                </div>
                <div className="flex-1" />
              </div>
              {/* state */}
              <Row label="Stato">
                {days.map((d) => {
                  const n = nights.get(`${r.id}|${d}`)!;
                  return (
                    <Cell key={d} d={d} today={today} sel={inSel(r.id, d)} onDown={(e) => down(e, r.id, d)} onEnter={() => enter(r.id, d)}>
                      <span className={cn('flex h-7 w-full items-center justify-center rounded-lg text-[0.62rem] font-semibold uppercase tracking-[0.06em]', n.kind === 'open' ? 'bg-[#e4f2e7] text-[#2e7a46]' : n.kind === 'sold' ? 'bg-navy text-ivory' : n.kind === 'portal' ? 'bg-gold/25 text-[#7a5a1f]' : 'bg-terracotta/15 text-terracotta')}>
                        {n.kind === 'open' ? 'Aperta' : n.kind === 'sold' ? 'Venduta' : n.kind === 'portal' ? 'Portale' : 'Chiusa'}
                      </span>
                    </Cell>
                  );
                })}
              </Row>
              {/* bookings as bars over their nights */}
              <Row label="Prenotazioni">
                <div className="relative h-9" style={{ width: days.length * COL }}>
                  {bookings
                    .filter((b) => b.roomId === r.id && b.active && b.checkOut > days[0]! && b.checkIn <= days[days.length - 1]!)
                    .map((b) => {
                      const s = Math.max(0, diffDays(days[0]!, b.checkIn));
                      const e = Math.min(days.length, diffDays(days[0]!, b.checkOut));
                      return (
                        <button key={b.id} type="button" onClick={() => onBooking(b)} title={`${b.guest} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`} style={{ left: s * COL + 3, width: Math.max(COL - 6, (e - s) * COL - 6) }} className={cn('absolute top-1.5 flex h-6 items-center gap-1 overflow-hidden rounded-full px-2.5 text-left text-[0.68rem] font-semibold transition-transform hover:-translate-y-px', b.status === 'pending_payment' ? 'bg-gold/30 text-navy' : 'bg-navy/90 text-ivory')}>
                          <span className="truncate">{b.guest}</span>
                          <span className="shrink-0 opacity-60">· {b.sourceLabel}</span>
                        </button>
                      );
                    })}
                </div>
              </Row>
              {/* price of every night */}
              <Row label="Prezzo">
                {days.map((d) => {
                  const p = rate(r, d);
                  return (
                    <Cell key={d} d={d} today={today} sel={inSel(r.id, d)} onDown={(e) => down(e, r.id, d)} onEnter={() => enter(r.id, d)}>
                      <span className={cn('block text-center', p.custom ? 'font-semibold text-navy' : 'text-charcoal/80')}>€ {p.price}</span>
                      {p.cash ? <span className="block text-center text-[0.6rem] text-sage">€ {p.cash} cont.</span> : null}
                    </Cell>
                  );
                })}
              </Row>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-mist">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-[#bfe3c8]" /> Aperta</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-navy" /> Venduta</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-terracotta/40" /> Chiusa da te</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-gold/50" /> Chiusa dal calendario di un portale</span>
        <span>Prezzo in grassetto = diverso dal prezzo base</span>
      </p>

      {/* the edit panel: what is selected, price and open/close */}
      <AnimatePresence>
        {sel && !dragging && range && selRoom && (
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }} transition={{ duration: 0.32, ease: EASE }} className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-2xl rounded-[1.6rem] border border-line bg-white p-4 shadow-[0_30px_80px_-30px_rgba(16,40,61,0.65)] md:bottom-6 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-gold-2">{all ? `Tutte le camere (${list.length})` : selRoom.name || `Camera ${selRoom.number}`}</p>
                <p className="serif text-[1.35rem] leading-tight text-navy">
                  {fmtDate(range[0]!, 'it', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {nightsN > 1 ? ` → ${fmtDate(range[1]!, 'it', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''} · {notti(nightsN)}
                </p>
              </div>
              <button type="button" onClick={done} aria-label="Chiudi il pannello" title="Chiudi il pannello" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sand-2 text-navy">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-ivory px-3 py-2 text-sm text-navy">
              Applica a tutte le camere
              <Toggle size="sm" checked={all} onChange={setAll} label="Applica a tutte le camere" />
            </label>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[7rem] flex-1">
                  <span className="label">Prezzo a notte (carta)</span>
                  <input className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Prezzo a notte con carta" />
                </label>
                <label className="min-w-[7rem] flex-1">
                  <span className="label">In contanti (facoltativo)</span>
                  <input className="field" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="—" aria-label="Prezzo in contanti" />
                </label>
                <Button disabled={pending || !priceOk} onClick={() => savePrice(false)}>
                  <CalendarCheck className="h-4 w-4" /> Salva prezzo
                </Button>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => savePrice(true)} title="Torna al prezzo base della camera">
                  <RotateCcw className="h-3.5 w-3.5" /> Base
                </Button>
              </div>
              <div className="flex items-end gap-2 border-t border-line pt-3 md:border-l md:border-t-0 md:pl-3 md:pt-0">
                <Button variant="line" disabled={pending} onClick={() => setOpen(true)}>
                  <LockOpen className="h-4 w-4 text-sage" /> Apri
                </Button>
                <Button variant="line" disabled={pending} onClick={() => setOpen(false)}>
                  <Lock className="h-4 w-4 text-terracotta" /> Chiudi
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-stretch border-t border-line/60">
      <div style={{ width: LEFT }} className="sticky left-0 z-[2] flex shrink-0 items-center bg-white px-4 text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-mist">
        {label}
      </div>
      <div className="flex">{children}</div>
    </div>
  );
}

function Cell({ d, today, sel, onDown, onEnter, children }: { d: string; today: string; sel: boolean; onDown: (e: React.PointerEvent) => void; onEnter: () => void; children: React.ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onPointerDown={onDown}
      onPointerEnter={onEnter}
      style={{ width: COL }}
      className={cn('flex shrink-0 cursor-pointer flex-col justify-center border-l border-line/60 px-1 py-1.5 transition-colors', isWeekend(d) && 'bg-sand-2/40', d === today && 'bg-gold/10', sel ? 'bg-navy/10 ring-1 ring-inset ring-navy/60' : 'hover:bg-sand-2/70', d < today && 'opacity-50')}
    >
      {children}
    </div>
  );
}
