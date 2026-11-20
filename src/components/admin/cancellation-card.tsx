'use client';
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BedDouble, CalendarX2, Euro, Minus, Percent, Plus } from 'lucide-react';
import { addDays, todayISO } from '@/lib/dates';
import { cancelFeeAmount, cancelText, type CancelFee } from '@/lib/cancellation';
import { cn, money } from '@/lib/utils';
import { Card, NumInput } from './ui';
import { saveCancellationAction } from '@/app/admin/actions/settings';

const EASE = [0.22, 0.61, 0.12, 1] as const;
const KINDS: { v: CancelFee['type'] | 'all'; l: string; d: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { v: 'all', l: 'Tutto il soggiorno', d: 'il 100% del prezzo', icon: CalendarX2 },
  { v: 'first_night', l: 'La prima notte', d: 'il prezzo di una notte', icon: BedDouble },
  { v: 'percent', l: 'Una percentuale', d: 'es. il 50%', icon: Percent },
  { v: 'fixed', l: 'Un importo fisso', d: 'es. 50 €', icon: Euro },
];

/**
 * Prezzi → Cancellazione: up to how many days before arrival cancelling is free, and what it costs
 * afterwards. Saved by itself; the example shows the sentence guests read on the site and in the e-mails.
 */
export function CancellationCard({ initial, canEdit }: { initial: { freeCancellationDays: number; cancellationFee: CancelFee }; canEdit: boolean }) {
  const [days, setDays] = useState(initial.freeCancellationDays);
  const [fee, setFee] = useState<CancelFee>(initial.cancellationFee);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const save = (d: number, f: CancelFee, wait = 500) => {
    setDays(d);
    setFee(f);
    if (!canEdit) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setState('saving');
      const res = await saveCancellationAction({ freeCancellationDays: d, cancellationFee: f }).catch(() => null);
      setState(res?.ok ? 'saved' : 'error');
      setError(res && !res.ok ? res.error : null);
    }, wait);
  };
  const kind = fee.type === 'percent' && fee.value === 100 ? 'all' : fee.type;
  const pick = (k: (typeof KINDS)[number]['v']) =>
    save(days, k === 'all' ? { type: 'percent', value: 100 } : k === 'percent' ? { type: 'percent', value: fee.type === 'percent' && fee.value !== 100 ? fee.value : 50 } : k === 'fixed' ? { type: 'fixed', value: fee.type === 'fixed' ? fee.value : 50 } : { type: 'first_night', value: 0 }, 150);
  // the example: 3 nights at 100 € arriving in a month, as guests read it
  const rules = { freeCancellationDays: days, cancellationFee: fee };
  const exampleIn = addDays(todayISO(), 30);
  const example = cancelText('it', rules, { checkIn: exampleIn, total: 300, nights: 3, bookedAt: new Date().toISOString() });

  return (
    <Card
      title="Cancellazione"
      action={<span className={cn('text-xs font-semibold', state === 'error' ? 'text-terracotta' : 'text-mist')}>{state === 'saving' ? 'Salvo…' : state === 'saved' ? '✓ Salvato' : state === 'error' ? 'Non salvato: riprova' : 'Si salva da solo'}</span>}
    >
      {error && <p className="mb-4 rounded-2xl bg-terracotta/10 px-4 py-2.5 text-sm text-terracotta">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-ivory p-5">
          <p className="text-sm font-semibold text-navy">Gratis fino a</p>
          <p className="mt-1 text-[0.78rem] text-mist">Giorni prima dell’arrivo in cui l’ospite può annullare senza pagare nulla.</p>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" disabled={!canEdit || days <= 0} onClick={() => save(Math.max(0, days - 1), fee)} aria-label="Un giorno in meno" className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-white text-navy transition-colors hover:border-navy disabled:opacity-40">
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[7rem] text-center">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={days} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="serif block text-[2.4rem] leading-none text-navy">
                  {days}
                </motion.span>
              </AnimatePresence>
              <span className="text-xs text-mist">{days === 0 ? 'mai gratis' : days === 1 ? 'giorno prima' : 'giorni prima'}</span>
            </span>
            <button type="button" disabled={!canEdit || days >= 90} onClick={() => save(Math.min(90, days + 1), fee)} aria-label="Un giorno in più" className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-white text-navy transition-colors hover:border-navy disabled:opacity-40">
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[0, 1, 3, 7, 14, 30].map((n) => (
              <button key={n} type="button" disabled={!canEdit} onClick={() => save(n, fee, 150)} className={cn('h-8 rounded-full border px-3 text-xs font-semibold transition-colors', days === n ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/40')}>
                {n === 0 ? 'Mai' : `${n} g`}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-ivory p-5">
          <p className="text-sm font-semibold text-navy">Dopo, annullare costa</p>
          <p className="mt-1 text-[0.78rem] text-mist">L’ospite può comunque annullare dalla sua pagina: paga questa penale online (o la tratteniamo da quanto ha già pagato).</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button key={k.v} type="button" disabled={!canEdit} aria-pressed={kind === k.v} onClick={() => pick(k.v)} className={cn('flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors', kind === k.v ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/40')}>
                <k.icon className={cn('mt-0.5 h-4 w-4 shrink-0', kind === k.v ? 'text-gold' : 'text-gold-2')} />
                <span className="leading-tight">
                  <span className="block text-[0.82rem] font-semibold">{k.l}</span>
                  <span className={cn('block text-[0.7rem]', kind === k.v ? 'text-ivory/70' : 'text-mist')}>{k.d}</span>
                </span>
              </button>
            ))}
          </div>
          <AnimatePresence initial={false}>
            {(kind === 'percent' || kind === 'fixed') && (
              <motion.label initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="mt-3 flex items-center gap-2 overflow-hidden">
                <NumInput min={kind === 'percent' ? 1 : 0} max={kind === 'percent' ? 99 : 10000} decimals={kind === 'percent' ? 0 : 2} className="field w-28" value={fee.value} disabled={!canEdit} onChange={(v) => v !== null && save(days, { type: fee.type, value: v })} aria-label="Valore della penale" />
                <span className="text-sm text-navy">{kind === 'percent' ? '% del soggiorno' : '€'}</span>
              </motion.label>
            )}
          </AnimatePresence>
          <p className="mt-3 text-[0.75rem] text-charcoal/70">Esempio, 3 notti da 100 €: penale {money(cancelFeeAmount(rules, 300, 3), 'it', 2)}.</p>
        </div>
      </div>
      <div className="mt-5 rounded-2xl border border-dashed border-gold/50 bg-white/70 p-4">
        <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-mist">Così lo legge l’ospite (arrivo tra un mese, 3 notti da 100 €)</p>
        <p className="mt-1.5 text-sm leading-relaxed text-navy">{example}</p>
      </div>
    </Card>
  );
}
