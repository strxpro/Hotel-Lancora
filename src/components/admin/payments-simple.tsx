'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useInView } from 'motion/react';
import { ArrowUpRight, Banknote, BadgeCheck, CalendarClock, Check, ChevronDown, CreditCard, FlaskConical, Landmark, Link2, Loader2, Minus, Plus, RefreshCw, ShieldCheck, Unplug, Wallet } from 'lucide-react';
import { cancelFeeAmount, cancelText } from '@/lib/cancellation';
import { cn, money } from '@/lib/utils';
import { Dialog, useAction, useToast } from './ui';
import { NiceSelect } from './nice-select';
import { DAYS, nextPayouts, type ConnectView } from './stripe-connect';
import { InstantPayout } from './instant-payout';
import { savePaymentsAction } from '@/app/admin/actions/settings';
import { disconnectStripeAction, refreshStripeConnectAction, savePayoutScheduleAction, simulateStripeConnectAction, startStripeConnectAction, stripeDashboardAction } from '@/app/admin/actions/payments';

const EASE = [0.22, 0.61, 0.12, 1] as const;

/* ---------------- numbers that count up ---------------- */

function CountUp({ value, className, delay = 0 }: { value: number; className?: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(from.current, value, { duration: 0.9, delay, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setShown(v) });
    from.current = value;
    return () => c.stop();
  }, [value, inView, delay]);
  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {money(Math.round(shown * 100) / 100, 'it', (Number.isInteger(value) ? 0 : 2) as 0 | 2)}
    </span>
  );
}

/* ---------------- the month at a glance ---------------- */

export function MoneyHero({ monthLabel, month, today, due, cashDue, byCard, byCash, days }: { monthLabel: string; month: number; today: number; due: number; cashDue: number; byCard: number; byCash: number; days: { date: string; label: string; amount: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.amount));
  const cardShare = byCard + byCash > 0 ? Math.round((byCard / (byCard + byCash)) * 100) : 0;
  return (
    <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="relative overflow-hidden rounded-[2rem] bg-navy-3 p-6 text-ivory md:p-8">
      <motion.span aria-hidden="true" className="pointer-events-none absolute -left-24 -top-28 h-80 w-80 rounded-full bg-[#635bff]/35 blur-3xl" animate={{ x: [0, 70, 0], y: [0, 40, 0] }} transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.span aria-hidden="true" className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-gold/30 blur-3xl" animate={{ x: [0, -60, 0], y: [0, -30, 0] }} transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }} />
      <div className="relative grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <div>
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.22em] text-ivory/55">Incassato a {monthLabel}</p>
          <p className="serif mt-2 text-[clamp(3rem,7vw,5.2rem)] leading-none">
            <CountUp value={month} />
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[
              { l: 'Oggi', v: today },
              { l: 'Da incassare', v: due },
              { l: 'Contanti attesi', v: cashDue },
            ].map((s, i) => (
              <motion.div key={s.l} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.1, duration: 0.6, ease: EASE }} className="min-w-0 rounded-2xl bg-white/[0.06] px-3 py-3 ring-1 ring-white/10">
                <p className="truncate text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-ivory/50">{s.l}</p>
                <p className="serif mt-1 truncate text-[clamp(1.05rem,1.6vw,1.4rem)] leading-none">
                  <CountUp value={Math.round(s.v)} delay={0.15 + i * 0.06} />
                </p>
              </motion.div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex h-36 items-end gap-1.5" role="img" aria-label="Incassi degli ultimi 14 giorni">
            {days.map((d, i) => (
              <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.label}: ${money(d.amount, 'it', 2)}`}>
                <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(d.amount ? 6 : 2, (d.amount / max) * 100)}%` }} transition={{ delay: 0.4 + i * 0.045, duration: 0.9, ease: [0.16, 1, 0.3, 1] }} className={cn('w-full rounded-t-md transition-colors', i === days.length - 1 ? 'bg-gold' : d.amount ? 'bg-ivory/70 group-hover:bg-ivory' : 'bg-white/15')} />
                <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-ivory px-2 py-0.5 text-[0.62rem] font-semibold text-navy-3 group-hover:block">{money(d.amount)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[0.6rem] uppercase tracking-[0.14em] text-ivory/45">
            <span>{days[0]?.label}</span>
            <span>oggi</span>
          </div>
          <div className="mt-5">
            <div className="flex justify-between text-[0.66rem] text-ivory/60">
              <span className="flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5" /> carta {money(byCard)}
              </span>
              <span className="flex items-center gap-1.5">
                contanti {money(byCash)} <Banknote className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <motion.div initial={{ width: 0 }} animate={{ width: `${cardShare}%` }} transition={{ delay: 0.8, duration: 1.2, ease: EASE }} className="h-full rounded-full bg-gradient-to-r from-[#635bff] to-gold" />
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

/* ---------------- the hotel's account (Stripe) ---------------- */

const INTERVAL: Record<ConnectView['payoutInterval'], string> = { daily: 'ogni giorno', weekly: 'ogni settimana', monthly: 'ogni mese' };

export function AccountCard({ c, mode, demo = true }: { c: ConnectView; mode: 'test' | 'live' | 'off'; demo?: boolean }) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [sched, setSched] = useState({ interval: c.payoutInterval, weeklyAnchor: (DAYS.some(([k]) => k === c.weeklyAnchor) ? c.weeklyAnchor : 'monday') as (typeof DAYS)[number][0], monthlyAnchor: c.monthlyAnchor });
  const upcoming = useMemo(() => nextPayouts(sched.interval, sched.weeklyAnchor, sched.monthlyAnchor), [sched]);
  const connected = Boolean(c.accountId);
  const ready = connected && (c.detailsSubmitted || c.simulated);
  const go = (fn: () => Promise<{ ok: true; data?: { url: string } } | { ok: false; error: string }>) => run(fn, { onOk: (d) => d?.url && window.location.assign(d.url) });
  const day = DAYS.find(([k]) => k === c.weeklyAnchor)?.[1] ?? 'Lun';
  const when = c.payoutInterval === 'weekly' ? `ogni settimana, ${day.toLowerCase()}` : c.payoutInterval === 'monthly' ? `ogni mese, il ${c.monthlyAnchor === 31 ? 'ultimo giorno' : c.monthlyAnchor}` : 'ogni giorno lavorativo';

  return (
    <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.7, ease: EASE }} className="relative flex flex-col overflow-hidden rounded-[2rem] border border-line bg-white p-6 md:p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-mist">
          <Landmark className="h-3.5 w-3.5" /> Il tuo conto
        </p>
        {(mode === 'test' || c.simulated) && <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-gold-2">{c.simulated ? 'Simulazione' : 'Prova'}</span>}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {ready ? (
          <motion.div key="ready" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 flex-1">
            <div className="flex items-center gap-3">
              <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 15, delay: 0.3 }} className="flex h-12 w-12 items-center justify-center rounded-full bg-sage text-white">
                <BadgeCheck className="h-6 w-6" />
              </motion.span>
              <div className="min-w-0">
                <p className="serif truncate text-[1.5rem] leading-tight text-navy">{c.businessName ?? 'Conto collegato'}</p>
                <p className="text-xs text-mist">{c.bankLast4 ? `IBAN •••• ${c.bankLast4}` : 'IBAN da aggiungere su Stripe'}</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(true)} className="mt-5 flex w-full items-center gap-3 rounded-2xl bg-ivory px-4 py-3 text-left transition-colors hover:bg-sand-2">
              <CalendarClock className="h-5 w-5 text-gold-2" />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-mist">Bonifici</span>
                <span className="block text-sm font-semibold text-navy">{when}</span>
              </span>
              <span className="text-xs font-semibold text-navy underline-offset-2 hover:underline">Cambia</span>
            </button>
            {(mode !== 'off' || c.simulated) && <InstantPayout />}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {!c.simulated && (
                <button type="button" disabled={pending} onClick={() => go(stripeDashboardAction)} className="flex h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-xs font-semibold text-navy hover:border-navy">
                  Apri Stripe <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
              <button type="button" disabled={pending} onClick={() => run(refreshStripeConnectAction)} aria-label="Aggiorna" title="Aggiorna" className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-navy hover:border-navy">
                <RefreshCw className={cn('h-3.5 w-3.5', pending && 'animate-spin')} />
              </button>
              <button type="button" disabled={pending} onClick={() => run(disconnectStripeAction)} className="ml-auto flex items-center gap-1 text-[0.7rem] text-mist hover:text-terracotta">
                <Unplug className="h-3.5 w-3.5" /> Scollega
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="todo" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 flex flex-1 flex-col">
            <p className="serif text-[1.6rem] leading-tight text-navy">{connected ? 'Manca poco' : 'Ricevi i pagamenti sul tuo conto'}</p>
            <p className="mt-1.5 text-[0.82rem] leading-relaxed text-mist">{connected ? 'Stripe chiede ancora qualche dato: un minuto e hai finito.' : 'Un clic: Stripe ti guida, verifica i dati e da quel momento gli incassi con carta arrivano a te.'}</p>
            <ul className="mt-4 space-y-2">
              {[
                { i: Wallet, t: 'Crea il conto', d: connected },
                { i: ShieldCheck, t: 'Verifica documento e IBAN', d: c.detailsSubmitted },
                { i: Landmark, t: 'Ricevi i bonifici', d: c.payoutsEnabled },
              ].map((s, k) => (
                <motion.li key={s.t} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + k * 0.1 }} className="flex items-center gap-2.5 text-[0.8rem] text-navy">
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-full', s.d ? 'bg-sage text-white' : 'bg-sand-2 text-navy')}>{s.d ? <Check className="h-3.5 w-3.5" /> : <s.i className="h-3.5 w-3.5" />}</span>
                  {s.t}
                </motion.li>
              ))}
            </ul>
            <div className="mt-auto flex flex-wrap gap-2 pt-5">
              {mode !== 'off' && (
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} type="button" disabled={pending} onClick={() => go(startStripeConnectAction)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#635bff] px-5 text-sm font-semibold text-white shadow-[0_18px_40px_-20px_rgba(99,91,255,0.9)] disabled:opacity-60">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} {connected ? 'Completa la verifica' : 'Collega Stripe'}
                </motion.button>
              )}
              {mode === 'off' && demo && (
                <button type="button" disabled={pending} onClick={() => run(simulateStripeConnectAction)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-line px-4 text-xs font-semibold text-navy hover:border-navy">
                  <FlaskConical className="h-4 w-4" /> Prova il collegamento (demo)
                </button>
              )}
              {mode === 'off' && !demo && <p className="flex-1 rounded-2xl bg-ivory px-4 py-3 text-[0.8rem] leading-relaxed text-charcoal/80">I pagamenti con carta stanno per essere attivati dall’assistenza tecnica: qui comparirà “Collega Stripe”.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={open} onClose={() => setOpen(false)} title="Quando vuoi ricevere i soldi" width={560}>
        <div role="radiogroup" aria-label="Frequenza bonifici" className="relative grid grid-cols-3 rounded-full bg-ivory-2 p-1">
          {(Object.keys(INTERVAL) as ConnectView['payoutInterval'][]).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={sched.interval === v} onClick={() => setSched({ ...sched, interval: v })} className={cn('relative z-[1] h-10 rounded-full text-sm font-semibold capitalize transition-colors', sched.interval === v ? 'text-ivory' : 'text-navy')}>
              {sched.interval === v && <motion.span layoutId="payout-pill-2" className="absolute inset-0 -z-[1] rounded-full bg-navy" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              {INTERVAL[v]}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {sched.interval === 'weekly' && (
            <motion.div key="w" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="flex flex-wrap gap-2 pt-4">
                {DAYS.map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={sched.weeklyAnchor === k} onClick={() => setSched({ ...sched, weeklyAnchor: k })} className={cn('h-10 w-14 rounded-full border text-sm transition-colors', sched.weeklyAnchor === k ? 'border-navy bg-navy text-ivory' : 'border-line text-navy hover:border-navy/50')}>
                    {l}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
          {sched.interval === 'monthly' && (
            <motion.div key="m" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <label className="flex items-center gap-3 pt-4 text-sm text-navy">
                Il giorno
                <NiceSelect
                  className="min-w-[5.5rem]"
                  label="Giorno del mese"
                  value={String(sched.monthlyAnchor)}
                  onChange={(v) => setSched({ ...sched, monthlyAnchor: Number(v) })}
                  options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: i === 30 ? 'ultimo del mese' : String(i + 1) }))}
                />
              </label>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="mt-6 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-mist">Prossimi bonifici</p>
        <ul className="mt-3 grid grid-cols-4 gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {upcoming.map((d, i) => (
              <motion.li key={`${sched.interval}-${d.toISOString()}`} layout initial={{ opacity: 0, y: 12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: i * 0.05, duration: 0.35, ease: EASE }} className="rounded-2xl border border-line bg-ivory px-2 py-2.5 text-center">
                <span className="block text-[0.6rem] uppercase tracking-[0.16em] text-mist">{d.toLocaleDateString('it-IT', { weekday: 'short' })}</span>
                <span className="serif block text-2xl leading-none text-navy">{d.getDate()}</span>
                <span className="block text-[0.65rem] text-mist">{d.toLocaleDateString('it-IT', { month: 'short' })}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <button type="button" disabled={pending} onClick={() => run(() => savePayoutScheduleAction(sched), { onOk: () => setOpen(false) })} className="btn btn-navy mt-6 w-full">
          Salva
        </button>
      </Dialog>
    </motion.section>
  );
}

/* ---------------- how guests pay (saved by itself) ---------------- */

type Pay = { mode: 'full' | 'deposit_percent' | 'deposit_fixed'; depositPercent: number; depositFixed: number; freeCancellationDays: number; cancellationPolicy: string; refundPolicy: string; holdMinutes: number; cashDiscountPercent: number; allowCashAtHotel: boolean; allowOnline?: boolean; cardGuarantee?: boolean; cancellationFee?: { type: 'percent' | 'first_night' | 'fixed'; value: number } };

export function GuestPayments({ initial, cardsOn = false }: { initial: Pay; cardsOn?: boolean }) {
  const toast = useToast();
  const [f, setF] = useState({ ...initial, allowOnline: initial.allowOnline ?? true, cardGuarantee: initial.cardGuarantee ?? false, cancellationFee: initial.cancellationFee ?? { type: 'percent' as const, value: 100 } });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [more, setMore] = useState(false);
  // "Percentuale…" chosen: show the slider even when it lands on 50% or 100%
  const [pctOpen, setPctOpen] = useState(initial.cancellationFee?.type === 'percent' && initial.cancellationFee.value !== 100 && initial.cancellationFee.value !== 50);
  const first = useRef(true);
  const timer = useRef<number | null>(null);

  // every change is saved by itself, a moment after the last touch
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (timer.current) window.clearTimeout(timer.current);
    setState('saving');
    timer.current = window.setTimeout(async () => {
      const r = await savePaymentsAction(f).catch(() => null);
      if (r?.ok) {
        setState('saved');
        window.setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 2200);
      } else {
        setState('error');
        toast('error', r && !r.ok ? r.error : 'Non salvato: riprova.');
      }
    }, 650);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [f, toast]);

  const how = f.allowOnline && f.allowCashAtHotel ? 'both' : f.allowOnline ? 'online' : 'hotel';
  const HOW = [
    { v: 'online', icon: CreditCard, t: 'Carta online', d: 'Pagano sul sito quando prenotano.' },
    { v: 'both', icon: Wallet, t: 'Sceglie l’ospite', d: 'Carta online oppure in hotel.' },
    { v: 'hotel', icon: Banknote, t: 'Solo in hotel', d: 'Nessun pagamento online.' },
  ] as const;
  const rules = { freeCancellationDays: f.freeCancellationDays, cancellationFee: f.cancellationFee };
  const sentence = cancelText('it', rules);
  const example = 300;
  const now = f.mode === 'full' ? example : f.mode === 'deposit_percent' ? Math.round(example * f.depositPercent) / 100 : Math.min(example, f.depositFixed);

  return (
    <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7, ease: EASE }} className="rounded-[2rem] border border-line bg-white p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="serif text-[1.9rem] leading-tight text-navy">Come pagano gli ospiti</p>
          <p className="text-sm text-mist">Tocca e basta: si salva da solo.</p>
        </div>
        <SaveState state={state} />
      </div>

      <div role="radiogroup" aria-label="Come pagano gli ospiti" className="mt-6 grid gap-3 sm:grid-cols-3">
        {HOW.map((o, i) => {
          const on = how === o.v;
          return (
            <motion.button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={on}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.08, duration: 0.5, ease: EASE }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setF({ ...f, allowOnline: o.v !== 'hotel', allowCashAtHotel: o.v !== 'online' })}
              className={cn('relative flex flex-col gap-2 overflow-hidden rounded-[1.4rem] border p-4 text-left transition-colors', on ? 'border-navy text-ivory' : 'border-line bg-ivory text-navy hover:border-navy/40')}
            >
              {on && <motion.span layoutId="how-pay" className="absolute inset-0 -z-0 bg-navy" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
              <o.icon className={cn('relative h-6 w-6', on ? 'text-gold' : 'text-gold-2')} />
              <span className="relative text-[0.95rem] font-semibold">{o.t}</span>
              <span className={cn('relative text-[0.75rem] leading-snug', on ? 'text-ivory/70' : 'text-mist')}>{o.d}</span>
              {on && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }} className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-gold text-navy-3">
                  <Check className="h-3.5 w-3.5" />
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AnimatePresence initial={false}>
          {f.allowOnline && (
            <motion.div key="deposit" layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="rounded-[1.4rem] bg-ivory p-5">
              <p className="text-sm font-semibold text-navy">Con la carta, quanto pagano subito</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    ['full', 'Tutto'],
                    ['deposit_percent', 'Acconto %'],
                    ['deposit_fixed', 'Acconto fisso'],
                  ] as const
                ).map(([v, l]) => (
                  <Chip key={v} on={f.mode === v} onClick={() => setF({ ...f, mode: v })}>
                    {l}
                  </Chip>
                ))}
              </div>
              {f.mode === 'deposit_percent' && <Slider value={f.depositPercent} min={10} max={100} step={5} suffix="%" onChange={(v) => setF({ ...f, depositPercent: v })} />}
              {f.mode === 'deposit_fixed' && <Stepper value={f.depositFixed} min={10} max={2000} step={10} unit="€" onChange={(v) => setF({ ...f, depositFixed: v })} />}
              <p className="mt-4 text-[0.78rem] text-mist">
                Su un soggiorno da {money(example)}: subito{' '}
                <AnimatePresence mode="wait" initial={false}>
                  <motion.strong key={now} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="inline-block text-navy">
                    {money(now)}
                  </motion.strong>
                </AnimatePresence>
                {now < example ? `, il resto (${money(example - now)}) all’arrivo.` : '.'}
              </p>
            </motion.div>
          )}
          {f.allowCashAtHotel && (
            <motion.div key="cash" layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="rounded-[1.4rem] bg-ivory p-5">
              <p className="text-sm font-semibold text-navy">Sconto per chi paga in contanti</p>
              <Slider value={f.cashDiscountPercent} min={0} max={15} step={0.5} suffix="%" onChange={(v) => setF({ ...f, cashDiscountPercent: v })} />
              <p className="mt-4 text-[0.78rem] text-mist">Sul sito ogni camera mostra il prezzo con carta e quello in contanti. In Italia si può solo scontare i contanti, non far pagare di più la carta.</p>
              <button
                type="button"
                role="switch"
                aria-checked={f.cardGuarantee}
                onClick={() => setF({ ...f, cardGuarantee: !f.cardGuarantee })}
                className={cn('mt-4 flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors', f.cardGuarantee ? 'border-navy bg-white' : 'border-line bg-white/60 hover:border-navy/40')}
              >
                <span className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', f.cardGuarantee ? 'bg-navy' : 'bg-line')}>
                  <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow', f.cardGuarantee ? 'right-0.5' : 'left-0.5')} />
                </span>
                <span className="text-[0.8rem] leading-snug text-charcoal/85">
                  <span className="block font-semibold text-navy">Carta a garanzia anche per chi paga in contanti</span>
                  Non si addebita niente quando prenota: la carta resta collegata alla prenotazione per il no-show o la cancellazione tardiva.
                  {!cardsOn && <span className="mt-1 block text-mist">Funziona quando i pagamenti con carta sono attivi.</span>}
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div layout className="mt-4 rounded-[1.4rem] bg-ivory p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div>
            <p className="text-sm font-semibold text-navy">Cancellazione gratuita</p>
            <Stepper value={f.freeCancellationDays} min={0} max={60} step={1} unit={f.freeCancellationDays === 1 ? 'giorno prima' : 'giorni prima'} onChange={(v) => setF({ ...f, freeCancellationDays: v })} />
          </div>
          <div>
            <p className="text-sm font-semibold text-navy">Dopo, chi cancella paga</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip on={!pctOpen && f.cancellationFee.type === 'percent' && f.cancellationFee.value === 100} onClick={() => { setPctOpen(false); setF({ ...f, cancellationFee: { type: 'percent', value: 100 } }); }}>
                Tutto il soggiorno
              </Chip>
              <Chip on={!pctOpen && f.cancellationFee.type === 'percent' && f.cancellationFee.value === 50} onClick={() => { setPctOpen(false); setF({ ...f, cancellationFee: { type: 'percent', value: 50 } }); }}>
                Metà
              </Chip>
              <Chip on={f.cancellationFee.type === 'first_night'} onClick={() => { setPctOpen(false); setF({ ...f, cancellationFee: { type: 'first_night', value: 0 } }); }}>
                La prima notte
              </Chip>
              <Chip on={pctOpen && f.cancellationFee.type === 'percent'} onClick={() => { setPctOpen(true); if (f.cancellationFee.type !== 'percent') setF({ ...f, cancellationFee: { type: 'percent', value: 30 } }); }}>
                Percentuale…
              </Chip>
              <Chip on={f.cancellationFee.type === 'fixed'} onClick={() => { setPctOpen(false); setF({ ...f, cancellationFee: { type: 'fixed', value: f.cancellationFee.type === 'fixed' ? f.cancellationFee.value : 50 } }); }}>
                Importo fisso…
              </Chip>
            </div>
          </div>
          <AnimatePresence initial={false}>
            {pctOpen && f.cancellationFee.type === 'percent' && (
              <motion.div key="fee-pct" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="min-w-[14rem] flex-1 overflow-hidden">
                <p className="text-sm font-semibold text-navy">Percentuale del soggiorno</p>
                <Slider value={f.cancellationFee.value} min={5} max={100} step={5} suffix="%" onChange={(v) => setF({ ...f, cancellationFee: { type: 'percent', value: v } })} />
              </motion.div>
            )}
            {f.cancellationFee.type === 'fixed' && (
              <motion.div key="fee-fix" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <p className="text-sm font-semibold text-navy">Importo fisso</p>
                <Stepper value={f.cancellationFee.value} min={10} max={2000} step={10} unit="€" onChange={(v) => setF({ ...f, cancellationFee: { type: 'fixed', value: v } })} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <p className="mt-3 text-[0.78rem] text-mist">
          Esempio, {money(example)} per 3 notti: chi cancella dopo il termine paga{' '}
          <strong className="text-navy">{money(cancelFeeAmount(rules, example, 3), 'it', 2)}</strong>
          {f.mode !== 'full' || !f.allowOnline ? ' (trattenuti da quanto ha già versato; se ha versato meno, non riceve rimborso)' : ` e riceve indietro ${money(Math.max(0, example - cancelFeeAmount(rules, example, 3)), 'it', 2)}`}.
        </p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={sentence} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3 }} className="mt-4 rounded-xl bg-white px-4 py-3 text-[0.82rem] leading-relaxed text-charcoal/85 ring-1 ring-line">
            <span className="mr-1 text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-gold-2">Sul sito:</span> {sentence}
          </motion.p>
        </AnimatePresence>
      </motion.div>

      <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="mt-5 flex items-center gap-2 text-xs font-semibold text-mist hover:text-navy">
        <ChevronDown className={cn('h-4 w-4 transition-transform', more && 'rotate-180')} /> Altre impostazioni
      </button>
      <AnimatePresence initial={false}>
        {more && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
            <div className="grid gap-4 pt-4 md:grid-cols-2">
              <div className="rounded-[1.4rem] bg-ivory p-5">
                <p className="text-sm font-semibold text-navy">Camera tenuta durante il pagamento</p>
                <Stepper value={f.holdMinutes} min={5} max={60} step={5} unit="minuti" onChange={(v) => setF({ ...f, holdMinutes: v })} />
              </div>
              <label className="block rounded-[1.4rem] bg-ivory p-5">
                <span className="text-sm font-semibold text-navy">Nota sulla cancellazione (facoltativa)</span>
                <textarea className="field mt-3" rows={3} value={f.cancellationPolicy} onChange={(e) => setF({ ...f, cancellationPolicy: e.target.value })} />
              </label>
              <label className="block rounded-[1.4rem] bg-ivory p-5 md:col-span-2">
                <span className="text-sm font-semibold text-navy">Rimborsi</span>
                <textarea className="field mt-3" rows={2} value={f.refundPolicy} onChange={(e) => setF({ ...f, refundPolicy: e.target.value })} />
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {state !== 'idle' && (
        <motion.span key={state} initial={{ opacity: 0, y: -6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold', state === 'saved' ? 'bg-sage/15 text-[#3f5a35]' : state === 'error' ? 'bg-terracotta/10 text-terracotta' : 'bg-sand-2 text-mist')}>
          {state === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === 'saved' ? <Check className="h-3.5 w-3.5" /> : null}
          {state === 'saving' ? 'Salvo…' : state === 'saved' ? 'Salvato' : 'Non salvato'}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button whileTap={{ scale: 0.95 }} type="button" aria-pressed={on} onClick={onClick} className={cn('h-9 rounded-full border px-4 text-xs font-semibold transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50')}>
      {children}
    </motion.button>
  );
}

/** − 3 + with the number rolling. */
function Stepper({ value, min, max, step, unit, onChange }: { value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  return (
    <div className="mt-3 flex items-center gap-3">
      <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Meno" disabled={value <= min} onClick={() => set(value - step)} className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white text-navy hover:border-navy disabled:opacity-30">
        <Minus className="h-4 w-4" />
      </motion.button>
      <span className="relative inline-flex h-11 min-w-[3.2rem] items-center justify-center overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -22, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }} className="serif text-[2.1rem] leading-none text-navy tabular-nums">
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <motion.button whileTap={{ scale: 0.9 }} type="button" aria-label="Più" disabled={value >= max} onClick={() => set(value + step)} className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white text-navy hover:border-navy disabled:opacity-30">
        <Plus className="h-4 w-4" />
      </motion.button>
      <span className="text-sm text-mist">{unit}</span>
    </div>
  );
}

/** A slider with the value big above the thumb. */
function Slider({ value, min, max, step, suffix, onChange }: { value: number; min: number; max: number; step: number; suffix: string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-1">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} className="serif text-[2.1rem] leading-none text-navy tabular-nums">
            {String(value).replace('.', ',')}
          </motion.span>
        </AnimatePresence>
        <span className="text-sm text-mist">{suffix}</span>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-white ring-1 ring-line">
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-navy to-gold" animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Valore" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        <motion.span aria-hidden="true" className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-navy shadow-[0_4px_12px_rgba(16,40,61,0.35)]" animate={{ left: `${pct}%` }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} />
      </div>
    </div>
  );
}
