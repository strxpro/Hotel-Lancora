'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Baby, Banknote, BedDouble, BedSingle, Check, CreditCard, Crown, ExternalLink, Layers, Loader2, Minus, Plus, Sofa, Sparkles, Trash2, TriangleAlert, Users, UsersRound, Wand2, X } from 'lucide-react';
import type { BedKind, FloorKey, Locale, Photo, Room, RoomStatus, RoomText, RoomType } from '@/lib/types';
import { BED_KINDS, bedsCountOf, bedsText, parseBeds, sleepsOf, type BedConfig } from '@/lib/beds';
import { AMENITIES, AMENITY_KEYS } from '@/content/amenities';
import { addDays, addMonths, fmtDate, todayISO } from '@/lib/dates';
import { monthStarts, type MonthPrice } from '@/lib/period-prices';
import { cn, money } from '@/lib/utils';
import { Flag } from '@/components/site/flags';
import { Badge, Button, Dialog, NumInput, Segmented, Toggle, useAction, useToast } from './ui';
import { PhotoManager } from './photo-manager';
import { addCustomAmenityAction, deleteRoomAction, improveTextAction, removeBlockAction, removeCustomAmenityAction, removeRatePeriodAction, saveRoomAction, suggestRoomAction } from '@/app/admin/actions/rooms';

const STEPS = [
  { t: 'La camera', d: 'Nome o numero, tipo, ospiti e prezzo' },
  { t: 'Piano e servizi', d: 'Dove si trova e cosa offre' },
  { t: 'Foto', d: 'La prima è la copertina' },
  { t: 'Descrizione', d: 'Il testo che leggono gli ospiti' },
  { t: 'Pubblica', d: 'Stato, date e anteprima' },
];
const TYPES: { value: RoomType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'singola', label: 'Singola', icon: BedSingle },
  { value: 'matrimoniale', label: 'Matrimoniale', icon: BedDouble },
  { value: 'doppia', label: 'Twin · letti separati', icon: BedSingle },
  { value: 'tripla', label: 'Tripla', icon: Users },
  { value: 'family', label: 'Family', icon: UsersRound },
  { value: 'suite', label: 'Junior suite', icon: Crown },
];
/** The usual beds of each typology: picked automatically, still editable below. */
const TYPE_BEDS: Partial<Record<RoomType, { label: string; beds: { kind: 'matrimoniale' | 'singolo'; count: number }[] }[]>> = {
  singola: [{ label: '1 letto singolo', beds: [{ kind: 'singolo', count: 1 }] }],
  matrimoniale: [{ label: '1 letto matrimoniale', beds: [{ kind: 'matrimoniale', count: 1 }] }],
  doppia: [{ label: '2 letti separati', beds: [{ kind: 'singolo', count: 2 }] }],
  tripla: [
    { label: 'Matrimoniale + 1 singolo', beds: [{ kind: 'matrimoniale', count: 1 }, { kind: 'singolo', count: 1 }] },
    { label: '3 letti separati', beds: [{ kind: 'singolo', count: 3 }] },
  ],
};
const LANGS: { code: Exclude<Locale, 'it'>; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polski' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
];
const EASE = [0.22, 0.61, 0.12, 1] as const;

export interface WizardProps {
  room: Room | null;
  enableLower: boolean;
  canEditPrice: boolean;
  canDelete: boolean;
  translation: { configured: boolean; label: string };
  ai: { configured: boolean; label: string };
  blocks: { id: string; from: string; to: string; reason: string }[];
  periods: { id: string; label: string; from: string; to: string; value: number; mode: 'fixed' | 'percent' }[];
  /** other rooms, to warn about a duplicate number before saving */
  existing?: { id: string; number: string; name: string }[];
  customAmenities?: { key: string; label: string }[];
  cash?: { enabled: boolean; percent: number };
  /** this room's price month by month (next 12 months), when editing */
  months?: MonthPrice[];
}

type Form = {
  number: string;
  name: string;
  type: RoomType;
  maxGuests: number;
  beds: string;
  bedsCount: number;
  basePrice: number;
  cashPrice: number | null;
  payment: 'both' | 'card' | 'cash';
  bedConfig: BedConfig;
  size: number | null;
  floor: FloorKey;
  photos: Photo[];
  text: RoomText;
  amenities: string[];
  status: RoomStatus;
  hidden: boolean;
};

export function RoomWizard({ room, enableLower, canEditPrice, canDelete, translation, ai, blocks, periods, existing = [], customAmenities = [], cash = { enabled: true, percent: 5 }, months, initialStep = 0 }: WizardProps & { initialStep?: number }) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(room);
  const [step, setStep] = useState(Math.min(initialStep, STEPS.length - 1));
  const [dir, setDir] = useState(1);
  const [id, setId] = useState<string | undefined>(room?.id);
  const [f, setF] = useState<Form>({
    number: room?.number ?? '',
    name: room?.name ?? '',
    type: room?.type ?? 'matrimoniale',
    maxGuests: room?.maxGuests ?? 2,
    beds: room?.beds ?? '1 letto matrimoniale',
    bedsCount: room?.bedsCount ?? 1,
    basePrice: room?.basePrice ?? 95,
    cashPrice: room?.cashPrice ?? null,
    payment: room?.payment ?? 'both',
    bedConfig: room?.bedConfig?.length ? room.bedConfig : room ? parseBeds(room.beds) : [{ kind: 'matrimoniale', count: 1 }],
    size: room?.size ?? null,
    floor: room?.floor ?? 'terra',
    photos: room?.photos ?? [],
    text: room?.text ?? { title: '', short: '', description: '' },
    amenities: room?.amenities ?? ['wifi', 'aria_condizionata', 'tv', 'bagno_privato', 'asciugacapelli'],
    status: room?.status ?? 'available',
    hidden: room?.hidden ?? false,
  });
  const [touched, setTouched] = useState<Set<string>>(() => new Set(room ? ['maxGuests', 'beds', 'bedsCount', 'basePrice', 'amenities', 'size'] : []));
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [newBlocks, setNewBlocks] = useState<{ from: string; to: string; reason: string }[]>([]);
  const [newPrices, setNewPrices] = useState<{ from: string; to: string; price: number; label: string }[]>([]);
  // price month by month: what the room has now (null = base price, 'mixed' = several prices) and the owner's changes
  const [monthNow, setMonthNow] = useState<Record<string, number | null | 'mixed'>>(() =>
    Object.fromEntries((months ?? monthStarts(todayISO()).map((m) => ({ m, min: room?.basePrice ?? 0, max: room?.basePrice ?? 0 }))).map((x) => [x.m, x.min !== x.max ? 'mixed' : x.min === (room?.basePrice ?? x.min) ? null : x.min])),
  );
  const [monthEdit, setMonthEdit] = useState<Record<string, number | null>>({});
  const [seasonal, setSeasonal] = useState(() => Object.values(monthNow).some((v) => v !== null));
  const [proposal, setProposal] = useState<{ mode: 'ai' | 'template'; provider: string; text: RoomText; warnings: string[] } | null>(null);
  const [saved, setSaved] = useState<{ slug: string; translating: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { run, pending } = useAction();
  const [helping, setHelping] = useState(false);
  const [extras, setExtras] = useState(customAmenities);
  const [newAmenity, setNewAmenity] = useState<string | null>(null);
  const dup = f.number.trim() ? (existing.find((r) => r.number === f.number.trim() && r.id !== id) ?? null) : null;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setTouched((t) => (t.has(k) ? t : new Set(t).add(k)));
  };
  /** beds chosen from a typology preset: text, count and guests follow */
  const applyBeds = (cfg: { kind: 'matrimoniale' | 'singolo'; count: number }[]) => {
    setF((x) => ({ ...x, bedConfig: cfg, beds: bedsText(cfg, 'it'), bedsCount: bedsCountOf(cfg), maxGuests: Math.min(10, Math.max(1, sleepsOf(cfg))) }));
    setTouched((t) => new Set(t).add('beds').add('bedsCount'));
  };

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (f.number.trim().length > 8) e.number = 'Massimo 8 caratteri.';
    else if (f.number.trim() && existing.some((r) => r.number === f.number.trim() && r.id !== id)) e.number = 'dup';
    if (f.cashPrice !== null && !(f.cashPrice >= 1 && f.cashPrice <= f.basePrice)) e.cashPrice = 'Il prezzo in contanti deve essere uguale o più basso di quello con carta.';
    if (!(f.maxGuests >= 1 && f.maxGuests <= 10)) e.maxGuests = 'Da 1 a 10 ospiti.';
    if (!(f.bedsCount >= 1 && f.bedsCount <= 8)) e.bedsCount = 'Da 1 a 8 letti.';
    if (!(f.basePrice >= 1 && f.basePrice <= 5000)) e.basePrice = 'Prezzo tra 1 e 5000 €.';
    if (f.size !== null && !(f.size >= 5 && f.size <= 300)) e.size = 'Superficie tra 5 e 300 m², oppure lasciala vuota.';
    return e;
  }, [f, existing, id]);
  const stepErrors = (s: number) => (s === 0 ? Object.keys(errors).length : 0);
  const err = (k: keyof Form) => (showErrors ? errors[k] : undefined);

  const go = (s: number) => {
    if (s > step && stepErrors(step)) {
      setShowErrors(true);
      toast('error', dup ? `Il numero ${dup.number} è già usato: cambialo oppure modifica quella camera.` : 'Controlla i campi evidenziati.');
      return;
    }
    setDir(s > step ? 1 : -1);
    setStep(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const payload = (statusOverride?: RoomStatus) => ({
    id,
    number: f.number.trim(),
    name: f.name.trim() || (f.number.trim() ? `Camera ${f.number.trim()}` : ''),
    type: f.type,
    maxGuests: Number(f.maxGuests),
    beds: f.beds.trim() || '—',
    bedsCount: Number(f.bedsCount),
    size: f.size ? Number(f.size) : null,
    floor: f.floor,
    basePrice: Number(f.basePrice),
    cashPrice: f.cashPrice === null ? null : Number(f.cashPrice),
    payment: f.payment,
    bedConfig: f.bedConfig.filter((b) => b.count > 0),
    status: statusOverride ?? f.status,
    hidden: f.hidden,
    amenities: f.amenities,
    photos: f.photos,
    text: { title: f.text.title || f.name || (f.number.trim() ? `Camera ${f.number}` : ''), short: f.text.short, description: f.text.description },
    blocks: newBlocks,
    prices: [
      ...newPrices,
      ...Object.entries(monthEdit).map(([m, v]) => ({ from: m, to: addMonths(m, 1), price: v, label: v === null ? '' : `${f.name.trim() || `Camera ${f.number.trim()}`} · ${fmtDate(m, 'it', { month: 'long', year: 'numeric' })}` })),
    ],
  });

  const save = (opts: { draft?: boolean } = {}) => {
    if (Object.keys(errors).length) {
      setShowErrors(true);
      setDir(-1);
      setStep(0);
      toast('error', 'Manca qualcosa nel primo passo: è evidenziato in rosso.');
      return;
    }
    run(() => saveRoomAction(payload(opts.draft ? 'draft' : undefined)), {
      onOk: (data) => {
        const d = data as { id: string; slug: string; translating: boolean };
        setId(d.id);
        setNewBlocks([]);
        setNewPrices([]);
        setMonthNow((now) => ({ ...now, ...monthEdit }));
        setMonthEdit({});
        if (opts.draft) setF((x) => ({ ...x, status: 'draft' }));
        setSaved({ slug: d.slug, translating: d.translating });
      },
    });
  };

  const help = () => {
    setHelping(true);
    run(
      () =>
        suggestRoomAction({
          id,
          number: f.number,
          name: f.name,
          type: f.type,
          floor: f.floor,
          maxGuests: f.maxGuests,
          beds: f.beds,
          bedsCount: f.bedsCount,
          size: f.size,
          basePrice: f.basePrice,
          amenities: f.amenities,
          text: f.text,
          touched: [...touched],
        }),
      {
        onOk: (d) => {
          setHelping(false);
          const r = d as { values: Partial<Form>; filled: string[]; mode: 'ai' | 'template' | null };
          const values = { ...r.values };
          if (!canEditPrice && editing) delete values.basePrice;
          if (typeof values.beds === 'string') {
            const cfg = parseBeds(values.beds);
            if (cfg.length) values.bedConfig = cfg;
          }
          setF((x) => ({ ...x, ...values }));
          setFlash(new Set(Object.keys(values)));
          window.setTimeout(() => setFlash(new Set()), 2200);
          toast('ok', r.filled.length ? `Ho completato: ${r.filled.join(', ')}${r.mode === 'template' ? ' (testo guidato, senza AI)' : ''}. Controlla e modifica come vuoi.` : 'Era già tutto compilato.');
        },
      },
    );
    window.setTimeout(() => setHelping(false), 15000);
  };

  const fl = (k: keyof Form) => flash.has(k);
  const pct = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="mx-auto max-w-5xl">
      {/* stepper */}
      <div className="rounded-3xl border border-line bg-white p-4 md:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-mist">
            Passo <strong className="text-navy">{step + 1}</strong> di {STEPS.length}
          </p>
          <div className="flex items-center gap-2">
            {id && f.status === 'available' && !f.hidden && room?.slug && (
              <a href={`/camere/${room.slug}`} target="_blank" className="hidden items-center gap-1.5 text-xs font-semibold text-navy sm:flex">
                Vedi sul sito <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <Button variant="line" size="sm" disabled={pending} onClick={() => save({ draft: !editing || f.status === 'draft' })}>
              Salva {!editing || f.status === 'draft' ? 'bozza' : 'modifiche'}
            </Button>
          </div>
        </div>
        <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-sand-2">
          <motion.div className="h-full rounded-full bg-[linear-gradient(90deg,#10283D,#B69562)]" animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: EASE }} />
        </div>
        <ol className="mt-4 grid grid-cols-5 gap-1.5">
          {STEPS.map((s, i) => {
            const done = i < step;
            const on = i === step;
            const bad = showErrors && stepErrors(i) > 0;
            return (
              <li key={s.t}>
                <button type="button" onClick={() => go(i)} aria-current={on ? 'step' : undefined} className={cn('group flex w-full flex-col items-center gap-1.5 rounded-2xl px-1 py-2 text-center transition-colors md:flex-row md:gap-2.5 md:px-2.5 md:text-left', on ? 'bg-navy text-ivory' : 'hover:bg-ivory')}>
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold transition-colors', bad ? 'bg-terracotta text-white' : on ? 'bg-gold text-navy-3' : done ? 'bg-sage text-white' : 'bg-sand-2 text-navy')}>{bad ? '!' : done ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                  <span className="min-w-0">
                    <span className={cn('block text-[0.62rem] font-semibold leading-tight md:truncate md:text-[0.78rem]', on ? 'text-ivory' : 'text-navy')}>{s.t}</span>
                    <span className={cn('hidden truncate text-[0.66rem] lg:block', on ? 'text-ivory/60' : 'text-mist')}>{s.d}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* AI helper */}
      {/* compact on phones: one line of title, one of text, the button beside it */}
      <motion.div layout data-tour="wizard-help" className="relative mt-3 overflow-hidden rounded-[1.4rem] bg-navy py-2.5 pl-2.5 pr-2.5 text-ivory md:mt-4 md:rounded-3xl md:p-4">
        <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-[radial-gradient(closest-side,rgba(182,149,98,0.35),transparent)]" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gold/20 md:h-11 md:w-11">
            <Wand2 className="h-[18px] w-[18px] text-gold md:h-5 md:w-5" />
          </span>
          <p className="min-w-0 flex-1 leading-tight">
            <strong className="block text-[0.86rem] font-semibold md:text-sm">Non sai cosa scrivere?</strong>
            <span className="mt-0.5 block truncate text-[0.72rem] text-ivory/65 md:hidden">L’AI compila tutto, tu controlli.</span>
            <span className="mt-0.5 hidden text-sm text-ivory/80 md:block">L’assistente compila quello che manca — numero, nome, letti, prezzo come le camere simili, servizi e descrizioni. Tu controlli e salvi.</span>
            <span className="mt-1 hidden text-xs text-ivory/55 md:block">{ai.configured ? `Testi con ${ai.label}` : 'Senza provider AI: testi guidati dai dati (vedi “AI gratis” nel README).'}</span>
          </p>
          <motion.button type="button" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={help} disabled={pending} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-gold px-3.5 text-[0.8rem] font-semibold text-navy-3 disabled:opacity-60 md:h-11 md:gap-2 md:px-5 md:text-sm">
            {helping && pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="md:hidden">Aiutami</span>
            <span className="hidden md:inline">Aiutami con AI</span>
          </motion.button>
        </div>
      </motion.div>

      {/* step body */}
      <div className="relative mt-4">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.section
            key={step}
            custom={dir}
            variants={{ enter: (d: number) => ({ opacity: 0, x: 40 * d }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: -40 * d }) }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.35, ease: EASE }}
            className="rounded-3xl border border-line bg-white p-5 md:p-8"
            aria-labelledby={`step-${step}`}
          >
            <h2 id={`step-${step}`} className="serif text-[2rem] leading-tight text-navy">
              {STEPS[step]!.t}
            </h2>
            <p className="mt-1 text-sm text-mist">{STEPS[step]!.d}</p>

            {step === 0 && (
              <div className="mt-7 space-y-7">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Input label="Numero camera (facoltativo)" hint={dup ? undefined : 'Es. 113. Lascia vuoto se le camere non hanno numero'} error={err('number') === 'dup' ? undefined : err('number')} flash={fl('number')}>
                    <input className={cn('field', dup && 'border-terracotta')} value={f.number} onChange={(e) => set('number', e.target.value)} inputMode="numeric" maxLength={8} aria-invalid={Boolean(err('number')) || Boolean(dup)} aria-describedby={dup ? 'dup-number' : undefined} />
                    <AnimatePresence initial={false}>
                      {dup && (
                        <motion.div id="dup-number" role="alert" initial={{ opacity: 0, height: 0, y: -4 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                          <div className="mt-2 rounded-2xl border border-terracotta/30 bg-terracotta/[0.07] p-3 text-sm text-charcoal">
                            <p className="flex items-start gap-2">
                              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-terracotta" />
                              <span>
                                Esiste già la camera <b>{dup.number}</b> “{dup.name}”. Cambia il numero qui, oppure modifica quella camera.
                              </span>
                            </p>
                            <div className="mt-2.5 flex flex-wrap gap-2 pl-6">
                              <Link href={`/admin/camere/${dup.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-navy px-4 text-xs font-semibold text-ivory">
                                Modifica la camera {dup.number} <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                              <button
                                type="button"
                                onClick={() => {
                                  const used = new Set(existing.map((r) => r.number));
                                  let n = Number(dup.number) || 100;
                                  while (used.has(String(n))) n++;
                                  set('number', String(n));
                                }}
                                className="inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-xs font-semibold text-navy"
                              >
                                Usa il primo numero libero
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Input>
                  <Input label="Nome (facoltativo)" hint="Es. “Cala Spinosa”" flash={fl('name')}>
                    <input className="field" value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
                  </Input>
                </div>
                <div>
                  <p className="label">Tipologia</p>
                  <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {TYPES.map((t) => {
                      const on = f.type === t.value;
                      return (
                        <button key={t.value} type="button" role="radio" aria-checked={on} onClick={() => { set('type', t.value); const preset = TYPE_BEDS[t.value]?.[0]; if (preset) applyBeds(preset.beds); }} className={cn('relative flex flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-sm transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-ivory text-navy hover:border-navy/40')}>
                          <t.icon className={cn('h-6 w-6', on ? 'text-gold' : 'text-gold-2')} />
                          {t.label}
                          {on && <motion.span layoutId="type-check" className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-navy-3"><Check className="h-3 w-3" /></motion.span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {(TYPE_BEDS[f.type]?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-mist">Letti tipici</span>
                    {TYPE_BEDS[f.type]!.map((p) => {
                      const on = bedsText(p.beds, 'it') === bedsText(f.bedConfig, 'it');
                      return (
                        <button key={p.label} type="button" aria-pressed={on} onClick={() => applyBeds(p.beds)} className={cn('h-9 rounded-full border px-3.5 text-[0.8rem] transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/40')}>
                          {p.label}
                        </button>
                      );
                    })}
                    {(f.type === 'matrimoniale' || f.type === 'doppia') && <span className="rounded-full bg-sage/15 px-2.5 py-1 text-[0.72rem] font-medium text-[#3f5a35]">Uso singola: sconto automatico per 1 ospite (Prezzi → Tariffe e sconti)</span>}
                  </div>
                )}
                <BedComposer
                  value={f.bedConfig}
                  flash={fl('beds') || fl('bedsCount')}
                  onChange={(cfg) => {
                    setF((x) => ({ ...x, bedConfig: cfg, beds: cfg.length ? bedsText(cfg, 'it') : x.beds, bedsCount: bedsCountOf(cfg), maxGuests: touched.has('maxGuests') ? x.maxGuests : Math.min(10, Math.max(1, sleepsOf(cfg))) }));
                    setTouched((t) => new Set(t).add('beds').add('bedsCount'));
                  }}
                />
                <div className="grid gap-5 sm:grid-cols-2">
                  <Input label="Ospiti massimi" hint={sleepsOf(f.bedConfig) && sleepsOf(f.bedConfig) !== f.maxGuests ? `I letti scelti ospitano ${sleepsOf(f.bedConfig)} persone` : undefined} error={err('maxGuests')} flash={fl('maxGuests')}>
                    <Stepper value={f.maxGuests} min={1} max={10} onChange={(v) => set('maxGuests', v)} />
                  </Input>
                  <Input label="Superficie m² (facoltativa)" error={err('size')} flash={fl('size')}>
                    <input className="field" type="number" min={5} max={300} value={f.size ?? ''} onChange={(e) => set('size', e.target.value ? Number(e.target.value) : null)} />
                  </Input>
                </div>
                <PricePair
                  card={f.basePrice}
                  cash={f.cashPrice}
                  globalPercent={cash.enabled ? cash.percent : 0}
                  cashEnabled={cash.enabled}
                  disabled={!canEditPrice && editing}
                  flash={fl('basePrice')}
                  error={err('basePrice') ?? err('cashPrice')}
                  onCard={(v) => set('basePrice', v)}
                  onCash={(v) => set('cashPrice', v)}
                />
                <MonthPrices
                  base={f.basePrice}
                  now={monthNow}
                  edit={monthEdit}
                  open={seasonal}
                  disabled={!canEditPrice && editing}
                  cashNote={cash.enabled}
                  onOpen={setSeasonal}
                  onEdit={setMonthEdit}
                />
                <div>
                  <p className="label">Come si paga questa camera</p>
                  <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                    {([
                      { v: 'both', t: 'Carta e contanti', d: 'L’ospite sceglie' },
                      { v: 'card', t: 'Solo carta', d: 'Pagamento online sul sito' },
                      { v: 'cash', t: 'Solo contanti', d: 'Si paga in hotel all’arrivo' },
                    ] as const).map((o) => {
                      const on = f.payment === o.v;
                      return (
                        <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => set('payment', o.v)} className={cn('flex flex-col items-start gap-0.5 rounded-2xl border px-3.5 py-3 text-left transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-ivory text-navy hover:border-navy/40')}>
                          <span className="text-sm font-semibold">{o.t}</span>
                          <span className={cn('text-[0.72rem]', on ? 'text-ivory/70' : 'text-mist')}>{o.d}</span>
                        </button>
                      );
                    })}
                  </div>
                  {f.payment === 'cash' && !cash.enabled && <p className="mt-2 text-xs text-terracotta">Attenzione: in Pagamenti il pagamento in hotel è spento. Finché resta spento, per questa camera vale l’impostazione generale.</p>}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="mt-7 space-y-8">
                <div>
                  <p className="label">Piano</p>
                  <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        { v: 'terra', t: 'Piano terra', d: 'Accesso senza scale' },
                        { v: 'superiore', t: 'Piano superiore', d: 'Primo piano o più' },
                        ...(enableLower ? [{ v: 'inferiore', t: 'Piano inferiore', d: 'Sotto il livello d’ingresso' }] : []),
                      ] as { v: FloorKey; t: string; d: string }[]
                    ).map((o) => (
                      <button key={o.v} type="button" role="radio" aria-checked={f.floor === o.v} onClick={() => set('floor', o.v)} className={cn('relative rounded-2xl border p-5 text-left transition-colors', f.floor === o.v ? 'border-navy bg-navy text-ivory' : 'border-line bg-ivory hover:border-navy/50')}>
                        <span className="serif block text-[1.5rem] leading-tight">{o.t}</span>
                        <span className={cn('mt-1 block text-xs', f.floor === o.v ? 'text-ivory/70' : 'text-mist')}>{o.d}</span>
                        {f.floor === o.v && <Check className="absolute right-4 top-4 h-5 w-5 text-gold" />}
                      </button>
                    ))}
                  </div>
                  {!enableLower && <p className="mt-3 text-xs text-mist">Serve anche il “Piano inferiore”? Si attiva in Impostazioni → Piani.</p>}
                </div>
                <div className={cn('rounded-2xl transition-shadow duration-700', fl('amenities') && 'shadow-[0_0_0_3px_rgba(182,149,98,0.45)]')}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="label">Servizi e comfort</p>
                    <span className="text-xs text-mist">{f.amenities.length} selezionati</span>
                  </div>
                  <motion.div layout className="flex flex-wrap gap-2">
                    {AMENITY_KEYS.map((k) => {
                      const on = f.amenities.includes(k);
                      return (
                        <motion.button key={k} layout type="button" aria-pressed={on} whileTap={{ scale: 0.94 }} onClick={() => set('amenities', on ? f.amenities.filter((a) => a !== k) : [...f.amenities, k])} className={cn('flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/40')}>
                          {on && <Check className="h-3.5 w-3.5 text-gold" />}
                          {AMENITIES[k]!.label.it}
                        </motion.button>
                      );
                    })}
                    <AnimatePresence initial={false}>
                      {extras.map((c) => {
                        const on = f.amenities.includes(c.key);
                        return (
                          <motion.span
                            key={c.key}
                            layout
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.4, filter: 'blur(4px)', transition: { duration: 0.28 } }}
                            className="group relative"
                          >
                            <motion.button type="button" aria-pressed={on} whileTap={{ scale: 0.94 }} onClick={() => set('amenities', on ? f.amenities.filter((a) => a !== c.key) : [...f.amenities, c.key])} className={cn('flex items-center gap-1.5 rounded-full border border-dashed py-2 pl-3.5 pr-8 text-sm transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-gold/60 bg-gold/[0.07] text-navy hover:border-navy/40')}>
                              {on ? <Check className="h-3.5 w-3.5 text-gold" /> : <Sparkles className="h-3.5 w-3.5 text-gold-2" />}
                              {c.label}
                            </motion.button>
                            <button
                              type="button"
                              aria-label={`Elimina “${c.label}” da tutte le camere`}
                              title="Elimina da tutte le camere"
                              onClick={() =>
                                run(() => removeCustomAmenityAction(c.key), {
                                  onOk: (d) => {
                                    setExtras((x) => x.filter((y) => y.key !== c.key));
                                    setF((x) => ({ ...x, amenities: x.amenities.filter((a) => a !== c.key) }));
                                    const n = (d as { rooms: number }).rooms;
                                    toast('ok', `“${c.label}” eliminato${n ? ` (tolto da ${n} ${n === 1 ? 'camera' : 'camere'})` : ''}.`);
                                  },
                                })
                              }
                              className={cn('absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full transition-[opacity,transform,background-color] duration-200 md:scale-75 md:opacity-0 md:group-hover:scale-100 md:group-hover:opacity-100 md:focus-visible:scale-100 md:focus-visible:opacity-100', on ? 'bg-white/15 text-ivory hover:bg-terracotta' : 'bg-navy/10 text-navy hover:bg-terracotta hover:text-white')}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </motion.span>
                        );
                      })}
                    </AnimatePresence>
                    <motion.span layout>
                      {newAmenity === null ? (
                        <motion.button type="button" whileTap={{ scale: 0.94 }} onClick={() => setNewAmenity('')} className="flex items-center gap-1.5 rounded-full border border-dashed border-navy/30 px-3.5 py-2 text-sm text-navy transition-colors hover:border-navy hover:bg-navy/[0.03]">
                          <Plus className="h-3.5 w-3.5" /> Aggiungi un servizio
                        </motion.button>
                      ) : (
                        <form
                          className="flex items-center gap-1 rounded-full border border-navy bg-white py-1 pl-3.5 pr-1 shadow-[0_8px_24px_-14px_rgba(16,40,61,0.6)]"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const label = newAmenity.trim();
                            if (label.length < 2) return;
                            run(() => addCustomAmenityAction(label), {
                              onOk: (d) => {
                                const c = d as { key: string; label: string };
                                setExtras((x) => (x.some((y) => y.key === c.key) ? x : [...x, c]));
                                setF((x) => ({ ...x, amenities: x.amenities.includes(c.key) ? x.amenities : [...x.amenities, c.key] }));
                                setNewAmenity(null);
                                toast('ok', `“${c.label}” aggiunto: lo trovi anche nelle altre camere.`);
                              },
                            });
                          }}
                        >
                          <input autoFocus value={newAmenity} maxLength={40} onChange={(e) => setNewAmenity(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNewAmenity(null)} placeholder="Es. Macchina del caffè" className="w-44 bg-transparent text-sm outline-none" aria-label="Nuovo servizio" />
                          <button type="submit" disabled={pending || newAmenity.trim().length < 2} className="flex h-8 items-center gap-1 rounded-full bg-navy px-3 text-xs font-semibold text-ivory disabled:opacity-40">
                            <Check className="h-3.5 w-3.5" /> Aggiungi
                          </button>
                          <button type="button" aria-label="Annulla" onClick={() => setNewAmenity(null)} className="flex h-8 w-8 items-center justify-center rounded-full text-mist hover:text-navy">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      )}
                    </motion.span>
                  </motion.div>
                  <p className="mt-3 text-xs text-mist">I servizi che aggiungi tu (bordo tratteggiato) restano disponibili per tutte le camere e vengono tradotti per il sito. Passa sopra e premi × per eliminarli.</p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="mt-7">
                <PhotoManager photos={f.photos} onChange={(p) => set('photos', p)} roomLabel={`Camera ${f.number || ''} ${f.name}`.trim()} />
                <p className="mt-4 text-xs text-mist">La prima foto è la copertina (card e anteprime). Puoi salvare anche senza foto e aggiungerle dopo.</p>
              </div>
            )}

            {step === 3 && (
              <div className="mt-7 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/[0.06] p-4">
                  <p className="text-sm text-charcoal/85">
                    Scrivi anche solo due appunti: l’assistente li trasforma in un testo elegante, <strong>senza inventare servizi</strong>.
                  </p>
                  <Button
                    disabled={pending}
                    onClick={() =>
                      run(() => improveTextAction({ facts: { name: f.name || `Camera ${f.number}`, type: f.type, maxGuests: f.maxGuests, beds: f.beds, size: f.size, floor: f.floor, amenities: f.amenities }, text: { title: f.text.title || f.name, short: f.text.short, description: f.text.description } }), {
                        onOk: (d) => setProposal(d as typeof proposal),
                      })
                    }
                  >
                    <Sparkles className="h-4 w-4 text-gold" /> {pending ? 'Sto scrivendo…' : 'Migliora con AI'}
                  </Button>
                </div>
                <Input label="Titolo" flash={fl('text')}>
                  <input className="field" value={f.text.title} placeholder={f.name || 'Es. Camera Cala Spinosa'} onChange={(e) => set('text', { ...f.text, title: e.target.value })} maxLength={80} />
                </Input>
                <Input label="Descrizione breve" hint={`${f.text.short.length}/200 · appare sulle card del sito`} flash={fl('text')}>
                  <input className="field" value={f.text.short} maxLength={200} onChange={(e) => set('text', { ...f.text, short: e.target.value })} />
                </Input>
                <Input label="Descrizione completa" hint="Lascia una riga vuota tra i paragrafi" flash={fl('text')}>
                  <textarea className="field" rows={7} value={f.text.description} onChange={(e) => set('text', { ...f.text, description: e.target.value })} />
                </Input>
                <p className="flex items-start gap-2 text-xs text-mist">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-2" />
                  {translation.configured ? `Scrivi solo in italiano: al salvataggio il testo viene tradotto e pubblicato da solo in inglese, polacco, tedesco, francese e spagnolo (${translation.label}).` : 'Scrivi in italiano. Con un servizio di traduzione gratuito attivo (vedi README) le altre 5 lingue si aggiornano da sole al salvataggio.'}
                </p>
              </div>
            )}

            {step === 4 && (
              <div className="mt-7 grid gap-8 [&>*]:min-w-0 lg:grid-cols-[1fr_300px]">
                <div className="space-y-8">
                  <div>
                    <p className="label">Stato</p>
                    <Segmented
                      id="room-status"
                      value={f.status}
                      onChange={(v) => set('status', v)}
                      options={[
                        { value: 'available', label: 'Disponibile' },
                        { value: 'unavailable', label: 'Non disponibile' },
                        { value: 'draft', label: 'Bozza' },
                      ]}
                    />
                    <p className="mt-2 text-xs text-mist">{f.status === 'available' ? 'Prenotabile sul sito.' : f.status === 'unavailable' ? 'Visibile ma non prenotabile (es. lavori).' : 'Non visibile e non prenotabile.'}</p>
                  </div>
                  <label className="flex items-center justify-between gap-4 rounded-2xl border border-line p-4">
                    <span>
                      <span className="block text-sm font-medium text-navy">Nascondi dal sito</span>
                      <span className="block text-xs text-mist">Resta nel planning ma sparisce dall’offerta pubblica.</span>
                    </span>
                    <Toggle checked={f.hidden} onChange={(v) => set('hidden', v)} label="Nascondi dal sito" />
                  </label>
                  <RangeList
                    title="Blocca date"
                    hint="La camera non sarà prenotabile in queste notti (la data finale è il giorno in cui torna libera)."
                    existing={blocks.map((b) => ({ id: b.id, line: `${fmtDate(b.from)} → ${fmtDate(b.to)} · ${b.reason}`, remove: () => run(() => removeBlockAction(b.id)) }))}
                    pending={newBlocks.map((b, i) => ({ line: `${fmtDate(b.from)} → ${fmtDate(b.to)} · ${b.reason}`, remove: () => setNewBlocks(newBlocks.filter((_, j) => j !== i)) }))}
                    onAdd={(from, to, extra) => setNewBlocks([...newBlocks, { from, to, reason: extra || 'Blocco manuale' }])}
                    extraLabel="Motivo"
                  />
                  {canEditPrice && (
                    <RangeList
                      title="Prezzo diverso in alcuni giorni"
                      hint="Prezzo fisso per notte nel periodo indicato (es. eventi, ponti)."
                      existing={periods.map((p) => ({ id: p.id, line: `${p.label}: ${fmtDate(p.from)} → ${fmtDate(p.to)} · ${p.mode === 'fixed' ? money(p.value) : `${p.value > 0 ? '+' : ''}${p.value}%`}`, remove: () => run(() => removeRatePeriodAction(p.id)) }))}
                      pending={newPrices.map((p, i) => ({ line: `${fmtDate(p.from)} → ${fmtDate(p.to)} · ${money(p.price)}`, remove: () => setNewPrices(newPrices.filter((_, j) => j !== i)) }))}
                      onAdd={(from, to, extra) => setNewPrices([...newPrices, { from, to, price: Number(extra) || f.basePrice, label: `Camera ${f.number}` }])}
                      extraLabel="Prezzo €"
                      extraNumeric
                    />
                  )}
                  <div>
                    <p className="label">Lingue del sito</p>
                    <ul className="flex flex-wrap gap-2">
                      {LANGS.map((l) => {
                        const tr = room?.translations[l.code];
                        const ok = Boolean(tr?.published);
                        return (
                          <li key={l.code} className={cn('flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs', ok ? 'border-sage/40 bg-sage/10 text-sage' : 'border-line text-mist')}>
                            <Flag locale={l.code} className="h-3.5 w-5 rounded-[3px]" />
                            {l.label}
                            {ok ? <Check className="h-3.5 w-3.5" /> : <span>· {translation.configured ? 'al salvataggio' : 'italiano'}</span>}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-xs text-mist">{translation.configured ? 'Le traduzioni sono automatiche: non devi fare nulla.' : 'Senza servizio di traduzione il sito mostra il testo italiano nelle altre lingue.'}</p>
                  </div>
                </div>
                <Preview f={f} />
              </div>
            )}

            <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
              <Button variant="ghost" disabled={step === 0} onClick={() => go(step - 1)}>
                <ArrowLeft className="h-4 w-4" /> Indietro
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => go(step + 1)}>
                  Avanti <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="gold" disabled={pending} onClick={() => save()}>
                  {pending ? 'Salvataggio…' : editing ? 'Salva e pubblica' : 'Crea camera'}
                </Button>
              )}
            </div>
          </motion.section>
        </AnimatePresence>
        {editing && canDelete && (
          <div className="mt-6 text-right">
            <button type="button" className="inline-flex items-center gap-2 text-xs text-terracotta" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Elimina camera
            </button>
          </div>
        )}
      </div>

      {/* AI before/after */}
      <Dialog
        open={Boolean(proposal)}
        onClose={() => setProposal(null)}
        title={proposal?.mode === 'ai' ? 'Proposta dell’assistente' : 'Composizione guidata (senza AI)'}
        width={920}
        footer={
          <>
            <Button variant="line" onClick={() => setProposal(null)}>
              Rifiuta
            </Button>
            <Button
              onClick={() => {
                if (proposal) set('text', proposal.text);
                setProposal(null);
                toast('ok', 'Testo applicato. Ricorda di salvare.');
              }}
            >
              <Check className="h-4 w-4" /> Accetta
            </Button>
          </>
        }
      >
        {proposal && (
          <div>
            <p className="mb-4 text-xs text-mist">{proposal.provider}</p>
            {proposal.warnings.length > 0 && (
              <p className="mb-4 flex items-start gap-2 rounded-2xl border border-gold/40 bg-gold/10 p-3 text-sm text-gold-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Il testo menziona elementi non presenti nei dati: <strong>{proposal.warnings.join(', ')}</strong>. Verifica prima di accettare.
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { h: 'Prima', t: { title: f.text.title || f.name, short: f.text.short, description: f.text.description } },
                { h: 'Dopo', t: proposal.text },
              ].map((c) => (
                <div key={c.h} className={cn('rounded-2xl border p-4', c.h === 'Dopo' ? 'border-navy' : 'border-line bg-ivory')}>
                  <p className="label">{c.h}</p>
                  <p className="serif text-2xl text-navy">{c.t.title || '—'}</p>
                  <p className="mt-2 text-sm font-medium text-charcoal">{c.t.short || '—'}</p>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-charcoal/80">{c.t.description || '—'}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Dialog>

      {/* success */}
      <AnimatePresence>
        {saved && (
          <motion.div className="fixed inset-0 z-[120] flex items-center justify-center bg-navy-3/60 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ scale: 0.92, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="w-full max-w-md rounded-[2rem] bg-ivory p-8 text-center">
              <motion.svg viewBox="0 0 52 52" className="mx-auto h-16 w-16 text-sage" initial="h" animate="v">
                <motion.circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="1.5" variants={{ h: { pathLength: 0 }, v: { pathLength: 1, transition: { duration: 0.6 } } }} />
                <motion.path d="M15 27l7 7 15-16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" variants={{ h: { pathLength: 0 }, v: { pathLength: 1, transition: { delay: 0.45, duration: 0.4 } } }} />
              </motion.svg>
              <p className="serif mt-6 text-[2rem] leading-tight text-navy">Camera {f.number} salvata</p>
              <p className="mt-2 text-sm text-mist">{f.status === 'available' && !f.hidden ? 'È già visibile e prenotabile sul sito.' : 'Salvata come bozza / non pubblicata.'}</p>
              {saved.translating && <p className="mt-2 text-xs text-sage">Traduzioni in corso nelle altre 5 lingue: compariranno da sole sul sito tra pochi secondi.</p>}
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                {f.status === 'available' && !f.hidden && (
                  <a href={`/camere/${saved.slug}`} target="_blank" className="btn btn-navy h-11 min-h-0">
                    Vedi sul sito
                  </a>
                )}
                <Button
                  variant="line"
                  onClick={() => {
                    setSaved(null);
                    if (!editing && id) router.replace(`/admin/camere/${id}`);
                    else router.refresh();
                  }}
                >
                  Continua a modificare
                </Button>
                <Link href="/admin/camere" className="btn btn-line h-11 min-h-0 text-navy">
                  Tutte le camere
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Eliminare la camera ${f.number}?`}
        footer={
          <>
            <Button variant="line" onClick={() => setConfirmDelete(false)}>
              Annulla
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => id && run(() => deleteRoomAction(id), { onOk: () => router.replace('/admin/camere') })}>
              Elimina definitivamente
            </Button>
          </>
        }
      >
        <p className="text-sm text-charcoal/85">L’operazione non è reversibile. Se la camera ha prenotazioni future verrà rifiutata: in quel caso puoi nasconderla dal sito.</p>
      </Dialog>
    </div>
  );
}

function Input({ label, hint, error, flash, className, children }: { label: string; hint?: string; error?: string; flash?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('block', className)}>
      <span className="label">{label}</span>
      <motion.span className={cn('block rounded-[0.95rem] transition-shadow duration-700', error ? 'shadow-[0_0_0_2px_rgba(181,90,63,0.7)]' : flash ? 'shadow-[0_0_0_3px_rgba(182,149,98,0.55)]' : '')} animate={error ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }} transition={{ duration: 0.4 }}>
        {children}
      </motion.span>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.span key="e" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-1.5 block text-xs text-terracotta">
            {error}
          </motion.span>
        ) : (
          hint && <span className="mt-1.5 block text-xs text-mist">{hint}</span>
        )}
      </AnimatePresence>
    </label>
  );
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="field flex items-center justify-between gap-2 py-1.5 pl-2 pr-2">
      <button type="button" aria-label="Meno" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className="flex h-9 w-9 items-center justify-center rounded-full bg-sand-2 text-navy disabled:opacity-30">
        <Minus className="h-4 w-4" />
      </button>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={value} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} className="serif text-2xl tabular-nums text-navy">
          {value}
        </motion.span>
      </AnimatePresence>
      <button type="button" aria-label="Più" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-ivory disabled:opacity-30">
        <Plus className="h-4 w-4" />
      </button>
    </span>
  );
}

/** How the room card will look on the website. */
function Preview({ f }: { f: Form }) {
  const photo = f.photos[0];
  return (
    <div className="lg:sticky lg:top-24 lg:self-start">
      <p className="label">Anteprima sul sito</p>
      <div className="overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-[0_24px_60px_-40px_rgba(16,40,61,0.5)]">
        <div className="relative aspect-[4/3] bg-sand">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.src} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-mist">Nessuna foto</span>
          )}
          <span className="absolute left-3 top-3 rounded-full bg-ivory/90 px-2.5 py-1 text-[0.62rem] font-semibold text-navy">N° {f.number || '—'}</span>
        </div>
        <div className="p-4">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-gold-2">{TYPES.find((t) => t.value === f.type)?.label}</p>
          <p className="serif mt-1 text-[1.5rem] leading-tight text-navy">{f.text.title || f.name || `Camera ${f.number}`}</p>
          <p className="mt-1 line-clamp-2 text-xs text-mist">{f.text.short || 'La descrizione breve apparirà qui.'}</p>
          <p className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-[0.6rem] uppercase tracking-[0.16em] text-mist">da / notte</span>
            <span className="serif text-[1.5rem] text-navy">{money(f.basePrice)}</span>
          </p>
        </div>
      </div>
      <p className="mt-2 flex flex-wrap gap-1.5">
        {f.status !== 'available' && <Badge tone="gray">{f.status === 'draft' ? 'bozza' : 'non disponibile'}</Badge>}
        {f.hidden && <Badge tone="gray">nascosta</Badge>}
      </p>
    </div>
  );
}

function RangeList({ title, hint, existing, pending, onAdd, extraLabel, extraNumeric }: { title: string; hint: string; existing: { id: string; line: string; remove: () => void }[]; pending: { line: string; remove: () => void }[]; onAdd: (from: string, to: string, extra: string) => void; extraLabel: string; extraNumeric?: boolean }) {
  const today = todayISO();
  const [from, setFrom] = useState(addDays(today, 7));
  const [to, setTo] = useState(addDays(today, 10));
  const [extra, setExtra] = useState('');
  return (
    <div>
      <p className="label">{title}</p>
      <p className="mb-3 text-xs text-mist">{hint}</p>
      <ul className="mb-3 space-y-1.5">
        {existing.map((x) => (
          <li key={x.id} className="flex items-center justify-between rounded-2xl border border-line bg-ivory px-3 py-2 text-sm">
            {x.line}
            <button type="button" onClick={x.remove} className="text-xs text-terracotta">
              Rimuovi
            </button>
          </li>
        ))}
        {pending.map((x, i) => (
          <li key={i} className="flex items-center justify-between rounded-2xl border border-dashed border-navy/40 px-3 py-2 text-sm">
            <span>
              {x.line} <Badge tone="gold">da salvare</Badge>
            </span>
            <button type="button" onClick={x.remove} className="text-xs text-terracotta">
              Rimuovi
            </button>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input type="date" className="field py-2 text-sm" value={from} min={today} onChange={(e) => setFrom(e.target.value)} aria-label="Dal" />
        <input type="date" className="field py-2 text-sm" value={to} min={addDays(from, 1)} onChange={(e) => setTo(e.target.value)} aria-label="Al (libera da)" />
        <input className="field py-2 text-sm" placeholder={extraLabel} inputMode={extraNumeric ? 'decimal' : undefined} value={extra} onChange={(e) => setExtra(e.target.value)} aria-label={extraLabel} />
        <Button
          variant="line"
          size="sm"
          className="h-auto"
          disabled={to <= from || (extraNumeric && !(Number(extra) > 0))}
          onClick={() => {
            onAdd(from, to, extra);
            setExtra('');
          }}
        >
          Aggiungi
        </Button>
      </div>
    </div>
  );
}

const BED_UI: Record<BedKind, { label: string; note: string; icon: React.ComponentType<{ className?: string }> }> = {
  matrimoniale: { label: 'Matrimoniale', note: '2 persone', icon: BedDouble },
  francese: { label: 'Alla francese', note: '1–2 persone, 140 cm', icon: BedDouble },
  singolo: { label: 'Singolo', note: '1 persona', icon: BedSingle },
  divano_letto: { label: 'Divano letto', note: 'fino a 2 persone', icon: Sofa },
  castello: { label: 'A castello', note: '2 persone', icon: Layers },
  culla: { label: 'Culla', note: 'per neonati', icon: Baby },
};

/** "1 double + 1 single" in a few taps: each bed type has its own counter and a live preview. */
function BedComposer({ value, onChange, flash }: { value: BedConfig; onChange: (v: BedConfig) => void; flash?: boolean }) {
  const count = (k: BedKind) => value.find((b) => b.kind === k)?.count ?? 0;
  const setCount = (k: BedKind, n: number) => {
    const next = BED_KINDS.map((b) => ({ kind: b.kind, count: b.kind === k ? n : count(b.kind) })).filter((b) => b.count > 0);
    onChange(next);
  };
  const beds = value.flatMap((b) => Array.from({ length: b.count }, (_, i) => ({ id: `${b.kind}-${i}`, kind: b.kind })));
  const sleeps = sleepsOf(value);
  return (
    <div className={cn('rounded-[1.6rem] border border-line bg-ivory p-4 transition-shadow duration-700 md:p-5', flash && 'shadow-[0_0_0_3px_rgba(182,149,98,0.55)]')}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label mb-1">Letti nella camera</p>
          <p className="text-sm text-mist">Tocca + sui letti presenti. Il testo per il sito si scrive da solo, in tutte le lingue.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1.5 text-xs text-navy ring-1 ring-line">{sleeps ? `Dormono fino a ${sleeps} ${sleeps === 1 ? 'persona' : 'persone'}` : 'Nessun letto'}</span>
      </div>
      <div className="mt-4 flex min-h-[4.5rem] flex-wrap items-center gap-2 rounded-2xl border border-dashed border-line bg-white px-3 py-3" aria-live="polite">
        <AnimatePresence initial={false}>
          {beds.length === 0 && (
            <motion.span key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm text-mist">
              Aggiungi almeno un letto qui sotto.
            </motion.span>
          )}
          {beds.map((b) => {
            const Ui = BED_UI[b.kind];
            return (
              <motion.span key={b.id} layout initial={{ opacity: 0, scale: 0.4, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.4 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={cn('flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold', b.kind === 'culla' ? 'bg-sage/15 text-[#3f5a35]' : 'bg-navy text-ivory')}>
                <Ui.icon className="h-4 w-4" /> {Ui.label}
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>
      <p className="mt-2 text-xs text-mist">
        Sul sito: <span className="font-semibold text-navy">{value.length ? bedsText(value, 'it') : '—'}</span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BED_KINDS.map((b) => {
          const n = count(b.kind);
          const Ui = BED_UI[b.kind];
          return (
            <div key={b.kind} className={cn('flex flex-col gap-3 rounded-2xl border p-3 transition-colors', n ? 'border-navy/40 bg-white' : 'border-line bg-white/60')}>
              <div className="flex items-start gap-2.5">
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors', n ? 'bg-navy text-gold' : 'bg-sand-2 text-navy')}>
                  <Ui.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight text-navy">{Ui.label}</span>
                  <span className="block text-[0.7rem] text-mist">{Ui.note}</span>
                </span>
              </div>
              <div className="flex items-center justify-between rounded-full bg-ivory p-1">
                <button type="button" aria-label={`Togli ${Ui.label}`} disabled={!n} onClick={() => setCount(b.kind, n - 1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-navy shadow-sm disabled:opacity-30">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={n} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} className="serif text-xl tabular-nums text-navy">
                    {n}
                  </motion.span>
                </AnimatePresence>
                <button type="button" aria-label={`Aggiungi ${Ui.label}`} disabled={n >= 6} onClick={() => setCount(b.kind, n + 1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-navy text-ivory disabled:opacity-30">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Card price + cash price side by side; cash can follow the standard discount or be set by hand. */
function PricePair({ card, cash, globalPercent, cashEnabled, disabled, flash, error, onCard, onCash }: { card: number; cash: number | null; globalPercent: number; cashEnabled: boolean; disabled?: boolean; flash?: boolean; error?: string; onCard: (v: number) => void; onCash: (v: number | null) => void }) {
  const auto = Math.round(card * (1 - globalPercent / 100) * 100) / 100;
  const effective = cash ?? auto;
  const saving = card > 0 ? Math.round((1 - effective / card) * 1000) / 10 : 0;
  return (
    <div className={cn('rounded-[1.6rem] border border-line p-4 transition-shadow duration-700 md:p-5', flash && 'shadow-[0_0_0_3px_rgba(182,149,98,0.55)]', error && 'shadow-[0_0_0_2px_rgba(181,90,63,0.7)]')}>
      <p className="label mb-1">Prezzo per notte</p>
      <p className="text-sm text-mist">Sul sito l’ospite vede entrambi i prezzi quando sceglie le date, e decide come pagare. Qui sotto puoi dare un prezzo diverso ad alcuni mesi.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block rounded-2xl bg-navy p-4 text-ivory">
          <span className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-gold">
            <CreditCard className="h-4 w-4" /> Con carta
          </span>
          <span className="mt-2 flex items-baseline gap-1">
            <span className="serif text-2xl text-ivory/60">€</span>
            <NumInput min={1} max={5000} value={card} disabled={disabled} onChange={(v) => v !== null && onCard(v)} className="serif w-full bg-transparent text-[2.4rem] leading-none text-ivory outline-none disabled:opacity-60" aria-label="Prezzo con carta" />
          </span>
        </label>
        <div className={cn('rounded-2xl border p-4', cashEnabled ? 'border-sage/40 bg-sage/[0.07]' : 'border-line bg-ivory opacity-70')}>
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[#3f5a35]">
              <Banknote className="h-4 w-4" /> In contanti
            </span>
            <AnimatePresence mode="popLayout">
              {saving > 0 && (
                <motion.span key={saving} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-full bg-sage px-2 py-0.5 text-[0.66rem] font-semibold text-white">
                  −{String(saving).replace('.', ',')}%
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span className="mt-2 flex items-baseline gap-1">
            <span className="serif text-2xl text-navy/50">€</span>
            <NumInput allowEmpty min={1} max={card} value={cash} placeholder={String(auto)} disabled={disabled || !cashEnabled} onChange={(v) => onCash(v)} className="serif w-full bg-transparent text-[2.4rem] leading-none text-navy outline-none placeholder:text-navy/35 disabled:opacity-60" aria-label="Prezzo in contanti" />
          </span>
          <div className="mt-1 text-[0.72rem] text-mist">
            {!cashEnabled ? (
              'Pagamento in contanti disattivato in Pagamenti.'
            ) : cash === null ? (
              `Vuoto = sconto standard −${globalPercent}%. Scrivi un prezzo per deciderlo tu.`
            ) : (
              <button type="button" onClick={() => onCash(null)} className="underline decoration-gold underline-offset-2">
                Torna allo sconto standard (−{globalPercent}%)
              </button>
            )}
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-terracotta">{error}</p>}
    </div>
  );
}

/**
 * Under the price: does it hold all year, or do some months have their own price? Twelve month
 * tiles; an empty tile is the base price. The cash price follows the room's cash discount.
 */
function MonthPrices({ base, now, edit, open, disabled, cashNote, onOpen, onEdit }: { base: number; now: Record<string, number | null | 'mixed'>; edit: Record<string, number | null>; open: boolean; disabled?: boolean; cashNote: boolean; onOpen: (v: boolean) => void; onEdit: (v: Record<string, number | null>) => void }) {
  const months = Object.keys(now).sort();
  const valueOf = (m: string): number | null | 'mixed' => (m in edit ? edit[m]! : now[m]!);
  const custom = months.filter((m) => typeof valueOf(m) === 'number').length;
  const setMonth = (m: string, raw: number | null) => {
    const v = raw === base ? null : raw; // the base price itself needs no month price
    const next = { ...edit };
    if (v === null && now[m] === null) delete next[m];
    else if (v !== null && now[m] === v) delete next[m];
    else next[m] = v;
    onEdit(next);
  };
  const allBase = () => onEdit(Object.fromEntries(months.filter((m) => now[m] !== null).map((m) => [m, null])));
  return (
    <div className="rounded-[1.6rem] border border-line p-4 md:p-5">
      <p className="label mb-1">Per quale periodo vale questo prezzo?</p>
      <div role="radiogroup" className="mt-2 grid gap-2 sm:grid-cols-2">
        {([
          { v: false, t: 'Tutto l’anno', d: `Sempre ${money(base)} a notte` },
          { v: true, t: 'Cambia in alcuni mesi', d: 'Es. agosto più caro, novembre più economico' },
        ] as const).map((o) => {
          const on = open === o.v;
          return (
            <button key={String(o.v)} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onOpen(o.v)} className={cn('flex flex-col items-start gap-0.5 rounded-2xl border px-3.5 py-3 text-left transition-colors disabled:opacity-60', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-ivory text-navy hover:border-navy/40')}>
              <span className="text-sm font-semibold">{o.t}</span>
              <span className={cn('text-[0.72rem]', on ? 'text-ivory/70' : 'text-mist')}>{o.d}</span>
            </button>
          );
        })}
      </div>
      {!open && custom > 0 && (
        <p className="mt-3 text-xs text-mist">
          {custom === 1 ? 'Un mese ha' : `${custom} mesi hanno`} un prezzo proprio.{' '}
          <button type="button" onClick={() => onOpen(true)} className="underline decoration-gold underline-offset-2">
            Vedi i mesi
          </button>
        </p>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease: [0.22, 0.61, 0.12, 1] }} className="overflow-hidden">
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {months.map((m, i) => {
                const v = valueOf(m);
                const changed = m in edit;
                const up = typeof v === 'number' && v > base;
                const down = typeof v === 'number' && v < base;
                return (
                  <motion.label
                    key={m}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.025 }}
                    className={cn('relative block rounded-2xl border px-3 py-2.5 transition-colors', up ? 'border-gold/60 bg-gold/[0.08]' : down ? 'border-sage/50 bg-sage/[0.08]' : 'border-line bg-ivory', changed && 'ring-2 ring-gold/40')}
                  >
                    <span className="flex items-center justify-between gap-1 text-[0.7rem] font-semibold capitalize text-navy">
                      {fmtDate(m, 'it', { month: 'long' })}
                      <span className="font-normal text-mist">{m.slice(0, 4)}</span>
                    </span>
                    <span className="mt-1 flex items-baseline gap-1">
                      <span className="serif text-lg text-navy/45">€</span>
                      <NumInput allowEmpty min={1} max={5000} value={typeof v === 'number' ? v : null} placeholder={String(base)} disabled={disabled} onChange={(x) => setMonth(m, x)} className="serif w-full bg-transparent text-[1.6rem] leading-none text-navy outline-none placeholder:text-navy/30 disabled:opacity-60" aria-label={`Prezzo di ${fmtDate(m, 'it', { month: 'long', year: 'numeric' })}`} />
                    </span>
                    <span className="mt-0.5 block text-[0.66rem] text-mist">{v === 'mixed' ? 'prezzi diversi nel mese' : typeof v === 'number' ? (up ? `+${money(v - base)} sul base` : down ? `−${money(base - v)} sul base` : 'come il base') : 'prezzo base'}</span>
                    {typeof v === 'number' && !disabled && (
                      <button type="button" onClick={() => setMonth(m, null)} aria-label="Torna al prezzo base" title="Torna al prezzo base" className="absolute bottom-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-navy/10 text-navy opacity-70 hover:bg-terracotta hover:text-white hover:opacity-100">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </motion.label>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-mist">
              <span>Mese vuoto = prezzo base ({money(base)}).{cashNote ? ' In contanti vale lo stesso sconto della camera.' : ''} Si salva insieme alla camera.</span>
              {custom > 0 && !disabled && (
                <button type="button" onClick={allBase} className="underline decoration-gold underline-offset-2 hover:text-navy">
                  Tutti i mesi al prezzo base
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
