'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Hotel } from 'lucide-react';
import type { Locale } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Ideas shown in the empty fields of the review form, one after the other. */
export const HINTS: Record<Locale, { name: string[]; email: string[]; review: string[] }> = {
  it: { name: ['Es. Giulia', 'Es. Marco R.', 'Es. Anna e Luca', 'Es. Famiglia Bianchi'], email: ['nome@email.it', 'giulia.rossi@gmail.com', 'marco@libero.it'], review: ['Cosa ti è piaciuto di più?', 'Com’era la colazione?', 'Hai dormito bene?', 'E la vista dalla camera?', 'Cosa possiamo migliorare?', 'Torneresti da noi?'] },
  en: { name: ['E.g. Emma', 'E.g. James W.', 'E.g. Anna & Tom', 'E.g. The Smith family'], email: ['name@email.com', 'emma.walker@gmail.com', 'james@outlook.com'], review: ['What did you like most?', 'How was breakfast?', 'Did you sleep well?', 'And the view from the room?', 'What could we do better?', 'Would you come back?'] },
  pl: { name: ['Np. Kasia', 'Np. Marek K.', 'Np. Anna i Piotr', 'Np. Rodzina Nowaków'], email: ['imie@email.pl', 'kasia.nowak@gmail.com', 'marek@wp.pl'], review: ['Co podobało Ci się najbardziej?', 'Jak było ze śniadaniem?', 'Dobrze się spało?', 'A widok z pokoju?', 'Co możemy poprawić?', 'Wrócisz do nas?'] },
  de: { name: ['Z. B. Lena', 'Z. B. Jonas M.', 'Z. B. Anna & Felix', 'Z. B. Familie Müller'], email: ['name@email.de', 'lena.mueller@gmail.com', 'jonas@web.de'], review: ['Was hat Ihnen am besten gefallen?', 'Wie war das Frühstück?', 'Haben Sie gut geschlafen?', 'Und der Blick aus dem Zimmer?', 'Was können wir besser machen?', 'Würden Sie wiederkommen?'] },
  fr: { name: ['Ex. Léa', 'Ex. Hugo D.', 'Ex. Anna et Paul', 'Ex. Famille Martin'], email: ['nom@email.fr', 'lea.martin@gmail.com', 'hugo@orange.fr'], review: ['Qu’avez-vous le plus aimé ?', 'Et le petit-déjeuner ?', 'Avez-vous bien dormi ?', 'Et la vue depuis la chambre ?', 'Que pouvons-nous améliorer ?', 'Reviendriez-vous ?'] },
  es: { name: ['Ej. Lucía', 'Ej. Pablo G.', 'Ej. Ana y Diego', 'Ej. Familia García'], email: ['nombre@email.es', 'lucia.garcia@gmail.com', 'pablo@hotmail.com'], review: ['¿Qué te gustó más?', '¿Qué tal el desayuno?', '¿Dormiste bien?', '¿Y las vistas desde la habitación?', '¿Qué podemos mejorar?', '¿Volverías?'] },
};

/**
 * A placeholder that changes by itself: each idea rises in, waits, and fades out upwards.
 * Drawn over the empty field (it disappears as soon as there is text). Not read by screen readers:
 * the field keeps its own label.
 */
export function RotatingHint({ hints, show, multiline = false }: { hints: string[]; show: boolean; multiline?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!show || hints.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % hints.length), 2600);
    return () => clearInterval(t);
  }, [show, hints.length]);
  return (
    <span aria-hidden className={cn('pointer-events-none absolute inset-x-4 overflow-hidden text-[0.95rem] text-mist/80', multiline ? 'top-3.5 h-6' : 'top-1/2 h-6 -translate-y-1/2')}>
      <AnimatePresence mode="wait" initial={false}>
        {show && (
          <motion.span key={i} className="block truncate" initial={{ y: 14, opacity: 0, filter: 'blur(4px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }} exit={{ y: -14, opacity: 0, filter: 'blur(4px)' }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
            {hints[i % hints.length]}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** The room the review is about: a drop-down of the site, instead of a strip to scroll sideways. */
export function RoomPicker({ value, onChange, rooms, general, label }: { value: string | null; onChange: (id: string | null) => void; rooms: { id: string; number: string; name: string }[]; general: string; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const options = [{ id: null as string | null, number: '', name: general }, ...rooms.map((r) => ({ id: r.id as string | null, number: r.number, name: r.name }))];
  const current = options.find((o) => o.id === value) ?? options[0]!;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className={cn('flex h-[3.2rem] w-full items-center gap-3 rounded-xl border bg-white px-4 text-left transition-all', open ? 'border-navy ring-2 ring-gold/25' : 'border-line hover:border-navy/50')}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy text-[0.72rem] font-semibold text-ivory">{current.number || <Hotel className="h-4 w-4" />}</span>
        <span className="min-w-0 flex-1 truncate text-[0.92rem] text-navy">{current.name}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-navy/60">
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul role="listbox" aria-label={label} initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} style={{ transformOrigin: 'top' }} className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-64 overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-[0_24px_60px_-18px_rgba(10,28,43,0.45)]">
            {options.map((o, k) => {
              const sel = o.id === value;
              return (
                <motion.li key={o.id ?? 'general'} role="option" aria-selected={sel} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(k, 10) * 0.025 }}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.id);
                      setOpen(false);
                    }}
                    className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors hover:bg-ivory', sel ? 'font-semibold text-navy' : 'text-charcoal')}
                  >
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[0.68rem] font-semibold', sel ? 'bg-navy text-ivory' : 'bg-ivory text-navy')}>{o.number || <Hotel className="h-3.5 w-3.5" />}</span>
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    {sel && <Check className="h-4 w-4 text-gold-2" />}
                  </button>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
