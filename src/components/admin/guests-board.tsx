'use client';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Search } from 'lucide-react';
import type { GuestProfile } from '@/server/guests';
import { fmtDate } from '@/lib/dates';
import { cn, money } from '@/lib/utils';
import { Flag } from '@/components/site/flags';
import { useGuestCard } from './guest-card';
import { StickyBar } from './ui';

type Filter = 'all' | 'inhouse' | 'future' | 'consent' | 'loyal';

/**
 * Guests as people, not rows: search + quick filters, tap a person to open the guest card
 * (contact, bookings, payments, messages, notes, history, e-mail, refunds, privacy).
 */
export function GuestsBoard({ guests }: { guests: GuestProfile[] }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const openGuest = useGuestCard();
  const list = useMemo(
    () =>
      guests.filter((g) => {
        if (q && !`${g.name} ${g.email} ${g.phone} ${g.country}`.toLowerCase().includes(q.toLowerCase())) return false;
        if (filter === 'inhouse') return g.inHouse;
        if (filter === 'future') return Boolean(g.next);
        if (filter === 'consent') return g.consent && !g.unsubscribed;
        if (filter === 'loyal') return g.stays >= 2;
        return true;
      }),
    [guests, q, filter],
  );
  const counts = { all: guests.length, inhouse: guests.filter((g) => g.inHouse).length, future: guests.filter((g) => g.next).length, consent: guests.filter((g) => g.consent && !g.unsubscribed).length, loyal: guests.filter((g) => g.stays >= 2).length };
  const chips: { k: Filter; label: string }[] = [
    { k: 'all', label: 'Tutti' },
    { k: 'inhouse', label: 'In hotel ora' },
    { k: 'future', label: 'In arrivo' },
    { k: 'loyal', label: 'Tornano spesso' },
    { k: 'consent', label: 'Accettano email' },
  ];

  return (
    <div>
      <StickyBar>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <label data-tour="guests-search" className="relative block md:w-80">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nome, email, telefono…" className="field rounded-full py-2.5 pl-10 text-sm" aria-label="Cerca ospite" />
        </label>
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {chips.map((c) => (
            <button key={c.k} type="button" onClick={() => setFilter(c.k)} className={cn('relative flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-semibold transition-colors', filter === c.k ? 'border-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/30')}>
              {filter === c.k && <motion.span layoutId="guest-filter" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <span className="relative">{c.label}</span>
              <span className={cn('relative rounded-full px-1.5 text-[0.62rem]', filter === c.k ? 'bg-white/15' : 'bg-sand-2')}>{counts[c.k]}</span>
            </button>
          ))}
        </div>
      </div>
      </StickyBar>

      <ul data-tour="guests-list" className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false}>
          {list.slice(0, 240).map((g, i) => (
            <motion.li key={g.key} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ delay: Math.min(i, 10) * 0.02 }}>
              <button type="button" onClick={() => openGuest({ email: g.email })} className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3.5 text-left transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-navy/30 hover:shadow-[0_18px_40px_-30px_rgba(16,40,61,0.6)]">
                <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sand-2 font-serif text-xl text-navy">
                  {g.firstName.charAt(0)}
                  {g.inHouse && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-sage" title="In hotel ora" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold text-navy">{g.name}</span>
                    <Flag locale={g.lang} className="h-3 w-4 shrink-0 rounded-[2px]" />
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-mist">
                    {g.stays} {g.stays === 1 ? 'soggiorno' : 'soggiorni'} · {money(g.spent)}
                    {g.next ? ` · arriva il ${fmtDate(g.next)}` : g.inHouse ? ' · in hotel' : ''}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-mist transition-transform group-hover:translate-x-0.5" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {list.length === 0 && <p className="mt-10 text-center text-sm text-mist">Nessun ospite con questi filtri.</p>}

    </div>
  );
}
