'use client';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, HelpCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Step = { sel: string; title: string; text: string };

const COMMON_END: Step[] = [
  { sel: '[data-tour="assistant"]', title: 'Se hai un dubbio, chiedi', text: 'L’assistente risponde con i dati veri e spiega come si fa. Puoi anche parlargli con il microfono.' },
  { sel: '[data-tour="help"]', title: 'Questa guida è sempre qui', text: 'Su ogni pagina il punto di domanda ti mostra cosa toccare. Premilo quando vuoi.' },
];

/** One short tour per page: what to tap, in plain words. Missing elements are skipped. */
const TOURS: { re: RegExp; steps: Step[] }[] = [
  {
    re: /^\/admin\/?$/,
    steps: [
      { sel: 'main h1', title: 'La tua giornata', text: 'Qui vedi subito chi arriva, chi parte e quante camere sono libere oggi.' },
      { sel: '[data-tour="quick-actions"]', title: 'Le azioni di tutti i giorni', text: 'Aggiungi una camera, una prenotazione arrivata per telefono o cambia un prezzo con un tocco.' },
      { sel: '[data-tour="inhouse"]', title: 'Chi è in hotel adesso', text: 'Gli ospiti presenti con la loro camera e la notte del soggiorno.' },
      { sel: '[data-tour="earnings"]', title: 'Gli incassi', text: 'Quanto è entrato questo mese, diviso tra carta, contanti, bonifico e portali.' },
      { sel: '[data-tour="nav"], [data-tour="tabbar"]', title: 'Il menu', text: 'Da qui passi al planning, alle prenotazioni, ai prezzi e a tutto il resto.' },
      ...COMMON_END,
    ],
  },
  {
    re: /disponibilita/,
    steps: [
      { sel: 'main h1', title: 'Il planning delle camere', text: 'Come il foglio a quadretti: righe = camere, colonne = giorni.' },
      { sel: '[role="grid"]', title: 'Tocca una casella', text: 'Una casella vuota è una notte libera: toccala per creare una prenotazione o chiudere la camera. Scorri di lato con il dito: i numeri delle camere restano fermi.' },
      { sel: '[data-tour="planning-legend"]', title: 'Cosa significano i colori', text: 'X blu = prenotazione confermata, oro = in attesa di pagamento, righe grigie = camera chiusa.' },
      ...COMMON_END,
    ],
  },
  {
    re: /prenotazioni/,
    steps: [
      { sel: 'main h1', title: 'Tutte le prenotazioni', text: 'Sito, telefono, Booking, Expedia: tutte in un posto.' },
      { sel: '[data-tour="bookings"]', title: 'Tocca una riga', text: 'Si apre la scheda: puoi assegnare la camera, registrare un pagamento (carta, contanti o bonifico) o annullare.' },
      ...COMMON_END,
    ],
  },
  {
    re: /camere\/(nuova|[^/]+)$/,
    steps: [
      { sel: 'main h1', title: 'Scheda della camera', text: 'Cinque passi semplici. Puoi salvare una bozza in qualsiasi momento.' },
      { sel: '[data-tour="wizard-help"]', title: 'Non sai cosa scrivere?', text: '“Aiutami con AI” compila quello che manca. Tu controlli e salvi.' },
      ...COMMON_END,
    ],
  },
  {
    re: /camere/,
    steps: [
      { sel: 'main h1', title: 'Le tue camere', text: 'Ogni camera con foto, prezzo e stato sul sito.' },
      { sel: '[data-tour="room-add"]', title: 'Aggiungi una camera', text: 'Si apre una procedura guidata: numero, letti, foto, servizi e prezzo.' },
      { sel: '[data-tour="rooms-list"]', title: 'Modifica', text: 'Tocca una camera per cambiare foto, testi, letti o prezzo.' },
      ...COMMON_END,
    ],
  },
  {
    re: /prezzi/,
    steps: [
      { sel: '[data-tour="prices-board"]', title: 'Scegli le camere', text: 'Tocca una o più camere: diventano blu.' },
      { sel: '[data-tour="prices-board"]', title: 'Scrivi il prezzo una volta sola', text: 'In basso compare la barra: prezzo con carta e, se vuoi, in contanti. Premi Applica e il sito si aggiorna.' },
      { sel: '[data-tour="prices-periods"]', title: 'Prezzi per un periodo', text: 'Per agosto, Natale o un evento: scegli le date e quanto aumentare o diminuire.' },
      ...COMMON_END,
    ],
  },
  {
    re: /clienti/,
    steps: [
      { sel: '[data-tour="guests-search"]', title: 'Trova un ospite', text: 'Scrivi nome, email o telefono. I filtri sotto mostrano chi è in hotel, chi arriva e chi torna spesso.' },
      { sel: '[data-tour="guests-list"]', title: 'Tocca una persona', text: 'Vedi quanto ha speso, le notti, la camera preferita, come paga e puoi scriverle un’email.' },
      ...COMMON_END,
    ],
  },
  {
    re: /marketing/,
    steps: [
      { sel: '[data-tour="mk-tabs"]', title: 'Email e recensioni', text: 'Scegli cosa fare: scrivere ai clienti, gestire le recensioni o i codici sconto.' },
      { sel: '[data-tour="mk-words"]', title: 'Scrivi con parole tue', text: 'Spiega cosa vuoi dire, anche in due righe: l’AI prepara l’email completa.' },
      { sel: '[data-tour="mk-people"]', title: 'A chi mandarla', text: 'Tutti, per lingua o una persona alla volta. Ognuno la riceve tradotta nella sua lingua.' },
      ...COMMON_END,
    ],
  },
  {
    re: /impostazioni/,
    steps: [
      { sel: '[data-tour="connections"]', title: 'Cosa è collegato', text: 'Verde = funziona. Tocca una scheda per collegare l’AI gratuita, Telegram o le email: ti guida passo passo.' },
      ...COMMON_END,
    ],
  },
];

const PAD = 10;
type Box = { top: number; left: number; width: number; height: number };

function findTarget(sel: string): HTMLElement | null {
  for (const s of sel.split(',').map((x) => x.trim())) {
    const all = [...document.querySelectorAll<HTMLElement>(s)];
    const el = all.find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (el) return el;
  }
  return null;
}

/** Help button that starts the tour of the current page. */
export function HelpButton({ className }: { className?: string }) {
  const [hint, setHint] = useState(false);
  useEffect(() => {
    try {
      setHint(!localStorage.getItem('la-tour-seen'));
    } catch {
      /* private mode */
    }
  }, []);
  return (
    <button
      type="button"
      data-tour="help"
      aria-label="Guida: cosa posso fare in questa pagina?"
      title="Guida della pagina"
      onClick={() => {
        setHint(false);
        window.dispatchEvent(new Event('tour:start'));
      }}
      className={cn('relative flex h-10 w-10 items-center justify-center rounded-full text-navy transition-colors hover:bg-navy/5', className)}
    >
      {hint && <span className="absolute inset-1 animate-ping rounded-full bg-gold/40" />}
      <HelpCircle className="relative h-5 w-5" strokeWidth={1.7} />
    </button>
  );
}

export function GuideTour() {
  const pathname = usePathname();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });

  const start = useCallback(() => {
    const tour = TOURS.find((t) => t.re.test(pathname));
    const list = (tour?.steps ?? [{ sel: 'main h1', title: 'Questa pagina', text: 'Qui trovi gli strumenti di questa sezione. Se hai dubbi chiedi all’assistente.' }, ...COMMON_END]).filter((s) => findTarget(s.sel));
    if (!list.length) return;
    setSteps(list);
    setI(0);
    try {
      localStorage.setItem('la-tour-seen', '1');
    } catch {
      /* ignore */
    }
  }, [pathname]);

  useEffect(() => {
    window.addEventListener('tour:start', start);
    return () => window.removeEventListener('tour:start', start);
  }, [start]);

  useEffect(() => setSteps(null), [pathname]);

  const step = steps?.[i] ?? null;

  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.sel);
    setVp({ w: window.innerWidth, h: window.innerHeight });
    if (!el) return setBox(null);
    const r = el.getBoundingClientRect();
    const top = Math.max(6, r.top - PAD);
    const left = Math.max(6, r.left - PAD);
    setBox({ top, left, width: Math.min(window.innerWidth - left - 6, r.width + PAD * 2), height: Math.min(window.innerHeight - top - 6, r.height + PAD * 2) });
  }, [step]);

  useLayoutEffect(() => {
    if (!step) return;
    const el = findTarget(step.sel);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fits = r.top >= 70 && r.bottom <= window.innerHeight - 110;
    if (!fits) el.scrollIntoView({ behavior: 'smooth', block: r.height > window.innerHeight * 0.6 ? 'start' : 'center' });
    measure();
    const t = window.setTimeout(measure, 420);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step, measure]);

  useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSteps(null);
      if (e.key === 'ArrowRight') setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps]);

  if (typeof document === 'undefined') return null;
  const last = steps ? i === steps.length - 1 : false;
  // the card goes below the highlighted area when there is room, otherwise above
  const below = box ? box.top + box.height + 220 < vp.h : true;
  const cardLeft = box ? Math.min(Math.max(12, box.left), Math.max(12, vp.w - 352)) : 12;
  const cardStyle: React.CSSProperties = box ? (below ? { top: box.top + box.height + 14, left: cardLeft } : { bottom: Math.max(12, vp.h - box.top + 14), left: cardLeft }) : { top: vp.h / 3, left: cardLeft };

  return createPortal(
    <AnimatePresence>
      {steps && step && (
        <motion.div key="tour" className="fixed inset-0 z-[200]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label="Guida della pagina">
          {/* dark veil with a hole around the element to tap */}
          <motion.div
            className="pointer-events-none absolute rounded-[1.25rem] ring-2 ring-gold"
            initial={false}
            animate={box ? { top: box.top, left: box.left, width: box.width, height: box.height, opacity: 1 } : { top: vp.h / 2, left: vp.w / 2, width: 0, height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 32 }}
            style={{ boxShadow: '0 0 0 9999px rgba(8,22,34,0.72)' }}
          >
            <motion.span className="absolute -inset-1 rounded-[1.4rem] ring-2 ring-gold/60" animate={{ scale: [1, 1.04, 1], opacity: [0.8, 0, 0.8] }} transition={{ duration: 1.8, repeat: Infinity }} />
          </motion.div>
          <button type="button" aria-label="Chiudi la guida" className="absolute inset-0 cursor-default" onClick={() => setSteps(null)} />
          <motion.div
            key={i}
            initial={{ opacity: 0, y: below ? 10 : -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.35, ease: [0.22, 0.61, 0.12, 1] }}
            className="absolute w-[min(340px,calc(100vw-24px))] rounded-[1.5rem] bg-ivory p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]"
            style={cardStyle}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex gap-1">
                {steps.map((_, k) => (
                  <motion.span key={k} className={cn('h-1.5 rounded-full', k === i ? 'bg-navy' : k < i ? 'bg-gold' : 'bg-navy/15')} animate={{ width: k === i ? 22 : 6 }} />
                ))}
              </span>
              <button type="button" onClick={() => setSteps(null)} aria-label="Chiudi" className="flex h-8 w-8 items-center justify-center rounded-full text-mist hover:bg-navy/5 hover:text-navy">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="serif mt-3 text-[1.45rem] leading-tight text-navy">{step.title}</p>
            <p className="mt-1.5 text-[0.9rem] leading-relaxed text-charcoal/80">{step.text}</p>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button type="button" disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))} className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm text-navy disabled:opacity-0">
                <ArrowLeft className="h-4 w-4" /> Indietro
              </button>
              <button type="button" onClick={() => (last ? setSteps(null) : setI((x) => x + 1))} className="flex h-11 items-center gap-2 rounded-full bg-navy px-5 text-sm font-semibold text-ivory">
                {last ? (
                  <>
                    <Check className="h-4 w-4" /> Ho capito
                  </>
                ) : (
                  <>
                    Avanti <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
