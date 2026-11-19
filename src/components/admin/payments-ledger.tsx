'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { GuestLink } from './guest-card';
import { Printer, Search } from 'lucide-react';
import { printSheet } from './print';
import { cn, money } from '@/lib/utils';
import { fmtDateTime } from '@/lib/dates';
import { Badge } from './ui';

export type LedgerRow = { id: string; at: string; bookingId: string | null; label: string; code?: string; guest?: string; kind: string; method: 'card' | 'cash' | 'transfer' | 'ota' | 'other'; provider: string; amount: number; status: 'succeeded' | 'failed' | 'pending' };

const FILTERS: { k: 'all' | 'card' | 'cash' | 'transfer' | 'refund'; label: string }[] = [
  { k: 'all', label: 'Tutti' },
  { k: 'card', label: 'Carta' },
  { k: 'cash', label: 'Contanti' },
  { k: 'transfer', label: 'Bonifico' },
  { k: 'refund', label: 'Rimborsi' },
];

/**
 * Every payment, at the bottom of the page in a box of its own: the list scrolls inside the box
 * (the page keeps its length), the title and the column names stay in view, and it can be
 * narrowed by method or searched by booking code or surname.
 */
const METHOD_LABEL: Record<LedgerRow['method'], string> = { card: 'Carta', cash: 'Contanti', transfer: 'Bonifico', ota: 'Portali', other: 'Altro' };

export function PaymentsLedger({ rows, hotel = 'Hotel L’Ancora' }: { rows: LedgerRow[]; hotel?: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['k']>('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [warn, setWarn] = useState<string | null>(null);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (filter === 'all' ? true : filter === 'refund' ? r.amount < 0 : r.method === filter && r.amount >= 0) && (!s || r.label.toLowerCase().includes(s)) && (!from || r.at.slice(0, 10) >= from) && (!to || r.at.slice(0, 10) <= to));
  }, [rows, filter, q, from, to]);
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const allPicked = shown.length > 0 && shown.every((r) => picked.includes(r.id));
  // the ticked rows, or else everything shown (period + filters)
  const print = () => {
    const list = (picked.length ? rows.filter((r) => picked.includes(r.id)) : shown).filter((r) => r.status === 'succeeded').sort((a, b) => a.at.localeCompare(b.at));
    if (!list.length) return setWarn('Niente da stampare: scegli un periodo o spunta qualche movimento.');
    setWarn(null);
    const by = new Map<string, number>();
    for (const r of list) by.set(r.amount < 0 ? 'Rimborsi' : METHOD_LABEL[r.method], (by.get(r.amount < 0 ? 'Rimborsi' : METHOD_LABEL[r.method]) ?? 0) + r.amount);
    const fmt = (iso: string) => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
    const period = picked.length ? `${picked.length} movimenti scelti` : from || to ? `Dal ${from ? fmt(from) : 'primo movimento'} al ${to ? fmt(to) : 'oggi'}` : 'Tutti i movimenti';
    const ok = printSheet({
      hotel,
      title: 'Estratto dei movimenti',
      period,
      columns: ['Data', 'Prenotazione', 'Ospite', 'Metodo', 'Importo'],
      alignRight: [4],
      rows: list.map((r) => [fmtDateTime(r.at), r.code ?? r.label, r.guest ?? '', `${r.amount < 0 ? 'Rimborso · ' : ''}${METHOD_LABEL[r.method]}`, money(r.amount, 'it', 2)]),
      totals: [...[...by.entries()].map(([k, v]) => [k, money(v, 'it', 2)] as [string, string]), ['Totale', money(list.reduce((a, r) => a + r.amount, 0), 'it', 2)]],
    });
    if (!ok) setWarn('Il browser ha bloccato la finestra di stampa: consenti i popup per questo sito.');
  };
  const total = shown.reduce((a, r) => a + (r.status === 'succeeded' ? r.amount : 0), 0);
  return (
    <section aria-labelledby="ledger-title" className="mt-6 overflow-hidden rounded-3xl border border-line bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <h2 id="ledger-title" className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">
          Movimenti
        </h2>
        <span className="text-xs text-mist">
          {shown.length} {shown.length === 1 ? 'movimento' : 'movimenti'} · totale {money(total, 'it', 2)}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full bg-ivory p-1">
            {FILTERS.map((f) => (
              <button key={f.k} type="button" aria-pressed={filter === f.k} onClick={() => setFilter(f.k)} className={cn('h-8 rounded-full px-3 text-[0.72rem] font-semibold transition-colors', filter === f.k ? 'bg-navy text-ivory' : 'text-navy hover:bg-white')}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[0.7rem] text-mist">
            Dal
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-full border border-line bg-white px-3 text-xs text-navy outline-none focus:border-navy" />
          </label>
          <label className="flex items-center gap-1.5 text-[0.7rem] text-mist">
            al
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-full border border-line bg-white px-3 text-xs text-navy outline-none focus:border-navy" />
          </label>
          <button type="button" onClick={print} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-navy px-4 text-xs font-semibold text-ivory transition hover:bg-navy-2">
            <Printer className="h-3.5 w-3.5" /> {picked.length ? `Stampa ${picked.length} scelti` : 'Stampa'}
          </button>
          <label className="relative">
            <span className="sr-only">Cerca</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Codice o cognome" className="h-9 w-44 rounded-full border border-line bg-white pl-8 pr-3 text-xs outline-none focus:border-navy" />
          </label>
        </div>
      </div>
      {warn && <p className="border-b border-line bg-terracotta/5 px-5 py-2 text-xs text-terracotta">{warn}</p>}
      {/* the list scrolls here, not the page */}
      <div data-lenis-prevent className="thin-scroll max-h-[min(520px,60vh)] overflow-auto overscroll-contain">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-[1] bg-ivory/95 text-left text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-mist backdrop-blur">
            <tr>
              <th className="w-10 py-2.5 pl-5">
                <input type="checkbox" aria-label="Scegli tutti i movimenti mostrati" checked={allPicked} onChange={() => setPicked(allPicked ? [] : shown.map((r) => r.id))} className="h-4 w-4 accent-[var(--color-navy)]" />
              </th>
              <th className="px-3 py-2.5 font-semibold">Data</th>
              <th className="px-3 py-2.5 font-semibold">Prenotazione</th>
              <th className="px-3 py-2.5 font-semibold">Tipo</th>
              <th className="px-3 py-2.5 text-right font-semibold">Importo</th>
              <th className="px-5 py-2.5 text-right font-semibold">Stato</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-mist">
                  Nessun movimento.
                </td>
              </tr>
            )}
            {shown.map((p) => (
              <tr key={p.id} className={cn('hover:bg-ivory/60', picked.includes(p.id) && 'bg-gold/[0.07]')}>
                <td className="py-2.5 pl-5">
                  <input type="checkbox" aria-label={`Scegli il movimento del ${fmtDateTime(p.at)}`} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-[var(--color-navy)]" />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-mist">{fmtDateTime(p.at)}</td>
                <td className="px-3 py-2.5">
                  {p.bookingId ? (
                    p.code && p.guest ? (
                      <span>
                        <Link href={`/admin/prenotazioni?id=${p.bookingId}`} className="text-navy hover:underline">
                          {p.code}
                        </Link>
                        {' · '}
                        <GuestLink bookingId={p.bookingId} className="text-navy">
                          {p.guest}
                        </GuestLink>
                      </span>
                    ) : (
                      <Link href={`/admin/prenotazioni?id=${p.bookingId}`} className="text-navy hover:underline">
                        {p.label}
                      </Link>
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-mist">
                  {p.kind} · {p.provider}
                </td>
                <td className={cn('whitespace-nowrap px-3 py-2.5 text-right tabular-nums', p.amount < 0 ? 'text-terracotta' : 'text-navy')}>{money(p.amount, 'it', 2)}</td>
                <td className="px-5 py-2.5 text-right">{p.status === 'succeeded' ? <Badge tone="green">ok</Badge> : p.status === 'failed' ? <Badge tone="red">non riuscito</Badge> : <Badge tone="gold">in attesa</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
