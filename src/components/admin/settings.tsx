'use client';
import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import type { AuditEntry, Settings } from '@/lib/types';
import { fmtDateTime } from '@/lib/dates';
import { Button, Card, Dialog, Field, Toggle, useAction } from './ui';
import { NiceSelect } from './nice-select';
import { changePasswordAction, saveFaqAction, saveFloorsAction, saveHotelAction, saveServicesAction, saveStayTimesAction, saveHouseRulesAction } from '@/app/admin/actions/settings';
import type { HouseRules } from '@/lib/house-rules';
import { cn } from '@/lib/utils';
import { resetDemo, startRealDataAction } from '@/app/admin/actions/misc';

export function HotelForm({ hotel }: { hotel: Settings['hotel'] }) {
  const [h, setH] = useState(hotel);
  const { run, pending } = useAction();
  const s = (k: keyof typeof h, v: unknown) => setH({ ...h, [k]: v });
  return (
    <Card title="Dati della struttura" action={<Button size="sm" disabled={pending} onClick={() => run(() => saveHotelAction({ ...h, lat: Number(h.lat), lng: Number(h.lng) }))}>Salva</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <input className="field" value={h.name} onChange={(e) => s('name', e.target.value)} />
        </Field>
        <Field label="CIN (codice identificativo nazionale)">
          <input className="field" value={h.cin} onChange={(e) => s('cin', e.target.value)} />
        </Field>
        <Field label="Indirizzo" className="sm:col-span-2">
          <input className="field" value={h.addressLine} onChange={(e) => s('addressLine', e.target.value)} />
        </Field>
        <Field label="CAP">
          <input className="field" value={h.postalCode} onChange={(e) => s('postalCode', e.target.value)} />
        </Field>
        <Field label="Comune">
          <input className="field" value={h.city} onChange={(e) => s('city', e.target.value)} />
        </Field>
        <Field label="Latitudine" hint="Dal punto esatto su Google Maps">
          <input className="field" inputMode="decimal" value={h.lat} onChange={(e) => s('lat', e.target.value)} />
        </Field>
        <Field label="Longitudine">
          <input className="field" inputMode="decimal" value={h.lng} onChange={(e) => s('lng', e.target.value)} />
        </Field>
        <Field label="Telefono">
          <input className="field" value={h.phone} onChange={(e) => s('phone', e.target.value)} />
        </Field>
        <Field label="WhatsApp" hint="Numero per prenotare via WhatsApp (sul sito diventa un pulsante)">
          <input className="field" value={h.whatsapp ?? ''} onChange={(e) => s('whatsapp', e.target.value)} placeholder="+39 …" />
        </Field>
        <Field label="Email">
          <input className="field" type="email" value={h.email} onChange={(e) => s('email', e.target.value)} />
        </Field>
        <Field label="Partita IVA">
          <input className="field" value={h.vat ?? ''} onChange={(e) => s('vat', e.target.value)} />
        </Field>
        <Field label="Link Google Reviews">
          <input className="field" value={h.googleReviewUrl} placeholder="https://g.page/r/…" onChange={(e) => s('googleReviewUrl', e.target.value)} />
        </Field>
        <label className="flex items-center justify-between gap-3 border border-line p-3 text-sm sm:col-span-2">
          <span>
            Indirizzo verificato <span className="block text-xs text-mist">Solo se attivo il sito e il chatbot mostrano l’indirizzo esatto.</span>
          </span>
          <Toggle checked={h.addressVerified} onChange={(v) => s('addressVerified', v)} label="Indirizzo verificato" />
        </label>
        <label className="flex items-center justify-between gap-3 border border-line p-3 text-sm sm:col-span-2">
          <span>
            Orari e informazioni confermati <span className="block text-xs text-mist">Se disattivo, il sito indica “dati dimostrativi”.</span>
          </span>
          <Toggle checked={h.factsVerified} onChange={(v) => s('factsVerified', v)} label="Dati confermati" />
        </label>
      </div>
    </Card>
  );
}

export function FloorsCard({ enableLower }: { enableLower: boolean }) {
  const { run, pending } = useAction();
  return (
    <Card title="Piani">
      <p className="text-sm text-charcoal/80">Di base: “Piano terra (0)” e “Piano superiore”.</p>
      <label className="mt-4 flex items-center justify-between gap-3 border border-line p-3 text-sm">
        <span>Abilita “Piano inferiore”</span>
        <Toggle checked={enableLower} disabled={pending} onChange={(v) => run(() => saveFloorsAction(v))} label="Piano inferiore" />
      </label>
    </Card>
  );
}

export function ServicesCard({ services }: { services: Settings['services'] }) {
  const [list, setList] = useState(services);
  const { run, pending } = useAction();
  return (
    <Card title="Servizi della struttura" action={<Button size="sm" disabled={pending} onClick={() => run(() => saveServicesAction(list))}>Salva</Button>}>
      <p className="mb-4 text-xs text-mist">Il chatbot del sito risponde solo con ciò che è confermato qui. “Da confermare” = l’assistente rimanda alla reception.</p>
      <ul className="space-y-2">
        {list.map((x, i) => (
          <li key={x.key} className="grid gap-2 border border-line p-3 sm:grid-cols-[1fr_11rem]">
            <div>
              <p className="text-sm font-medium text-navy">{x.label}</p>
              <input className="mt-1 w-full border-b border-line bg-transparent py-1 text-xs outline-none" placeholder="Nota (es. orari, costo)" value={x.note} onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)))} aria-label={`Nota ${x.label}`} />
            </div>
            <NiceSelect
              className="w-full"
              label={`Stato ${x.label}`}
              value={x.status}
              onChange={(v) => setList(list.map((y, j) => (j === i ? { ...y, status: v } : y)))}
              options={[
                { value: 'confermato', label: 'Disponibile', dot: 'var(--color-sage)' },
                { value: 'non_disponibile', label: 'Non disponibile', dot: 'var(--color-terracotta)' },
                { value: 'da_confermare', label: 'Da confermare', dot: 'var(--color-gold)' },
              ]}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function FaqCard({ faq }: { faq: Settings['faq'] }) {
  const [list, setList] = useState(faq);
  const { run, pending } = useAction();
  return (
    <Card title="FAQ del chatbot" action={<Button size="sm" disabled={pending} onClick={() => run(() => saveFaqAction(list))}>Salva</Button>}>
      <ul className="space-y-3">
        {list.map((f, i) => (
          <li key={f.id} className="space-y-2 border border-line p-3">
            <div className="flex gap-2">
              <input className="field py-2 text-sm" value={f.question} onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, question: e.target.value } : y)))} aria-label="Domanda" />
              <button type="button" aria-label="Elimina FAQ" className="px-2 text-terracotta" onClick={() => setList(list.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <textarea className="field text-sm" rows={2} value={f.answer} onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, answer: e.target.value } : y)))} aria-label="Risposta" />
            <input className="field py-2 text-xs" value={f.keywords.join(', ')} onChange={(e) => setList(list.map((y, j) => (j === i ? { ...y, keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) } : y)))} aria-label="Parole chiave" placeholder="parole chiave, separate da virgola (anche in altre lingue)" />
          </li>
        ))}
      </ul>
      <Button variant="line" size="sm" className="mt-3" onClick={() => setList([...list, { id: `faq-${Date.now()}`, question: 'Nuova domanda', answer: 'Risposta', keywords: [] }])}>
        <Plus className="h-4 w-4" /> Aggiungi FAQ
      </Button>
    </Card>
  );
}

export function AccountCard({ demo }: { demo: boolean }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [reset, setReset] = useState(false);
  const { run, pending } = useAction();
  return (
    <Card title={demo ? 'Account e dati demo' : 'Account'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Password attuale">
          <input className="field" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label="Nuova password" hint="Minimo 10 caratteri">
          <input className="field" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      <Button size="sm" className="mt-3" disabled={pending || !cur || next.length < 10} onClick={() => run(() => changePasswordAction(cur, next), { onOk: () => { setCur(''); setNext(''); } })}>
        Cambia password
      </Button>
      {demo && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="text-sm text-charcoal/80">Ripristina i dati dimostrativi (camere, prenotazioni, planning) come all’inizio della presentazione.</p>
          <Button variant="line" size="sm" className="mt-3" onClick={() => setReset(true)}>
            <RotateCcw className="h-4 w-4" /> Ripristina dati demo
          </Button>
        </div>
      )}
      <Dialog
        open={reset}
        onClose={() => setReset(false)}
        title="Ripristinare i dati demo?"
        footer={
          <>
            <Button variant="line" onClick={() => setReset(false)}>
              Annulla
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => run(() => resetDemo(), { onOk: () => setReset(false) })}>
              Ripristina
            </Button>
          </>
        }
      >
        <p className="text-sm">Tutte le modifiche fatte durante la demo verranno sostituite dai dati di esempio generati per la data di oggi. Le foto caricate restano sul disco ma non saranno più collegate.</p>
      </Dialog>
    </Card>
  );
}

export function AuditCard({ entries }: { entries: AuditEntry[] }) {
  return (
    <Card title="Registro attività" padded={false}>
      <ul className="thin-scroll max-h-[520px] divide-y divide-line overflow-y-auto">
        {entries.map((a) => (
          <li key={a.id} className="grid grid-cols-[8.5rem_1fr] gap-3 px-5 py-2.5 text-xs">
            <span className="text-mist">{fmtDateTime(a.at)}</span>
            <span>
              <span className="font-semibold text-navy">{a.actor}</span> · {a.action} · <span className="text-charcoal/80">{a.details}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type DemoCounts = { bookings: number; guests: number; payments: number; reviews: number; messages: number; emails: number; promotions: number; blocks: number; rooms: number; photos: number; seasons: number; telegramChats: number };

/**
 * "Passa ai dati veri": one tile, one button. The dialog says in plain words what goes and what
 * stays; the owner types CANCELLA, so it can never happen with a stray click.
 */
export function GoLiveCard({ counts }: { counts: DemoCounts }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const { run, pending } = useAction();
  const ready = word.trim().toUpperCase() === 'CANCELLA';
  const goes = [
    `${counts.bookings} prenotazioni di prova e i loro ${counts.guests} ospiti`,
    `${counts.payments} pagamenti e rimborsi di prova`,
    `${counts.reviews} recensioni di esempio`,
    `${counts.messages + counts.emails} messaggi ed email di prova`,
    counts.promotions ? `${counts.promotions} codici sconto di esempio` : null,
    counts.blocks ? `${counts.blocks} chiusure di camere fatte a mano` : null,
    'statistiche, notifiche, registro attività e chat con l’assistente',
  ].filter(Boolean) as string[];
  const stays = [
    `${counts.rooms} camere con le loro ${counts.photos} foto`,
    `prezzi e ${counts.seasons} stagioni`,
    'dati della struttura, pagamenti, regole di cancellazione',
    'il tuo account e quello della reception',
    counts.telegramChats ? `Telegram (${counts.telegramChats} chat collegate)` : 'i collegamenti (email, Telegram, Stripe)',
  ];
  return (
    <Card title="Passa ai dati veri">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 0.61, 0.12, 1] }}>
        <div className="flex items-start gap-4">
          <motion.span
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold/15 text-gold-2"
            animate={{ rotate: [0, -8, 8, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 3.5 }}
          >
            <Sparkles className="h-5 w-5" />
          </motion.span>
          <p className="text-sm leading-relaxed text-charcoal/80">
            Quando l’hotel inizia a lavorare con il sito, cancella le prenotazioni e i dati di prova. Camere, foto e prezzi restano come sono. Si fa una volta sola.
          </p>
        </div>
        <Button variant="gold" size="sm" className="mt-4" onClick={() => setOpen(true)}>
          <Sparkles className="h-4 w-4" /> Inizia con i dati veri
        </Button>
      </motion.div>
      <Dialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        title="Iniziare con i dati veri?"
        footer={
          <>
            <Button variant="line" disabled={pending} onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button variant="danger" disabled={pending || !ready} onClick={() => run(() => startRealDataAction(word), { onOk: () => setOpen(false) })}>
              <Trash2 className="h-4 w-4" /> {pending ? 'Sto cancellando…' : 'Cancella i dati di prova'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="rounded-2xl bg-terracotta/[0.07] p-4">
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-terracotta">Si cancella</p>
            <ul className="space-y-1.5">
              {goes.map((g, i) => (
                <motion.li key={g} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }} className="flex gap-2">
                  <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-terracotta" /> {g}
                </motion.li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl bg-[#e8f1ea] p-4">
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[#2f6b45]">Resta</p>
            <ul className="space-y-1.5">
              {stays.map((s, i) => (
                <motion.li key={s} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }} className="flex gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2f6b45]" /> {s}
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-mist">Prima di cancellare, il sito salva una copia completa dei dati di prova. Dopo non si potranno più ripristinare dal pannello.</p>
        <Field label="Per confermare scrivi CANCELLA" className="mt-4">
          <input className="field" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" spellCheck={false} placeholder="CANCELLA" />
        </Field>
      </Dialog>
    </Card>
  );
}

/**
 * Arrivo e partenza: three big hours the owner changes with one tap, saved by themselves, and the
 * same box the guests see on the booking page (like Booking), so it is clear where it shows.
 */
export function StayTimesCard({ hotel, tax }: { hotel: Settings['hotel']; tax?: { enabled: boolean; amount: number } | null }) {
  const [t, setT] = useState({ checkInFrom: hotel.checkInFrom, checkInTo: hotel.checkInTo, checkOutBy: hotel.checkOutBy });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const save = (next: typeof t) => {
    setT(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setState('saving');
      const r = await saveStayTimesAction(next).catch(() => null);
      if (r?.ok) {
        setState('saved');
        setError(null);
      } else {
        setState('error');
        setError(r && !r.ok ? r.error : 'Non salvato: riprova.');
      }
    }, 650);
  };
  const tiles = [
    { k: 'checkInFrom' as const, label: 'Check-in dalle', hint: 'Da che ora la camera è pronta' },
    { k: 'checkInTo' as const, label: 'Check-in fino alle', hint: 'Ultimo orario per arrivare' },
    { k: 'checkOutBy' as const, label: 'Check-out entro le', hint: 'Quando la camera va lasciata' },
  ];
  return (
    <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title="Orari di arrivo e partenza" action={<span className={cn('text-xs font-semibold', state === 'error' ? 'text-terracotta' : 'text-mist')}>{state === 'saving' ? 'Salvo…' : state === 'saved' ? '✓ Salvato' : state === 'error' ? 'Non salvato' : 'Si salva da solo'}</span>}>
        <div className="grid gap-3 sm:grid-cols-3">
          {tiles.map((x, i) => (
            <motion.label key={x.k} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="group flex cursor-pointer flex-col rounded-2xl border border-line bg-ivory p-4 transition-colors focus-within:border-navy hover:border-navy/50">
              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-mist">{x.label}</span>
              <input type="time" step={900} value={t[x.k]} onChange={(e) => e.target.value && save({ ...t, [x.k]: e.target.value })} className="serif mt-1 w-full bg-transparent text-[2.2rem] leading-none text-navy outline-none" aria-label={x.label} />
              <span className="mt-2 text-[0.72rem] leading-snug text-mist">{x.hint}</span>
            </motion.label>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-terracotta">{error}</p>}
        <p className="mt-4 text-xs leading-relaxed text-mist">Gli orari compaiono nella pagina di pagamento, nell’email di conferma, nel piè di pagina del sito e nelle risposte del chatbot.</p>
      </Card>
      <Card title="Così lo vedono gli ospiti">
        <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-white">
          {[
            ['Check-in', 'sab 12 lug 2026', `dalle ${t.checkInFrom} alle ${t.checkInTo}`],
            ['Check-out', 'lun 14 lug 2026', `entro le ${t.checkOutBy}`],
          ].map(([l, d, h], i) => (
            <div key={l} className={cn('px-4 py-3.5', i === 1 && 'border-l border-line')}>
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-mist">{l}</p>
              <p className="mt-1 text-[0.95rem] font-semibold text-navy">{d}</p>
              <motion.p key={h} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-1 text-[0.78rem] text-charcoal/75">
                🕑 {h}
              </motion.p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-mist">Esempio con date di prova: sul sito ci sono le date scelte dall’ospite.</p>
        <a href="/admin/prezzi?tab=tassa" className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-ivory px-4 py-3 transition-colors hover:border-navy">
          <span className="text-xl" aria-hidden="true">🏛️</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-navy">Tassa di soggiorno</span>
            <span className="block text-xs text-mist">{tax?.enabled ? `${tax.amount.toLocaleString('it-IT', { minimumFractionDigits: 2 })} € per adulto a notte · si cambia in Prezzi` : 'Spenta · si accende in Prezzi → Tariffe e sconti'}</span>
          </span>
          <span className="text-xs font-semibold text-navy">Apri →</span>
        </a>
      </Card>
    </div>
  );
}

/**
 * Da sapere: the house rules as one-tap choices, saved by themselves. They appear on every room page,
 * in the booking summary and in the chatbot's answers ("si possono portare i cani?").
 */
export function HouseRulesCard({ initial }: { initial: HouseRules }) {
  const [r, setR] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<number | null>(null);
  const save = (next: HouseRules, wait = 300) => {
    setR(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setState('saving');
      const res = await saveHouseRulesAction(next).catch(() => null);
      setState(res?.ok ? 'saved' : 'error');
    }, wait);
  };
  const rows: { k: 'pets' | 'smoking' | 'parties' | 'children'; icon: string; label: string; opts: { v: string; l: string }[] }[] = [
    { k: 'pets', icon: '🐾', label: 'Animali', opts: [{ v: 'no', l: 'Non ammessi' }, { v: 'yes', l: 'Ammessi' }, { v: 'request', l: 'Su richiesta' }] },
    { k: 'smoking', icon: '🚭', label: 'Fumo', opts: [{ v: 'outside', l: 'Solo all’aperto' }, { v: 'no', l: 'Vietato ovunque' }] },
    { k: 'parties', icon: '🎉', label: 'Feste ed eventi', opts: [{ v: 'no', l: 'Non ammessi' }, { v: 'yes', l: 'Su richiesta' }] },
    { k: 'children', icon: '🧒', label: 'Bambini', opts: [{ v: 'yes', l: 'Benvenuti' }, { v: 'no', l: 'Solo adulti' }] },
  ];
  return (
    <Card className="mt-6" title="Da sapere · regole della casa" action={<span className={cn('text-xs font-semibold', state === 'error' ? 'text-terracotta' : 'text-mist')}>{state === 'saving' ? 'Salvo…' : state === 'saved' ? '✓ Salvato' : state === 'error' ? 'Non salvato: riprova' : 'Si salva da solo'}</span>}>
      <p className="mb-4 text-xs leading-relaxed text-mist">Gli ospiti le vedono nella pagina di ogni camera e nel riepilogo della prenotazione; il chatbot risponde con queste.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row, i) => (
          <motion.div key={row.k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="rounded-2xl border border-line bg-ivory p-3.5">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy">
              <span aria-hidden="true">{row.icon}</span> {row.label}
            </p>
            <div role="radiogroup" aria-label={row.label} className="flex flex-wrap gap-1.5">
              {row.opts.map((o) => {
                const on = r[row.k] === o.v;
                return (
                  <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => !on && save({ ...r, [row.k]: o.v } as HouseRules)} className={cn('relative rounded-full px-3.5 py-2 text-xs font-semibold transition-colors', on ? 'text-ivory' : 'bg-white text-navy ring-1 ring-line hover:ring-navy/50')}>
                    {on && <motion.span layoutId={`rule-${row.k}`} className="absolute inset-0 -z-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <span className="relative">{o.l}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ))}
        <label className="rounded-2xl border border-line bg-ivory p-3.5">
          <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy">
            <span aria-hidden="true">🌙</span> Silenzio dalle
          </span>
          <span className="flex items-center gap-2">
            <input type="time" step={1800} value={r.quietFrom} onChange={(e) => save({ ...r, quietFrom: e.target.value }, 650)} className="field max-w-[9rem] bg-white" aria-label="Silenzio dalle" />
            {r.quietFrom && (
              <button type="button" onClick={() => save({ ...r, quietFrom: '' })} className="text-xs font-semibold text-mist hover:text-terracotta">
                Togli
              </button>
            )}
          </span>
        </label>
        <label className="rounded-2xl border border-line bg-ivory p-3.5">
          <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy">
            <span aria-hidden="true">📝</span> Altro da sapere (facoltativo)
          </span>
          <input value={r.note} maxLength={300} onChange={(e) => save({ ...r, note: e.target.value }, 900)} placeholder="Es. Nessun ascensore per il primo piano" className="field bg-white" aria-label="Altro da sapere" />
        </label>
      </div>
    </Card>
  );
}
