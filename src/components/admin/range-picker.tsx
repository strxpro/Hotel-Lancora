'use client';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, CalendarDays, Moon } from 'lucide-react';
import { addMonths, diffDays, fmtDate, monthDays, monthName, startOfMonth, todayISO, weekdayMon, weekdayShortNames } from '@/lib/dates';
import { cn } from '@/lib/utils';

const EASE = [0.22, 0.61, 0.12, 1] as const;

/** "martedì 24 novembre 2026": the whole date, as the panel shows it everywhere. */
export const fullDate = (iso: string): string => fmtDate(iso, 'it', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/** "mar 24 nov 2026": the same, shorter, for tight places. */
export const shortFullDate = (iso: string): string => fmtDate(iso, 'it', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const nightsLabel = (n: number) => (n === 1 ? '1 notte' : `${n} notti`);

/**
 * The panel's own date-range picker: two months side by side (one on the phone), month and year
 * in the title, the chosen days written in full above. Tap the first day, then the day after the
 * last night (the day the room is free again / the period ends).
 */
export function RangePicker({ from, to, onChange, minDate = todayISO(), endLabel = 'Al' }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void; minDate?: string; endLabel?: string }) {
  const [view, setView] = useState(() => startOfMonth(from ?? minDate));
  const [dir, setDir] = useState(1);
  const [hover, setHover] = useState<string | null>(null);
  const weekdays = useMemo(() => weekdayShortNames('it'), []);
  const minMonth = startOfMonth(minDate);
  const pickingEnd = Boolean(from && !to);
  const end = to ?? (pickingEnd && hover && from && hover > from ? hover : null);
  const nights = from && end ? diffDays(from, end) : 0;

  const go = (n: number) => {
    const next = addMonths(view, n);
    if (next < minMonth) return;
    setDir(n > 0 ? 1 : -1);
    setView(next);
  };
  const pick = (d: string) => {
    if (d < minDate) return;
    if (!from || to || d <= from) {
      onChange(d, null);
      setHover(null);
      return;
    }
    onChange(from, d);
  };

  // the year's months as chips: jump far without pressing the arrow many times
  const year = Number(view.slice(0, 4));
  const jumpMonths = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);

  return (
    <div className="select-none">
      {/* what is chosen, in full */}
      <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-white">
        {([
          ['Dal', from, !from],
          [endLabel, end, pickingEnd],
        ] as const).map(([label, day, active], i) => (
          <div key={label} className={cn('relative px-4 py-3 transition-colors', i === 1 && 'border-l border-line', active && 'bg-sand-2/50')}>
            <p className="flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-mist">
              <CalendarDays className="h-3 w-3 text-gold-2" /> {label}
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={day ?? 'none'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }} className={cn('mt-1 text-[0.92rem] font-semibold leading-snug first-letter:uppercase', day ? 'text-navy' : 'text-mist')}>
                {day ? fullDate(day) : active ? 'tocca un giorno' : '—'}
              </motion.p>
            </AnimatePresence>
            {active && <motion.span layoutId="range-picker-active" className="absolute inset-x-0 bottom-0 h-[2px] bg-gold" />}
          </div>
        ))}
      </div>
      <p className="mt-2 flex h-5 items-center gap-1.5 text-xs text-mist" aria-live="polite">
        {nights > 0 ? (
          <>
            <Moon className="h-3.5 w-3.5 text-gold-2" /> <strong className="font-semibold text-navy">{nightsLabel(nights)}</strong>
            {!to && ' · tocca per confermare'}
          </>
        ) : from ? (
          'Ora tocca il giorno in cui finisce'
        ) : (
          'Tocca il primo giorno'
        )}
      </p>

      {/* month and year */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => go(-1)} disabled={view <= minMonth} aria-label="Mese precedente" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-navy transition-colors hover:bg-navy hover:text-ivory disabled:pointer-events-none disabled:opacity-30">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => go(-12)} disabled={addMonths(view, -12) < minMonth} aria-label="Anno precedente" className="h-8 rounded-full px-2 text-xs font-semibold text-mist hover:text-navy disabled:opacity-30">
            ‹
          </button>
          <span className="serif min-w-[4.5rem] text-center text-[1.35rem] leading-none text-navy">{year}</span>
          <button type="button" onClick={() => go(12)} aria-label="Anno successivo" className="h-8 rounded-full px-2 text-xs font-semibold text-mist hover:text-navy">
            ›
          </button>
        </div>
        <button type="button" onClick={() => go(1)} aria-label="Mese successivo" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-navy transition-colors hover:bg-navy hover:text-ivory">
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <div className="no-scrollbar -mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-1">
        {jumpMonths.map((m) => {
          const off = startOfMonth(m) < minMonth;
          // the second month is shown only on wider screens: highlighted only there
          const on = m === view ? 'bg-navy text-ivory' : m === addMonths(view, 1) ? 'bg-white text-navy ring-1 ring-line md:bg-navy md:text-ivory md:ring-0' : null;
          return (
            <button
              key={m}
              type="button"
              disabled={off}
              onClick={() => {
                setDir(m > view ? 1 : -1);
                setView(m);
              }}
              className={cn('h-7 shrink-0 rounded-full px-2.5 text-[0.7rem] font-semibold capitalize transition-colors', on ?? 'bg-white text-navy ring-1 ring-line hover:ring-navy/40', off && 'opacity-30')}
            >
              {fmtDate(m, 'it', { month: 'short' }).replace('.', '')}
            </button>
          );
        })}
      </div>

      <div className="relative mt-3 overflow-hidden" onMouseLeave={() => setHover(null)}>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={view}
            custom={dir}
            variants={{ enter: (d: number) => ({ x: d * 40, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d * -40, opacity: 0 }) }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.38, ease: EASE }}
            className="grid gap-6 md:grid-cols-2"
          >
            {[view, addMonths(view, 1)].map((m, mi) => (
              <div key={m} className={cn('min-h-[17rem]', mi === 1 && 'hidden md:block')}>
                <p className="mb-2 text-center text-[0.95rem] font-semibold capitalize text-navy">{monthName(m, 'it')}</p>
                <div className="grid grid-cols-7 text-center">
                  {weekdays.map((w) => (
                    <div key={w} className="pb-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-mist">
                      {w}
                    </div>
                  ))}
                  {Array.from({ length: weekdayMon(m) }, (_, i) => (
                    <div key={`b${i}`} />
                  ))}
                  {monthDays(m).map((d) => {
                    const disabled = d < minDate;
                    const isStart = d === from;
                    const isEnd = d === end;
                    const inRange = Boolean(from && end && d > from && d < end);
                    const preview = !to && (inRange || isEnd);
                    const today = d === todayISO();
                    return (
                      <div key={d} className="relative h-10">
                        {(inRange || (isStart && end) || isEnd) && (
                          <span aria-hidden="true" className={cn('absolute inset-y-[3px]', preview ? 'bg-sand-2/60' : 'bg-sand-2', isStart ? 'left-1/2 right-0' : isEnd ? 'left-0 right-1/2' : 'inset-x-0', isStart && isEnd && 'hidden')} />
                        )}
                        <button
                          type="button"
                          data-date={d}
                          disabled={disabled}
                          aria-pressed={isStart || isEnd}
                          aria-label={fullDate(d)}
                          onClick={() => pick(d)}
                          onMouseEnter={() => setHover(d)}
                          className={cn(
                            'relative z-[1] mx-auto flex h-[34px] w-[34px] items-center justify-center rounded-full text-[0.86rem] tabular-nums transition-[background-color,color,transform] duration-200 active:scale-90',
                            isStart || (isEnd && to) ? 'bg-navy text-ivory' : isEnd ? 'border border-navy text-navy' : 'text-charcoal hover:bg-white hover:ring-1 hover:ring-navy/30',
                            disabled && 'pointer-events-none text-charcoal/25',
                            today && !isStart && 'font-semibold underline decoration-gold decoration-2 underline-offset-4',
                          )}
                        >
                          {Number(d.slice(8))}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
      {(from || to) && (
        <button type="button" onClick={() => onChange(null, null)} className="mt-1 text-xs font-semibold text-mist underline-offset-2 hover:text-navy hover:underline">
          Ricomincia
        </button>
      )}
    </div>
  );
}

/** One chosen period in a list: the two whole dates, the nights, and what goes with it. */
export function RangeLine({ from, to, note, endLabel = 'al' }: { from: string; to: string; note?: string; endLabel?: string }) {
  const n = diffDays(from, to);
  return (
    <span className="min-w-0">
      <span className="block text-[0.88rem] font-semibold leading-snug text-navy first-letter:uppercase">
        {fullDate(from)} <span className="font-normal text-mist">{endLabel}</span> {fullDate(to)}
      </span>
      <span className="mt-0.5 block text-xs text-mist">
        {nightsLabel(n)}
        {note ? ` · ${note}` : ''}
      </span>
    </span>
  );
}
