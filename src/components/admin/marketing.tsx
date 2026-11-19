'use client';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Flag } from '@/components/site/flags';
import { Check, Gift, Heart, Star, Trash2 } from 'lucide-react';
import type { Feedback, Locale, Promotion } from '@/lib/types';
import { addDays, fmtDate, todayISO } from '@/lib/dates';
import { Badge, Button, Card, Field, NumInput, StickyBar, Toggle, useAction } from './ui';
import { NiceSelect } from './nice-select';
import { cn, notti } from '@/lib/utils';
import { ReviewsManager, type AdminRoom } from './reviews-manager';
import { addFeedbackAction, deleteFeedbackAction, deletePromotion, savePromotion, sendReturnOffer, sendThankYou, toggleFeedbackOnSite, togglePromotion } from '@/app/admin/actions/marketing';

export function ReviewsPanel({ feedback, rooms, settings }: { feedback: Feedback[]; rooms: AdminRoom[]; settings: { autoRequest: boolean; delayDays: number } }) {
  return (
    <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[1.35fr_1fr]">
      <div>
        <ReviewsManager feedback={feedback} rooms={rooms} settings={settings} />
        <p className="mt-4 text-xs text-mist">Vedi tutte le opinioni, anche quelle negative. Quelle scritte sul sito senza un soggiorno aspettano la tua approvazione; quelle arrivate dal link dopo il soggiorno sono “verificate” e vanno online subito (puoi nasconderle).</p>
      </div>
      <AddReview rooms={rooms} />
    </div>
  );
}

export function PromosPanel({ promotions, recent, googleUrl }: { promotions: Promotion[]; recent: { id: string; guest: string; checkOut: string; marketing: boolean; code: string }[]; googleUrl: string }) {
  const { run, pending } = useAction();
  const today = todayISO();
  const [p, setP] = useState({ code: '', description: 'Vantaggio prenotazione diretta', percent: 10, validFrom: today, validTo: addDays(today, 90), minNights: 2, active: true });
  const [offer, setOffer] = useState(promotions.find((x) => x.active)?.code ?? '');
  return (
    <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
      <div className="contents">
        <Card title="Dopo il soggiorno">
          <p className="mb-3 text-xs text-mist">{googleUrl ? 'Il link a Google Reviews è incluso nel ringraziamento.' : 'Aggiungi il link Google Reviews in Impostazioni per includerlo.'}</p>
          <div className="mb-4 flex items-center gap-2">
            <label htmlFor="offer-code" className="text-xs text-mist">
              Codice per l’offerta di ritorno
            </label>
            <NiceSelect id="offer-code" size="sm" label="Codice per l’offerta di ritorno" value={offer} onChange={setOffer} options={promotions.map((x) => ({ value: x.code, label: x.code }))} />
          </div>
          <ul className="divide-y divide-line">
            {recent.length === 0 && <li className="py-3 text-sm text-mist">Nessuna partenza negli ultimi 14 giorni.</li>}
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>
                  {r.guest} <span className="text-xs text-mist">· partito il {fmtDate(r.checkOut)}</span>
                </span>
                <span className="flex gap-1.5">
                  <Button size="sm" variant="line" disabled={pending} onClick={() => run(() => sendThankYou(r.id))}>
                    <Heart className="h-3.5 w-3.5" /> Grazie + parere
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending || !r.marketing || !offer} title={r.marketing ? '' : 'Nessun consenso marketing'} onClick={() => run(() => sendReturnOffer(r.id, offer))}>
                    <Gift className="h-3.5 w-3.5" /> Offerta
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Codici promozionali e promozioni stagionali">
          <ul className="mb-5 space-y-2">
            {promotions.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 border border-line px-3 py-2.5 text-sm">
                <span>
                  <span className="serif text-lg text-navy">{x.code}</span> · −{x.percent}% <span className="text-xs text-mist">· {x.description} · {fmtDate(x.validFrom)}–{fmtDate(x.validTo)} · min {notti(x.minNights)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Toggle size="sm" checked={x.active} onChange={() => run(() => togglePromotion(x.id))} label={`Attiva ${x.code}`} />
                  <button type="button" aria-label="Elimina" onClick={() => run(() => deletePromotion(x.id))} className="text-terracotta">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Codice">
              <input className="field uppercase" value={p.code} onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="ESTATE10" />
            </Field>
            <Field label="Sconto %">
              <NumInput min={1} max={60} decimals={0} className="field" value={p.percent} onChange={(v) => v !== null && setP({ ...p, percent: v })} />
            </Field>
            <Field label="Valido per arrivi dal">
              <input type="date" className="field" value={p.validFrom} onChange={(e) => setP({ ...p, validFrom: e.target.value })} />
            </Field>
            <Field label="al">
              <input type="date" className="field" value={p.validTo} onChange={(e) => setP({ ...p, validTo: e.target.value })} />
            </Field>
            <Field label="Descrizione" className="sm:col-span-2">
              <input className="field" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
            </Field>
          </div>
          <Button className="mt-4" disabled={pending || p.code.length < 4} onClick={() => run(() => savePromotion(p), { onOk: () => setP({ ...p, code: '' }) })}>
            Crea codice
          </Button>
        </Card>

        <Card title="Promemoria prenotazione non completata">
          <p className="text-sm text-charcoal/80">Disattivato. Inviare promemoria a chi ha iniziato una prenotazione senza completarla richiede una base giuridica adeguata (consenso esplicito) e un’informativa dedicata.</p>
          <p className="mt-2 text-xs text-mist">Si può attivare in futuro solo per ospiti che lo hanno accettato.</p>
        </Card>
      </div>
    </div>
  );
}

const REVIEW_LANGS: Locale[] = ['it', 'en', 'pl', 'de', 'fr', 'es'];

/** Add a review by hand (from Google, a guestbook, a phone call…): stars, text, language, on the site or not. */
function AddReview({ rooms }: { rooms: AdminRoom[] }) {
  const { run, pending } = useAction();
  const [r, setR] = useState({ name: '', rating: 5, comment: '', lang: 'it' as Locale, showOnSite: true, roomId: null as string | null });
  const [hover, setHover] = useState(0);
  const [done, setDone] = useState(false);
  const shown = hover || r.rating;
  const WORDS = ['', 'Pessima', 'Così così', 'Buona', 'Molto buona', 'Eccellente'];
  return (
    <Card title="Aggiungi una recensione">
      <p className="mb-4 text-xs text-mist">Per le opinioni ricevute a voce, su Google o sul libro degli ospiti. Anche quelle con poche stelle: decidi tu se mostrarle sul sito.</p>
      <div className="space-y-4">
        <div>
          <p className="label">Stelle</p>
          <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <motion.button key={n} type="button" whileTap={{ scale: 0.8 }} whileHover={{ scale: 1.15, rotate: -6 }} onMouseEnter={() => setHover(n)} onClick={() => setR({ ...r, rating: n })} aria-label={`${n} stelle`} className="p-1 text-gold">
                <Star className="h-8 w-8" fill={n <= shown ? 'currentColor' : 'none'} strokeWidth={1.3} />
              </motion.button>
            ))}
            <AnimatePresence mode="popLayout">
              <motion.span key={shown} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="ml-2 text-sm font-semibold text-navy">
                {WORDS[shown]}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
        <Field label="Camera">
          <NiceSelect className="w-full" label="Camera" value={r.roomId ?? ''} onChange={(v) => setR({ ...r, roomId: v || null })} options={[{ value: '', label: 'Hotel in generale' }, ...rooms.map((x) => ({ value: x.id, label: `${x.number} · ${x.name}` }))]} />
        </Field>
        <Field label="Nome dell’ospite">
          <input className="field" value={r.name} maxLength={60} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="Es. Marco B." />
        </Field>
        <Field label="Cosa ha scritto">
          <textarea className="field" rows={4} value={r.comment} maxLength={1200} onChange={(e) => setR({ ...r, comment: e.target.value })} placeholder="Copia qui il testo della recensione" />
        </Field>
        <div>
          <p className="label">Lingua</p>
          <div className="flex flex-wrap gap-1.5">
            {REVIEW_LANGS.map((l) => (
              <button key={l} type="button" onClick={() => setR({ ...r, lang: l })} className={cn('flex h-9 items-center gap-2 rounded-full border px-3 text-xs transition-colors', r.lang === l ? 'border-navy bg-navy text-ivory' : 'border-line text-navy')}>
                <Flag locale={l} className="h-3 w-4 rounded-[2px]" /> {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-3 rounded-2xl bg-ivory p-3 text-sm text-charcoal/85">
          <Toggle size="sm" checked={r.showOnSite} onChange={(v) => setR({ ...r, showOnSite: v })} label="Mostra sul sito" />
          Mostra sul sito nella sezione recensioni
        </label>
        <Button
          disabled={pending || r.name.trim().length < 2 || r.comment.trim().length < 3}
          onClick={() =>
            run(() => addFeedbackAction(r), {
              onOk: () => {
                setR({ name: '', rating: 5, comment: '', lang: 'it', showOnSite: true, roomId: null });
                setDone(true);
                window.setTimeout(() => setDone(false), 2200);
              },
            })
          }
        >
          {done ? (
            <>
              <Check className="h-4 w-4" /> Aggiunta!
            </>
          ) : (
            'Aggiungi recensione'
          )}
        </Button>
      </div>
    </Card>
  );
}

/** Marketing in three clear tabs instead of one long page. */
export function MarketingTabs({ email, reviews, promos, initial = 'email' }: { email: React.ReactNode; reviews: React.ReactNode; promos: React.ReactNode; initial?: 'email' | 'reviews' | 'promos' }) {
  const [tab, setTab] = useState(initial);
  const tabs = [
    { k: 'email' as const, label: 'Email ai clienti' },
    { k: 'reviews' as const, label: 'Recensioni' },
    { k: 'promos' as const, label: 'Codici e offerte' },
  ];
  return (
    <div>
      <StickyBar className="mb-4">
      <div data-tour="mk-tabs" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
        {tabs.map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} className={cn('relative h-11 shrink-0 rounded-full px-5 text-sm font-semibold transition-colors', tab === t.k ? 'text-ivory' : 'border border-line bg-white text-navy hover:border-navy/30')}>
            {tab === t.k && <motion.span layoutId="mk-tab" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>
      </StickyBar>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
          {tab === 'email' ? email : tab === 'reviews' ? reviews : promos}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
