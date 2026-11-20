'use client';
import { AnimatePresence, motion } from 'motion/react';
import { Check, PackagePlus } from 'lucide-react';
import { EXTRA_T, extraTotal, type ExtraUnit } from '@/lib/extras';
import { cn, money } from '@/lib/utils';
import { useI18n } from '../providers';

/** One supplement as the site shows it: the name already in the guest's language. */
export type SiteExtra = { id: string; name: string; price: number; unit: ExtraUnit };

const EASE = [0.22, 0.61, 0.12, 1] as const;

/**
 * Supplementi in the booking summary: the guest ticks what they want (towels, breakfast…), sees
 * what it comes to for their stay, and that it is paid at the hotel, never online.
 * Without `onToggle` (the booking is already made) only the ticked ones are listed.
 */
export function ExtrasPicker({ extras, chosen, onToggle, nights, guests }: { extras: SiteExtra[]; chosen: string[]; onToggle?: (id: string) => void; nights: number; guests: number }) {
  const { locale } = useI18n();
  const x = EXTRA_T[locale];
  const shown = onToggle ? extras : extras.filter((e) => chosen.includes(e.id));
  const sum = Math.round(extras.filter((e) => chosen.includes(e.id)).reduce((s, e) => s + extraTotal(e, nights, guests), 0) * 100) / 100;
  if (!shown.length) return null;
  return (
    <div className="mt-4 rounded-2xl border border-line bg-ivory/60 p-3.5" data-testid="extras-picker">
      <p className="flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-mist">
        <PackagePlus className="h-3.5 w-3.5 text-gold-2" /> {x.title} · <span className="normal-case tracking-normal">{x.note}</span>
      </p>
      <ul className="mt-2.5 grid gap-1.5">
        {shown.map((e) => {
          const on = chosen.includes(e.id);
          const price = e.price > 0 ? `${money(e.price, locale, 2)} ${x.unit[e.unit]}` : x.free;
          const Tag = onToggle ? 'button' : 'div';
          return (
            <li key={e.id}>
              <Tag
                {...(onToggle ? { type: 'button' as const, onClick: () => onToggle(e.id), 'aria-pressed': on } : {})}
                className={cn('flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-[0.82rem] transition-colors duration-300', on ? 'border-navy bg-white' : 'border-transparent bg-white/60 hover:border-line', onToggle && 'cursor-pointer')}
              >
                <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-300', on ? 'border-navy bg-navy text-gold' : 'border-line bg-white')}>
                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.2, ease: EASE }}>
                        <Check className="h-3.5 w-3.5" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-tight text-navy">{e.name}</span>
                  <span className="block text-[0.72rem] text-mist">{price}</span>
                </span>
                {on && e.price > 0 && <span className="shrink-0 text-[0.82rem] font-semibold text-navy">{money(extraTotal(e, nights, guests), locale, 2)}</span>}
              </Tag>
            </li>
          );
        })}
      </ul>
      <AnimatePresence initial={false}>
        {sum > 0 && (
          <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
            <span className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-line pt-2.5 text-[0.8rem]">
              <span className="text-charcoal/80">{x.atHotel}</span>
              <span className="font-semibold text-navy">+ {money(sum, locale, 2)}</span>
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
