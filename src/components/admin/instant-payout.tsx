'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion } from 'motion/react';
import { ArrowUpRight, Check, ChevronRight, Clock, CreditCard, Hourglass, Loader2, Wallet, Zap } from 'lucide-react';
import { cn, money } from '@/lib/utils';
import { Dialog, useToast } from './ui';
import { instantInfoAction, instantPayoutAction, stripeDashboardAction } from '@/app/admin/actions/payments';
import type { InstantView } from '@/server/payments/instant';

const EASE = [0.22, 0.61, 0.12, 1] as const;
type View = Omit<InstantView, 'destination'>;
type Done = { amount: number; to: string | null; simulated: boolean };

const eur = (n: number) => money(n, 'it', 2);

/** The amount rolling to its new value. */
function Rolling({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const c = animate(from.current, value, { duration: 0.7, ease: [0.16, 1, 0.3, 1], onUpdate: setShown });
    from.current = value;
    return () => c.stop();
  }, [value]);
  return <span className={cn('tabular-nums', className)}>{eur(Math.round(shown * 100) / 100)}</span>;
}

const LINE: Record<InstantView['state'], (v: View) => string> = {
  ready: (v) => `Fino a ${eur(v.max)}`,
  no_card: () => 'Aggiungi una carta di debito per riceverli in 30 minuti',
  not_enabled: () => 'Stripe non l’ha ancora attivato per il tuo conto',
  empty: () => 'Per ora non c’è niente da trasferire',
  error: () => 'Saldo non leggibile ora: riprova tra poco',
};

/**
 * "Ricevi subito": a tile in the account card. It reads what can leave now, the owner picks how
 * much (all of it, or less) and confirms; the money reaches the debit card in about 30 minutes.
 */
export function InstantPayout() {
  const toast = useToast();
  const [view, setView] = useState<View | null | 'loading'>('loading');
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(true);
  const [custom, setCustom] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    const r = await instantInfoAction().catch(() => null);
    setView(r?.ok ? r.data : { state: 'error', simulated: false, test: false, max: 0, fee: 0, to: null });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (view === null) return null;
  const v = view === 'loading' ? null : view;
  const parsed = Number(custom.replace(/\./g, '').replace(',', '.'));
  const amount = v ? (all ? v.max : Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0) : 0;
  const tooMuch = v ? amount > v.max + 0.001 : false;
  const valid = Boolean(v && v.state === 'ready' && amount >= 1 && !tooMuch);
  // the service cost grows with the amount (the share Stripe showed for the whole balance)
  const fee = v && v.fee > 0 && v.max > 0 ? Math.round(((v.fee * amount) / v.max) * 100) / 100 : 0;

  const openDialog = () => {
    setDone(null);
    setAll(true);
    setCustom('');
    setOpen(true);
    void load();
  };
  const send = async () => {
    if (!valid) return;
    setSending(true);
    const r = await instantPayoutAction({ amount }).catch(() => null);
    setSending(false);
    if (r?.ok && r.data) {
      setDone({ amount: r.data.amount, to: r.data.to, simulated: r.data.simulated });
      void load();
    } else toast('error', r && !r.ok ? r.error : 'Nessun soldo è stato spostato: riprova.');
  };
  const addCard = async () => {
    setOpening(true);
    const r = await stripeDashboardAction().catch(() => null);
    setOpening(false);
    if (r?.ok && r.data?.url) window.location.assign(r.data.url);
    else toast('error', r && !r.ok ? r.error : 'Stripe non risponde ora.');
  };

  return (
    <>
      <motion.button
        type="button"
        data-testid="instant-tile"
        onClick={openDialog}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.5, ease: EASE }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        className={cn('group relative mt-3 flex w-full items-center gap-3 overflow-hidden rounded-2xl px-4 py-3 text-left', v?.state === 'ready' ? 'bg-navy text-ivory shadow-[0_18px_40px_-24px_rgba(16,40,61,0.9)]' : 'bg-ivory text-navy hover:bg-sand-2')}
      >
        {v?.state === 'ready' && <motion.span aria-hidden="true" className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" animate={{ x: ['0%', '420%'] }} transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }} />}
        <span className={cn('relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full', v?.state === 'ready' ? 'bg-gold text-navy-3' : 'bg-white text-gold-2')}>
          <Zap className="h-4 w-4" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className={cn('block text-[0.6rem] font-semibold uppercase tracking-[0.16em]', v?.state === 'ready' ? 'text-ivory/60' : 'text-mist')}>Ricevi subito</span>
          {v ? <span className="block truncate text-sm font-semibold">{LINE[v.state](v)}</span> : <span className="mt-1 block h-3.5 w-40 animate-pulse rounded-full bg-sand-2" aria-label="Controllo il saldo" />}
          {v?.state === 'ready' && <span className="block truncate text-[0.7rem] text-ivory/60">sulla tua carta in circa 30 minuti</span>}
        </span>
        <ChevronRight className="relative h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" />
      </motion.button>

      <Dialog open={open} onClose={() => !sending && setOpen(false)} title="Ricevi subito" width={520}>
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center py-4 text-center" data-testid="instant-done">
              <span className="relative flex h-20 w-20 items-center justify-center">
                {[0, 1].map((i) => (
                  <motion.span key={i} aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-sage" initial={{ scale: 0.6, opacity: 0.8 }} animate={{ scale: 1.8, opacity: 0 }} transition={{ delay: 0.25 + i * 0.35, duration: 1.2, ease: 'easeOut' }} />
                ))}
                <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="flex h-20 w-20 items-center justify-center rounded-full bg-sage text-white">
                  <Check className="h-9 w-9" />
                </motion.span>
              </span>
              <p className="mt-5 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-mist">In arrivo</p>
              <p className="serif mt-1 text-[2.8rem] leading-none text-navy">
                <Rolling value={done.amount} />
              </p>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-charcoal/80">
                Su {done.to ?? 'la tua carta'}, di solito entro 30 minuti. Il resto continua ad arrivare con i bonifici normali.
              </p>
              {done.simulated && <p className="mt-3 rounded-full bg-gold/15 px-3 py-1 text-[0.7rem] font-semibold text-[#7a5a1f]">Simulazione: nessun soldo è stato spostato</p>}
              <button type="button" onClick={() => setOpen(false)} className="btn btn-navy mt-6 w-full">
                Fatto
              </button>
            </motion.div>
          ) : !v ? (
            <motion.div key="load" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 py-10 text-sm text-mist">
              <Loader2 className="h-6 w-6 animate-spin text-gold-2" /> Controllo quanto puoi ricevere…
            </motion.div>
          ) : v.state === 'ready' ? (
            <motion.div key="ready" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="relative overflow-hidden rounded-[1.6rem] bg-navy-3 p-6 text-center text-ivory">
                <motion.span aria-hidden="true" className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-gold/25 blur-3xl" animate={{ x: [0, 40, 0] }} transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }} />
                <p className="relative flex items-center justify-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-ivory/55">
                  Ricevi adesso {(v.test || v.simulated) && <span className="rounded-full bg-gold/25 px-2 py-0.5 tracking-[0.12em] text-gold">{v.simulated ? 'Simulazione' : 'Prova'}</span>}
                </p>
                <p className={cn('serif relative mt-2 text-[3.2rem] leading-none transition-colors', tooMuch && 'text-[#f0a58c]')} data-testid="instant-amount">
                  <Rolling value={amount} />
                </p>
                <p className="relative mt-2 text-xs text-ivory/60">Disponibili adesso: {eur(v.max)}</p>
              </div>

              <div className="mt-4 grid grid-cols-2 rounded-full bg-ivory-2 p-1" role="radiogroup" aria-label="Quanto ricevere">
                {[
                  { on: all, l: 'Tutto', f: () => setAll(true) },
                  { on: !all, l: 'Un’altra cifra', f: () => setAll(false) },
                ].map((o) => (
                  <button key={o.l} type="button" role="radio" aria-checked={o.on} onClick={o.f} className={cn('relative z-[1] h-10 rounded-full text-sm font-semibold transition-colors', o.on ? 'text-ivory' : 'text-navy')}>
                    {o.on && <motion.span layoutId="instant-pill" className="absolute inset-0 -z-[1] rounded-full bg-navy" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                    {o.l}
                  </button>
                ))}
              </div>
              <AnimatePresence initial={false}>
                {!all && (
                  <motion.label key="custom" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="block overflow-hidden">
                    <span className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-white px-4 focus-within:border-navy">
                      <input autoFocus inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={String(Math.floor(v.max))} aria-label="Importo in euro" className="h-12 w-full bg-transparent text-lg font-semibold text-navy outline-none" />
                      <span className="text-lg text-mist">€</span>
                    </span>
                    {tooMuch && <span className="mt-1.5 block text-xs text-terracotta">Al massimo {eur(v.max)}.</span>}
                  </motion.label>
                )}
              </AnimatePresence>

              <ul className="mt-4 space-y-2 text-[0.82rem] text-navy">
                <li className="flex items-center gap-3 rounded-2xl bg-white px-4 py-2.5 ring-1 ring-line">
                  <CreditCard className="h-4 w-4 shrink-0 text-gold-2" /> <span className="flex-1">Arriva su</span> <strong className="text-right">{v.to}</strong>
                </li>
                <li className="flex items-center gap-3 rounded-2xl bg-white px-4 py-2.5 ring-1 ring-line">
                  <Clock className="h-4 w-4 shrink-0 text-gold-2" /> <span className="flex-1">Quando</span> <strong className="text-right">di solito entro 30 minuti, anche nel weekend</strong>
                </li>
                <li className="flex items-center gap-3 rounded-2xl bg-white px-4 py-2.5 ring-1 ring-line">
                  <Wallet className="h-4 w-4 shrink-0 text-gold-2" /> <span className="flex-1">Costo per te</span> <strong className="text-right">{fee > 0 ? eur(fee) : 'nessuno'}</strong>
                </li>
              </ul>
              <p className="mt-3 text-[0.75rem] leading-relaxed text-mist">Quello che non ricevi ora arriva come sempre con il bonifico normale.</p>
              <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={!valid || sending} onClick={send} data-testid="instant-send" className="mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-full bg-gold px-5 py-3.5 text-[0.95rem] font-semibold text-navy-3 shadow-[0_18px_40px_-20px_rgba(196,154,82,0.9)] disabled:opacity-50">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} {valid ? `Ricevi ${eur(amount)} adesso` : 'Scegli l’importo'}
              </motion.button>
            </motion.div>
          ) : (
            <motion.div key={v.state} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="py-2">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sand-2 text-gold-2">{v.state === 'no_card' ? <CreditCard className="h-6 w-6" /> : <Hourglass className="h-6 w-6" />}</span>
              <p className="serif mt-4 text-[1.6rem] leading-tight text-navy">
                {v.state === 'no_card' ? 'Serve una carta di debito' : v.state === 'not_enabled' ? 'Non ancora attivo' : v.state === 'empty' ? 'Niente da trasferire, per ora' : 'Stripe non risponde'}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-charcoal/80">
                {v.state === 'no_card' && 'I soldi arrivano in circa 30 minuti su una carta di debito (Visa o Mastercard) intestata all’hotel. Aggiungila una volta su Stripe: poi il pulsante funziona da qui.'}
                {v.state === 'not_enabled' && 'Stripe attiva i bonifici immediati dopo un periodo di incassi regolari, oppure oggi è stato raggiunto il limite giornaliero. Intanto i soldi arrivano con il bonifico normale, come sempre.'}
                {v.state === 'empty' && 'Appena un ospite paga con la carta, l’importo compare qui e puoi riceverlo in pochi minuti.'}
                {v.state === 'error' && 'Non riesco a leggere il saldo ora. Nessun soldo è stato spostato: riprova tra qualche minuto.'}
              </p>
              {v.state === 'no_card' && !v.simulated && (
                <button type="button" disabled={opening} onClick={addCard} className="btn btn-navy mt-6 w-full">
                  {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />} Aggiungi la carta su Stripe
                </button>
              )}
              {v.state === 'error' && (
                <button type="button" onClick={() => { setView('loading'); void load(); }} className="btn btn-navy mt-6 w-full">
                  Riprova
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </Dialog>
    </>
  );
}
