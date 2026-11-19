'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AvailabilityResponse, RoomCardData } from '@/lib/room-card';
import { useI18n, useLenis, useLiveVersion, scrollToTarget } from '../providers';
import { SearchBar } from '../booking/search-bar';
import { RoomsSection } from './rooms-section';
import { queryToParams, type StayQuery } from '../booking/query';

export function RoomsExplorer({ rooms, initialQuery, initialResults, today, cashPercent = 0 }: { rooms: RoomCardData[]; initialQuery: StayQuery; initialResults: AvailabilityResponse | null; today: string; cashPercent?: number }) {
  const { locale } = useI18n();
  const router = useRouter();
  const lenis = useLenis();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState(initialResults);
  const [loading, setLoading] = useState(false);
  const last = useRef<StayQuery | null>(initialResults ? initialQuery : null);
  const bar = useRef<HTMLDivElement>(null);

  // the docked search: floating buttons (chat, back-to-top) sit above it, like on the home page
  useEffect(() => {
    const root = document.documentElement;
    const el = bar.current;
    if (!el) return;
    let last = '';
    const set = () => {
      const m = window.innerWidth < 768 ? 16 : 24;
      const h = Math.round(el.offsetHeight);
      const key = `${h}:${m}`;
      if (key === last) return;
      last = key;
      root.style.setProperty('--dock-h', `${h + m}px`);
      root.style.setProperty('--dock-mid', `${m + h / 2}px`);
      root.dataset.dock = '1';
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--dock-h', '0px');
      delete root.dataset.dock;
    };
  }, []);

  const fetchResults = useCallback(
    async (q: StayQuery) => {
      const p = queryToParams(q);
      p.set('locale', locale);
      const r = await fetch(`/api/availability?${p}`, { cache: 'no-store' });
      return r.ok ? ((await r.json()) as AvailabilityResponse) : null;
    },
    [locale],
  );

  const search = async (q: StayQuery) => {
    setLoading(true);
    const data = await fetchResults(q);
    last.current = q;
    window.history.replaceState(null, '', `${window.location.pathname}?${queryToParams(q)}`);
    scrollToTarget(lenis.current, '#camere', -100, () => {
      setResults(data);
      setLoading(false);
    });
  };

  useLiveVersion(
    useCallback(async () => {
      if (last.current) {
        const d = await fetchResults(last.current);
        if (d) setResults(d);
      }
      router.refresh();
    }, [fetchResults, router]),
  );

  return (
    <div className="relative pb-24 md:pb-28">
      <div className={loading ? 'opacity-40 transition-opacity duration-500' : 'transition-opacity duration-500'}>
        <RoomsSection
          rooms={rooms}
          results={results}
          query={query}
          cashPercent={cashPercent}
          onReset={() => {
            setResults(null);
            last.current = null;
            window.history.replaceState(null, '', window.location.pathname);
          }}
          onChangeDates={() => scrollToTarget(lenis.current, '#camere', -100)}
          onPickDates={(checkIn, checkOut) => {
            const q = { ...query, checkIn, checkOut };
            setQuery(q);
            search(q);
          }}
        />
      </div>
      {/* the search rides along at the bottom of the screen while you browse the rooms, then parks above the footer */}
      <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-end px-4 pb-4 sm:px-6 md:px-[6.25rem] md:pb-6">
        <div ref={bar} id="ricerca" className="pointer-events-auto sticky bottom-4 mx-auto w-full max-w-[1120px] md:bottom-6">
          <SearchBar value={query} onChange={setQuery} onSubmit={search} today={today} loading={loading} variant="hero" docked />
        </div>
      </div>
    </div>
  );
}
