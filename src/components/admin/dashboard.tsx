'use client';
import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Check, Plus, Trash2 } from 'lucide-react';
import type { Task } from '@/lib/types';
import type { BookingRow, RoomOption } from '@/server/admin-data';
import { fmtDate, fmtDateTime, isWeekend } from '@/lib/dates';
import { cn, money, notti, ospiti } from '@/lib/utils';
import { Badge, Button, useAction } from './ui';
import { NiceSelect } from './nice-select';
import { addTask, removeTask, toggleTask } from '@/app/admin/actions/misc';
import { setPriceAction } from '@/app/admin/actions/rooms';
import { GuestLink } from './guest-card';

export function StatusBadge({ row }: { row: Pick<BookingRow, 'status' | 'active' | 'roomId' | 'simulated'> & { noShow?: boolean } }) {
  if (row.noShow) return <Badge tone="red">No-show</Badge>;
  if (row.status === 'cancelled') return <Badge tone="red">Annullata</Badge>;
  if (row.status === 'pending_payment') return <Badge tone="gold">{row.active ? 'Pagamento in attesa' : 'Scaduta'}</Badge>;
  if (!row.roomId) return <Badge tone="gold">Da assegnare</Badge>;
  return <Badge tone="green">Confermata</Badge>;
}

export function SourceBadge({ row }: { row: Pick<BookingRow, 'source' | 'sourceLabel' | 'simulated'> }) {
  const ota = row.source === 'booking' || row.source === 'expedia' || row.source === 'altro_ota';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-mist">
      <span className={cn('h-1.5 w-1.5 rounded-full', ota ? 'bg-gold' : 'bg-navy')} />
      {row.sourceLabel}
      {row.simulated && <span className="font-semibold text-gold-2">· SIMULAZIONE</span>}
    </span>
  );
}

export function OccupancyStrip({ days }: { days: { date: string; occupied: number; blocked: number; total: number; rate: number }[] }) {
  return (
    <section className="border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">Occupazione · prossimi 21 giorni</h2>
        <Link href="/admin/disponibilita" className="inline-flex items-center gap-1 text-xs font-semibold text-navy">
          Planning <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="no-scrollbar overflow-x-auto px-5 pb-5 pt-6">
        <div className="flex min-w-[640px] items-end gap-1.5">
          {days.map((d, i) => (
            <Link key={d.date} href={`/admin/disponibilita?m=${d.date.slice(0, 7)}`} className="group flex flex-1 flex-col items-center gap-2" title={`${fmtDate(d.date)}: ${d.occupied}/${d.total} occupate${d.blocked ? `, ${d.blocked} bloccate` : ''}`}>
              <span className="text-[0.6rem] tabular-nums text-mist opacity-0 transition-opacity group-hover:opacity-100">{d.rate}%</span>
              <span className="relative block h-28 w-full overflow-hidden bg-sand-2">
                <motion.span className="absolute inset-x-0 bottom-0 bg-navy" initial={{ height: 0 }} animate={{ height: `${d.rate}%` }} transition={{ delay: i * 0.025, duration: 0.8, ease: [0.22, 0.61, 0.12, 1] }} />
                {d.blocked > 0 && <span className="absolute inset-x-0 top-0 bg-charcoal/25" style={{ height: `${(d.blocked / d.total) * 100}%` }} />}
              </span>
              <span className={cn('text-[0.62rem] tabular-nums', i === 0 ? 'font-bold text-navy' : isWeekend(d.date) ? 'text-gold-2' : 'text-mist')}>{Number(d.date.slice(8))}</span>
            </Link>
          ))}
        </div>
        <p className="mt-4 flex gap-5 text-[0.68rem] text-mist">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-navy" /> occupate</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-charcoal/25" /> bloccate</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-sand-2" /> libere</span>
        </p>
      </div>
    </section>
  );
}

export function ArrivalsList({ rows }: { rows: BookingRow[] }) {
  return (
    <section className="border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">Prossimi arrivi</h2>
        <Link href="/admin/prenotazioni?filtro=arrivi" className="text-xs font-semibold text-navy">
          Tutti
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {rows.length === 0 && <li className="px-5 py-6 text-sm text-mist">Nessun arrivo nei prossimi 7 giorni.</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/prenotazioni?id=${r.id}`} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-4 px-5 py-3 hover:bg-ivory">
              <span className="text-center">
                <span className="serif block text-[1.7rem] leading-none text-navy">{Number(r.checkIn.slice(8))}</span>
                <span className="text-[0.6rem] uppercase tracking-[0.14em] text-mist">{fmtDate(r.checkIn, 'it', { month: 'short' })}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-navy">
                  <GuestLink inline email={r.email} bookingId={r.id}>{r.guest}</GuestLink>
                </span>
                <span className="block text-xs text-mist">
                  {notti(r.nights)} · {ospiti(r.adults + r.children)} · <SourceBadge row={r} />
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="text-sm font-semibold text-navy">{r.roomNumber ? `Camera ${r.roomNumber}` : '—'}</span>
                <StatusBadge row={r} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RecentBookings({ rows }: { rows: BookingRow[] }) {
  return (
    <section className="border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">Ultime prenotazioni</h2>
        <Link href="/admin/prenotazioni" className="text-xs font-semibold text-navy">
          Tutte
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-ivory">
                <td className="px-5 py-3">
                  <Link href={`/admin/prenotazioni?id=${r.id}`} className="font-medium text-navy">
                    {r.code}
                  </Link>
                  <p className="text-xs text-mist">{fmtDateTime(r.createdAt)}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="text-navy">
                    <GuestLink email={r.email} bookingId={r.id}>{r.guest}</GuestLink>
                  </p>
                  <SourceBadge row={r} />
                </td>
                <td className="px-3 py-3 text-mist">
                  {fmtDate(r.checkIn)} → {fmtDate(r.checkOut)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-navy">{money(r.total)}</td>
                <td className="px-5 py-3 text-right">
                  <StatusBadge row={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TaskList({ derived, manual }: { derived: { id: string; label: string; href: string }[]; manual: Task[] }) {
  const [text, setText] = useState('');
  const { run, pending } = useAction();
  return (
    <section className="border border-line bg-white">
      <h2 className="border-b border-line px-5 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">Da fare</h2>
      <ul className="divide-y divide-line">
        {derived.map((t) => (
          <li key={t.id}>
            <Link href={t.href} className="flex items-center gap-3 px-5 py-3 text-sm text-navy hover:bg-ivory">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" /> {t.label}
            </Link>
          </li>
        ))}
        {manual.map((t) => (
          <li key={t.id} className="group flex items-center gap-3 px-5 py-3 text-sm">
            <button type="button" onClick={() => run(() => toggleTask(t.id))} aria-label={t.done ? 'Segna come da fare' : 'Segna come fatto'} className={cn('flex h-5 w-5 shrink-0 items-center justify-center border', t.done ? 'border-navy bg-navy text-ivory' : 'border-line')}>
              {t.done && <Check className="h-3 w-3" />}
            </button>
            <span className={cn('flex-1', t.done && 'text-mist line-through')}>{t.label}</span>
            <button type="button" onClick={() => run(() => removeTask(t.id))} aria-label="Elimina" className="text-mist opacity-60 hover:opacity-100">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          run(() => addTask(text), { onOk: () => setText('') });
        }}
      >
        <label htmlFor="task" className="sr-only">
          Nuovo compito
        </label>
        <input id="task" value={text} onChange={(e) => setText(e.target.value)} placeholder="Aggiungi un promemoria…" className="field py-2 text-sm" />
        <Button type="submit" size="sm" disabled={pending} aria-label="Aggiungi">
          <Plus className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}

export function QuickPrice({ rooms, canEdit }: { rooms: RoomOption[]; canEdit: boolean }) {
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const room = rooms.find((r) => r.id === roomId);
  const [price, setPrice] = useState<string>(String(room?.basePrice ?? ''));
  const { run, pending } = useAction();
  return (
    <section className="border border-line bg-white p-5">
      <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">Cambio prezzo veloce</h2>
      {!canEdit && <p className="mt-2 text-xs text-mist">Solo l’amministratore può modificare i prezzi.</p>}
      <div className="mt-4 grid grid-cols-[1fr_7rem] gap-2">
        <label className="sr-only" htmlFor="qp-room">
          Camera
        </label>
        <NiceSelect
          id="qp-room"
          className="w-full min-w-0"
          label="Camera"
          value={roomId}
          onChange={(v) => {
            setRoomId(v);
            setPrice(String(rooms.find((r) => r.id === v)?.basePrice ?? ''));
          }}
          options={rooms.map((r) => ({ value: r.id, label: `${r.number} · ${r.name}`, hint: `ora ${money(r.basePrice)} a notte` }))}
        />
        <label className="sr-only" htmlFor="qp-price">
          Prezzo per notte
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mist">€</span>
          <input id="qp-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} className="field py-2.5 pl-7 text-sm" />
        </div>
      </div>
      <Button className="mt-3 w-full" disabled={!canEdit || pending || !room || Number(price.replace(',', '.')) === room.basePrice} onClick={() => run(() => setPriceAction(roomId, Number(price.replace(',', '.'))))}>
        Salva prezzo base {room ? `(ora ${money(room.basePrice)})` : ''}
      </Button>
    </section>
  );
}

/* ---------------- today in the hotel: arrivals · departures · staying ---------------- */
export type DayRow = { id: string; guest: string; room: string | null; guests: number; from: string; to: string; night?: string; paid?: boolean };

/**
 * The three lists of the day, like the reception's paper sheet: who arrives, who leaves, who is
 * staying. Every row opens the booking (where the room can be assigned or changed); the header
 * jumps to the monthly planning, which is drawn from the very same bookings.
 */
export function DayLists({ arrivals, departures, staying, planningHref, dateLabel }: { arrivals: DayRow[]; departures: DayRow[]; staying: DayRow[]; planningHref: string; dateLabel: string }) {
  const cols = [
    { key: 'arrivi', title: 'Arrivi', sub: 'check-in di oggi', rows: arrivals, tone: 'bg-sage/15 text-[#3f5a35]', empty: 'Nessun arrivo oggi.', all: '/admin/prenotazioni?filtro=arrivi' },
    { key: 'partenze', title: 'Partenze', sub: 'check-out di oggi', rows: departures, tone: 'bg-terracotta/12 text-terracotta', empty: 'Nessuna partenza oggi.', all: '/admin/prenotazioni?filtro=partenze' },
    { key: 'soggiorno', title: 'In soggiorno', sub: 'ospiti già in casa', rows: staying, tone: 'bg-navy/[0.07] text-navy', empty: 'Nessun ospite in casa.', all: '/admin/prenotazioni?filtro=in_casa' },
  ];
  return (
    <section aria-label="Oggi in hotel" className="mt-8 overflow-clip rounded-3xl border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">Oggi in hotel</h2>
          <p className="mt-0.5 text-xs text-mist">{dateLabel} · le stesse prenotazioni del planning</p>
        </div>
        <Link href={planningHref} className="flex h-9 items-center gap-2 rounded-full bg-navy px-4 text-[0.72rem] font-semibold text-ivory transition-transform hover:-translate-y-0.5">
          Apri il planning del mese →
        </Link>
      </div>
      <div className="grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {cols.map((c) => (
          <div key={c.key} className="min-w-0">
            <div className="flex items-center gap-3 px-5 pb-2 pt-4">
              <span className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-semibold ${c.tone}`}>{c.rows.length}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy">{c.title}</span>
                <span className="block text-[0.7rem] text-mist">{c.sub}</span>
              </span>
              <Link href={c.all} className="text-[0.72rem] font-semibold text-navy underline decoration-gold underline-offset-4">
                Tutte
              </Link>
            </div>
            <ul className="px-2 pb-3">
              {c.rows.length === 0 && <li className="px-3 py-3 text-sm text-mist">{c.empty}</li>}
              {c.rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/prenotazioni?id=${r.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-ivory">
                    <span className={`flex h-10 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${r.room ? 'bg-navy text-ivory' : 'border border-dashed border-terracotta/60 text-terracotta'}`}>{r.room ?? '?'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-navy">
                        <GuestLink inline bookingId={r.id}>{r.guest}</GuestLink>
                      </span>
                      <span className="block truncate text-[0.72rem] text-mist">
                        {r.room ? '' : 'camera da assegnare · '}
                        {r.guests} {r.guests === 1 ? 'ospite' : 'ospiti'} · {r.night ?? `${fmtDate(r.from, 'it', { day: 'numeric', month: 'short' })} → ${fmtDate(r.to, 'it', { day: 'numeric', month: 'short' })}`}
                      </span>
                    </span>
                    {r.paid === false && <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[0.62rem] font-semibold text-[#7a5a1f]">da saldare</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
