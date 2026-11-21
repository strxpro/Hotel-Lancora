'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownLeft, ArrowUpRight, BadgeCheck, CalendarClock, CreditCard, Download, FlaskConical, History, Inbox, Loader2, Mail, MessageSquare, NotebookPen, Phone, ReceiptEuro, RotateCcw, Send, ShieldAlert, Star, UserX, Wallet, X } from 'lucide-react';
import type { GuestCardData } from '@/server/guest-card';
import { fmtDate, fmtDateTime } from '@/lib/dates';
import { cn, money, notti, ospiti } from '@/lib/utils';
import { Badge, Button, Dialog, NumInput, Toggle, useAction, useToast } from './ui';
import { NiceSelect } from './nice-select';
import { Flag } from '@/components/site/flags';
import { guestCardAction, refundGuestPaymentAction, sendGuestEmailAction } from '@/app/admin/actions/guests';
import { anonymizeGuestAction, notesAction } from '@/app/admin/actions/bookings';
import { BinButton, DeleteBookingDialog, type DeleteTarget } from './delete-booking';

const EASE = [0.22, 0.61, 0.12, 1] as const;
type Target = { email?: string | null; bookingId?: string | null };
type CardData = GuestCardData & { canRefund: boolean; canGdpr: boolean; canDelete?: boolean };
type Pay = CardData['payments'][number];
type Tab = 'prenotazioni' | 'pagamenti' | 'messaggi' | 'note' | 'storico';

const LANG_NAME: Record<string, string> = { it: 'Italiano', en: 'Inglese', pl: 'Polacco', de: 'Tedesco', fr: 'Francese', es: 'Spagnolo' };
const STATUS: Record<string, { label: string; tone: 'green' | 'gold' | 'gray' }> = { confirmed: { label: 'Confermata', tone: 'green' }, pending_payment: { label: 'In attesa', tone: 'gold' }, cancelled: { label: 'Annullata', tone: 'gray' } };
const KIND: Record<Pay['kind'], string> = { deposit: 'Acconto', full: 'Totale', balance: 'Saldo', refund: 'Rimborso' };
const MAILER: Record<string, string> = { smtp: 'SMTP', cloudflare: 'Cloudflare Email', webhook: 'Make.com' };

/* ---------------- opening the card from anywhere in the panel ---------------- */

const Ctx = createContext<(t: Target) => void>(() => {});
export const useGuestCard = () => useContext(Ctx);

export function GuestCardProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const open = useCallback((t: Target) => setTarget({ email: t.email ?? null, bookingId: t.bookingId ?? null }), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      <GuestCardModal target={target} onClose={() => setTarget(null)} />
    </Ctx.Provider>
  );
}

/**
 * A guest's name that opens the guest card. `inline` renders a span (for names that sit inside a
 * row that is already a link: the click opens the card instead of following the row).
 */
export function GuestLink({ email, bookingId, children, className, inline = false }: Target & { children: React.ReactNode; className?: string; inline?: boolean }) {
  const open = useGuestCard();
  const go = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    open({ email, bookingId });
  };
  const cls = cn('cursor-pointer text-left underline decoration-gold/0 decoration-2 underline-offset-4 transition-colors hover:decoration-gold focus-visible:decoration-gold focus-visible:outline-none', className);
  if (inline)
    return (
      <span role="button" tabIndex={0} title="Apri la scheda ospite" onClick={go} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go(e)} className={cls}>
        {children}
      </span>
    );
  return (
    <button type="button" title="Apri la scheda ospite" onClick={go} className={cls}>
      {children}
    </button>
  );
}

/* ---------------- the card ---------------- */

function GuestCardModal({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<CardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [tab, setTab] = useState<Tab>('prenotazioni');
  const [compose, setCompose] = useState(false);
  const [refund, setRefund] = useState<Pay | null>(null);
  const [gdpr, setGdpr] = useState(false);
  // the bin on a booking of this person: the one asked about, the ones already gone
  const [del, setDel] = useState<DeleteTarget | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const key = target ? `${target.email ?? ''}|${target.bookingId ?? ''}` : '';

  const load = useCallback(
    (t: Target) =>
      startLoading(async () => {
        const r = await guestCardAction(t).catch(() => null);
        if (r?.ok && r.data) {
          setData(r.data as CardData);
          setError(null);
          // someone who only wrote to the hotel: open on the messages
          if (!(r.data as CardData).bookings.length) setTab((x) => (x === 'prenotazioni' ? 'messaggi' : x));
        } else setError(r && !r.ok ? r.error : 'Scheda non disponibile.');
      }),
    [],
  );

  useEffect(() => {
    if (!target) return;
    setData(null);
    setError(null);
    setTab('prenotazioni');
    setCompose(false);
    setRefund(null);
    setDel(null);
    setGone([]);
    load(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => {
    if (!target) return;
    load(target);
    router.refresh();
  }, [target, load, router]);

  // page behind stays still; Esc closes (unless a confirmation is open on top)
  const sub = Boolean(refund) || gdpr || Boolean(del);
  useEffect(() => {
    if (!target) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 80);
    return () => {
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [target]);
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sub) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, sub, onClose]);

  if (typeof document === 'undefined') return null;
  const g = data;
  const refundable = g?.payments.filter((p) => p.refundable > 0) ?? [];
  const tabs: { k: Tab; label: string; icon: React.ComponentType<{ className?: string }>; n?: number }[] = g
    ? [
        { k: 'prenotazioni', label: 'Prenotazioni', icon: CalendarClock, n: g.bookings.length },
        { k: 'pagamenti', label: 'Pagamenti', icon: Wallet, n: g.payments.length },
        { k: 'messaggi', label: 'Messaggi', icon: MessageSquare, n: g.messages.length },
        { k: 'note', label: 'Note', icon: NotebookPen },
        { k: 'storico', label: 'Storico', icon: History, n: g.history.length },
      ]
    : [];

  return createPortal(
    <>
      <AnimatePresence>
        {target && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-5" data-guest-card>
            <motion.button type="button" aria-label="Chiudi la scheda" onClick={onClose} className="absolute inset-0 bg-navy-3/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              ref={box}
              role="dialog"
              aria-modal="true"
              aria-label={g ? `Scheda ospite: ${g.name}` : 'Scheda ospite'}
              initial={{ opacity: 0, y: 34, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.42, ease: EASE }}
              className="relative flex h-[94svh] w-full max-w-[960px] flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-[0_40px_120px_-30px_rgba(10,28,43,0.65)] sm:h-[min(860px,92svh)] sm:rounded-[2rem]"
            >
              {/* header */}
              <header className="relative shrink-0 overflow-hidden bg-navy px-5 pb-5 pt-5 text-ivory md:px-7">
                <span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold/25 blur-3xl" />
                <div className="relative flex items-start gap-4">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ivory/10 font-serif text-3xl md:h-16 md:w-16">{g?.firstName.charAt(0) ?? '·'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-ivory/55">Scheda ospite</p>
                    <p className="serif truncate text-[1.8rem] leading-tight md:text-[2.1rem]">{g?.name ?? (error ? 'Scheda non disponibile' : 'Carico…')}</p>
                    {g && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ivory/70">
                        <span className="flex items-center gap-1.5">
                          <Flag locale={g.lang} className="h-3 w-4 rounded-[2px]" /> {LANG_NAME[g.lang]}
                        </span>
                        {g.country && <span>{g.country}</span>}
                        {g.stats.inHouse && <span className="rounded-full bg-sage px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-white">in hotel ora</span>}
                        {g.stats.stays >= 2 && <span className="rounded-full bg-gold px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-navy-3">cliente fedele</span>}
                        {g.demo && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em]">demo</span>}
                      </p>
                    )}
                  </div>
                  <button type="button" data-autofocus onClick={onClose} aria-label="Chiudi" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {g && (
                  <div className="relative mt-4 flex flex-wrap gap-2">
                    {g.email && (
                      <a href={`mailto:${g.email}`} className="flex h-9 max-w-full items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-xs hover:bg-white/20">
                        <Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{g.email}</span>
                      </a>
                    )}
                    {g.phone && (
                      <a href={`tel:${g.phone.replace(/\s/g, '')}`} className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-xs hover:bg-white/20">
                        <Phone className="h-3.5 w-3.5" /> {g.phone}
                      </a>
                    )}
                    <span className="flex-1" />
                    {g.email && (
                      <button type="button" onClick={() => { setTab('messaggi'); setCompose(true); }} className="flex h-9 items-center gap-1.5 rounded-full bg-gold px-4 text-xs font-semibold text-navy-3 transition-transform hover:-translate-y-0.5">
                        <Send className="h-3.5 w-3.5" /> Scrivi un’email
                      </button>
                    )}
                    {g.canRefund && refundable.length > 0 && (
                      <button type="button" onClick={() => (refundable.length === 1 ? setRefund(refundable[0]!) : setTab('pagamenti'))} className="flex h-9 items-center gap-1.5 rounded-full border border-white/25 px-4 text-xs font-semibold hover:bg-white/10">
                        <RotateCcw className="h-3.5 w-3.5" /> Rimborsa
                      </button>
                    )}
                  </div>
                )}
              </header>

              {error && !g && <p className="m-6 rounded-2xl bg-terracotta/10 p-4 text-sm text-terracotta">{error}</p>}
              {!g && !error && (
                <div className="flex flex-1 items-center justify-center text-mist">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              )}

              {g && (
                <>
                  {/* the person in numbers */}
                  <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-line px-5 py-3 sm:grid-cols-5 md:px-7">
                    <Mini label="Ha speso" value={money(g.stats.spent)} />
                    <Mini label="Versato" value={money(g.stats.paid)} />
                    <Mini label="Notti" value={`${g.stats.nights} · ${g.stats.stays} sogg.`} />
                    <Mini label="Prossimo arrivo" value={g.stats.next ? fmtDate(g.stats.next, 'it', { day: 'numeric', month: 'short' }) : '—'} />
                    <Mini label="Email promo" value={g.unsubscribed ? 'disiscritto' : g.consent ? 'accetta' : 'no consenso'} />
                  </div>
                  <nav className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 md:px-5" aria-label="Sezioni della scheda">
                    {tabs.map((t) => (
                      <button key={t.k} type="button" aria-pressed={tab === t.k} onClick={() => setTab(t.k)} className={cn('relative flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors', tab === t.k ? 'text-ivory' : 'text-navy/70 hover:text-navy')}>
                        {tab === t.k && <motion.span layoutId="guest-card-tab" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                        <t.icon className="relative h-3.5 w-3.5" />
                        <span className="relative">{t.label}</span>
                        {t.n !== undefined && <span className={cn('relative rounded-full px-1.5 text-[0.6rem]', tab === t.k ? 'bg-white/15' : 'bg-sand-2')}>{t.n}</span>}
                      </button>
                    ))}
                    {loading && <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin self-center text-mist" />}
                  </nav>
                  <div data-lenis-prevent className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 md:px-7">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                        {tab === 'prenotazioni' && <BookingsTab g={g} gone={gone} onDelete={g.canDelete ? (b) => setDel({ id: b.id, guest: g.name, code: b.code, checkIn: b.checkIn, checkOut: b.checkOut, nights: b.nights, room: b.room ? `camera ${b.room}` : null, total: b.total, amountPaid: b.amountPaid, status: b.status, active: b.active }) : undefined} />}
                        {tab === 'pagamenti' && <PaymentsTab g={g} onRefund={setRefund} />}
                        {tab === 'messaggi' && <MessagesTab g={g} compose={compose} setCompose={setCompose} onSent={reload} />}
                        {tab === 'note' && <NotesTab g={g} onSaved={reload} />}
                        {tab === 'storico' && <HistoryTab g={g} onGdpr={() => setGdpr(true)} />}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {g?.canDelete && (
        <DeleteBookingDialog
          row={del}
          onClose={() => setDel(null)}
          onDeleted={(id) => {
            setDel(null);
            setGone((x) => [...x, id]);
            const left = g.bookings.filter((b) => b.id !== id && !gone.includes(b.id)).length;
            // nothing left to show about this person: the card closes, the page behind updates
            window.setTimeout(() => {
              if (!left && !g.messages.length) onClose();
              else load({ email: g.email || null, bookingId: g.email ? null : g.bookings.find((b) => b.id !== id)?.id ?? null });
              router.refresh();
            }, 480);
          }}
        />
      )}
      {g && refund && <RefundDialog g={g} pay={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); setTab('pagamenti'); reload(); }} />}
      {g && (
        <GdprDialog
          open={gdpr}
          name={g.name}
          email={g.email}
          onClose={() => setGdpr(false)}
          onDone={() => {
            setGdpr(false);
            onClose();
            router.refresh();
          }}
        />
      )}
    </>,
    document.body,
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-ivory px-3 py-2">
      <p className="truncate text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-mist">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-navy">{value}</p>
    </div>
  );
}

/* ---------------- tabs ---------------- */

function BookingsTab({ g, gone = [], onDelete }: { g: CardData; gone?: string[]; onDelete?: (b: CardData['bookings'][number]) => void }) {
  if (!g.bookings.length) return <p className="rounded-2xl bg-ivory p-5 text-sm text-mist">Nessuna prenotazione: questa persona ha solo scritto all’hotel.</p>;
  return (
    <ul className="space-y-2.5">
      {g.bookings.map((b) => (
        <motion.li
          key={b.id}
          initial={false}
          animate={gone.includes(b.id) ? { opacity: 0, x: 60, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0, borderWidth: 0 } : { opacity: 1, x: 0, height: 'auto' }}
          transition={{ duration: 0.42, ease: [0.4, 0, 0.2, 1] }}
          className={cn('overflow-hidden rounded-2xl border border-line p-3.5', gone.includes(b.id) && 'bg-terracotta/10')}
        >
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ivory font-serif text-lg text-navy">{b.room ?? '—'}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-navy">
                {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)}
              </span>
              <span className="block truncate text-xs text-mist">
                {b.code} · {notti(b.nights)} · {ospiti(b.guests)} · {b.source}
                {b.method ? ` · ${b.method === 'card' ? 'carta' : b.method === 'cash' ? 'contanti' : b.method === 'transfer' ? 'bonifico' : 'portale'}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm tabular-nums text-navy">{money(b.total, 'it', 2)}</span>
              <Badge tone={STATUS[b.status]!.tone}>{b.status === 'pending_payment' && !b.active ? 'Scaduta' : STATUS[b.status]!.label}</Badge>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-2.5 text-xs text-charcoal/80">
            <span>
              Versato <strong className="tabular-nums text-navy">{money(b.amountPaid, 'it', 2)}</strong>
              {b.total - b.amountPaid > 0.005 && b.status !== 'cancelled' ? <span className="text-[#7a5a1f]"> · da saldare {money(b.total - b.amountPaid, 'it', 2)}</span> : ''}
            </span>
            {b.status !== 'cancelled' && b.amountPaid > 0 && (
              <span className="text-mist">
                Se annullata oggi: rimborso {money(b.refundIfCancelled, 'it', 2)} {b.freeCancel ? '(cancellazione gratuita)' : '(penale applicata)'}
              </span>
            )}
            <Link href={`/admin/prenotazioni?id=${b.id}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-navy hover:underline">
              Apri la prenotazione <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            {onDelete && <BinButton onClick={() => onDelete(b)} label={`Elimina la prenotazione ${b.code}`} className="h-8 w-8" />}
          </div>
        </motion.li>
      ))}
      {g.reviews.length > 0 && (
        <li className="rounded-2xl bg-ivory p-4">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-mist">Recensioni</p>
          {g.reviews.map((r, i) => (
            <div key={i} className="mt-2">
              <span className="flex gap-0.5 text-gold">
                {Array.from({ length: 5 }, (_, k) => (
                  <Star key={k} className="h-3.5 w-3.5" fill={k < r.rating ? 'currentColor' : 'none'} />
                ))}
              </span>
              <p className="mt-1 text-sm text-navy">“{r.comment}”</p>
            </div>
          ))}
        </li>
      )}
    </ul>
  );
}

function PaymentsTab({ g, onRefund }: { g: CardData; onRefund: (p: Pay) => void }) {
  if (!g.payments.length) return <p className="rounded-2xl bg-ivory p-5 text-sm text-mist">Nessun pagamento registrato per questo ospite.</p>;
  const inTotal = g.payments.filter((p) => p.status === 'succeeded' && p.amount > 0).reduce((s, p) => s + p.amount, 0);
  const outTotal = g.payments.filter((p) => p.status === 'succeeded' && p.amount < 0).reduce((s, p) => s - p.amount, 0);
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-sage/15 px-3 py-1.5 font-semibold text-[#3f5a35]">Incassato {money(inTotal, 'it', 2)}</span>
        {outTotal > 0 && <span className="rounded-full bg-terracotta/10 px-3 py-1.5 font-semibold text-terracotta">Rimborsato {money(outTotal, 'it', 2)}</span>}
        {g.stripe === 'test' && <span className="flex items-center gap-1 rounded-full bg-gold/15 px-3 py-1.5 font-semibold text-gold-2"><FlaskConical className="h-3.5 w-3.5" /> Stripe in modalità prova</span>}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {g.payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', p.amount < 0 ? 'bg-terracotta/10 text-terracotta' : 'bg-navy/[0.07] text-navy')}>{p.amount < 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-navy">
                {KIND[p.kind]} · {p.provider}
              </span>
              <span className="block truncate text-xs text-mist">
                {fmtDateTime(p.at)} · {p.code}
                {p.refundOf ? ' · di un pagamento precedente' : ''}
                {p.refunded > 0 ? ` · già rimborsati ${money(p.refunded, 'it', 2)}` : ''}
                {p.status !== 'succeeded' ? ` · ${p.status === 'failed' ? 'non riuscito' : 'in attesa'}` : ''}
              </span>
            </span>
            <span className={cn('shrink-0 text-right text-sm font-semibold tabular-nums', p.amount < 0 ? 'text-terracotta' : 'text-navy')}>{money(p.amount, 'it', 2)}</span>
            {p.refundVia === 'portal' && <span className="w-full text-right text-[0.7rem] text-mist sm:w-auto">rimborso dal portale</span>}
            {g.canRefund && p.refundable > 0 && (
              <Button size="sm" variant="line" onClick={() => onRefund(p)} className="shrink-0">
                <RotateCcw className="h-3.5 w-3.5" /> Rimborsa
              </Button>
            )}
            {p.kind !== 'refund' && p.amount > 0 && p.status === 'succeeded' && p.refundVia === 'unavailable' && p.refunded < p.amount && (
              <span className="w-full text-right text-[0.7rem] text-mist sm:w-auto">{p.providerKey === 'stripe' || p.providerKey === 'stripe_test' ? 'rimborso da Stripe (collegamento non attivo)' : 'nulla da rimborsare'}</span>
            )}
          </li>
        ))}
      </ul>
      {!g.canRefund && <p className="mt-3 text-xs text-mist">Solo l’amministratore può fare rimborsi.</p>}
    </div>
  );
}

const PILLS = [
  ['{nome}', 'Nome'],
  ['{camera}', 'Camera'],
  ['{arrivo}', 'Arrivo'],
  ['{partenza}', 'Partenza'],
  ['{codice}', 'Codice'],
] as const;

function MessagesTab({ g, compose, setCompose, onSent }: { g: CardData; compose: boolean; setCompose: (v: boolean) => void; onSent: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const live = g.bookings.filter((b) => b.status !== 'cancelled');
  const [kind, setKind] = useState<'messaggio' | 'conferma' | 'promemoria' | 'modifica'>('messaggio');
  const [bookingId, setBookingId] = useState(live[0]?.id ?? g.bookings[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(`Gentile {nome},\n\n`);
  const area = useRef<HTMLTextAreaElement>(null);
  const where = g.testAddress ? 'Indirizzo di prova: l’email resta nella Outbox, non viene spedita.' : g.mailer ? `Parte subito con ${MAILER[g.mailer] ?? g.mailer} e resta copia nella Outbox.` : 'Email non collegate: resta nella Outbox (Impostazioni → Collegamenti per spedirla).';
  const insert = (tok: string) => {
    const el = area.current;
    if (!el) return setBody((b) => b + tok);
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + tok + body.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + tok.length, s + tok.length);
    });
  };
  const send = () =>
    start(async () => {
      const r = await sendGuestEmailAction(kind === 'messaggio' ? { kind, email: g.email, bookingId: bookingId || null, subject, body } : { kind, bookingId }).catch(() => null);
      if (!r?.ok) return toast('error', r && !r.ok ? r.error : 'Email non creata.');
      const d = r.data as { to: string; delivered: boolean };
      toast('ok', d.delivered ? `Email inviata a ${d.to}.` : g.testAddress ? 'Email salvata nella Outbox (indirizzo di prova: non spedita).' : 'Email salvata nella Outbox.');
      setCompose(false);
      setSubject('');
      setBody('Gentile {nome},\n\n');
      onSent();
    });
  const canSend = kind === 'messaggio' ? subject.trim().length >= 2 && body.replace('Gentile {nome},', '').trim().length >= 2 : Boolean(bookingId);

  return (
    <div className="space-y-4">
      {!g.email ? (
        <p className="rounded-2xl bg-ivory p-4 text-sm text-mist">Questa prenotazione non ha un indirizzo email.</p>
      ) : !compose ? (
        <button type="button" onClick={() => setCompose(true)} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-navy/30 px-4 py-3.5 text-left text-sm font-semibold text-navy hover:border-navy">
          <Send className="h-4 w-4 text-gold-2" /> Scrivi un’email a {g.firstName || g.name}
        </button>
      ) : (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-line bg-ivory p-4" aria-label="Nuova email">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['messaggio', 'Messaggio personale'],
                ['conferma', 'Conferma'],
                ['promemoria', 'Promemoria arrivo'],
                ['modifica', 'Modifica'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn('h-8 rounded-full border px-3 text-xs font-semibold transition-colors', kind === k ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50')}>
                {l}
              </button>
            ))}
          </div>
          {g.bookings.length > 0 && (
            <label className="mt-3 block">
              <span className="label">Prenotazione</span>
              <NiceSelect
                className="w-full"
                label="Prenotazione"
                value={bookingId}
                onChange={setBookingId}
                options={g.bookings.map((b) => ({ value: b.id, label: `${b.code} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}`, hint: STATUS[b.status]!.label, dot: STATUS[b.status]!.tone === 'green' ? 'var(--color-sage)' : STATUS[b.status]!.tone === 'gold' ? 'var(--color-gold)' : '#b9b4ab' }))}
              />
            </label>
          )}
          {kind === 'messaggio' ? (
            <>
              <label className="mt-3 block">
                <span className="label">Oggetto</span>
                <input className="field py-2 text-sm" value={subject} maxLength={140} onChange={(e) => setSubject(e.target.value)} placeholder="Es. Il suo arrivo a L’Ancora" />
              </label>
              <label className="mt-3 block">
                <span className="label">Testo</span>
                <textarea ref={area} className="field text-sm" rows={6} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PILLS.map(([t, l]) => (
                  <button key={t} type="button" onClick={() => insert(t)} className="h-7 rounded-full border border-gold/50 bg-white px-2.5 text-[0.68rem] font-semibold text-navy hover:bg-gold/10">
                    + {l}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-mist">Il modello «{kind === 'conferma' ? 'Conferma prenotazione' : kind === 'promemoria' ? 'Promemoria arrivo' : 'Modifica prenotazione'}» con i dati della prenotazione scelta (lo vedi in Messaggi → Modelli).</p>
          )}
          <p className={cn('mt-3 flex items-start gap-2 text-xs', g.testAddress ? 'text-gold-2' : 'text-mist')}>
            {g.testAddress ? <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Inbox className="mt-0.5 h-3.5 w-3.5 shrink-0" />} {where}
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="line" size="sm" onClick={() => setCompose(false)}>
              Annulla
            </Button>
            <Button size="sm" disabled={pending || !canSend} onClick={send}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Invia a {g.email}
            </Button>
          </div>
        </motion.section>
      )}
      {g.messages.length === 0 ? (
        <p className="rounded-2xl bg-ivory p-5 text-sm text-mist">Nessun messaggio con questo ospite.</p>
      ) : (
        <ul className="space-y-2">
          {g.messages.map((m) => (
            <li key={m.id} className={cn('rounded-2xl border p-3.5', m.dir === 'in' ? 'border-gold/40 bg-gold/[0.05]' : 'border-line')}>
              <p className="flex flex-wrap items-center gap-2 text-[0.68rem] text-mist">
                {m.dir === 'in' ? <ArrowDownLeft className="h-3.5 w-3.5 text-gold-2" /> : <ArrowUpRight className="h-3.5 w-3.5 text-navy" />}
                <span className="font-semibold uppercase tracking-[0.1em]">{m.dir === 'in' ? 'Ricevuto' : 'Inviato'}</span> · {m.label} · {fmtDateTime(m.at)}
                <span className={cn('ml-auto rounded-full px-2 py-0.5 font-semibold', m.status.startsWith('non') ? 'bg-terracotta/10 text-terracotta' : m.status === 'da leggere' ? 'bg-gold/15 text-[#7a5a1f]' : 'bg-sand-2 text-charcoal')}>{m.status}</span>
              </p>
              <p className="mt-1.5 text-sm font-semibold text-navy">{m.subject}</p>
              <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-charcoal/80">{m.preview}</p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/admin/messaggi" className="inline-flex items-center gap-1 text-xs font-semibold text-navy hover:underline">
        Tutti i messaggi e la Outbox <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function NotesTab({ g, onSaved }: { g: CardData; onSaved: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-mist">Le note interne restano nel pannello: l’ospite non le vede.</p>
      {g.bookings.map((b) => (
        <NoteBox key={b.id} b={b} onSaved={onSaved} />
      ))}
    </div>
  );
}

function NoteBox({ b, onSaved }: { b: CardData['bookings'][number]; onSaved: () => void }) {
  const [notes, setNotes] = useState(b.notes);
  const { run, pending } = useAction();
  return (
    <div className="rounded-2xl border border-line p-3.5">
      <p className="text-xs font-semibold text-navy">
        {b.code} · {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)}
      </p>
      {b.specialRequests && <p className="mt-2 border-l-2 border-gold pl-3 text-xs text-charcoal/85">Richieste dell’ospite: {b.specialRequests}</p>}
      <label className="mt-2 block">
        <span className="sr-only">Note interne {b.code}</span>
        <textarea className="field text-sm" rows={2} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} placeholder="Nessuna nota" />
      </label>
      {notes !== b.notes && (
        <Button size="sm" variant="line" className="mt-2" disabled={pending} onClick={() => run(() => notesAction(b.id, notes), { onOk: onSaved })}>
          Salva nota
        </Button>
      )}
    </div>
  );
}

function HistoryTab({ g, onGdpr }: { g: CardData; onGdpr: () => void }) {
  const exportGuest = () => {
    const blob = new Blob([JSON.stringify({ esportato: new Date().toISOString(), titolare: 'Hotel L’Ancora', interessato: g }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dati-ospite-${(g.email || g.key).replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-5">
      {g.history.length === 0 ? (
        <p className="rounded-2xl bg-ivory p-5 text-sm text-mist">Nessuna operazione registrata.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-5">
          {g.history.map((h) => (
            <li key={h.id} className="relative">
              <span className={cn('absolute -left-[1.6rem] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white', h.action === 'Rimborso' ? 'bg-terracotta' : h.action === 'Email' ? 'bg-gold' : 'bg-navy')} />
              <p className="text-[0.68rem] text-mist">
                {fmtDateTime(h.at)} · {h.actor}
              </p>
              <p className="text-sm text-navy">
                <strong className="font-semibold">{h.action}</strong> · {h.details}
              </p>
            </li>
          ))}
        </ol>
      )}
      <div className="rounded-2xl bg-ivory p-4 text-sm text-charcoal/85">
        <p className="flex items-start gap-2">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-sage" /> Privacy (GDPR): l’ospite può chiedere una copia dei suoi dati (art. 15/20) o la cancellazione (art. 17).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="line" onClick={exportGuest}>
            <Download className="h-3.5 w-3.5" /> Scarica i dati (JSON)
          </Button>
          {g.canGdpr && g.email && (
            <Button size="sm" variant="danger" onClick={onGdpr}>
              <UserX className="h-3.5 w-3.5" /> Anonimizza
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- refund: choose, then confirm ---------------- */

function RefundDialog({ g, pay, onClose, onDone }: { g: CardData; pay: Pay; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<'choose' | 'confirm'>('choose');
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [partial, setPartial] = useState<number | null>(Math.round(pay.refundable * 50) / 100);
  const [notify, setNotify] = useState(Boolean(g.email));
  const b = g.bookings.find((x) => x.id === pay.bookingId);
  const amount = mode === 'full' ? pay.refundable : Math.round((partial ?? 0) * 100) / 100;
  const valid = amount > 0 && amount <= pay.refundable + 0.004;
  const how =
    pay.refundVia === 'stripe'
      ? g.stripe === 'test'
        ? 'Stripe, modalità prova: il rimborso viene creato su Stripe (nessun denaro reale si muove).'
        : 'Parte subito e torna sulla stessa carta con cui l’ospite ha pagato: di solito la vede in 5–10 giorni lavorativi (se il pagamento è di pochi giorni fa, spesso prima).'
      : pay.refundVia === 'simulation'
        ? 'Pagamento simulato (demo): il rimborso viene solo registrato.'
        : `${pay.provider}: il rimborso viene registrato, i soldi li restituisci tu all’ospite.`;
  const go = () =>
    start(async () => {
      const r = await refundGuestPaymentAction({ paymentId: pay.id, amount, notifyGuest: notify }).catch(() => null);
      if (!r?.ok) return toast('error', r && !r.ok ? r.error : 'Rimborso non riuscito.');
      const d = r.data as { amount: number; full: boolean; via: string; code: string };
      toast('ok', `Rimborso ${d.full ? 'totale' : 'parziale'} di ${money(d.amount, 'it', 2)} registrato (${d.code})${d.via === 'stripe' ? ' su Stripe' : ''}. Lo trovi nello storico.`);
      onDone();
    });
  const summary = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl bg-white p-4 text-sm ring-1 ring-line">
      <dt className="text-mist">Ospite</dt>
      <dd className="text-navy">{g.name}</dd>
      <dt className="text-mist">Prenotazione</dt>
      <dd className="text-navy">
        {pay.code}
        {b ? ` · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}` : ''}
      </dd>
      <dt className="text-mist">Pagamento</dt>
      <dd className="text-navy">
        {KIND[pay.kind]} · {pay.provider} · {money(pay.amount, 'it', 2)} del {fmtDateTime(pay.at)}
      </dd>
      {pay.refunded > 0 && (
        <>
          <dt className="text-mist">Già rimborsati</dt>
          <dd className="text-navy">{money(pay.refunded, 'it', 2)}</dd>
        </>
      )}
      <dt className="text-mist">Rimborsabile</dt>
      <dd className="font-semibold text-navy">{money(pay.refundable, 'it', 2)}</dd>
    </dl>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={step === 'choose' ? 'Rimborso' : 'Confermi il rimborso?'}
      width={560}
      footer={
        step === 'choose' ? (
          <>
            <Button variant="line" onClick={onClose}>
              Annulla
            </Button>
            <Button disabled={!valid} onClick={() => setStep('confirm')}>
              Continua
            </Button>
          </>
        ) : (
          <>
            <Button variant="line" disabled={pending} onClick={() => setStep('choose')}>
              Indietro
            </Button>
            <Button variant="danger" disabled={pending || !valid} onClick={go}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptEuro className="h-4 w-4" />} Conferma rimborso di {money(amount, 'it', 2)}
            </Button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === 'choose' ? (
          <motion.div key="choose" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="space-y-4">
            {summary}
            <div role="radiogroup" aria-label="Tipo di rimborso" className="grid grid-cols-2 gap-2">
              {(
                [
                  ['full', 'Totale', money(pay.refundable, 'it', 2)],
                  ['partial', 'Parziale', 'scegli l’importo'],
                ] as const
              ).map(([k, l, d]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cn('rounded-2xl border p-3.5 text-left transition-colors', mode === k ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/40')}>
                  <span className="block text-sm font-semibold">{l}</span>
                  <span className={cn('block text-xs', mode === k ? 'text-ivory/70' : 'text-mist')}>{d}</span>
                </button>
              ))}
            </div>
            {mode === 'partial' && (
              <label className="block">
                <span className="label">Importo da rimborsare (€)</span>
                <NumInput className="field" min={0.01} max={pay.refundable} value={partial} allowEmpty onChange={setPartial} aria-label="Importo da rimborsare" />
                {!valid && <span className="mt-1 block text-xs text-terracotta">Tra 0,01 € e {money(pay.refundable, 'it', 2)}.</span>}
              </label>
            )}
            {b && b.status !== 'cancelled' && (
              <p className="text-xs text-mist">
                Regola di cancellazione: se la prenotazione fosse annullata oggi, il rimborso previsto sarebbe {money(b.refundIfCancelled, 'it', 2)}. Il rimborso non annulla la prenotazione.
              </p>
            )}
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-line">
              <span className="text-sm text-navy">
                Avvisa l’ospite via email
                <span className="block text-xs text-mist">{g.email ? (g.testAddress ? 'indirizzo di prova: resta nella Outbox' : g.email) : 'nessun indirizzo email'}</span>
              </span>
              <Toggle checked={notify} disabled={!g.email} onChange={setNotify} label="Avvisa l’ospite via email" />
            </label>
            <p className="flex items-start gap-2 text-xs text-mist">
              <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {how}
            </p>
          </motion.div>
        ) : (
          <motion.div key="confirm" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} className="space-y-4">
            <div className="rounded-2xl bg-terracotta/[0.07] p-4 text-center ring-1 ring-terracotta/20">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-terracotta">Rimborso {mode === 'full' ? 'totale' : 'parziale'}</p>
              <p className="serif mt-1 text-[2.6rem] leading-none text-navy">{money(amount, 'it', 2)}</p>
              <p className="mt-1 text-xs text-mist">{mode === 'full' ? 'tutto quanto resta di questo pagamento' : `su ${money(pay.refundable, 'it', 2)} rimborsabili`}</p>
            </div>
            {summary}
            <ul className="space-y-1.5 text-xs text-charcoal/85">
              <li>· {how}</li>
              <li>· {notify && g.email ? `L’ospite riceve l’email «Conferma rimborso»${g.testAddress ? ' (indirizzo di prova: resta nella Outbox)' : ''}.` : 'Nessuna email all’ospite.'}</li>
              <li>· L’operazione viene scritta nello storico con il tuo nome e non si può annullare.</li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
}

function GdprDialog({ open, name, email, onClose, onDone }: { open: boolean; name: string; email: string; onClose: () => void; onDone: () => void }) {
  const { run, pending } = useAction();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Anonimizzare l’ospite?"
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="danger" disabled={pending} onClick={() => run(() => anonymizeGuestAction(email), { onOk: onDone })}>
            Anonimizza
          </Button>
        </>
      }
    >
      <p className="text-sm text-charcoal/85">Nome, email, telefono e note di {name} verranno sostituiti in tutte le prenotazioni. Restano solo i dati contabili anonimi. Operazione non reversibile.</p>
    </Dialog>
  );
}

/** Opens the card from a list item without nesting buttons in links (used by the Clienti grid). */
export function useOpenGuest() {
  const open = useGuestCard();
  return useMemo(() => (email: string) => open({ email }), [open]);
}
