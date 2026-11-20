'use client';
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Moon, PackagePlus, Plus, Trash2, UserRound, Users } from 'lucide-react';
import { EXTRA_T, extraTotal, extraUnits, type Extra, type ExtraUnit } from '@/lib/extras';
import { cn, money } from '@/lib/utils';
import { Card, NumInput, Toggle } from './ui';
import { saveExtrasAction } from '@/app/admin/actions/settings';

const EASE = [0.22, 0.61, 0.12, 1] as const;
const UNITS: { v: ExtraUnit; l: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { v: 'stay', l: 'A soggiorno', icon: PackagePlus },
  { v: 'night', l: 'A notte', icon: Moon },
  { v: 'person', l: 'A persona', icon: UserRound },
  { v: 'person_night', l: 'A persona a notte', icon: Users },
];

/**
 * Prezzi → Supplementi: towels, breakfast, cot… The owner turns on only what the hotel offers,
 * writes the price and how it counts (per stay, per night, per person, per person per night).
 * Saved by itself; guests see the ones that are on and can add them to the booking (paid at the hotel).
 */
export function ExtrasEditor({ initial, canEdit }: { initial: Extra[]; canEdit: boolean }) {
  const [list, setList] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const save = (next: Extra[], wait = 600) => {
    setList(next);
    if (!canEdit) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      // a supplement switched on without a name waits for its name
      if (next.some((e) => e.enabled && !(e.name.it ?? '').trim())) return setState('idle');
      setState('saving');
      const res = await saveExtrasAction(next).catch(() => null);
      setState(res?.ok ? 'saved' : 'error');
      setError(res && !res.ok ? res.error : null);
    }, wait);
  };
  const set = (id: string, patch: Partial<Extra>) => save(list.map((e) => (e.id === id ? { ...e, ...patch } : e)), patch.enabled !== undefined || patch.unit ? 150 : 600);
  const add = () => save([...list, { id: `extra-${Math.random().toString(36).slice(2, 8)}`, name: { it: '' }, price: 0, unit: 'stay', enabled: true }]);
  const on = list.filter((e) => e.enabled);

  return (
    <Card
      title="Supplementi"
      action={<span className={cn('text-xs font-semibold', state === 'error' ? 'text-terracotta' : 'text-mist')}>{state === 'saving' ? 'Salvo…' : state === 'saved' ? '✓ Salvato' : state === 'error' ? 'Non salvato: riprova' : 'Si salva da solo'}</span>}
    >
      <p className="mb-5 max-w-3xl text-sm leading-relaxed text-charcoal/80">
        Accendi solo quello che offri e scrivi il prezzo. Gli ospiti li vedono nella pagina della camera e possono aggiungerli alla prenotazione: <strong className="text-navy">non si pagano online</strong>, li incassi tu in hotel. Il prezzo può valere per tutto il soggiorno, a notte, a persona o a persona a notte.
      </p>
      {error && <p className="mb-4 rounded-2xl bg-terracotta/10 px-4 py-2.5 text-sm text-terracotta">{error}</p>}
      <ul className="grid gap-3">
        <AnimatePresence initial={false}>
          {list.map((e) => {
            const ex = extraTotal(e, 3, 2);
            const u = extraUnits(e.unit, 3, 2);
            return (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className={cn('overflow-hidden rounded-2xl border p-4 transition-colors duration-300', e.enabled ? 'border-gold/60 bg-white shadow-[0_18px_40px_-34px_rgba(16,40,61,0.6)]' : 'border-line bg-ivory')}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Toggle checked={e.enabled} disabled={!canEdit} onChange={(v) => set(e.id, { enabled: v })} label={`${e.name.it || 'Supplemento'}: sul sito`} />
                  <input
                    className={cn('field min-w-0 flex-1 py-2 font-semibold', !e.enabled && 'text-charcoal/60')}
                    value={e.name.it ?? ''}
                    maxLength={80}
                    disabled={!canEdit}
                    placeholder="Es. Teli mare"
                    onChange={(ev) => set(e.id, { name: { ...e.name, it: ev.target.value } })}
                  />
                  <label className="flex items-center gap-1.5">
                    <NumInput min={0} max={1000} decimals={2} className="field w-24 py-2 text-right" value={e.price} disabled={!canEdit} onChange={(v) => v !== null && set(e.id, { price: v })} aria-label="Prezzo" />
                    <span className="text-sm text-navy">€</span>
                  </label>
                  {!e.preset && canEdit && (
                    <button type="button" onClick={() => window.confirm('Togliere questo supplemento?') && save(list.filter((x) => x.id !== e.id), 150)} aria-label="Togli" title="Togli" className="flex h-9 w-9 items-center justify-center rounded-full text-terracotta hover:bg-terracotta/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {e.enabled && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {UNITS.map((o) => (
                          <button key={o.v} type="button" disabled={!canEdit} aria-pressed={e.unit === o.v} onClick={() => set(e.id, { unit: o.v })} className={cn('flex h-9 items-center gap-1.5 rounded-full border px-3 text-[0.78rem] font-semibold transition-colors', e.unit === o.v ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/40')}>
                            <o.icon className={cn('h-3.5 w-3.5', e.unit === o.v ? 'text-gold' : 'text-gold-2')} />
                            {o.l}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2.5 text-[0.75rem] text-charcoal/70">
                        {e.price > 0 ? (
                          <>
                            Esempio, 2 persone per 3 notti: {u > 1 ? `${money(e.price, 'it', 2)} × ${u} = ` : ''}
                            <strong className="text-navy">{money(ex, 'it', 2)}</strong> da pagare in hotel
                          </>
                        ) : (
                          <>Prezzo 0: sul sito appare come “{EXTRA_T.it.free}”.</>
                        )}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
      {canEdit && (
        <button type="button" onClick={add} className="mt-4 inline-flex h-11 items-center gap-2 rounded-full border border-dashed border-navy/40 px-5 text-sm font-semibold text-navy transition-colors hover:border-navy hover:bg-ivory">
          <Plus className="h-4 w-4" /> Aggiungi un supplemento
        </button>
      )}
      <p className="mt-4 text-[0.75rem] text-mist">{on.length ? `Sul sito: ${on.map((e) => e.name.it || '…').join(', ')}.` : 'Spenti tutti: il sito non mostra supplementi.'} I nomi scritti da te restano in italiano nelle altre lingue.</p>
    </Card>
  );
}
