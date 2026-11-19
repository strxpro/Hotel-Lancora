'use client';
import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, ChevronDown, Search, Users } from 'lucide-react';
import { diffDays, fmtDate } from '@/lib/dates';
import { plural } from '@/lib/i18n/config';
import { cn } from '@/lib/utils';
import { useI18n, useIsDesktop } from '../providers';
import { RangeCalendar } from './calendar';
import { GuestSelector } from './guests';
import { Popover } from './popover';
import type { StayQuery } from './query';

type Panel = 'dates' | 'guests' | 'mobile' | null;

/**
 * Booking search. Every part looks and behaves like a button: icon chip, label, value or
 * "Scegli…" placeholder and a chevron; a soft pulse marks where to start until dates are chosen.
 */
export function SearchBar({
  value,
  onChange,
  onSubmit,
  today,
  loading = false,
  variant = 'hero',
  docked = false,
  className,
}: {
  value: StayQuery;
  onChange: (q: StayQuery) => void;
  onSubmit: (q: StayQuery) => void;
  today: string;
  loading?: boolean;
  variant?: 'hero' | 'inline';
  docked?: boolean;
  className?: string;
}) {
  const { t, locale } = useI18n();
  const desktop = useIsDesktop();
  const [panel, setPanel] = useState<Panel>(null);
  const [hint, setHint] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);
  const datesRef = useRef<HTMLDivElement>(null);
  const guestsRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setPanel(null), []);

  const nights = value.checkIn && value.checkOut ? diffDays(value.checkIn, value.checkOut) : 0;
  const guests = value.adults + value.children;
  const hasDates = Boolean(value.checkIn && value.checkOut);
  const fmt = (d: string | null) => (d ? fmtDate(d, locale, { weekday: 'short', day: 'numeric', month: 'short' }) : null);

  const submit = () => {
    if (!hasDates) {
      setHint(true);
      setPanel(desktop ? 'dates' : 'mobile');
      return;
    }
    setHint(false);
    setPanel(null);
    onSubmit(value);
  };

  const glass = variant === 'hero';

  const calendar = (months: 1 | 2) => (
    <RangeCalendar
      checkIn={value.checkIn}
      checkOut={value.checkOut}
      minDate={today}
      months={months}
      autoFocus={months === 2}
      onChange={(ci, co) => onChange({ ...value, checkIn: ci, checkOut: co })}
      onComplete={() => {
        if (desktop) {
          setPanel('guests');
        }
      }}
    />
  );

  const spinner = <span className="h-4 w-4 animate-spin rounded-full border-2 border-ivory/30 border-t-ivory" />;

  const cta = (full = false) => (
    <button
      type="button"
      onClick={submit}
      disabled={loading}
      className={cn('btn btn-navy relative overflow-hidden shadow-[0_10px_30px_-12px_rgba(16,40,61,0.7)] hover:shadow-[0_16px_40px_-14px_rgba(16,40,61,0.8)]', full ? 'h-14 w-full' : cn('h-full px-6 transition-[min-height] duration-500 xl:px-8', docked ? 'min-h-[3.25rem]' : 'min-h-[3.9rem]'), loading && 'cursor-wait')}
    >
      <AnimatePresence mode="wait" initial={false}>
        {loading ? (
          <motion.span key="l" className="flex items-center gap-3" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }}>
            {spinner}
            {t.search.searching}
          </motion.span>
        ) : (
          <motion.span key="c" className="flex items-center gap-2.5" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }}>
            <Search className="h-4 w-4" />
            {t.search.cta}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );

  const pulse = !hasDates && !panel && (
    <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3 w-3" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-70" />
      <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-ivory bg-gold" />
    </span>
  );

  /* ---------- phone: pill (dates · guests) + explicit "Cerca", opening a bottom sheet ---------- */
  const mobileUi = (
    <div ref={mobileRef} className={cn('w-full md:hidden', className)}>
      <div className={cn('flex w-full items-center gap-1.5 rounded-full p-1.5 transition-[background-color,box-shadow] duration-500', glass ? 'bg-ivory/[0.97] shadow-[0_18px_50px_-18px_rgba(10,28,43,0.6)] ring-1 ring-white/60' : 'border border-line bg-white shadow-[0_14px_40px_-24px_rgba(16,40,61,0.5)]')}>
        <button type="button" onClick={() => setPanel('mobile')} aria-haspopup="dialog" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full py-1 pl-1.5 pr-2 text-left transition-colors active:bg-sand-2">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy/[0.07] text-navy">
            <CalendarDays className="h-[1.1rem] w-[1.1rem]" strokeWidth={1.7} />
            {pulse}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.58rem] font-semibold uppercase tracking-[0.2em] text-mist">
              {t.search.when} · {t.search.who}
            </span>
            <span className={cn('block truncate text-[0.9rem]', hasDates ? 'text-navy' : 'text-navy/70')}>
              {hasDates ? `${fmtDate(value.checkIn!, locale)} – ${fmtDate(value.checkOut!, locale)}` : t.search.chooseDates} · {plural(locale, guests, t.search.guestsCount)}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-mist" />
        </button>
        <button type="button" onClick={submit} disabled={loading} aria-label={t.search.go} title={t.search.go} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-ivory shadow-[0_10px_24px_-12px_rgba(16,40,61,0.8)] transition-transform active:scale-90">
          {loading ? spinner : <Search className="h-[18px] w-[18px]" />}
        </button>
      </div>
      <Popover open={panel === 'mobile' && !desktop} onClose={close} anchor={mobileRef} label={t.search.cta} closeLabel={t.common.close}>
        <div className="space-y-6">
          <p className={cn('rounded-xl px-3 py-2 text-sm', hint && !value.checkOut ? 'bg-terracotta/10 text-terracotta' : 'bg-sand-2/70 text-navy')}>{value.checkIn ? t.search.pickDeparture : t.search.pickArrival}</p>
          {calendar(1)}
          <div className="rounded-2xl border border-line bg-white px-4 py-1">
            <GuestSelector value={value} onChange={(g) => onChange({ ...value, ...g })} />
          </div>
          <div className="sticky bottom-0 -mx-4 bg-ivory px-4 pb-1 pt-3">{cta(true)}</div>
        </div>
      </Popover>
    </div>
  );

  /* ---------- desktop / tablet ---------- */
  const field = (active: boolean) =>
    cn(
      'group relative flex h-full min-w-0 flex-1 items-center gap-3 rounded-full px-3 text-left transition-[background-color,box-shadow,min-height] duration-300 xl:px-4',
      docked ? 'min-h-[3.25rem]' : 'min-h-[3.9rem]',
      active ? 'bg-white shadow-[0_8px_24px_-14px_rgba(16,40,61,0.45)] ring-1 ring-line' : 'hover:bg-white/70',
    );
  const chip = 'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy/[0.06] text-navy transition-colors duration-300 group-hover:bg-navy group-hover:text-ivory';
  const label = 'block text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-mist';
  const val = (has: boolean) => cn('block truncate text-[0.98rem]', has ? 'text-navy' : 'text-navy/55');
  const divider = <span className="my-auto h-8 w-px shrink-0 bg-line" aria-hidden="true" />;

  return (
    <>
      {mobileUi}
      <div
        ref={barRef}
        className={cn(
          'relative hidden w-full items-stretch gap-1 rounded-full p-1.5 transition-[background-color,box-shadow,border-color] duration-700 ease-[var(--ease-lux)] md:flex',
          glass
            ? docked
              ? 'border border-line bg-ivory/[0.97] shadow-[0_30px_70px_-30px_rgba(10,28,43,0.55)]'
              : 'border border-white/60 bg-ivory/[0.96] shadow-[0_30px_80px_-40px_rgba(10,28,43,0.6)]'
            : 'border border-line bg-white',
          className,
        )}
      >
        <div ref={datesRef} className="flex min-w-0 flex-[1.7] items-stretch gap-1">
          <button type="button" className={field(panel === 'dates' && !(value.checkIn && !value.checkOut))} aria-haspopup="dialog" aria-expanded={panel === 'dates'} onClick={() => setPanel(panel === 'dates' ? null : 'dates')}>
            <span className={chip}>
              <CalendarDays className="h-[1.1rem] w-[1.1rem]" strokeWidth={1.7} />
              {pulse}
            </span>
            <span className="min-w-0 flex-1">
              <span className={label}>{t.search.arrival}</span>
              <span className={val(Boolean(value.checkIn))}>{fmt(value.checkIn) ?? t.search.chooseDate}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-mist transition-transform duration-300 group-hover:translate-y-0.5" />
          </button>
          {divider}
          <button
            type="button"
            className={field(panel === 'dates' && Boolean(value.checkIn) && !value.checkOut)}
            aria-haspopup="dialog"
            aria-expanded={panel === 'dates'}
            onClick={() => {
              if (value.checkIn && value.checkOut) onChange({ ...value, checkOut: null });
              setPanel('dates');
            }}
          >
            <span className={chip}>
              <CalendarDays className="h-[1.1rem] w-[1.1rem]" strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn(label, 'flex items-center justify-between gap-2')}>
                <span>{t.search.departure}</span>
                {nights > 0 && <span className="rounded-full bg-gold/15 px-2 py-0.5 normal-case tracking-normal text-gold-2">{plural(locale, nights, t.search.nights)}</span>}
              </span>
              <span className={val(Boolean(value.checkOut))}>{fmt(value.checkOut) ?? t.search.chooseDate}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-mist transition-transform duration-300 group-hover:translate-y-0.5" />
          </button>
        </div>
        {divider}
        <button ref={guestsRef} type="button" className={field(panel === 'guests')} aria-haspopup="dialog" aria-expanded={panel === 'guests'} onClick={() => setPanel(panel === 'guests' ? null : 'guests')}>
          <span className={chip}>
            <Users className="h-[1.1rem] w-[1.1rem]" strokeWidth={1.7} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={label}>{t.search.guests}</span>
            <span className={val(true)}>{plural(locale, guests, t.search.guestsCount)}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-mist transition-transform duration-300 group-hover:translate-y-0.5" />
        </button>
        <div className="shrink-0">{cta()}</div>
        {loading && <span className="absolute inset-x-8 bottom-0 h-px origin-left animate-[pulse_1.2s_ease-in-out_infinite] bg-gold" aria-hidden="true" />}

        <Popover open={panel === 'dates'} onClose={close} anchor={datesRef} label={t.search.arrival} width={760} closeLabel={t.common.close}>
          <p className={cn('mb-3 inline-flex rounded-full px-3 py-1.5 text-xs font-medium', hint && !value.checkOut ? 'bg-terracotta/10 text-terracotta' : 'bg-sand-2/80 text-navy')}>{value.checkIn && !value.checkOut ? t.search.pickDeparture : t.search.pickArrival}</p>
          {calendar(2)}
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <button type="button" className="link-u text-xs font-semibold uppercase tracking-[0.18em] text-mist hover:text-navy" onClick={() => onChange({ ...value, checkIn: null, checkOut: null })}>
              {t.search.clear}
            </button>
            <div className="flex items-center gap-5">
              {nights > 0 && <span className="serif text-xl text-navy">{plural(locale, nights, t.search.nights)}</span>}
              <button type="button" className="btn btn-navy h-11 min-h-0" onClick={() => setPanel('guests')} disabled={!value.checkOut}>
                {t.search.done}
              </button>
            </div>
          </div>
        </Popover>
        <Popover open={panel === 'guests'} onClose={close} anchor={guestsRef} label={t.search.guests} width={380} align="end" closeLabel={t.common.close}>
          <GuestSelector value={value} onChange={(g) => onChange({ ...value, ...g })} />
          <button type="button" className="btn btn-navy mt-4 h-11 min-h-0 w-full" onClick={hasDates ? submit : close}>
            <Search className="h-4 w-4" /> {hasDates ? t.search.cta : t.search.done}
          </button>
        </Popover>
      </div>
    </>
  );
}
