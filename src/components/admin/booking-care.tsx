'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, CalendarRange, Check, CreditCard, Hourglass, MessageCircle, Send, ShieldAlert, UserX, X } from 'lucide-react';
import type { RoomOption } from '@/server/admin-data';
import type { ActionResult } from '@/server/action';
import { addDays, diffDays, fmtDate, fmtDateTime, todayISO } from '@/lib/dates';
import { cn, money, notti, ospiti } from '@/lib/utils';
import { itOn } from '@/lib/charge-later';
import { Badge, Button, Dialog, Field, Toggle, useAction, useToast } from './ui';
import { NiceSelect } from './nice-select';
import {
  answerChangeAction,
  bookingCareAction,
  chargeCardAction,
  noShowAction,
  proposeDatesAction,
  quoteChangeAction,
  requestCardAction,
  sendHotelMessageAction,
  withdrawCardRequestAction,
  withdrawChangeAction,
} from '@/app/admin/actions/booking-care';

type Care = NonNullable<Extract<Awaited<ReturnType<typeof bookingCareAction>>, { ok: true }>['data']>;
type Row = { id: string; code: string; guest: string; email: string; status: string; checkIn: string; checkOut: string; total: number; amountPaid: number; roomId: string | null; adults: number; children: number; active: boolean };

const EASE = [0.22, 1, 0.36, 1] as const;
const eur = (n: number) => money(n, 'it', 2);
const num = (s: string) => Number(s.replace(',', '.'));

/** Loads the booking's care data (conversation, card, requests) and reloads it after every change. */
function useCare(bookingId: string) {
  const [care, setCare] = useState<Care | null>(null);
  const [, start] = useTransition();
  const load = useCallback(() => {
    start(async () => {
      const r = await bookingCareAction(bookingId);
      if (r.ok && r.data) setCare(r.data);
    });
  }, [bookingId]);
  useEffect(() => load(), [load]);
  return { care, reload: load };
}

/**
 * Everything the hotel does with a booking after it is made, on the booking page (like the portals'
 * extranet): the guest's requests waiting for an answer, the card (charge it, ask for a new one),
 * no-show, new dates, and the conversation with the guest.
 */
export function BookingCare({ row, rooms, onChanged }: { row: Row; rooms: RoomOption[]; onChanged: () => void }) {
  const { care, reload } = useCare(row.id);
  const done = useCallback(() => {
    reload();
    onChanged();
  }, [reload, onChanged]);
  if (!care) return <div className="mt-6 h-24 animate-pulse rounded-[1.25rem] bg-white" />;
  return (
    <div className="mt-6 space-y-4">
      <Requests row={row} care={care} onDone={done} />
      <CardBox row={row} care={care} onDone={done} />
      <StayActions row={row} care={care} rooms={rooms} onDone={done} />
      <Conversation row={row} care={care} onSent={reload} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* what waits for an answer                                            */
/* ------------------------------------------------------------------ */

function Requests({ row, care, onDone }: { row: Row; care: Care; onDone: () => void }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [answer, setAnswer] = useState('');
  const req = care.changeRequest;
  const items: React.ReactNode[] = [];

  if (req?.status === 'pending' && req.by === 'guest') {
    const free = req.kind === 'free_cancel';
    items.push(
      <Banner key="req" tone="gold" icon={free ? ShieldAlert : CalendarRange} title={free ? 'L’ospite chiede la cancellazione gratuita' : 'L’ospite chiede nuove date'}>
        {free ? (
          <p>
            Il termine gratuito è passato. Se accetti, la prenotazione si cancella senza penale e l’ospite riceve indietro {eur(row.amountPaid)}
            {care.card || row.amountPaid > 0 ? ' (sulla carta, se ha pagato con carta)' : ''}.
          </p>
        ) : (
          <p>
            <strong>
              {fmtDate(req.checkIn, 'it', { weekday: 'short', day: 'numeric', month: 'short' })} → {fmtDate(req.checkOut, 'it', { weekday: 'short', day: 'numeric', month: 'short' })}
            </strong>{' '}
            · {notti(diffDays(req.checkIn, req.checkOut))} · camera {req.roomNumber ?? '—'} libera · nuovo totale <strong>{eur(req.total)}</strong> (ora {eur(row.total)})
          </p>
        )}
        {req.note && <p className="mt-2 border-l-2 border-gold pl-3 italic">«{req.note}»</p>}
        <textarea className="field mt-3 text-sm" rows={2} placeholder="Risposta all’ospite (facoltativa)" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={pending || (free && !care.canMoney)} onClick={() => run(() => answerChangeAction(row.id, true, answer), { onOk: (d) => { if (d?.message) toast('ok', d.message); onDone(); } })}>
            <Check className="h-3.5 w-3.5" /> {free ? 'Cancella gratis' : 'Accetta le nuove date'}
          </Button>
          <Button size="sm" variant="line" disabled={pending} onClick={() => run(() => answerChangeAction(row.id, false, answer), { onOk: (d) => { if (d?.message) toast('ok', d.message); onDone(); } })}>
            <X className="h-3.5 w-3.5" /> Rifiuta
          </Button>
        </div>
      </Banner>,
    );
  }
  if (req?.status === 'pending' && req.by === 'hotel') {
    items.push(
      <Banner key="prop" tone="navy" icon={Hourglass} title="In attesa della risposta dell’ospite">
        <p>
          Hai proposto {fmtDate(req.checkIn)} → {fmtDate(req.checkOut)} · {eur(req.total)} il {fmtDateTime(req.at)}. Finché l’ospite non risponde la prenotazione resta com’è.
        </p>
        <Button size="sm" variant="line" className="mt-3" disabled={pending} onClick={() => run(() => withdrawChangeAction(row.id), { onOk: onDone })}>
          Ritira la proposta
        </Button>
      </Banner>,
    );
  }
  if (req && req.status !== 'pending' && req.answeredAt && Date.now() - new Date(req.answeredAt).getTime() < 7 * 86_400_000) {
    const who = req.by === 'guest' ? 'Richiesta dell’ospite' : 'La tua proposta';
    const what = req.kind === 'free_cancel' ? 'di cancellazione gratuita' : `di nuove date (${fmtDate(req.checkIn)} → ${fmtDate(req.checkOut)})`;
    const state = req.status === 'accepted' ? 'accettata' : req.status === 'refused' ? 'rifiutata' : 'ritirata';
    items.push(
      <p key="past" className="text-xs text-mist">
        {who} {what}: {state} il {fmtDateTime(req.answeredAt)}.
      </p>,
    );
  }
  const cr = care.cardRequest;
  if (cr && !cr.outcome) {
    items.push(
      <Banner key="card" tone="gold" icon={CalendarClock} title="Nuova carta chiesta all’ospite">
        <p>
          Entro <strong>{fmtDateTime(cr.deadline)}</strong> <Countdown to={cr.deadline} />
          {cr.amount > 0 ? ` · da pagare ${eur(cr.amount)}` : ''}. {cr.cancelOnExpiry ? 'Se non arriva, la prenotazione si cancella da sola e ti avviso.' : 'Se non arriva, ti avviso.'}
        </p>
        <Button size="sm" variant="line" className="mt-3" disabled={pending} onClick={() => run(() => withdrawCardRequestAction(row.id), { onOk: onDone })}>
          Ritira la richiesta
        </Button>
      </Banner>,
    );
  } else if (cr?.outcome && cr.doneAt && Date.now() - new Date(cr.doneAt).getTime() < 7 * 86_400_000) {
    items.push(
      <p key="cardpast" className="text-xs text-mist">
        Nuova carta: {cr.outcome === 'done' ? 'inserita dall’ospite' : cr.outcome === 'expired' ? 'non arrivata entro il termine' : 'richiesta ritirata'} · {fmtDateTime(cr.doneAt)}.
      </p>,
    );
  }
  if (care.noShow) {
    const n = care.noShow;
    items.push(
      <Banner key="ns" tone={n.outcome === 'due' ? 'red' : 'navy'} icon={UserX} title="No-show">
        <p>
          Segnato il {fmtDateTime(n.at)} da {n.by} ·{' '}
          {n.outcome === 'waived' ? 'penale non applicata' : n.outcome === 'due' ? `penale ${eur(n.fee)} ancora da incassare` : `penale ${eur(n.fee)} incassata`}.
        </p>
      </Banner>,
    );
  }
  if (!items.length) return null;
  return <div className="space-y-3">{items}</div>;
}

function Banner({ tone, icon: Icon, title, children }: { tone: 'gold' | 'navy' | 'red'; icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: EASE }}
      className={cn('rounded-[1.25rem] border px-4 py-4 text-sm text-charcoal/85', tone === 'gold' ? 'border-gold/50 bg-gold/[0.07]' : tone === 'red' ? 'border-terracotta/40 bg-terracotta/[0.06]' : 'border-line bg-white')}
    >
      <p className="flex items-center gap-2 font-semibold text-navy">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-full', tone === 'gold' ? 'bg-gold/25 text-navy' : tone === 'red' ? 'bg-terracotta/15 text-terracotta' : 'bg-navy text-ivory')}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </motion.div>
  );
}

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <Badge tone="red">scaduto</Badge>;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return <Badge tone="gold">{h > 0 ? `${h} h ${m} min` : `${m} min`}</Badge>;
}

/* ------------------------------------------------------------------ */
/* the card                                                            */
/* ------------------------------------------------------------------ */

function CardBox({ row, care, onDone }: { row: Row; care: Care; onDone: () => void }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const due = Math.max(0, Math.round((row.total - row.amountPaid) * 100) / 100);
  const noShowDue = care.noShow?.outcome === 'due' ? Math.max(0, care.noShow.fee - row.amountPaid) : 0;
  const [amount, setAmount] = useState(String(noShowDue || due || ''));
  const [declined, setDeclined] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const open = row.status !== 'cancelled' || care.noShow?.outcome === 'due';
  if (!open && !care.card) return null;
  const canCharge = care.canMoney && care.card?.usable && open;
  const charge = () =>
    run(() => chargeCardAction(row.id, num(amount), care.noShow?.outcome === 'due' ? 'penale no-show' : 'saldo del soggiorno'), {
      onOk: (r) => {
        if (r && !r.ok) {
          setDeclined(r.reason);
          return;
        }
        setDeclined(null);
        if (r?.ok) toast('ok', `Addebitati ${eur(r.amount)} sulla carta.`);
        onDone();
      },
    });

  return (
    <section className="rounded-[1.25rem] border border-line bg-white px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-navy">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-ivory">
            <CreditCard className="h-3.5 w-3.5" />
          </span>
          Carta dell’ospite
        </p>
        {care.card ? (
          <span className="flex items-center gap-2 text-sm text-navy">
            <span className="rounded-md bg-navy px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-ivory">{care.card.brand}</span>
            •••• {care.card.last4} <span className="text-xs text-mist">scad. {care.card.exp}</span>
            {care.card.test && <Badge tone="gray">prova</Badge>}
          </span>
        ) : (
          <span className="text-xs text-mist">{care.paymentMethod === 'cash' ? 'Paga in contanti, nessuna carta a garanzia' : 'Nessuna carta salvata'}</span>
        )}
      </div>
      {care.later && (
        <p className={cn('mt-3 rounded-xl px-3 py-2 text-[0.8rem]', care.later.failed ? 'bg-terracotta/10 text-terracotta' : 'bg-sand-2/60 text-navy')} data-testid="care-charge-later">
          {care.later.failed
            ? `Paga dopo: addebito di ${eur(care.later.amount)} non riuscito (${care.later.failed}).`
            : `Paga dopo: ${eur(care.later.amount)} sulla carta ${itOn(fmtDate(care.later.on, 'it', { day: 'numeric', month: 'long' }))}${care.later.auto ? ', in automatico' : ', quando premi “Addebita ora” in Pagamenti'}.`}
        </p>
      )}
      {open && care.cardsOn && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {care.card && care.canMoney && (
            <>
              <label className="sr-only" htmlFor={`charge-${row.id}`}>
                Importo da addebitare
              </label>
              <span className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-mist">€</span>
                <input id={`charge-${row.id}`} className="field w-32 py-2 pl-7 text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </span>
              <Button size="sm" disabled={pending || !canCharge || !(num(amount) > 0)} onClick={charge}>
                Addebita sulla carta
              </Button>
            </>
          )}
          <Button size="sm" variant="line" disabled={pending} onClick={() => setAsking(true)}>
            Chiedi una nuova carta
          </Button>
        </div>
      )}
      {open && !care.cardsOn && <p className="mt-3 text-xs text-mist">I pagamenti con carta non sono ancora attivi: per ora si incassa in hotel.</p>}
      <AnimatePresence>
        {declined && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-4 rounded-2xl border border-terracotta/40 bg-terracotta/[0.06] px-4 py-3 text-sm">
              <p className="font-semibold text-terracotta">La carta non ha pagato: {declined}.</p>
              <p className="mt-1 text-charcoal/80">Mandagli il link per inserire una nuova carta entro qualche ora: se non lo fa, la prenotazione si cancella da sola.</p>
              <Button size="sm" className="mt-3" onClick={() => setAsking(true)}>
                Chiedi all’ospite una nuova carta
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <CardRequestDialog open={asking} onClose={() => setAsking(false)} row={row} declined={Boolean(declined)} amount={declined ? num(amount) || 0 : noShowDue} canCancel={row.status !== 'cancelled'} onDone={() => { setAsking(false); setDeclined(null); onDone(); }} />
    </section>
  );
}

function CardRequestDialog({ open, onClose, row, declined, amount, canCancel, onDone }: { open: boolean; onClose: () => void; row: Row; declined: boolean; amount: number; canCancel: boolean; onDone: () => void }) {
  const { run, pending } = useAction();
  const [hours, setHours] = useState(24);
  const [pay, setPay] = useState(String(amount || 0));
  const [cancel, setCancel] = useState(canCancel);
  useEffect(() => {
    if (open) {
      setPay(String(amount || 0));
      setCancel(canCancel);
    }
  }, [open, amount, canCancel]);
  const deadline = new Date(Date.now() + hours * 3_600_000).toISOString();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Chiedi una nuova carta"
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Annulla
          </Button>
          <Button disabled={pending || !row.email} onClick={() => run(() => requestCardAction(row.id, { hours, amount: num(pay) || 0, cancelOnExpiry: cancel, declined }), { onOk: onDone })}>
            <Send className="h-4 w-4" /> Invia all’ospite
          </Button>
        </>
      }
    >
      <p className="text-sm text-charcoal/85">
        {row.guest} riceve un’email con il link alla sua area ospite, dove inserisce la nuova carta sulla pagina di pagamento sicura. Tu non vedi mai il numero della carta.
      </p>
      <p className="label mt-5">Entro quante ore</p>
      <div className="flex flex-wrap gap-2">
        {[12, 24, 48, 72].map((h) => (
          <button key={h} type="button" aria-pressed={hours === h} onClick={() => setHours(h)} className={cn('relative h-10 rounded-full border px-4 text-sm font-semibold transition-colors', hours === h ? 'border-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50')}>
            {hours === h && <motion.span layoutId={`hours-${row.id}`} className="absolute inset-0 rounded-full bg-navy" transition={{ duration: 0.35, ease: EASE }} />}
            <span className="relative">{h} ore</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-mist">Scadenza: {fmtDateTime(deadline)}</p>
      <Field label="Da pagare subito con la nuova carta (€)" className="mt-5" hint="0 = la carta resta solo come garanzia, non si addebita niente.">
        <input className="field" inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} />
      </Field>
      {canCancel && (
        <div className="mt-5 flex items-start justify-between gap-4 rounded-2xl border border-line bg-white px-4 py-3">
          <span className="text-sm text-charcoal/85">
            <span className="block font-semibold text-navy">Se non arriva in tempo, cancella la prenotazione</span>
            L’email lo dice all’ospite. Alla scadenza la cancello io e ti mando un avviso.
          </span>
          <Toggle checked={cancel} onChange={setCancel} label="Cancella alla scadenza" />
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* no-show, new dates                                                  */
/* ------------------------------------------------------------------ */

function StayActions({ row, care, rooms, onDone }: { row: Row; care: Care; rooms: RoomOption[]; onDone: () => void }) {
  const [noShow, setNoShow] = useState(false);
  const [dates, setDates] = useState(false);
  const today = todayISO();
  const canNoShow = row.status === 'confirmed' && today >= row.checkIn && !care.noShow;
  const canDates = row.status === 'confirmed' && row.active && row.checkOut > today && care.changeRequest?.status !== 'pending';
  if (!canNoShow && !canDates) return null;
  return (
    <section className="flex flex-wrap gap-2">
      {canDates && (
        <Button variant="line" size="sm" onClick={() => setDates(true)}>
          <CalendarRange className="h-3.5 w-3.5" /> Proponi nuove date
        </Button>
      )}
      {canNoShow && care.canMoney && (
        <Button variant="line" size="sm" onClick={() => setNoShow(true)}>
          <UserX className="h-3.5 w-3.5" /> L’ospite non è arrivato (no-show)
        </Button>
      )}
      <NoShowDialog open={noShow} onClose={() => setNoShow(false)} row={row} care={care} onDone={() => { setNoShow(false); onDone(); }} />
      <DatesDialog open={dates} onClose={() => setDates(false)} row={row} rooms={rooms} onDone={() => { setDates(false); onDone(); }} />
    </section>
  );
}

function NoShowDialog({ open, onClose, row, care, onDone }: { open: boolean; onClose: () => void; row: Row; care: Care; onDone: () => void }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const plan = care.noShowPlan;
  const [fee, setFee] = useState(String(plan.fee));
  const f = Math.min(row.total, Math.max(0, num(fee) || 0));
  const keep = Math.min(row.amountPaid, f);
  const back = Math.max(0, row.amountPaid - f);
  const charge = Math.max(0, f - row.amountPaid);
  const submit = (waive: boolean) =>
    run(() => noShowAction(row.id, { waive, fee: waive ? null : f }), {
      onOk: (r) => {
        if (r) {
          const parts = [waive ? 'No-show segnato senza penale.' : `No-show segnato: penale ${eur(r.fee)}.`];
          if (r.charged) parts.push(`${eur(r.charged)} addebitati sulla carta.`);
          if (r.refunded) parts.push(`${eur(r.refunded)} restituiti.`);
          if (r.outcome === 'due') parts.push(`La carta non ha pagato (${r.declined}): chiedi una nuova carta dalla prenotazione.`);
          toast(r.outcome === 'due' ? 'error' : 'ok', parts.join(' '));
        }
        onDone();
      },
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="L’ospite non è arrivato"
      footer={
        <>
          <Button variant="line" disabled={pending} onClick={() => submit(true)}>
            Nessuna penale
          </Button>
          <Button variant="danger" disabled={pending} onClick={() => submit(false)}>
            {charge > 0 ? `Addebita ${eur(charge)}` : `Trattieni ${eur(f)}`}
          </Button>
        </>
      }
    >
      <p className="text-sm text-charcoal/85">
        La prenotazione di {row.guest} ({fmtDate(row.checkIn)} → {fmtDate(row.checkOut)}) si chiude e le notti tornano libere. L’ospite riceve un’email nella sua lingua con quello che hai deciso.
      </p>
      <Field label="Penale (€)" className="mt-5" hint={`Dalle tue regole di cancellazione: ${eur(plan.fee)}.`}>
        <input className="field" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
      </Field>
      <ul className="mt-4 space-y-1.5 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-charcoal/85">
        <li>Pagato finora: {eur(row.amountPaid)}</li>
        {keep > 0 && <li>Trattieni da quanto pagato: {eur(keep)}</li>}
        {back > 0 && <li>Restituisci il resto: {eur(back)}</li>}
        {charge > 0 && <li>{care.card?.usable ? `Addebiti sulla carta ${care.card.label}: ${eur(charge)}` : `Da incassare ${eur(charge)}: non c’è una carta utilizzabile, poi puoi chiederne una all’ospite.`}</li>}
      </ul>
      <p className="mt-3 text-xs text-mist">Con «Nessuna penale» restituisci tutto ({eur(row.amountPaid)}).</p>
    </Dialog>
  );
}

function DatesDialog({ open, onClose, row, rooms, onDone }: { open: boolean; onClose: () => void; row: Row; rooms: RoomOption[]; onDone: () => void }) {
  const { run, pending } = useAction();
  const [from, setFrom] = useState(row.checkIn);
  const [to, setTo] = useState(row.checkOut);
  const [roomId, setRoomId] = useState(row.roomId ?? '');
  const [total, setTotal] = useState('');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<{ total: number; free: boolean; busy: string | null; roomNumber: string; nights: number } | { error: string } | null>(null);
  const seq = useRef(0);
  const nights = from && to ? diffDays(from, to) : 0;
  const fits = useMemo(() => rooms.filter((r) => r.status !== 'draft' && r.maxGuests >= row.adults + row.children), [rooms, row.adults, row.children]);
  useEffect(() => {
    if (!open || !from || !to || to <= from) {
      setQuote(null);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r: ActionResult<{ total: number; free: boolean; busy: string | null; roomNumber: string; nights: number }> = await quoteChangeAction(row.id, { checkIn: from, checkOut: to, roomId: roomId || null });
      if (n !== seq.current) return;
      if (r.ok && r.data) {
        setQuote(r.data);
        setTotal(String(r.data.total));
      } else setQuote({ error: r.ok ? 'Prezzo non disponibile' : r.error });
    }, 250);
    return () => clearTimeout(t);
  }, [open, from, to, roomId, row.id]);
  const ok = quote && 'free' in quote && quote.free && (from !== row.checkIn || to !== row.checkOut || roomId !== (row.roomId ?? ''));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Proponi nuove date"
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Annulla
          </Button>
          <Button disabled={pending || !ok} onClick={() => run(() => proposeDatesAction(row.id, { checkIn: from, checkOut: to, roomId: roomId || null, total: total === '' ? null : num(total), note }), { onOk: onDone })}>
            <Send className="h-4 w-4" /> Invia la proposta
          </Button>
        </>
      }
    >
      <p className="text-sm text-charcoal/85">L’ospite riceve la proposta per email e accetta o rifiuta dalla sua area. Le date cambiano solo se accetta.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Field label="Arrivo">
          <input type="date" className="field" min={todayISO()} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value && to <= e.target.value) setTo(addDays(e.target.value, Math.max(1, diffDays(row.checkIn, row.checkOut)))); }} />
        </Field>
        <Field label="Partenza">
          <input type="date" className="field" min={from ? addDays(from, 1) : todayISO()} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Camera" className="mt-3">
        <NiceSelect className="w-full" label="Camera" value={roomId} onChange={setRoomId} options={fits.map((r) => ({ value: r.id, label: `${r.number} · ${r.name}${r.id === row.roomId ? ' (attuale)' : ''}`, hint: `max ${ospiti(r.maxGuests)}` }))} />
      </Field>
      <AnimatePresence mode="wait">
        {quote && (
          <motion.div key={'error' in quote ? quote.error : `${quote.free}-${quote.total}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className={cn('mt-4 rounded-2xl border px-4 py-3 text-sm', 'error' in quote || !quote.free ? 'border-terracotta/40 bg-terracotta/[0.06] text-terracotta' : 'border-sage/40 bg-sage/[0.08] text-navy')}>
            {'error' in quote ? quote.error : quote.free ? `Camera ${quote.roomNumber} libera · ${notti(nights)} · prezzo del listino ${eur(quote.total)} (ora ${eur(row.total)})` : `Camera ${quote.roomNumber} occupata (${quote.busy}): scegli altre date o un’altra camera.`}
          </motion.div>
        )}
      </AnimatePresence>
      {quote && 'free' in quote && quote.free && (
        <Field label="Nuovo totale (€)" className="mt-4" hint="Puoi cambiarlo tu (per esempio per tenere lo stesso prezzo).">
          <input className="field" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
      )}
      <Field label="Messaggio per l’ospite (facoltativo)" className="mt-4">
        <textarea className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* the conversation                                                    */
/* ------------------------------------------------------------------ */

function Conversation({ row, care, onSent }: { row: Row; care: Care; onSent: () => void }) {
  const { run, pending } = useAction();
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const thread = care.thread;
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [thread.length]);
  const send = () => {
    if (!text.trim()) return;
    run(() => sendHotelMessageAction(row.id, text), {
      onOk: () => {
        setText('');
        onSent();
      },
    });
  };
  return (
    <section className="overflow-hidden rounded-[1.25rem] border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-navy">
          <MessageCircle className="h-4 w-4" /> Conversazione con l’ospite
        </p>
        <span className="text-xs text-mist">{thread.length ? `${thread.length} messaggi` : 'nessun messaggio'}</span>
      </div>
      <div ref={box} className="thin-scroll max-h-80 space-y-3 overflow-y-auto bg-ivory/60 px-4 py-4">
        {thread.length === 0 && <p className="py-6 text-center text-sm text-mist">Scrivi all’ospite: riceve il messaggio per email e risponde dalla sua area ospite.</p>}
        <AnimatePresence initial={false}>
          {thread.map((m) => (
            <motion.div key={m.id} layout initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.35, ease: EASE }} className={cn('flex', m.sender === 'hotel' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed', m.sender === 'hotel' ? 'rounded-br-md bg-navy text-ivory' : 'rounded-bl-md border border-line bg-white text-charcoal')}>
                <p className="whitespace-pre-line">{m.body}</p>
                <p className={cn('mt-1.5 text-[0.65rem]', m.sender === 'hotel' ? 'text-ivory/60' : 'text-mist')}>
                  {m.sender === 'hotel' ? m.name : row.guest} · {fmtDateTime(m.at)}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="border-t border-line p-3">
        <label className="sr-only" htmlFor={`msg-${row.id}`}>
          Messaggio all’ospite
        </label>
        <textarea
          id={`msg-${row.id}`}
          className="field min-h-[3.2rem] text-sm"
          rows={2}
          placeholder={row.email ? 'Scrivi un messaggio…' : 'Questa prenotazione non ha un’email'}
          value={text}
          disabled={!row.email}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[0.7rem] text-mist">Ctrl + Invio per inviare</span>
          <Button size="sm" disabled={pending || !text.trim() || !row.email} onClick={send}>
            <Send className="h-3.5 w-3.5" /> Invia
          </Button>
        </div>
      </div>
    </section>
  );
}
