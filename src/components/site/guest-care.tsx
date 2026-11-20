'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CalendarRange, Check, CreditCard, Lock, MessageCircle, Send } from 'lucide-react';
import { useI18n } from './providers';
import { RangeCalendar } from './booking/calendar';
import { CARE_T } from '@/lib/i18n/care-dict';
import { STAY_T } from '@/lib/i18n/stay-dict';
import { plural } from '@/lib/i18n/config';
import { addDays, diffDays, fmtDate, fmtDateTime, todayISO } from '@/lib/dates';
import { cn, money } from '@/lib/utils';
import { answerHotelProposal, askNewDates, sendGuestMessage, startCardUpdate, withdrawGuestRequest } from '@/app/[locale]/soggiorno/actions';

export type GuestCareProps = {
  token: string;
  active: boolean;
  checkIn: string;
  checkOut: string;
  total: number;
  hotelName: string;
  thread: { id: string; sender: 'guest' | 'hotel'; body: string; at: string }[];
  card: { deadline: string; amount: number; cancelOnExpiry: boolean; expired: boolean } | null;
  cardDone: boolean;
  change: { kind: 'dates' | 'free_cancel'; by: 'hotel' | 'guest'; checkIn: string; checkOut: string; total: number; note: string; status: string; answer?: string; recent: boolean } | null;
  /** nights of the guest's room already taken by others (the calendar shows them closed) */
  busy?: string[];
};

const EASE = [0.22, 1, 0.36, 1] as const;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

/**
 * The booking seen by the guest, beyond the summary: the hotel's request for a new card, new dates
 * (proposed by the hotel or asked by the guest) and the conversation with the hotel.
 */
export function GuestCare(p: GuestCareProps) {
  const { locale } = useI18n();
  const c = CARE_T[locale];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const err = (e?: string) => (e === 'too_many' ? c.tooMany : e === 'not_available' ? c.notAvailable : e === 'pending' ? c.pending : e === 'expired' ? c.cardExpired : c.error);
  const day = (d: string) => fmtDate(d, locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const eur = (n: number) => money(n, locale, 2);
  const change = p.change;

  return (
    <div className="space-y-10">
      {p.cardDone && (
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 rounded-2xl border border-sage/40 bg-sage/10 px-4 py-3 text-sm text-navy" role="status">
          <Check className="h-4 w-4 text-sage" /> {c.cardDone}
        </motion.p>
      )}

      {p.card && (
        <motion.section id="carta" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="scroll-mt-32 rounded-[1.5rem] border border-gold/50 bg-white p-6">
          <h2 className="serif flex items-center gap-3 text-[1.7rem] text-navy">
            <CreditCard className="h-6 w-6 text-gold-2" strokeWidth={1.4} /> {c.cardTitle}
          </h2>
          {p.card.expired ? (
            <p className="mt-3 text-sm text-terracotta">{c.cardExpired}</p>
          ) : (
            <>
              <p className="mt-3 text-sm text-charcoal/85">
                <strong>{fill(c.cardText, { deadline: fmtDateTime(p.card.deadline, locale) })}</strong> {p.card.amount > 0 && fill(c.cardPay, { amount: eur(p.card.amount) })}
              </p>
              {p.card.cancelOnExpiry && <p className="mt-2 text-sm text-charcoal/75">{c.cardCancel}</p>}
              <button
                type="button"
                disabled={pending}
                className="btn btn-navy mt-5"
                onClick={() =>
                  start(async () => {
                    const r = await startCardUpdate(p.token, locale);
                    if (r.ok) window.location.assign(r.url);
                    else setMsg({ ok: false, text: err(r.error) });
                  })
                }
              >
                {c.cardButton}
              </button>
              <p className="mt-3 flex items-center gap-2 text-xs text-mist">
                <Lock className="h-3.5 w-3.5" /> {c.cardSafe}
              </p>
            </>
          )}
        </motion.section>
      )}

      {change?.status === 'pending' && change.by === 'hotel' && change.kind === 'dates' && (
        <motion.section id="modifica" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="scroll-mt-32 rounded-[1.5rem] border border-navy/30 bg-white p-6">
          <h2 className="serif text-[1.7rem] text-navy">{c.proposalTitle}</h2>
          <p className="mt-3 text-navy">{fill(c.proposal, { from: day(change.checkIn), to: day(change.checkOut), total: eur(change.total), now: eur(p.total) })}</p>
          {change.note && <p className="mt-3 border-l-2 border-gold pl-3 text-sm italic text-charcoal/80">«{change.note}»</p>}
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" disabled={pending} className="btn btn-navy" onClick={() => start(async () => { const r = await answerHotelProposal(p.token, true); setMsg(r.ok ? { ok: true, text: c.acceptedDates } : { ok: false, text: err(r.error) }); if (r.ok) router.refresh(); })}>
              {c.accept}
            </button>
            <button type="button" disabled={pending} className="btn btn-line text-navy" onClick={() => start(async () => { const r = await answerHotelProposal(p.token, false); setMsg(r.ok ? { ok: true, text: c.answered } : { ok: false, text: err(r.error) }); if (r.ok) router.refresh(); })}>
              {c.decline}
            </button>
          </div>
        </motion.section>
      )}

      {change?.status === 'pending' && change.by === 'guest' && (
        <section className="rounded-[1.5rem] border border-line bg-white p-6">
          <p className="eyebrow text-gold-2">{c.waiting}</p>
          <p className="mt-3 text-sm text-navy">{change.kind === 'free_cancel' ? c.yourCancel : fill(c.yourDates, { from: day(change.checkIn), to: day(change.checkOut), total: eur(change.total) })}</p>
          <button type="button" disabled={pending} className="link-u mt-4 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-navy" onClick={() => start(async () => { const r = await withdrawGuestRequest(p.token); if (r.ok) router.refresh(); })}>
            {c.withdraw}
          </button>
        </section>
      )}

      {change?.recent && change.status === 'refused' && change.by === 'guest' && (
        <p className="rounded-2xl border border-line bg-white px-4 py-3 text-sm text-charcoal/80">
          {c.refused}
          {change.answer ? ` «${change.answer}»` : ''}
        </p>
      )}

      {p.active && change?.status !== 'pending' && <DatesForm token={p.token} checkIn={p.checkIn} checkOut={p.checkOut} busy={p.busy} onDone={(text) => { setMsg({ ok: true, text }); router.refresh(); }} onError={(e) => setMsg({ ok: false, text: err(e) })} />}

      <Conversation token={p.token} thread={p.thread} hotelName={p.hotelName} onError={(e) => setMsg({ ok: false, text: err(e) })} />

      <AnimatePresence>
        {msg && (
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('text-sm', msg.ok ? 'text-sage' : 'text-terracotta')} role="status">
            {msg.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function DatesForm({ token, checkIn, checkOut, busy = [], onDone, onError }: { token: string; checkIn: string; checkOut: string; busy?: string[]; onDone: (text: string) => void; onError: (e?: string) => void }) {
  const { locale, t } = useI18n();
  const blocked = useMemo(() => new Set(busy), [busy]);
  const day = (d: string) => fmtDate(d, locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const c = CARE_T[locale];
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(checkIn);
  const [to, setTo] = useState(checkOut);
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const nights = from && to && to > from ? diffDays(from, to) : 0;
  const same = from === checkIn && to === checkOut;
  return (
    <section id="modifica" className="scroll-mt-32">
      <h2 className="serif flex items-center gap-3 text-[1.9rem] text-navy">
        <CalendarRange className="h-6 w-6 text-gold-2" strokeWidth={1.3} /> {c.datesTitle}
      </h2>
      <p className="mt-2 text-sm text-mist">{c.datesText}</p>
      {!open ? (
        // the stay as it is now, and one big tap to pick other dates (the calendar shows which nights are free)
        <button type="button" onClick={() => setOpen(true)} className="group mt-5 block w-full overflow-hidden rounded-2xl border border-line bg-white text-left transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-navy hover:shadow-[0_24px_50px_-34px_rgba(16,40,61,0.6)]">
          <span className="block px-4 pt-3 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-gold-2">{STAY_T[locale].now}</span>
          <span className="grid grid-cols-2">
            {([[t.search.arrival, checkIn], [t.search.departure, checkOut]] as const).map(([l, d], i) => (
              <span key={l} className={cn('block px-4 pb-3 pt-1.5', i === 1 && 'border-l border-line')}>
                <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-mist">{l}</span>
                <span className="mt-0.5 block text-[0.95rem] font-semibold text-navy">{day(d)}</span>
              </span>
            ))}
          </span>
          <span className="flex items-center justify-between gap-3 bg-navy px-4 py-3.5 text-ivory">
            <span className="flex items-center gap-2.5 text-sm font-semibold">
              <CalendarRange className="h-4 w-4 text-gold" /> {STAY_T[locale].change}
            </span>
            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </span>
        </button>
      ) : (
        <motion.form
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.4, ease: EASE }}
          className="mt-5 overflow-hidden"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await askNewDates(token, { checkIn: from, checkOut: to, note });
              if (r.ok) {
                setOpen(false);
                onDone(t.guest.requestSent);
              } else onError(r.error);
            });
          }}
        >
          {/* the same calendar as the booking: nights already taken are closed, the stay shows as a band */}
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-white">
            {([[t.search.arrival, from], [t.search.departure, to]] as const).map(([l, d], i) => (
              <div key={l} className={cn('px-4 py-3', i === 1 && 'border-l border-line')}>
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-mist">{l}</p>
                <p className={cn('mt-0.5 text-[0.95rem] font-semibold', d ? 'text-navy' : 'text-mist')}>{d ? day(d) : '—'}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-2xl border border-line bg-white p-3 sm:p-4">
            <RangeCalendar checkIn={from || null} checkOut={to || null} minDate={todayISO()} months={1} blockedNights={blocked} onChange={(ci, co) => { setFrom(ci ?? ''); setTo(co ?? ''); }} />
          </div>
          {nights > 0 && <p className="mt-2 text-xs text-mist">{plural(locale, nights, t.booking.nights)}{same ? '' : ` · ${c.askDates}`}</p>}
          <label className="mt-3 block">
            <span className="label">{c.note}</span>
            <textarea className="field" rows={2} maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" disabled={pending || same || nights < 1} className="btn btn-navy mt-4">
            {c.askDates}
          </button>
        </motion.form>
      )}
    </section>
  );
}

function Conversation({ token, thread, hotelName, onError }: { token: string; thread: GuestCareProps['thread']; hotelName: string; onError: (e?: string) => void }) {
  const { locale } = useI18n();
  const c = CARE_T[locale];
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }, [thread.length]);
  const send = () => {
    if (!text.trim()) return;
    start(async () => {
      const r = await sendGuestMessage(token, text);
      if (r.ok) {
        setText('');
        router.refresh();
      } else onError(r.error);
    });
  };
  return (
    <section id="messaggi" className="scroll-mt-32 overflow-hidden rounded-[1.5rem] border border-line bg-white">
      <h2 className="serif flex items-center gap-3 border-b border-line px-6 py-4 text-[1.6rem] text-navy">
        <MessageCircle className="h-5 w-5 text-gold-2" strokeWidth={1.4} /> {c.msgTitle}
      </h2>
      <p className="border-b border-line bg-white px-6 py-2.5 text-xs text-mist">{STAY_T[locale].msgHint}</p>
      <div ref={box} className="max-h-96 space-y-3 overflow-y-auto bg-ivory/70 px-5 py-5">
        {thread.length === 0 && <p className="py-4 text-center text-sm text-mist">{c.msgEmpty}</p>}
        <AnimatePresence initial={false}>
          {thread.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }} className={cn('flex', m.sender === 'guest' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed', m.sender === 'guest' ? 'rounded-br-md bg-navy text-ivory' : 'rounded-bl-md border border-line bg-white text-charcoal')}>
                <p className="whitespace-pre-line">{m.body}</p>
                <p className={cn('mt-1.5 text-[0.65rem]', m.sender === 'guest' ? 'text-ivory/60' : 'text-mist')}>
                  {m.sender === 'guest' ? c.you : hotelName} · {fmtDateTime(m.at, locale)}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="sr-only" htmlFor="guest-msg">
          {c.msgPh}
        </label>
        <textarea id="guest-msg" className="field min-h-[3rem] flex-1 text-sm" rows={2} maxLength={3000} placeholder={c.msgPh} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }} />
        <button type="submit" disabled={pending || !text.trim()} aria-label={c.send} className="btn btn-navy h-12 min-h-0 px-4">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
