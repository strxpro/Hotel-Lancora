'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { TaxLine } from './tax-line';
import type { TaxQuote } from '@/lib/tourist-tax';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import type { StripeEmbeddedCheckout } from '@stripe/stripe-js';
import { AlertCircle, Banknote, Check, ChevronDown, Clock, CreditCard, FlaskConical, Lock, ShieldCheck, Tag } from 'lucide-react';
import type { AvailabilityResponse, RoomCardData, RoomResult } from '@/lib/room-card';
import type { StayQuote } from '@/lib/availability';
import { fmtDate, fmtDateLong, diffDays } from '@/lib/dates';
import { fill, plural } from '@/lib/i18n/config';
import { cn, money } from '@/lib/utils';
import { useI18n, useIsDesktop, useLenis, scrollToTarget } from '../providers';
import { cancelText } from '@/lib/cancellation';
import { RangeCalendar } from './calendar';
import { GuestSelector } from './guests';
import { queryToParams, type StayQuery } from './query';
import { ChooseRoom } from './choose-room';
import { openLegal } from '../legal-dialog';
import { createReservation, payAtHotel, simulatePayment, startCashGuarantee, startStripeCheckout } from '@/app/[locale]/prenotazione/actions';
import { CARE_T } from '@/lib/i18n/care-dict';

type QuoteResponse = { available: boolean; reason: 'capacity' | 'occupied' | null; quote: StayQuote; dueNow: number; promoValid: boolean; promoRequested: boolean; cashPercent?: number; touristTax?: TaxQuote | null };
type Hold = { bookingId: string; token: string; code: string; dueNow: number; total: number; holdExpiresAt: string };
type Payments = { mode: 'full' | 'deposit_percent' | 'deposit_fixed'; depositPercent: number; depositFixed: number; cancellationPolicy: string; holdMinutes: number; freeCancellationDays: number; cancellationFee?: { type: 'percent' | 'first_night' | 'fixed'; value: number } };

const EASE = [0.22, 0.61, 0.12, 1] as const;

export function BookingFlow({
  today,
  initialQuery,
  rooms,
  initialRoomSlug,
  payments,
  provider,
  stripeKey = null,
  cash = { enabled: false, percent: 0 },
  online = true,
}: {
  today: string;
  initialQuery: StayQuery;
  rooms: RoomCardData[];
  initialRoomSlug: string | null;
  payments: Payments;
  provider: 'stripe' | 'simulated';
  stripeKey?: string | null;
  cash?: { enabled: boolean; percent: number; guarantee?: boolean };
  /** false = the hotel only takes payment at the property */
  online?: boolean;
}) {
  const [method, setMethod] = useState<'card' | 'cash'>(online || !cash.enabled ? 'card' : 'cash');
  const { t, locale, href } = useI18n();
  const router = useRouter();
  const desktop = useIsDesktop();
  const lenis = useLenis();
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState<StayQuery>(initialQuery);
  const [available, setAvailable] = useState<RoomResult[] | null>(null);
  const [roomSlug, setRoomSlug] = useState<string | null>(initialRoomSlug);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', specialRequests: '', privacy: false, terms: false, marketing: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hold, setHold] = useState<Hold | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  const room = useMemo(() => rooms.find((r) => r.slug === roomSlug) ?? null, [rooms, roomSlug]);
  const hasDates = Boolean(query.checkIn && query.checkOut);
  const guests = query.adults + query.children;

  const go = useCallback(
    (s: number) => {
      setMessage(null);
      setStep(s);
      scrollToTarget(lenis.current, '#prenotazione-top', -100);
    },
    [lenis],
  );

  const loadAvailability = useCallback(
    async (q: StayQuery) => {
      const p = queryToParams(q);
      p.set('locale', locale);
      const r = await fetch(`/api/availability?${p}`, { cache: 'no-store' });
      const data = (await r.json()) as AvailabilityResponse;
      setAvailable(data.results);
      return data.results;
    },
    [locale],
  );

  const loadQuote = useCallback(async (slug: string, q: StayQuery, promoCode: string | null) => {
    if (!q.checkIn || !q.checkOut) return null;
    const p = queryToParams(q);
    p.set('room', slug);
    if (promoCode) p.set('promo', promoCode);
    const r = await fetch(`/api/quote?${p}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const data = (await r.json()) as QuoteResponse;
    setQuote(data);
    return data;
  }, []);

  // initial step from the URL
  useEffect(() => {
    (async () => {
      if (!initialQuery.checkIn || !initialQuery.checkOut) return;
      if (initialRoomSlug) {
        const q = await loadQuote(initialRoomSlug, initialQuery, null);
        if (q?.available) return setStep(2);
        await loadAvailability(initialQuery);
        setMessage(q?.reason === 'capacity' ? t.booking.noRooms : t.room.unavailableStay);
        return setStep(1);
      }
      await loadAvailability(initialQuery);
      setStep(1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // once the room is held for this guest the price is fixed: asking again would see our own hold as "occupied"
    if (roomSlug && hasDates && step >= 1 && !hold) loadQuote(roomSlug, query, promo);
  }, [roomSlug, query, promo, hasDates, step, loadQuote, hold]);

  useEffect(() => {
    if (!hold) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hold]);

  const remaining = hold ? Math.max(0, new Date(hold.holdExpiresAt).getTime() - now) : 0;
  useEffect(() => {
    if (hold && remaining === 0) {
      setHold(null);
      setMessage(t.booking.expired);
      setStep(1);
    }
  }, [remaining, hold, t.booking.expired]);

  const searchFrom = async (q: StayQuery) => {
    setQuery(q);
    if (!q.checkIn || !q.checkOut) return setMessage(t.search.pickArrival);
    setMessage(null);
    setBusy(true);
    const list = await loadAvailability(q);
    setBusy(false);
    window.history.replaceState(null, '', `${window.location.pathname}?${queryToParams(q)}`);
    if (roomSlug && !list.some((r) => r.room.slug === roomSlug)) setRoomSlug(null);
    setStep(1);
  };

  const searchStep = async () => {
    if (!hasDates) return setMessage(t.search.pickArrival);
    setBusy(true);
    const list = await loadAvailability(query);
    setBusy(false);
    window.history.replaceState(null, '', `${window.location.pathname}?${queryToParams(query)}`);
    if (roomSlug && list.some((r) => r.room.slug === roomSlug)) go(2);
    else {
      setRoomSlug(null);
      go(1);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = t.booking.required;
    if (!form.lastName.trim()) e.lastName = t.booking.required;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) e.email = t.booking.invalidEmail;
    if (form.phone.replace(/\D/g, '').length < 6) e.phone = t.booking.required;
    if (!form.privacy) e.privacy = t.booking.required;
    if (!form.terms) e.terms = t.booking.required;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const reserve = () => {
    if (!validate() || !room || !query.checkIn || !query.checkOut) return;
    startTransition(async () => {
      const res = await createReservation({
        locale,
        roomId: room.id,
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        adults: query.adults,
        children: query.children,
        childrenAges: query.childrenAges,
        ...form,
        privacy: true,
        terms: true,
        promoCode: promo,
      });
      if (!res.ok) {
        setMessage(res.code === 'conflict' ? t.booking.conflict : res.error);
        if (res.code === 'conflict') {
          await loadAvailability(query);
          setRoomSlug(null);
          go(1);
        }
        return;
      }
      setHold(res);
      go(3);
    });
  };

  // the room's own rule (card only / cash only / both) on top of the hotel's
  const canCard = online && (room?.pay?.card ?? true);
  const canCash = cash.enabled && (room?.pay?.cash ?? true);
  // the season's own cash prices of these nights, when the hotel set them
  const cashPct = canCash ? (quote?.cashPercent ?? room?.cashPercent ?? cash.percent) : 0;
  const cashTotal = hold ? Math.round(hold.total * (1 - cashPct / 100) * 100) / 100 : 0;
  const confirmCash = () => {
    if (!hold) return;
    startTransition(async () => {
      const r = await payAtHotel(hold.token);
      if (r.ok) router.push(href(`/prenotazione/conferma?t=${hold.token}`));
      else if (r.error === 'guarantee') {
        // the card as a guarantee, on the secure page: back on the confirmation page
        const g = await startCashGuarantee(hold.token, locale);
        if (g.ok) window.location.assign(g.url);
        else setMessage(g.error);
      } else setMessage(r.error);
    });
  };

  const pay = (outcome: 'success' | 'failure') => {
    if (!hold) return;
    startTransition(async () => {
      if (provider === 'stripe') {
        const r = await startStripeCheckout(hold.token, locale);
        if (r.ok && r.url) window.location.assign(r.url);
        else setMessage(r.ok ? 'Stripe' : r.error);
        return;
      }
      const r = await simulatePayment(hold.token, outcome);
      if (r.ok) router.push(href(`/prenotazione/conferma?t=${hold.token}`));
      else setMessage(r.error === 'failed' ? t.booking.failed : r.error);
    });
  };

  const steps = t.booking.steps;
  const field = (k: keyof typeof form, label: string, type = 'text', auto?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type={type}
        autoComplete={auto}
        value={form[k] as string}
        aria-invalid={Boolean(errors[k])}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="field"
        required
      />
      {errors[k] && <span className="mt-1 block text-xs text-terracotta">{errors[k]}</span>}
    </label>
  );

  const summary = <Summary room={room} query={query} quote={quote} hold={hold} payments={payments} promoInput={promoInput} setPromoInput={setPromoInput} applyPromo={() => setPromo(promoInput.trim() || null)} canPromo={step === 2 && !hold} guests={guests} cashPercent={cashPct} method={step === 3 ? method : 'card'} />;

  return (
    <div id="prenotazione-top" className="grid gap-10 [&>*]:min-w-0 md:grid-cols-12 md:gap-8 lg:gap-14">
      {/* guest data and payment sit beside the summary from tablet width up, so what you book and what you type are on the same screen */}
        {/* step indicator: full width above the form and the summary */}
        <ol className="grid grid-cols-5 gap-2 md:col-span-12 md:mb-2" aria-label={t.booking.title}>
          {steps.map((label, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <li key={label} className="min-w-0">
                <button type="button" disabled={!done || i >= 3 || Boolean(hold)} onClick={() => go(i)} className="group w-full text-left disabled:cursor-default" aria-current={current ? 'step' : undefined}>
                  <span className="relative block h-px w-full bg-line">
                    <motion.span className="absolute inset-y-0 left-0 bg-navy" initial={false} animate={{ width: done ? '100%' : current ? '50%' : '0%' }} transition={{ duration: 0.8, ease: EASE }} />
                  </span>
                  <span className={cn('mt-3 flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em]', current ? 'text-navy' : done ? 'text-navy/70 group-hover:text-navy' : 'text-mist/70')}>
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.6rem]', done ? 'border-navy bg-navy text-ivory' : current ? 'border-navy' : 'border-line')}>{done ? <Check className="h-3 w-3" /> : i + 1}</span>
                    <span className="hidden truncate sm:block">{label}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

      <div className={step <= 1 ? 'md:col-span-12' : 'md:col-span-7 xl:col-span-8'}>
        <AnimatePresence>
          {message && (
            <motion.p role="alert" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-8 flex items-start gap-3 border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-sm text-terracotta">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {message}
            </motion.p>
          )}
        </AnimatePresence>

        {step >= 2 && <MobileSummary room={room} query={query} total={hold?.total ?? quote?.quote.total ?? null} guests={guests}>{summary}</MobileSummary>}

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.45, ease: EASE }}>
            {step <= 1 && (
              <ChooseRoom
                query={query}
                onQuery={setQuery}
                onSearch={searchFrom}
                today={today}
                busy={busy}
                rooms={rooms}
                available={available}
                selected={roomSlug}
                cashPercent={cash.enabled ? cash.percent : 0}
                onPick={(slug) => {
                  setRoomSlug(slug);
                  go(2);
                }}
              />
            )}

            {step === 2 && (
              <section aria-labelledby="s2">
                <h2 id="s2" className="serif text-[2.4rem] leading-tight text-navy">
                  {steps[2]}
                </h2>
                <form
                  className="mt-8 grid gap-5 sm:grid-cols-2"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    reserve();
                  }}
                >
                  {field('firstName', t.booking.firstName, 'text', 'given-name')}
                  {field('lastName', t.booking.lastName, 'text', 'family-name')}
                  {field('email', t.booking.email, 'email', 'email')}
                  {field('phone', t.booking.phone, 'tel', 'tel')}
                  <label className="block sm:col-span-2">
                    <span className="label">{t.booking.requests}</span>
                    <textarea rows={3} maxLength={1000} placeholder={t.booking.requestsHint} value={form.specialRequests} onChange={(e) => setForm({ ...form, specialRequests: e.target.value })} className="field resize-y" />
                  </label>
                  <div className="space-y-3 sm:col-span-2">
                    {(['privacy', 'terms', 'marketing'] as const).map((k) => (
                      <label key={k} className="flex cursor-pointer items-start gap-3 text-sm text-charcoal/85">
                        <input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--color-navy)]" aria-invalid={Boolean(errors[k])} />
                        <span>
                          {t.booking[k]}
                          {k === 'privacy' && (
                            <>
                              {' '}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  openLegal('privacy', e.currentTarget);
                                }}
                                className="underline decoration-gold underline-offset-2"
                              >
                                (Privacy)
                              </button>
                            </>
                          )}
                          {errors[k] && <span className="ml-2 text-xs text-terracotta">{errors[k]}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-col-reverse gap-4 pt-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" className="link-u self-start text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-mist" onClick={() => go(1)}>
                      {t.booking.back}
                    </button>
                    <button type="submit" disabled={pending || !quote?.available} className="btn btn-navy w-full sm:w-auto">
                      {pending ? t.booking.processing : t.booking.continue}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {step === 3 && hold && (
              <section aria-labelledby="s3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <h2 id="s3" className="serif text-[2.4rem] leading-tight text-navy">
                    {t.booking.payTitle}
                  </h2>
                  <p className="flex items-center gap-2 rounded-full bg-sand-2 px-3.5 py-1.5 text-xs text-navy" aria-live="off">
                    <Clock className="h-3.5 w-3.5" /> {fill(t.booking.hold, { min: Math.ceil(remaining / 60000) })} · <span className="tabular-nums">{String(Math.floor(remaining / 60000)).padStart(2, '0')}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}</span>
                  </p>
                </div>

                <p className="label mt-8">{t.booking.pay.method}</p>
                <div role="radiogroup" aria-label={t.booking.pay.method} className={cn('grid gap-3', canCash && canCard && 'sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2')}>
                  {canCard && <MethodOption active={method === 'card'} onSelect={() => setMethod('card')} icon={CreditCard} title={t.booking.pay.card} note={t.booking.pay.cardNote} price={money(hold.total, locale, 2)} />}
                  {canCash && (
                    <MethodOption
                      active={method === 'cash'}
                      onSelect={() => setMethod('cash')}
                      icon={Banknote}
                      title={t.booking.pay.cash}
                      note={t.booking.pay.cashNote}
                      price={money(cashTotal, locale, 2)}
                      big
                      badge={cashPct > 0 ? fill(t.booking.pay.save, { amount: money(hold.total - cashTotal, locale, 2) }) : undefined}
                    />
                  )}
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  {method === 'card' ? (
                    <motion.div key="card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4, ease: EASE }} className="mt-6 overflow-hidden rounded-[1.75rem] border border-line bg-white">
                      <div className="grid items-center gap-6 bg-[radial-gradient(120%_120%_at_100%_0%,rgba(201,169,110,0.16),transparent_55%)] p-6 sm:grid-cols-[1fr_auto] md:p-8">
                        <div>
                          <p className="eyebrow text-mist">{t.booking.dueNow}</p>
                          <p className="serif mt-1 text-[2.6rem] leading-none text-navy">{money(hold.dueNow, locale, 2)}</p>
                          {hold.total - hold.dueNow > 0 && (
                            <p className="mt-2 text-xs text-mist">
                              {t.booking.dueLater}: {money(hold.total - hold.dueNow, locale, 2)}
                            </p>
                          )}
                          <p className="mt-4 flex items-center gap-2 text-xs text-sage">
                            <ShieldCheck className="h-4 w-4" /> {t.booking.pay.secure}
                          </p>
                        </div>
                        <CardVisual name={`${form.firstName} ${form.lastName}`.trim()} amount={money(hold.dueNow, locale, 2)} simulated={provider === 'simulated'} />
                      </div>
                      <div className="border-t border-line p-6 md:p-8">
                        {provider === 'stripe' && stripeKey ? (
                          <EmbeddedPay pk={stripeKey} token={hold.token} locale={locale} onError={setMessage} />
                        ) : provider === 'stripe' ? (
                          <>
                            <button type="button" onClick={() => pay('success')} disabled={pending} className="btn btn-navy w-full">
                              <Lock className="h-4 w-4" /> {pending ? t.booking.processing : `${t.booking.payStripe} · ${money(hold.dueNow, locale, 2)}`}
                            </button>
                            <p className="mt-3 text-xs text-mist">{t.booking.stripeNote}</p>
                          </>
                        ) : (
                          <>
                            <p className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-sand-2/50 p-4 text-sm text-charcoal/85">
                              <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-gold-2" />
                              <span>
                                <strong className="font-semibold">{t.booking.simTitle}.</strong> {t.booking.simNote}
                              </span>
                            </p>
                            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                              <button type="button" onClick={() => pay('success')} disabled={pending} className="btn btn-navy flex-1">
                                <Lock className="h-4 w-4" /> {pending ? t.booking.processing : t.booking.simOk}
                              </button>
                              <button type="button" onClick={() => pay('failure')} disabled={pending} className="btn btn-line flex-1 text-navy">
                                {t.booking.simFail}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div key="cash" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.4, ease: EASE }} className="mt-6 overflow-hidden rounded-[1.75rem] border border-line bg-white">
                      <div className="flex items-start gap-5 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(122,140,110,0.16),transparent_55%)] p-6 md:p-8">
                        <motion.span initial={{ rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sage/15 text-sage">
                          <Banknote className="h-7 w-7" />
                        </motion.span>
                        <div>
                          <p className="eyebrow text-mist">{t.booking.pay.priceCash}</p>
                          <p className="serif mt-1 text-[2.6rem] leading-none text-navy">{money(cashTotal, locale, 2)}</p>
                          {cashPct > 0 && <p className="mt-2 text-xs text-mist line-through">{money(hold.total, locale, 2)}</p>}
                          <p className="mt-4 max-w-md text-sm leading-relaxed text-charcoal/80">{fill(t.booking.pay.cashInfo, { amount: money(cashTotal, locale, 2) })}</p>
                          <p className="mt-2 text-xs text-mist">{t.booking.pay.cashLegal}</p>
                          {cash.guarantee && <p className="mt-3 max-w-md rounded-xl bg-ivory px-3 py-2 text-xs leading-relaxed text-charcoal/80">{CARE_T[locale].guarantee}</p>}
                        </div>
                      </div>
                      <div className="border-t border-line p-6 md:p-8">
                        <button type="button" onClick={confirmCash} disabled={pending} className="btn btn-navy w-full">
                          <Check className="h-4 w-4" /> {pending ? t.booking.processing : cash.guarantee ? CARE_T[locale].guaranteeButton : t.booking.pay.confirmCash}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <p className="mt-6 text-sm leading-relaxed text-charcoal/70">
                  <strong className="font-semibold text-navy">{t.booking.policy}:</strong> {cancelText(locale, payments, { checkIn: query.checkIn, total: hold?.total ?? null, nights: query.checkIn && query.checkOut ? diffDays(query.checkIn, query.checkOut) : null, bookedAt: new Date().toISOString() })} {payments.cancellationPolicy}
                </p>
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <aside className={step <= 1 ? 'hidden' : 'hidden md:col-span-5 md:block xl:col-span-4'}>{summary}</aside>
    </div>
  );
}

/** Phones: one tidy line (photo, room, dates, total) above the form; tap it for the full summary and the promo code. */
function MobileSummary({ room, query, total, guests, children }: { room: RoomCardData | null; query: StayQuery; total: number | null; guests: number; children: ReactNode }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const photo = room?.photos[0] ?? room?.photo ?? null;
  const d = (iso: string | null) => (iso ? fmtDate(iso, locale, { day: 'numeric', month: 'short' }) : '—');
  return (
    <div className="mb-8 md:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 rounded-[1.4rem] border border-line bg-white p-3 text-left shadow-[0_12px_30px_-24px_rgba(16,40,61,0.5)]">
        {photo && (
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sand">
            <Image src={photo.src} alt="" fill sizes="56px" className="object-cover" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="eyebrow block text-[0.58rem] text-gold-2">{t.booking.summary}</span>
          <span className="serif block truncate text-lg leading-tight text-navy">{room?.name ?? '—'}</span>
          <span className="block truncate text-xs text-mist">
            {d(query.checkIn)} → {d(query.checkOut)} · {plural(locale, guests, t.search.guestsCount)}
          </span>
        </span>
        <span className="serif shrink-0 text-xl text-navy">{total !== null ? money(total, locale) : ''}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-mist transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Summary({ room, query, quote, hold, payments, promoInput, setPromoInput, applyPromo, canPromo, guests, cashPercent, method }: { room: RoomCardData | null; query: StayQuery; quote: QuoteResponse | null; hold: Hold | null; payments: Payments; promoInput: string; setPromoInput: (s: string) => void; applyPromo: () => void; canPromo: boolean; guests: number; cashPercent: number; method: 'card' | 'cash' }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const q = quote?.quote;
  const total = hold?.total ?? q?.total ?? null;
  const cashTotal = total !== null && cashPercent > 0 ? Math.round(total * (1 - cashPercent / 100) * 100) / 100 : null;
  const dueNow = hold?.dueNow ?? quote?.dueNow ?? null;
  const showCash = method === 'cash' && cashTotal !== null;
  return (
    <div className="overflow-clip rounded-[1.75rem] border border-line bg-white md:sticky md:top-28">
      {room && <PhotoCarousel key={room.id} photos={room.photos.length ? room.photos : room.photo ? [room.photo] : []} />}
      <div className="p-6">
        <p className="eyebrow text-gold-2">{t.booking.summary}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={room?.id ?? 'none'} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35 }} className="serif mt-2 text-[1.9rem] leading-tight text-navy">
            {room ? room.name : '—'}
          </motion.p>
        </AnimatePresence>
        {room && <p className="mt-1 text-xs text-mist">{room.number ? `N° ${room.number} · ` : ''}{t.roomTypes[room.type]} · {t.floor[room.floor]}</p>}
        <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-line py-5 text-sm">
          <div>
            <dt className="label mb-1">{t.search.arrival}</dt>
            <dd className="text-navy">{query.checkIn ? fmtDateLong(query.checkIn, locale) : '—'}</dd>
          </div>
          <div>
            <dt className="label mb-1">{t.search.departure}</dt>
            <dd className="text-navy">{query.checkOut ? fmtDateLong(query.checkOut, locale) : '—'}</dd>
          </div>
          <div>
            <dt className="label mb-1">{t.search.guests}</dt>
            <dd className="text-navy">{plural(locale, guests, t.search.guestsCount)}</dd>
          </div>
          <div>
            <dt className="label mb-1">{t.booking.nights.other.replace('{n} ', '')}</dt>
            <dd className="text-navy">{q?.nights ?? '—'}</dd>
          </div>
        </dl>
        {q && (
          <div className="pt-4">
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-xs text-mist" aria-expanded={open}>
              <span>
                {plural(locale, q.nights, t.booking.nights)} · {money(q.averageNight, locale)} {t.booking.perNightAvg}
              </span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden text-xs text-charcoal/75">
                  {q.perNight.map((n) => (
                    <li key={n.date} className="flex justify-between py-1">
                      <span>{fmtDate(n.date, locale, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <span>{money(n.price, locale, 2)}</span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
            {q.discount > 0 && (
              <p className="mt-3 flex justify-between text-sm text-sage">
                <span>
                  {t.booking.discount} {q.promo?.code} (−{q.promo?.percent}%)
                </span>
                <span>−{money(q.discount, locale, 2)}</span>
              </p>
            )}
          </div>
        )}
        {canPromo && (
          <div className="mt-5 flex gap-2">
            <label className="sr-only" htmlFor="promo">
              {t.booking.promo}
            </label>
            <div className="relative flex-1">
              <Tag className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist" />
              <input id="promo" value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} placeholder={t.booking.promo} className="field py-2.5 pl-9 text-sm uppercase" />
            </div>
            <button type="button" onClick={applyPromo} className="btn btn-line h-auto min-h-0 px-4 text-navy">
              {t.booking.apply}
            </button>
          </div>
        )}
        {quote?.promoRequested && !quote.promoValid && canPromo && <p className="mt-2 text-xs text-terracotta">Codice non valido per queste date.</p>}
        <div className="mt-6 flex items-end justify-between border-t border-line pt-5">
          <span className="eyebrow text-mist">{t.booking.total}</span>
          <span className="serif text-[2.2rem] leading-none text-navy">{total !== null ? money(showCash ? cashTotal! : total, locale, 2) : '—'}</span>
        </div>
        {total !== null && cashTotal !== null && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <p className={cn('rounded-2xl border px-3 py-2 transition-colors', !showCash ? 'border-navy bg-navy text-ivory' : 'border-line text-mist')}>
              <span className="flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5" /> {t.booking.pay.priceCard}
              </span>
              <span className="serif mt-1 block text-[1.3rem] leading-none">{money(total, locale, 2)}</span>
            </p>
            <p className={cn('rounded-2xl border px-3 py-2 transition-colors', showCash ? 'border-sage bg-sage text-ivory' : 'border-sage/30 bg-sage/10 text-[#3f5a35]')}>
              <span className="flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5" /> {t.booking.pay.priceCash} −{Math.round(cashPercent)}%
              </span>
              <span className="serif mt-1 block text-[1.5rem] leading-none">{money(cashTotal, locale, 2)}</span>
            </p>
          </div>
        )}
        {quote?.touristTax && <TaxLine className="mt-3" tax={quote.touristTax} />}
        {!showCash && dueNow !== null && total !== null && (
          <div className="mt-3 space-y-1 text-sm">
            <p className="flex justify-between text-navy">
              <span>{t.booking.dueNow}</span>
              <span>{money(dueNow, locale, 2)}</span>
            </p>
            {total - dueNow > 0 && (
              <p className="flex justify-between text-mist">
                <span>{t.booking.dueLater}</span>
                <span>{money(total - dueNow, locale, 2)}</span>
              </p>
            )}
          </div>
        )}
        {quote && !quote.available && !hold && <p className="mt-4 text-sm text-terracotta">{t.room.unavailableStay}</p>}
        <p className="mt-5 text-xs leading-relaxed text-mist">
          {cancelText(locale, payments, { checkIn: query.checkIn, total: hold?.total ?? quote?.quote.total ?? null, nights: query.checkIn && query.checkOut ? diffDays(query.checkIn, query.checkOut) : null, bookedAt: new Date().toISOString() })} {payments.cancellationPolicy}
        </p>
      </div>
    </div>
  );
}

/** Swipeable, auto-advancing photo strip for the booking summary (crossfade + slow zoom). */
function PhotoCarousel({ photos }: { photos: { src: string; alt: string }[] }) {
  const [i, setI] = useState(0);
  const n = photos.length;
  useEffect(() => {
    if (n < 2) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % n), 4500);
    return () => window.clearInterval(id);
  }, [n]);
  if (!n) return null;
  const p = photos[i % n]!;
  return (
    <div className="relative aspect-[16/10] overflow-hidden bg-sand">
      <AnimatePresence initial={false}>
        <motion.div
          key={p.src}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.12 }}
          animate={{ opacity: 1, scale: 1.02 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 0.9 }, scale: { duration: 5.5, ease: 'linear' } }}
          drag={n > 1 ? 'x' : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            if (Math.abs(info.offset.x) > 40) setI((x) => (x + (info.offset.x < 0 ? 1 : n - 1)) % n);
          }}
        >
          <Image src={p.src} alt={p.alt} fill sizes="(min-width:1024px) 32vw, 100vw" className="pointer-events-none object-cover" />
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-navy-3/50 to-transparent" />
      {n > 1 && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
          {photos.map((ph, k) => (
            <button key={ph.src} type="button" aria-label={`${k + 1} / ${n}`} onClick={() => setI(k)} className="relative h-1.5 w-6 overflow-hidden rounded-full bg-ivory/40">
              {k === i % n && <motion.span layoutId="sum-dot" className="absolute inset-0 rounded-full bg-ivory" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MethodOption({ active, onSelect, icon: Icon, title, note, price, badge, big = false }: { active: boolean; onSelect: () => void; icon: React.ComponentType<{ className?: string }>; title: string; note: string; price: string; badge?: string; big?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn('group relative flex items-start gap-4 overflow-hidden rounded-[1.5rem] border p-5 text-left transition-[border-color,box-shadow,transform] duration-500 active:scale-[0.99]', active ? 'border-navy bg-white shadow-[0_24px_50px_-34px_rgba(16,40,61,0.6)]' : 'border-line bg-white/60 hover:border-navy/40')}
    >
      <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors duration-500', active ? 'bg-navy text-ivory' : 'bg-sand-2 text-navy')}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-navy">{title}</span>
          {badge && <span className="rounded-full bg-sage/15 px-2 py-0.5 text-[0.65rem] font-semibold text-sage">{badge}</span>}
        </span>
        <span className="mt-0.5 block text-xs text-mist">{note}</span>
        <span className={cn('serif mt-2 block leading-none', big ? 'text-[1.75rem] text-[#3f5a35]' : 'text-[1.5rem] text-navy')}>{price}</span>
      </span>
      <span className={cn('mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors', active ? 'border-navy' : 'border-line')}>
        <motion.span initial={false} animate={{ scale: active ? 1 : 0 }} className="h-2.5 w-2.5 rounded-full bg-navy" />
      </span>
    </button>
  );
}

/** Decorative payment card that tilts with the pointer. Never collects card data. */
function CardVisual({ name, amount, simulated }: { name: string; amount: string; simulated: boolean }) {
  const { t } = useI18n();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [10, -10]), { stiffness: 200, damping: 18 });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-14, 14]), { stiffness: 200, damping: 18 });
  const shine = useTransform(mx, [-0.5, 0.5], ['0%', '100%']);
  return (
    <div className="mx-auto [perspective:900px] sm:mx-0" aria-hidden="true">
      <motion.div
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          mx.set((e.clientX - r.left) / r.width - 0.5);
          my.set((e.clientY - r.top) / r.height - 0.5);
        }}
        onPointerLeave={() => {
          mx.set(0);
          my.set(0);
        }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE }}
        style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}
        className="relative h-[10.5rem] w-[16.5rem] overflow-hidden rounded-[1.25rem] bg-[linear-gradient(135deg,#10283d_0%,#1d4466_55%,#0b1e2e_100%)] p-5 text-ivory shadow-[0_30px_60px_-28px_rgba(16,40,61,0.8)]"
      >
        <motion.span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.18)_50%,transparent_70%)] bg-[length:250%_100%]" style={{ backgroundPositionX: shine }} />
        <span className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-gold/25 blur-2xl" />
        <span className="flex items-start justify-between">
          <span className="h-8 w-11 rounded-md bg-[linear-gradient(135deg,#e8d3a3,#b8955a)]" />
          {simulated ? <span className="rounded-full bg-gold px-2 py-0.5 text-[0.55rem] font-bold tracking-[0.18em] text-navy-3">{t.booking.pay.demo}</span> : <Lock className="h-4 w-4 text-ivory/70" />}
        </span>
        <span className="mt-5 block font-mono text-[0.95rem] tracking-[0.2em] text-ivory/85">•••• •••• •••• ••••</span>
        <span className="mt-4 flex items-end justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[0.5rem] uppercase tracking-[0.2em] text-ivory/50">{t.booking.pay.holder}</span>
            <span className="block truncate text-xs uppercase tracking-[0.12em]">{name || '—'}</span>
          </span>
          <span className="serif shrink-0 text-lg text-gold">{amount}</span>
        </span>
      </motion.div>
    </div>
  );
}

/** Stripe Embedded Checkout mounted inside the page (needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY). */
function EmbeddedPay({ pk, token, locale, onError }: { pk: string; token: string; locale: string; onError: (m: string) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let co: StripeEmbeddedCheckout | null = null;
    let cancelled = false;
    (async () => {
      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe(pk, { locale: locale as 'it' });
      if (!stripe || cancelled) return;
      co = await stripe.createEmbeddedCheckoutPage({
        fetchClientSecret: async () => {
          const r = await startStripeCheckout(token, locale, true);
          if (!r.ok || !r.clientSecret) throw new Error(r.ok ? 'Stripe' : r.error);
          return r.clientSecret;
        },
      });
      if (cancelled || !ref.current) return co.destroy();
      co.mount(ref.current);
      setReady(true);
    })().catch((e: Error) => onError(e.message));
    return () => {
      cancelled = true;
      co?.destroy();
    };
  }, [pk, token, locale, onError]);
  return (
    <div>
      <p className="mb-4 text-sm text-charcoal/75">{t.booking.pay.embedded}</p>
      {!ready && (
        <div className="space-y-3" aria-live="polite">
          <p className="text-xs text-mist">{t.booking.pay.loading}</p>
          {[0, 1, 2].map((k) => (
            <div key={k} className="h-12 animate-pulse rounded-2xl bg-sand-2" />
          ))}
        </div>
      )}
      <div ref={ref} />
    </div>
  );
}
