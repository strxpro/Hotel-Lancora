'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Globe, Lock, Phone, Plane } from 'lucide-react';
import type { BookingRow, RoomOption } from '@/server/admin-data';
import { addDays, diffDays, fmtDate, fmtDateLong, rangesOverlap, todayISO } from '@/lib/dates';
import { money, notti, ospiti } from '@/lib/utils';
import { Button, Dialog, Field, NumInput, useAction } from './ui';
import { NiceSelect } from './nice-select';
import { StatusBadge, SourceBadge } from './dashboard';
import { createBookingAction, assignRoomAction } from '@/app/admin/actions/bookings';
import { addBlockAction, removeBlockAction } from '@/app/admin/actions/rooms';
import { useGuestCard } from './guest-card';

export interface BlockRow {
  id: string;
  roomId: string;
  from: string;
  to: string;
  reason: string;
}

/** Client-side mirror of the server conflict rule (the server re-checks atomically). */
export function freeRooms(rooms: RoomOption[], bookings: Pick<BookingRow, 'roomId' | 'checkIn' | 'checkOut' | 'active' | 'id'>[], blocks: BlockRow[], from: string, to: string, ignoreId?: string): RoomOption[] {
  return rooms.filter(
    (r) =>
      r.status !== 'draft' &&
      !bookings.some((b) => b.roomId === r.id && b.active && b.id !== ignoreId && rangesOverlap(from, to, b.checkIn, b.checkOut)) &&
      !blocks.some((k) => k.roomId === r.id && rangesOverlap(from, to, k.from, k.to)),
  );
}

type Source = 'telefono' | 'email' | 'walkin' | 'booking' | 'expedia' | 'sito';
type BookingPreset = { roomId?: string; checkIn?: string; checkOut?: string; source?: Source };

/** The booking form's state and save, shared by "Nuova prenotazione" and the planning's range dialog. */
function useBookingForm(rooms: RoomOption[], bookings: BookingRow[], blocks: BlockRow[], preset?: BookingPreset) {
  const today = todayISO();
  const [f, setF] = useState(() => ({
    roomId: preset?.roomId ?? '',
    checkIn: preset?.checkIn ?? today,
    checkOut: preset?.checkOut ?? addDays(today, 2),
    adults: 2,
    children: 0,
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    source: (preset?.source ?? 'telefono') as Source,
    otaCode: '',
    status: 'confirmed' as 'confirmed' | 'pending_payment',
    total: '',
    amountPaid: '0',
    notes: '',
    sendEmail: !(preset?.source === 'booking' || preset?.source === 'expedia'),
  }));
  const { run, pending } = useAction();
  const valid = f.checkOut > f.checkIn;
  const free = useMemo(() => (valid ? freeRooms(rooms, bookings, blocks, f.checkIn, f.checkOut) : []), [rooms, bookings, blocks, f.checkIn, f.checkOut, valid]);
  const selected = rooms.find((r) => r.id === f.roomId);
  const roomFree = !f.roomId || free.some((r) => r.id === f.roomId);
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const ota = f.source === 'booking' || f.source === 'expedia';
  const canSave = !pending && valid && Boolean(f.firstName) && Boolean(f.lastName) && roomFree;
  const save = (onDone: () => void) =>
    run(
      () =>
        createBookingAction({
          roomId: f.roomId || null,
          checkIn: f.checkIn,
          checkOut: f.checkOut,
          adults: f.adults,
          children: f.children,
          firstName: f.firstName,
          lastName: f.lastName,
          email: f.email,
          phone: f.phone,
          source: f.source,
          status: f.status,
          total: f.total ? Number(f.total.replace(',', '.')) : null,
          amountPaid: Number(f.amountPaid.replace(',', '.')) || 0,
          notes: [ota && f.otaCode.trim() ? `${f.source === 'booking' ? 'Booking.com' : 'Expedia'} n. ${f.otaCode.trim()}` : '', f.notes].filter(Boolean).join(' · '),
          sendEmail: f.sendEmail,
        }),
      { onOk: onDone },
    );
  return { f, set, free, selected, roomFree, valid, ota, canSave, save, pending };
}

function BookingFields({ form, rooms, showDates = true, showSource = true }: { form: ReturnType<typeof useBookingForm>; rooms: RoomOption[]; showDates?: boolean; showSource?: boolean }) {
  const { f, set, free, selected, roomFree, valid, ota } = form;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showDates && (
        <>
          <Field label="Arrivo">
            <input type="date" className="field" value={f.checkIn} onChange={(e) => set('checkIn', e.target.value)} />
          </Field>
          <Field label="Partenza" hint={valid ? `${notti(diffDays(f.checkIn, f.checkOut))} · la data di partenza resta libera` : 'La partenza deve essere dopo l’arrivo'}>
            <input type="date" className="field" value={f.checkOut} min={addDays(f.checkIn, 1)} onChange={(e) => set('checkOut', e.target.value)} />
          </Field>
          <Field label="Camera" hint={`${free.length} camere libere per queste date${!roomFree ? ' · la camera scelta è occupata' : ''}`} className="sm:col-span-2">
            <NiceSelect
              className="w-full"
              label="Camera"
              invalid={!roomFree}
              value={f.roomId}
              onChange={(v) => set('roomId', v)}
              options={[
                { value: '', label: 'Da assegnare più tardi' },
                ...rooms.map((r) => {
                  const isFree = free.some((x) => x.id === r.id);
                  return { value: r.id, label: `${r.number} · ${r.name}`, hint: `max ${ospiti(r.maxGuests)} · ${isFree ? `da ${money(r.basePrice)}` : 'occupata'}`, disabled: !isFree };
                }),
              ]}
            />
          </Field>
        </>
      )}
      <Field label="Nome">
        <input className="field" value={f.firstName} onChange={(e) => set('firstName', e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Cognome">
        <input className="field" value={f.lastName} onChange={(e) => set('lastName', e.target.value)} autoComplete="off" />
      </Field>
      {ota && (
        <Field label={f.source === 'booking' ? 'Numero prenotazione Booking.com' : 'Numero prenotazione Expedia'} hint="Facoltativo: lo trovi nell’email o nell’extranet del portale" className="sm:col-span-2">
          <input className="field" value={f.otaCode} onChange={(e) => set('otaCode', e.target.value)} inputMode="numeric" autoComplete="off" />
        </Field>
      )}
      <Field label="Telefono">
        <input className="field" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
      </Field>
      <Field label="Email (facoltativa)">
        <input className="field" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <Field label="Adulti">
        <NumInput className="field" decimals={0} min={1} max={selected?.maxGuests ?? 8} value={f.adults} onChange={(v) => v !== null && set('adults', Math.max(1, v))} />
      </Field>
      <Field label="Bambini">
        <NumInput className="field" decimals={0} min={0} max={6} value={f.children} onChange={(v) => v !== null && set('children', Math.max(0, v))} />
      </Field>
      {showSource && (
        <Field label="Provenienza">
          <NiceSelect
            className="w-full"
            label="Provenienza"
            value={f.source}
            onChange={(v) => set('source', v)}
            options={[
              { value: 'telefono', label: 'Telefono' },
              { value: 'email', label: 'Email' },
              { value: 'walkin', label: 'Walk-in (al banco)' },
              { value: 'booking', label: 'Booking.com (inserita a mano)' },
              { value: 'expedia', label: 'Expedia (inserita a mano)' },
            ]}
          />
        </Field>
      )}
      <Field label="Stato">
        <NiceSelect
          className="w-full"
          label="Stato"
          value={f.status}
          onChange={(v) => set('status', v)}
          options={[
            { value: 'confirmed', label: 'Confermata', dot: 'var(--color-sage)' },
            { value: 'pending_payment', label: 'In attesa di pagamento', dot: 'var(--color-gold)' },
          ]}
        />
      </Field>
      <Field label="Totale (€)" hint={ota ? 'L’importo indicato dal portale' : 'Vuoto = calcolato dal listino'}>
        <input className="field" inputMode="decimal" value={f.total} onChange={(e) => set('total', e.target.value)} placeholder={selected && valid ? `≈ ${money(selected.basePrice * diffDays(f.checkIn, f.checkOut))}` : ''} />
      </Field>
      <Field label="Già versato (€)" hint={ota ? 'Se il portale ha già incassato, scrivi qui la cifra' : undefined}>
        <input className="field" inputMode="decimal" value={f.amountPaid} onChange={(e) => set('amountPaid', e.target.value)} />
      </Field>
      <Field label="Note" className="sm:col-span-2">
        <textarea className="field" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <label className="flex items-center gap-3 text-sm sm:col-span-2">
        <input type="checkbox" checked={f.sendEmail} onChange={(e) => set('sendEmail', e.target.checked)} className="h-4 w-4 accent-[var(--color-navy)]" /> {ota ? 'Invia anche la nostra email di conferma (di solito la manda già il portale)' : 'Invia email di conferma all’ospite'}
      </label>
    </div>
  );
}

export function NewBookingDialog({ open, onClose, rooms, bookings, blocks, preset }: { open: boolean; onClose: () => void; rooms: RoomOption[]; bookings: BookingRow[]; blocks: BlockRow[]; preset?: BookingPreset }) {
  const form = useBookingForm(rooms, bookings, blocks, preset);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nuova prenotazione"
      width={720}
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Annulla
          </Button>
          <Button disabled={!form.canSave} onClick={() => form.save(onClose)}>
            {form.pending ? 'Salvataggio…' : 'Salva prenotazione'}
          </Button>
        </>
      }
    >
      <BookingFields form={form} rooms={rooms} />
    </Dialog>
  );
}

const RANGE_MODES: { k: 'block' | Source; label: string; sub: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { k: 'block', label: 'Blocca', sub: 'manutenzione, chiusura…', icon: Lock },
  { k: 'telefono', label: 'Telefono', sub: 'prenotazione diretta', icon: Phone },
  { k: 'booking', label: 'Booking.com', sub: 'arrivata dal portale', icon: Globe },
  { k: 'expedia', label: 'Expedia', sub: 'arrivata dal portale', icon: Plane },
];
const REASONS = ['Manutenzione', 'Pulizia straordinaria', 'Uso personale', 'Chiusura stagionale'];

/**
 * The nights chosen on the planning: block them, or record a booking right here — taken on the
 * phone or arrived from Booking.com / Expedia — without leaving the dialog.
 */
export function RangeActionDialog({ open, onClose, room, from, to, rooms, bookings, blocks }: { open: boolean; onClose: () => void; room: RoomOption | null; from: string; to: string; rooms: RoomOption[]; bookings: BookingRow[]; blocks: BlockRow[] }) {
  const [mode, setMode] = useState<'block' | Source>('block');
  const [reason, setReason] = useState('Manutenzione');
  const block = useAction();
  const form = useBookingForm(rooms, bookings, blocks, { roomId: room?.id, checkIn: from, checkOut: to, source: 'telefono' });
  if (!room) return null;
  const nights = diffDays(from, to);
  const pick = (k: 'block' | Source) => {
    setMode(k);
    if (k !== 'block') {
      form.set('source', k);
      form.set('sendEmail', !(k === 'booking' || k === 'expedia'));
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Camera ${room.number} · ${fmtDate(from)} → ${fmtDate(to)}`}
      width={mode === 'block' ? 600 : 720}
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Annulla
          </Button>
          {mode === 'block' ? (
            <Button disabled={block.pending || !reason.trim()} onClick={() => block.run(() => addBlockAction(room.id, from, to, reason), { onOk: onClose })}>
              Conferma blocco
            </Button>
          ) : (
            <Button disabled={!form.canSave} onClick={() => form.save(onClose)}>
              {form.pending ? 'Salvataggio…' : 'Salva prenotazione'}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-charcoal/80">
        <strong className="text-navy">{nights} {nights === 1 ? 'notte' : 'notti'}</strong> · arrivo {fmtDateLong(from)}, partenza {fmtDateLong(to)} (la mattina della partenza la camera è di nuovo libera).
      </p>
      <p className="label mb-2 mt-5">Cosa vuoi fare con queste notti?</p>
      <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RANGE_MODES.map((m) => {
          const on = mode === m.k;
          return (
            <button key={m.k} type="button" role="radio" aria-checked={on} onClick={() => pick(m.k)} className={`flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors ${on ? 'border-navy bg-navy text-ivory' : 'border-line bg-ivory text-navy hover:border-navy/40'}`}>
              <m.icon className={`h-4 w-4 ${on ? 'text-gold' : 'text-gold-2'}`} />
              <span className="text-sm font-semibold">{m.label}</span>
              <span className={`text-[0.7rem] leading-snug ${on ? 'text-ivory/70' : 'text-mist'}`}>{m.sub}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-5">
        {mode === 'block' ? (
          <>
            <Field label="Motivo">
              <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
            </Field>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)} className={`h-8 rounded-full border px-3 text-xs ${reason === r ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/40'}`}>
                  {r}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-mist">Il sito non offrirà la camera in queste notti.</p>
          </>
        ) : (
          <BookingFields form={form} rooms={rooms} showDates={false} showSource={false} />
        )}
      </div>
    </Dialog>
  );
}

export function BookingDetailDialog({ row, onClose, rooms, bookings, blocks }: { row: BookingRow | null; onClose: () => void; rooms: RoomOption[]; bookings: BookingRow[]; blocks: BlockRow[] }) {
  const { run, pending } = useAction();
  const openGuest = useGuestCard();
  const [roomId, setRoomId] = useState('');
  if (!row) return null;
  const free = freeRooms(rooms, bookings, blocks, row.checkIn, row.checkOut, row.id).filter((r) => r.maxGuests >= row.adults + row.children);
  return (
    <Dialog open={Boolean(row)} onClose={onClose} title={row.guest} width={560}>
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge row={row} />
        <SourceBadge row={row} />
        <span className="text-xs text-mist">{row.code}</span>
        <button type="button" onClick={() => { onClose(); openGuest({ email: row.email, bookingId: row.id }); }} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-semibold text-navy hover:border-navy">
          Scheda ospite
        </button>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
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
            {row.adults} adulti{row.children ? ` · ${row.children} bambini` : ''}
          </dd>
        </div>
        <div>
          <dt className="label">Totale</dt>
          <dd className="text-navy">{money(row.total, 'it', 2)}</dd>
        </div>
        <div>
          <dt className="label">Versato</dt>
          <dd className="text-navy">{money(row.amountPaid, 'it', 2)}</dd>
        </div>
        {row.phone && (
          <div>
            <dt className="label">Telefono</dt>
            <dd>
              <a className="text-navy underline decoration-gold" href={`tel:${row.phone.replace(/\s/g, '')}`}>
                {row.phone}
              </a>
            </dd>
          </div>
        )}
        {row.otaRef && (
          <div>
            <dt className="label">Rif. OTA</dt>
            <dd className="text-navy">{row.otaRef}</dd>
          </div>
        )}
      </dl>
      {(row.specialRequests || row.notes) && <p className="mt-4 border-l border-gold pl-3 text-sm text-charcoal/80">{[row.specialRequests, row.notes].filter(Boolean).join(' · ')}</p>}
      {row.status !== 'cancelled' && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="label">{row.roomId ? 'Sposta in un’altra camera' : 'Assegna camera'}</p>
          <div className="flex gap-2">
            <NiceSelect
              className="min-w-0 flex-1"
              label={row.roomId ? 'Sposta in un’altra camera' : 'Assegna camera'}
              value={roomId}
              onChange={setRoomId}
              options={[{ value: '', label: free.length ? `Scegli tra ${free.length} camere libere…` : 'Nessuna camera libera per queste date', disabled: true }, ...free.map((r) => ({ value: r.id, label: `${r.number} · ${r.name}`, hint: `max ${ospiti(r.maxGuests)}` }))]}
            />
            <Button disabled={!roomId || pending} onClick={() => run(() => assignRoomAction(row.id, roomId), { onOk: onClose })}>
              Assegna
            </Button>
          </div>
        </div>
      )}
      <Link href={`/admin/prenotazioni?id=${row.id}`} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-navy">
        Apri scheda completa <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </Dialog>
  );
}

export function BlockDetailDialog({ block, room, onClose }: { block: BlockRow | null; room: RoomOption | null; onClose: () => void }) {
  const { run, pending } = useAction();
  if (!block) return null;
  return (
    <Dialog
      open={Boolean(block)}
      onClose={onClose}
      title={`Blocco camera ${room?.number ?? ''}`}
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Chiudi
          </Button>
          <Button variant="danger" disabled={pending} onClick={() => run(() => removeBlockAction(block.id), { onOk: onClose })}>
            Rimuovi blocco
          </Button>
        </>
      }
    >
      <p className="text-sm text-charcoal/80">
        {fmtDateLong(block.from)} → {fmtDateLong(block.to)} ({notti(diffDays(block.from, block.to))})
      </p>
      <p className="mt-3 text-navy">{block.reason}</p>
    </Dialog>
  );
}
