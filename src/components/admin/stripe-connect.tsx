'use client';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, BadgeCheck, Building2, CalendarClock, CircleDashed, FlaskConical, Landmark, Link2, RefreshCw, ShieldCheck, Unplug, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, useAction } from './ui';
import { NiceSelect } from './nice-select';
import { disconnectStripeAction, refreshStripeConnectAction, savePayoutScheduleAction, simulateStripeConnectAction, startStripeConnectAction, stripeDashboardAction } from '@/app/admin/actions/payments';

export interface ConnectView {
  accountId: string | null;
  simulated: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  payoutInterval: 'daily' | 'weekly' | 'monthly';
  weeklyAnchor: string;
  monthlyAnchor: number;
  businessName: string | null;
  bankLast4: string | null;
  requirements: string[];
  updatedAt: string | null;
  /** every card payment goes on to the hotel's card at once */
  autoInstant?: boolean;
}

const EASE = [0.22, 0.61, 0.12, 1] as const;
export const DAYS = [
  ['monday', 'Lun'],
  ['tuesday', 'Mar'],
  ['wednesday', 'Mer'],
  ['thursday', 'Gio'],
  ['friday', 'Ven'],
] as const;
const JS_DAY: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5 };

export function nextPayouts(interval: ConnectView['payoutInterval'], weekly: string, monthly: number): Date[] {
  const out: Date[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  for (let i = 1; out.length < 4 && i < 400; i++) {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    const wd = x.getDay();
    if (interval === 'daily' && wd !== 0 && wd !== 6) out.push(x);
    if (interval === 'weekly' && wd === JS_DAY[weekly]) out.push(x);
    if (interval === 'monthly') {
      const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
      if (x.getDate() === Math.min(monthly, last)) out.push(x);
    }
  }
  return out;
}

export function StripeConnectCard({ initial, mode }: { initial: ConnectView; mode: 'test' | 'live' | 'off' }) {
  const c = initial;
  const { run, pending } = useAction();
  const [sched, setSched] = useState({ interval: c.payoutInterval, weeklyAnchor: (DAYS.some(([k]) => k === c.weeklyAnchor) ? c.weeklyAnchor : 'monday') as (typeof DAYS)[number][0], monthlyAnchor: c.monthlyAnchor });
  const connected = Boolean(c.accountId);
  const live = connected && c.chargesEnabled;
  const upcoming = useMemo(() => nextPayouts(sched.interval, sched.weeklyAnchor, sched.monthlyAnchor), [sched]);
  const go = (fn: () => Promise<{ ok: true; data?: { url: string } } | { ok: false; error: string }>) =>
    run(fn, {
      onOk: (d) => {
        if (d?.url) window.location.assign(d.url);
      },
    });

  const steps = [
    { icon: Building2, title: 'Crea il conto', text: 'Email e dati dell’attività, in 2 minuti.', done: connected },
    { icon: ShieldCheck, title: 'Verifica identità e IBAN', text: 'Documento e conto bancario, direttamente su Stripe.', done: c.detailsSubmitted },
    { icon: Wallet, title: 'Ricevi i bonifici', text: 'Gli incassi arrivano sul tuo conto, quando vuoi tu.', done: c.payoutsEnabled },
  ];

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-white">
      {/* animated header */}
      <div className="relative overflow-hidden bg-navy-3 px-6 py-8 text-ivory md:px-8">
        <motion.span aria-hidden="true" className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[#635bff]/40 blur-3xl" animate={{ x: [0, 60, 0], y: [0, 30, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.span aria-hidden="true" className="absolute -right-16 top-0 h-64 w-64 rounded-full bg-gold/30 blur-3xl" animate={{ x: [0, -50, 0], y: [0, 40, 0] }} transition={{ duration: 17, repeat: Infinity, ease: 'easeInOut' }} />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl">
            <p className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-ivory/60">
              <Landmark className="h-3.5 w-3.5" /> Stripe Connect
              {c.simulated && <span className="rounded-full bg-gold px-2 py-0.5 text-[0.55rem] text-navy-3">SIMULAZIONE</span>}
              {mode === 'test' && !c.simulated && <span className="rounded-full bg-ivory/15 px-2 py-0.5 text-[0.55rem]">TEST</span>}
            </p>
            <h2 className="serif mt-3 text-[2rem] leading-tight md:text-[2.4rem]">{live ? 'I pagamenti arrivano sul tuo conto' : 'Ricevi i pagamenti delle prenotazioni sul tuo conto'}</h2>
            <p className="mt-2 text-sm text-ivory/70">
              {live
                ? `${c.businessName ?? 'Conto collegato'} · ${c.bankLast4 ? `IBAN •••• ${c.bankLast4}` : 'IBAN da aggiungere'}`
                : 'Un clic su “Collega Stripe”: Stripe ti guida nella creazione del conto, verifica i dati e da quel momento ogni pagamento con carta del sito arriva a te.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!connected || (!c.detailsSubmitted && !c.simulated) ? (
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                disabled={pending}
                onClick={() => go(startStripeConnectAction)}
                className="flex h-12 items-center gap-2 rounded-full bg-ivory px-6 text-sm font-semibold text-navy-3 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] disabled:opacity-60"
              >
                <Link2 className="h-4 w-4" /> {connected ? 'Completa la verifica' : 'Collega Stripe'}
              </motion.button>
            ) : (
              <>
                {!c.simulated && (
                  <button type="button" disabled={pending} onClick={() => go(stripeDashboardAction)} className="flex h-11 items-center gap-2 rounded-full bg-ivory px-5 text-sm font-semibold text-navy-3">
                    Dashboard Stripe <ArrowUpRight className="h-4 w-4" />
                  </button>
                )}
                <button type="button" disabled={pending} onClick={() => run(refreshStripeConnectAction)} className="flex h-11 w-11 items-center justify-center rounded-full bg-ivory/10 ring-1 ring-ivory/25" aria-label="Aggiorna stato" title="Aggiorna stato">
                  <RefreshCw className={cn('h-4 w-4', pending && 'animate-spin')} />
                </button>
              </>
            )}
            {mode === 'off' && !connected && (
              <button type="button" disabled={pending} onClick={() => run(simulateStripeConnectAction)} className="flex h-12 items-center gap-2 rounded-full px-4 text-xs font-semibold text-ivory/80 ring-1 ring-ivory/25 hover:bg-ivory/10">
                <FlaskConical className="h-4 w-4" /> Simula collegamento
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-0 [&>*]:min-w-0 lg:grid-cols-2">
        {/* onboarding progress */}
        <div className="border-b border-line p-6 md:p-8 lg:border-b-0 lg:border-r">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-mist">Come funziona</p>
          <ol className="relative mt-5 space-y-5">
            <span aria-hidden="true" className="absolute bottom-4 left-5 top-4 w-px bg-line" />
            <motion.span aria-hidden="true" className="absolute left-5 top-4 w-px origin-top bg-sage" initial={{ height: 0 }} animate={{ height: `${(steps.filter((s) => s.done).length / steps.length) * 88}%` }} transition={{ duration: 1.2, ease: EASE }} />
            {steps.map((s, i) => (
              <motion.li key={s.title} className="relative flex gap-4" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.12, duration: 0.5, ease: EASE }}>
                <span className={cn('relative z-[1] flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-colors', s.done ? 'bg-sage text-ivory' : 'bg-sand-2 text-navy')}>{s.done ? <BadgeCheck className="h-5 w-5" /> : <s.icon className="h-5 w-5" />}</span>
                <span>
                  <span className="block text-sm font-semibold text-navy">{s.title}</span>
                  <span className="block text-xs text-mist">{s.text}</span>
                </span>
              </motion.li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-2 text-xs">
            <StatusPill on={c.chargesEnabled} label="Pagamenti con carta" />
            <StatusPill on={c.payoutsEnabled} label="Bonifici" />
            <StatusPill on={c.detailsSubmitted} label="Dati inviati" />
          </div>
          {c.requirements.length > 0 && !c.simulated && <p className="mt-4 rounded-2xl bg-gold/10 px-4 py-3 text-xs text-charcoal/80">Stripe chiede ancora {c.requirements.length} informazioni: clicca “Completa la verifica”.</p>}
          {mode === 'off' && (
            <p className="mt-4 rounded-2xl border border-line bg-ivory px-4 py-3 text-xs leading-relaxed text-mist">
              Per il collegamento reale servono le chiavi Stripe della piattaforma in <code>.env</code> (STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET) e Connect attivo sull’account. Tutto il resto è già pronto.
            </p>
          )}
          {connected && (
            <button type="button" disabled={pending} onClick={() => run(disconnectStripeAction)} className="mt-5 flex items-center gap-1.5 text-xs text-mist hover:text-terracotta">
              <Unplug className="h-3.5 w-3.5" /> Scollega dal sito
            </button>
          )}
        </div>

        {/* payout schedule */}
        <div className={cn('p-6 md:p-8', !connected && 'pointer-events-none opacity-50')} aria-disabled={!connected}>
          <p className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-mist">
            <CalendarClock className="h-3.5 w-3.5" /> Quando vuoi ricevere i soldi
          </p>
          <div role="radiogroup" aria-label="Frequenza bonifici" className="relative mt-4 grid grid-cols-3 rounded-full bg-ivory-2 p-1">
            {(
              [
                ['daily', 'Ogni giorno'],
                ['weekly', 'Ogni settimana'],
                ['monthly', 'Ogni mese'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={sched.interval === v} onClick={() => setSched({ ...sched, interval: v })} className={cn('relative z-[1] h-10 rounded-full text-xs font-semibold transition-colors sm:text-sm', sched.interval === v ? 'text-ivory' : 'text-navy')}>
                {sched.interval === v && <motion.span layoutId="payout-pill" className="absolute inset-0 -z-[1] rounded-full bg-navy" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                {l}
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
                  di ogni mese
                </label>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="mt-6 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-mist">Prossimi bonifici</p>
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <AnimatePresence mode="popLayout" initial={false}>
              {upcoming.map((d, i) => (
                <motion.li key={`${sched.interval}-${d.toISOString()}`} layout initial={{ opacity: 0, y: 12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: i * 0.05, duration: 0.35, ease: EASE }} className="rounded-2xl border border-line bg-ivory px-3 py-2.5 text-center">
                  <span className="block text-[0.6rem] uppercase tracking-[0.16em] text-mist">{d.toLocaleDateString('it-IT', { weekday: 'short' })}</span>
                  <span className="serif block text-2xl leading-none text-navy">{d.getDate()}</span>
                  <span className="block text-[0.65rem] text-mist">{d.toLocaleDateString('it-IT', { month: 'short' })}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          <p className="mt-3 text-xs text-mist">I primi bonifici possono richiedere qualche giorno in più mentre Stripe verifica il conto.</p>
          <Button className="mt-5" disabled={pending || !connected} onClick={() => run(() => savePayoutScheduleAction(sched))}>
            Salva calendario bonifici
          </Button>
        </div>
      </div>
    </section>
  );
}

function StatusPill({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full px-3 py-1.5', on ? 'bg-sage/15 text-sage' : 'bg-ivory-2 text-mist')}>
      {on ? <BadgeCheck className="h-3.5 w-3.5" /> : <CircleDashed className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}
