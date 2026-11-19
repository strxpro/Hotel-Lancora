'use client';
import { AnimatePresence, motion } from 'motion/react';
import { Minus, Plus } from 'lucide-react';
import { plural } from '@/lib/i18n/config';
import { fill } from '@/lib/i18n/config';
import { useI18n } from '../providers';

export interface GuestValue {
  adults: number;
  children: number;
  childrenAges: number[];
}

export const MAX_GUESTS = 6;

function Stepper({ label, hint, value, min, max, onChange }: { label: string; hint: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div>
        <p className="text-[0.95rem] font-medium text-navy">{label}</p>
        <p className="text-xs text-mist">{hint}</p>
      </div>
      <div className="flex items-center gap-3" role="group" aria-label={label}>
        <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`${label} −`} className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-navy transition-colors hover:border-navy disabled:opacity-30">
          <Minus className="h-4 w-4" />
        </button>
        <span className="relative h-7 w-6 overflow-hidden text-center text-lg tabular-nums text-navy" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={value} className="absolute inset-0" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 0.61, 0.12, 1] }}>
              {value}
            </motion.span>
          </AnimatePresence>
        </span>
        <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`${label} +`} className="flex h-11 w-11 items-center justify-center rounded-full border border-line text-navy transition-colors hover:border-navy disabled:opacity-30">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** A child's age: − 6 anni + (the number rolls like the steppers above; no drop-down inside the popover). */
function AgeStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const { t, locale } = useI18n();
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex h-11 items-center justify-between gap-1 rounded-full border border-line bg-white px-1 transition-colors hover:border-navy/30" role="group" aria-label={label}>
        <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 0} aria-label={`${label} −`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy transition-colors hover:bg-sand-2 disabled:opacity-30">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="relative h-5 min-w-0 flex-1 overflow-hidden text-center text-sm tabular-nums text-navy" aria-live="polite">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={value} className="absolute inset-0 whitespace-nowrap" initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }} transition={{ duration: 0.26, ease: [0.22, 0.61, 0.12, 1] }}>
              {plural(locale, value, t.search.age)}
            </motion.span>
          </AnimatePresence>
        </span>
        <button type="button" onClick={() => onChange(value + 1)} disabled={value >= 12} aria-label={`${label} +`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy transition-colors hover:bg-sand-2 disabled:opacity-30">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function GuestSelector({ value, onChange, maxGuests = MAX_GUESTS }: { value: GuestValue; onChange: (v: GuestValue) => void; maxGuests?: number }) {
  const { t } = useI18n();
  const total = value.adults + value.children;
  const setAdults = (a: number) => onChange({ ...value, adults: Math.max(1, a) });
  const setChildren = (c: number) => {
    const ages = value.childrenAges.slice(0, c);
    while (ages.length < c) ages.push(6);
    onChange({ ...value, children: c, childrenAges: ages });
  };
  return (
    <div className="divide-y divide-line">
      <Stepper label={t.search.adults} hint={t.search.adultsHint} value={value.adults} min={1} max={Math.min(8, maxGuests - value.children)} onChange={setAdults} />
      <Stepper label={t.search.children} hint={t.search.childrenHint} value={value.children} min={0} max={Math.min(6, maxGuests - value.adults)} onChange={setChildren} />
      <AnimatePresence initial={false}>
        {value.children > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35 }} className="overflow-hidden">
            <div className="grid grid-cols-2 gap-3 py-4">
              {value.childrenAges.map((age, i) => (
                <AgeStepper
                  key={i}
                  label={fill(t.search.childAge, { n: i + 1 })}
                  value={age}
                  onChange={(a) => {
                    const ages = [...value.childrenAges];
                    ages[i] = Math.min(12, Math.max(0, a));
                    onChange({ ...value, childrenAges: ages });
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="pt-3 text-xs text-mist">{total >= maxGuests ? `Max ${maxGuests}` : t.search.minAdult}</p>
    </div>
  );
}
