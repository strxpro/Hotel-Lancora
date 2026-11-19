'use client';
import { cancelDeadline, cancelFeeAmount, cancelRefund, isFreeCancel } from '@/lib/cancellation';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Mail, Plus, Search } from 'lucide-react';
import type { BookingRow, RoomOption } from '@/server/admin-data';
import { diffDays, fmtDate, fmtDateLong, fmtDateTime, todayISO } from '@/lib/dates';
import { cn, money, notti, ospiti } from '@/lib/utils';
import { Badge, Button, Dialog, Drawer, Empty, Field, StickyBar, Toggle, useAction, useToast } from './ui';
import { NiceSelect } from './nice-select';
import { SourceBadge, StatusBadge } from './dashboard';
import { freeRooms, NewBookingDialog, type BlockRow } from './booking-dialogs';
import { GuestLink, useGuestCard } from './guest-card';
import { assignRoomAction, markPaidAction, notesAction, refundAction, sendBookingEmailAction } from '@/app/admin/actions/bookings';
import { cancelAndRefundAction } from '@/app/admin/actions/booking-care';
import { BookingCare } from './booking-care';

const FILTERS = [
  { key: 'tutte', label: 'Tutte' },
  { key: 'arrivi', label: 'Arrivi' },
  { key: 'in_casa', label: 'In casa' },
  { key: 'partenze', label: 'Partenze' },
  { key: 'da_assegnare', label: 'Da assegnare' },
  { key: 'in_attesa', label: 'Pagamento in attesa' },
  { key: 'future', label: 'Future' },
  { key: 'annullate', label: 'Annullate' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

export function BookingsTable({ rows, rooms, blocks, initialFilter, openId, openNew, isAdmin, freeCancellationDays, cancellationFee }: { rows: BookingRow[]; rooms: RoomOption[]; blocks: BlockRow[]; initialFilter: string; openId?: string; openNew?: boolean; isAdmin: boolean; freeCancellationDays: number; cancellationFee?: { type: 'percent' | 'first_night' | 'fixed'; value: number } }) {
  const today = todayISO();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>((FILTERS.some((f) => f.key === initialFilter) ? initialFilter : 'tutte') as FilterKey);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [creating, setCreating] = useState(Boolean(openNew));
  // the drawer and the dialog live in a portal (browser only): opened from a link (?id=) they appear
  // right after the page has loaded, so the page from the server and the one in the browser match
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('filtro', filter);
    if (open) p.set('id', open);
    else p.delete('id');
    p.delete('nuova');
    window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
  }, [filter, open]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        switch (filter) {
          case 'arrivi':
            return r.active && r.checkIn === today;
          case 'in_casa':
            return r.active && r.checkIn <= today && r.checkOut > today;
          case 'partenze':
            return r.active && r.checkOut === today;
          case 'da_assegnare':
            return r.active && !r.roomId && r.checkOut > today;
          case 'in_attesa':
            return r.status === 'pending_payment' && r.active;
          case 'future':
            return r.active && r.checkIn > today;
          case 'annullate':
            return r.status === 'cancelled';
          default:
            return true;
        }
      })
      .filter((r) => !source || r.source === source)
      .filter((r) => !s || `${r.code} ${r.guest} ${r.email} ${r.roomNumber ?? ''} ${r.otaRef ?? ''}`.toLowerCase().includes(s))
      .sort((a, b) => (filter === 'tutte' ? b.createdAt.localeCompare(a.createdAt) : a.checkIn.localeCompare(b.checkIn)));
  }, [rows, filter, q, source, today]);

  const current = rows.find((r) => r.id === open) ?? null;
  const count = (k: FilterKey) => (k === 'da_assegnare' ? rows.filter((r) => r.active && !r.roomId && r.checkOut > today).length : 0);

  return (
    <div data-tour="bookings">
      <StickyBar className="mb-3">
      <div className="flex flex-col gap-3 pb-3 md:flex-row md:items-center md:justify-between">
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={cn('shrink-0 border px-3 py-2 text-xs font-semibold transition-colors', filter === f.key ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50')}>
              {f.label}
              {count(f.key) > 0 && <span className="ml-1.5 bg-gold px-1.5 text-[0.6rem] text-navy-3">{count(f.key)}</span>}
            </button>
          ))}
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Nuova prenotazione
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" />
          <label htmlFor="bk-search" className="sr-only">
            Cerca
          </label>
          <input id="bk-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per nome, codice, email, camera…" className="field py-2.5 pl-9 text-sm" />
        </div>
        <label htmlFor="bk-src" className="sr-only">
          Provenienza
        </label>
        <NiceSelect
          id="bk-src"
          className="w-full sm:w-56"
          label="Provenienza"
          value={source}
          onChange={setSource}
          options={[
            { value: '', label: 'Tutte le provenienze' },
            { value: 'sito', label: 'Sito web' },
            { value: 'telefono', label: 'Telefono' },
            { value: 'email', label: 'Email' },
            { value: 'walkin', label: 'Walk-in' },
            { value: 'booking', label: 'Booking.com' },
            { value: 'expedia', label: 'Expedia' },
          ]}
        />
      </div>
      </StickyBar>

      <div className="border border-line bg-white">
        {list.length === 0 ? (
          <Empty title="Nessuna prenotazione" text="Cambia filtro o ricerca." />
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b border-line bg-ivory text-left text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-mist">
                <tr>
                  <th className="px-4 py-3">Ospite</th>
                  <th className="px-3 py-3">Soggiorno</th>
                  <th className="px-3 py-3">Camera</th>
                  <th className="px-3 py-3">Provenienza</th>
                  <th className="px-3 py-3 text-right">Totale</th>
                  <th className="px-4 py-3 text-right">Stato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.slice(0, 300).map((r) => (
                  <tr key={r.id} onClick={() => setOpen(r.id)} className="cursor-pointer transition-colors hover:bg-ivory">
                    <td className="px-4 py-3">
                      <p className="font-medium text-navy">
                        <GuestLink email={r.email} bookingId={r.id}>{r.guest}</GuestLink>
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-mist">
                        {r.code}
                        {r.demo ? ' · demo' : ''}
                        <CareChips row={r} />
                      </p>
                    </td>
                    <td className="px-3 py-3 text-charcoal">
                      {fmtDate(r.checkIn)} → {fmtDate(r.checkOut)}
                      <p className="text-xs text-mist">
                        {notti(r.nights)} · {ospiti(r.adults + r.children)}
                      </p>
                    </td>
                    <td className="px-3 py-3">{r.roomNumber ? <span className="serif text-lg text-navy">{r.roomNumber}</span> : <Badge tone="gold">Da assegnare</Badge>}</td>
                    <td className="px-3 py-3">
                      <SourceBadge row={r} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <p className="text-navy">{money(r.total)}</p>
                      <p className="text-xs text-mist">versato {money(r.amountPaid)}</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusBadge row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-line md:hidden">
              {list.slice(0, 200).map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left">
                    <span className="min-w-0">
                      <span className="block font-medium text-navy">
                        <GuestLink inline email={r.email} bookingId={r.id}>{r.guest}</GuestLink>
                      </span>
                      <span className="block text-xs text-mist">
                        {fmtDate(r.checkIn)} → {fmtDate(r.checkOut)} · {notti(r.nights)}
                      </span>
                      <SourceBadge row={r} />
                      <span className="mt-1 flex flex-wrap gap-1.5"><CareChips row={r} /></span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="serif text-xl text-navy">{r.roomNumber ?? '—'}</span>
                      <StatusBadge row={r} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-mist">{list.length} prenotazioni</p>

      {mounted && current && <BookingDrawer key={current.id} row={current} onClose={() => setOpen(null)} rooms={rooms} rows={rows} blocks={blocks} isAdmin={isAdmin} freeCancellationDays={freeCancellationDays} cancellationFee={cancellationFee} onChanged={() => router.refresh()} />}
      {mounted && creating && <NewBookingDialog open onClose={() => setCreating(false)} rooms={rooms} bookings={rows} blocks={blocks} />}
    </div>
  );
}

function BookingDrawer({ row, onClose, rooms, rows, blocks, isAdmin, freeCancellationDays, cancellationFee, onChanged }: { row: BookingRow; onClose: () => void; rooms: RoomOption[]; rows: BookingRow[]; blocks: BlockRow[]; isAdmin: boolean; freeCancellationDays: number; cancellationFee?: { type: 'percent' | 'first_night' | 'fixed'; value: number }; onChanged: () => void }) {
  const { run, pending } = useAction();
  const openGuest = useGuestCard();
  const [roomId, setRoomId] = useState('');
  const [notes, setNotes] = useState(row.notes);
  const [pay, setPay] = useState(String(Math.max(0, row.total - row.amountPaid)));
  const [method, setMethod] = useState<'contanti' | 'bonifico' | 'pos'>('contanti');
  const [cancel, setCancel] = useState(false);
  const [waive, setWaive] = useState(false);
  const toast = useToast();
  const free = freeRooms(rooms, rows, blocks, row.checkIn, row.checkOut, row.id).filter((r) => r.maxGuests >= row.adults + row.children);
  const daysBefore = diffDays(todayISO(), row.checkIn);
  const rules = { freeCancellationDays, cancellationFee };
  const freeNow = isFreeCancel(todayISO(), row.checkIn, freeCancellationDays);
  const fee = freeNow ? 0 : cancelFeeAmount(rules, row.total, row.nights);
  const refundable = cancelRefund(rules, todayISO(), { checkIn: row.checkIn, total: row.total, amountPaid: row.amountPaid, nights: row.nights });
  const [refund, setRefund] = useState(String(refundable));

  return (
    <Drawer open onClose={onClose} title={row.guest}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge row={row} />
        <SourceBadge row={row} />
        <span className="text-xs text-mist">{row.code}</span>
        <button type="button" onClick={() => { onClose(); openGuest({ email: row.email, bookingId: row.id }); }} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-semibold text-navy hover:border-navy">
          Scheda ospite
        </button>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div>
          <dt className="label">Arrivo</dt>
          <dd className="text-navy">{fmtDateLong(row.checkIn)}</dd>
        </div>
        <div>
          <dt className="label">Partenza</dt>
          <dd className="text-navy">{fmtDateLong(row.checkOut)}</dd>
        </div>
        <div>
          <dt className="label">Camera</dt>
          <dd className="text-navy">{row.roomNumber ? `${row.roomNumber} · ${row.roomName}` : 'Da assegnare'}</dd>
        </div>
        <div>
          <dt className="label">Ospiti</dt>
          <dd className="text-navy">
            {row.adults} adulti{row.children ? `, ${row.children} bambini` : ''}
          </dd>
        </div>
        <div>
          <dt className="label">Email</dt>
          <dd className="truncate text-navy">{row.email}</dd>
        </div>
        <div>
          <dt className="label">Telefono</dt>
          <dd className="text-navy">{row.phone || '—'}</dd>
        </div>
        <div>
          <dt className="label">Totale</dt>
          <dd className="serif text-2xl text-navy">{money(row.total, 'it', 2)}</dd>
        </div>
        <div>
          <dt className="label">Versato</dt>
          <dd className="serif text-2xl text-navy">{money(row.amountPaid, 'it', 2)}</dd>
        </div>
        <div className="col-span-2 text-xs text-mist">
          Creata {fmtDateTime(row.createdAt)}
          {row.otaRef ? ` · rif. ${row.otaRef}` : ''}
          {row.holdExpiresAt ? ` · riservata fino alle ${fmtDateTime(row.holdExpiresAt)}` : ''}
        </div>
      </dl>
      {row.specialRequests && <p className="mt-5 border-l border-gold pl-3 text-sm text-charcoal/85">Richieste: {row.specialRequests}</p>}
      <BookingCare row={row} rooms={rooms} onChanged={onChanged} />

      {row.status !== 'cancelled' && (
        <>
          <section className="mt-8 border-t border-line pt-6">
            <p className="label">{row.roomId ? 'Cambia camera' : 'Assegna camera'}</p>
            <p className="mb-2 text-xs text-mist">Sono elencate solo le camere libere per tutto il soggiorno e adatte al numero di ospiti.</p>
            <div className="flex gap-2">
              <NiceSelect
                className="min-w-0 flex-1"
                label={row.roomId ? 'Cambia camera' : 'Assegna camera'}
                value={roomId}
                onChange={setRoomId}
                options={[{ value: '', label: free.length ? `${free.length} camere disponibili…` : 'Nessuna camera libera', disabled: true }, ...free.map((r) => ({ value: r.id, label: `${r.number} · ${r.name}`, hint: `max ${ospiti(r.maxGuests)}` }))]}
              />
              <Button disabled={!roomId || pending} onClick={() => run(() => assignRoomAction(row.id, roomId), { onOk: onChanged })}>
                Assegna
              </Button>
            </div>
          </section>
          <section className="mt-6 border-t border-line pt-6">
            <p className="label">Registra pagamento</p>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <input className="field py-2.5" inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Importo" />
              <NiceSelect
                label="Metodo"
                value={method}
                onChange={setMethod}
                options={[
                  { value: 'contanti', label: 'Contanti' },
                  { value: 'pos', label: 'Carta (POS)' },
                  { value: 'bonifico', label: 'Bonifico' },
                ]}
              />
              <Button disabled={pending || !(Number(pay.replace(',', '.')) > 0)} onClick={() => run(() => markPaidAction(row.id, Number(pay.replace(',', '.')), method), { onOk: onChanged })}>
                Registra
              </Button>
            </div>
          </section>
          <section className="mt-6 border-t border-line pt-6">
            <p className="label">Email all’ospite</p>
            <div className="flex flex-wrap gap-2">
              {(['conferma', 'promemoria', 'modifica'] as const).map((t) => (
                <Button key={t} variant="line" size="sm" disabled={pending} onClick={() => run(() => sendBookingEmailAction(row.id, t))}>
                  <Mail className="h-3.5 w-3.5" /> {t === 'conferma' ? 'Conferma' : t === 'promemoria' ? 'Promemoria arrivo' : 'Modifica'}
                </Button>
              ))}
            </div>
          </section>
        </>
      )}
      <section className="mt-6 border-t border-line pt-6">
        <Field label="Note interne">
          <textarea className="field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button variant="line" size="sm" className="mt-2" disabled={pending || notes === row.notes} onClick={() => run(() => notesAction(row.id, notes))}>
          Salva note
        </Button>
      </section>
      <section className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
        <a href={`/soggiorno/${row.token}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-navy">
          Area ospite <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <div className="flex gap-2">
          {isAdmin && row.amountPaid > 0 && row.status === 'cancelled' && (
            <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => refundAction(row.id, row.amountPaid), { onOk: onChanged })}>
              Rimborsa {money(row.amountPaid)}
            </Button>
          )}
          {row.status !== 'cancelled' && (
            <Button variant="danger" size="sm" onClick={() => setCancel(true)}>
              Annulla prenotazione
            </Button>
          )}
        </div>
      </section>

      <Dialog
        open={cancel}
        onClose={() => setCancel(false)}
        title="Annullare la prenotazione?"
        footer={
          <>
            <Button variant="line" onClick={() => setCancel(false)}>
              No, torna indietro
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => run(() => cancelAndRefundAction(row.id, { waive, refund: isAdmin ? Number(refund.replace(',', '.')) || 0 : 0, reason: waive ? 'Cancellazione gratuita su richiesta dell’ospite' : 'Annullata dal pannello', notifyGuest: true }), { onOk: (d) => { if (d?.message) toast(d.problems.length ? 'error' : 'ok', d.message); setCancel(false); onClose(); onChanged(); } })}>
              {waive ? 'Sì, cancella gratis' : 'Sì, annulla'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-charcoal/85">
          {row.guest} · {fmtDate(row.checkIn)} → {fmtDate(row.checkOut)}. Le notti torneranno disponibili sul sito e nel planning. L’ospite riceverà l’email di conferma cancellazione.
        </p>
        <p className="mt-3 text-xs text-mist">
          Arrivo tra {daysBefore} giorni · {freeNow ? `cancellazione ancora gratuita (fino alle 00:00 di ${fmtDate(cancelDeadline(row.checkIn, freeCancellationDays), 'it', { weekday: 'long', day: 'numeric', month: 'long' })})` : `termine scaduto: penale ${money(fee, 'it', 2)}`} · rimborso previsto {money(refundable, 'it', 2)}.
        </p>
        {isAdmin && !freeNow && (
          <div className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-line bg-white px-4 py-3">
            <span className="text-sm text-charcoal/85">
              <span className="block font-semibold text-navy">Cancellazione gratuita (lo chiede l’ospite)</span>
              Niente penale anche se mancano meno di {freeCancellationDays} giorni: restituisci tutto e l’email lo dice all’ospite.
            </span>
            <Toggle checked={waive} onChange={(v) => { setWaive(v); setRefund(String(v ? row.amountPaid : refundable)); }} label="Cancellazione gratuita" />
          </div>
        )}
        {isAdmin && row.amountPaid > 0 && (
          <Field label="Importo da restituire (€)" className="mt-4" hint="Pagato con carta sul sito: torna sulla carta dell’ospite da solo. Contanti o bonifico: lo registro e lo restituisci tu.">
            <input className="field" inputMode="decimal" value={refund} disabled={waive} onChange={(e) => setRefund(e.target.value)} />
          </Field>
        )}
      </Dialog>
    </Drawer>
  );
}

/** Small signs on the list: the guest wrote, asks something, the card is due, no-show. */
function CareChips({ row }: { row: BookingRow }) {
  return (
    <>
      {row.unread > 0 && <Badge tone="navy">{row.unread === 1 ? '1 messaggio' : `${row.unread} messaggi`}</Badge>}
      {row.waiting && <Badge tone="gold">{row.waiting === 'dates' ? 'chiede nuove date' : 'chiede cancellazione gratuita'}</Badge>}
      {row.cardDue && <Badge tone="gold">carta entro {fmtDateTime(row.cardDue)}</Badge>}
    </>
  );
}
