'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { addDays, addMonths, diffDays, eachNight, fmtDateLong, monthDays, monthName, startOfMonth, weekdayMon, weekdayShortNames } from '@/lib/dates';
import { plural } from '@/lib/i18n/config';
import { cn, money } from '@/lib/utils';
import { useI18n } from '../providers';

export interface CalendarProps {
  checkIn: string | null;
  checkOut: string | null;
  onChange: (checkIn: string | null, checkOut: string | null) => void;
  minDate: string;
  months?: 1 | 2;
  /** nights that cannot be booked (e.g. a specific room's occupancy) */
  blockedNights?: Set<string>;
  onComplete?: () => void;
  autoFocus?: boolean;
  /** price per night shown under each free day (a room's own calendar) */
  priceOf?: (date: string) => number | null;
}

const EASE = [0.22, 0.61, 0.12, 1] as const;

export function RangeCalendar({ checkIn, checkOut, onChange, minDate, months = 2, blockedNights, onComplete, autoFocus, priceOf }: CalendarProps) {
  const { locale, t } = useI18n();
  const priced = Boolean(priceOf);
  const [view, setView] = useState(() => startOfMonth(checkIn ?? minDate));
  const [dir, setDir] = useState(1);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>(checkIn ?? minDate);
  const gridRef = useRef<HTMLDivElement>(null);
  const minMonth = startOfMonth(minDate);
  const selectingEnd = Boolean(checkIn && !checkOut);

  const weekdays = useMemo(() => weekdayShortNames(locale), [locale]);
  const shown = months === 2 ? [view, addMonths(view, 1)] : [view];

  const go = (n: number) => {
    const next = addMonths(view, n);
    if (next < minMonth) return;
    setDir(n);
    setView(next);
  };

  useEffect(() => {
    if (autoFocus) gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: true });
  }, [autoFocus]);

  const rangeHasBlocked = (from: string, to: string) => (blockedNights ? eachNight(from, to).some((d) => blockedNights.has(d)) : false);

  const isDisabled = (d: string) => {
    if (d < minDate) return true;
    if (selectingEnd && checkIn) {
      if (d <= checkIn) return false; // clicking before start re-anchors
      return rangeHasBlocked(checkIn, d);
    }
    return Boolean(blockedNights?.has(d));
  };

  const select = (d: string) => {
    if (isDisabled(d)) return;
    if (!checkIn || checkOut || d <= checkIn) {
      onChange(d, null);
      setHover(null);
      return;
    }
    onChange(checkIn, d);
    onComplete?.();
  };

  const moveFocus = (d: string) => {
    if (d < minDate) d = minDate;
    setFocus(d);
    const last = addMonths(view, months);
    if (d < view) {
      setDir(-1);
      setView(startOfMonth(d));
    } else if (d >= last) {
      setDir(1);
      setView(addMonths(startOfMonth(d), -(months - 1)));
    }
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${d}"]`)?.focus({ preventScroll: true }));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) {
      e.preventDefault();
      moveFocus(addDays(focus, map[e.key]!));
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      moveFocus(addDays(focus, e.key === 'PageUp' ? -28 : 28));
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveFocus(addDays(focus, -weekdayMon(focus)));
    } else if (e.key === 'End') {
      e.preventDefault();
      moveFocus(addDays(focus, 6 - weekdayMon(focus)));
    }
  };

  const end = checkOut ?? (selectingEnd && hover && checkIn && hover > checkIn && !isDisabled(hover) ? hover : null);
  const nights = checkIn && checkOut ? diffDays(checkIn, checkOut) : 0;

  return (
    <div className="select-none" onKeyDown={onKey}>
      <div className="flex items-center justify-between pb-2">
        <button type="button" onClick={() => go(-1)} disabled={view <= minMonth} aria-label={t.search.prev} className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-navy transition-colors hover:bg-navy hover:text-ivory disabled:pointer-events-none disabled:opacity-30">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-mist" aria-live="polite">
          {selectingEnd ? t.search.pickDeparture : checkOut ? plural(locale, nights, t.search.nights) : t.search.pickArrival}
        </p>
        <button type="button" onClick={() => go(1)} aria-label={t.search.next} className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-navy transition-colors hover:bg-navy hover:text-ivory">
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div ref={gridRef} className="relative overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={view}
            custom={dir}
            variants={{ enter: (d: number) => ({ x: d * 48, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d * -48, opacity: 0 }) }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.42, ease: EASE }}
            className={cn('grid gap-6', months === 2 ? 'grid-cols-2' : 'grid-cols-1')}
          >
            {shown.map((m) => (
              <div key={m} className={priced ? 'min-h-[22.5rem]' : 'min-h-[18.5rem]'}>
                <h3 className="serif mb-2 text-center text-[1.2rem] text-navy">{monthName(m, locale)}</h3>
                <div className="grid grid-cols-7 text-center" role="grid" aria-label={monthName(m, locale)}>
                  {weekdays.map((w) => (
                    <div key={w} role="columnheader" className="pb-2 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-mist">
                      {w}
                    </div>
                  ))}
                  {Array.from({ length: weekdayMon(m) }, (_, i) => (
                    <div key={`b${i}`} />
                  ))}
                  {monthDays(m).map((d) => {
                    const disabled = isDisabled(d);
                    const isStart = d === checkIn;
                    const isEnd = d === end;
                    const inRange = Boolean(checkIn && end && d > checkIn && d < end);
                    const preview = !checkOut && (inRange || isEnd);
                    const today = d === minDate;
                    const blocked = blockedNights?.has(d);
                    const price = priceOf && !disabled && !blocked ? priceOf(d) : null;
                    const chosen = isStart || isEnd || inRange;
                    return (
                      <div key={d} role="gridcell" className={cn('relative', priced ? 'h-[3.35rem]' : 'h-10')}>
                        {(inRange || (isStart && end) || isEnd) && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              priced ? 'absolute top-[3px] h-[34px]' : 'absolute inset-y-[3px]',
                              preview ? 'bg-sand-2/70' : 'bg-sand-2',
                              isStart ? 'left-1/2 right-0' : isEnd ? 'left-0 right-1/2' : 'inset-x-0',
                              isStart && isEnd && 'hidden',
                            )}
                          />
                        )}
                        <button
                          type="button"
                          data-date={d}
                          tabIndex={d === focus ? 0 : -1}
                          disabled={disabled}
                          aria-pressed={isStart || isEnd}
                          aria-label={price !== null ? `${fmtDateLong(d, locale)} · ${money(price, locale)}` : fmtDateLong(d, locale)}
                          onClick={() => select(d)}
                          onMouseEnter={() => setHover(d)}
                          onFocus={() => setFocus(d)}
                          className={cn(
                            'relative z-[1] mx-auto flex h-[34px] w-[34px] items-center justify-center rounded-full text-[0.86rem] tabular-nums transition-[background-color,color,transform] duration-300 active:scale-90',
                            isStart || (isEnd && checkOut) ? 'bg-navy text-ivory' : isEnd ? 'border border-navy text-navy' : 'text-charcoal hover:bg-ivory hover:ring-1 hover:ring-navy/30',
                            disabled && 'pointer-events-none text-charcoal/25',
                            blocked && !disabled && 'line-through decoration-gold/60',
                            blocked && disabled && 'line-through',
                            today && !isStart && 'font-semibold underline decoration-gold decoration-2 underline-offset-4',
                          )}
                        >
                          {Number(d.slice(8))}
                        </button>
                        {price !== null && (
                          <span aria-hidden="true" className={cn('pointer-events-none absolute inset-x-0 top-[38px] text-center text-[0.6rem] leading-none tabular-nums tracking-tight transition-colors', chosen ? 'font-semibold text-navy' : 'text-mist')}>
                            {money(price, locale)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
