import Link from 'next/link';
import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { periodRange, rangeStats, DIRECT_SOURCES } from '@/server/stats';
import { sourceLabel } from '@/server/bookings';
import { transcriptionConfigured } from '@/server/ai/transcribe';
import { addDays, fmtDate, isValidISODate, todayISO } from '@/lib/dates';
import { cn, money } from '@/lib/utils';
import { Card, PageHeader, Stat, StickyBar } from '@/components/admin/ui';
import { BarList, RevenueChart } from '@/components/admin/charts';
import { AssistantChat } from '@/components/admin/assistant-chat';
import { PrintButton, PrintHeader } from '@/components/admin/print';

export const metadata = { title: 'Statistiche' };

const PERIODS = [
  { key: 'oggi', label: 'Oggi' },
  { key: '7g', label: 'Ultimi 7 giorni' },
  { key: '30g', label: 'Ultimi 30 giorni' },
  { key: 'mese', label: 'Questo mese' },
  { key: 'mese-scorso', label: 'Mese scorso' },
];

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ p?: string; dal?: string; al?: string }> }) {
  await requirePageUser('stats.view');
  const sp = await searchParams;
  const db = readDb();
  const today = todayISO();
  const custom = isValidISODate(sp.dal) && isValidISODate(sp.al) && sp.al! >= sp.dal!;
  const range = custom ? { from: sp.dal!, to: addDays(sp.al!, 1), label: `${fmtDate(sp.dal!)} – ${fmtDate(sp.al!)}` } : periodRange(sp.p ?? '30g', today);
  const s = rangeStats(db, range.from, range.to);
  const key = custom ? 'custom' : (sp.p ?? '30g');

  return (
    <div>
      <PrintHeader hotel={db.settings.hotel.name} title="Statistiche" period={range.label} />
      <div className="print:hidden">
        <PageHeader eyebrow="Andamento" title="Statistiche" description={`${range.label} · ${db.settings.demoMode ? 'calcolate sui dati dimostrativi' : 'calcolate sui dati del gestionale'}.`} actions={<PrintButton label="Stampa le statistiche" />} />
      </div>
      <div className="print:hidden">
      <StickyBar className="mb-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0" aria-label="Periodo">
          {PERIODS.map((p) => (
            <Link key={p.key} href={`/admin/statistiche?p=${p.key}`} aria-current={key === p.key ? 'page' : undefined} className={cn('shrink-0 border px-3 py-2 text-xs font-semibold', key === p.key ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy')}>
              {p.label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-end gap-2" action="/admin/statistiche">
          <label className="text-xs text-mist">
            Dal
            <input type="date" name="dal" defaultValue={custom ? sp.dal : range.from} className="field mt-1 py-2 text-sm" />
          </label>
          <label className="text-xs text-mist">
            Al
            <input type="date" name="al" defaultValue={custom ? sp.al : addDays(range.to, -1)} className="field mt-1 py-2 text-sm" />
          </label>
          <button className="h-10 border border-navy px-4 text-xs font-semibold text-navy">Intervallo personalizzato</button>
        </form>
      </div>
      </StickyBar>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Numero prenotazioni" value={s.bookings} sub={`${s.cancelled} annullate nel periodo`} tone="navy" />
        <Stat label="Ricavi" value={money(s.revenue)} sub={`incassato ${money(s.received)}`} />
        <Stat label="Occupazione" value={`${s.occupancy}%`} sub={`${s.roomNights} ${s.roomNights === 1 ? 'notte venduta' : 'notti vendute'}`} />
        <Stat label="Prezzo medio per notte" value={money(s.adr)} sub="ADR" />
      </section>

      <div className="mt-6 grid gap-6 [&>*]:min-w-0 xl:grid-cols-3">
        <Card title="Ricavi e occupazione per giorno" className="xl:col-span-2">
          <RevenueChart data={s.daily} />
        </Card>
        <Card title="Provenienza prenotazioni">
          <BarList items={s.sources.map((x) => ({ label: sourceLabel(x.source), value: x.count, sub: money(x.revenue), accent: !DIRECT_SOURCES.includes(x.source) }))} />
          <p className="mt-5 border-t border-line pt-4 text-sm text-navy">
            Prenotazioni dirette: <strong>{s.directShare}%</strong> <span className="text-mist">({s.direct} su {s.bookings})</span>
          </p>
          <p className="mt-1 text-xs text-mist">Blu = dirette (nessuna commissione), oro = OTA.</p>
        </Card>
        <Card title="Camere più richieste">
          <BarList items={s.topRooms.map((r) => ({ label: `${r.number} · ${r.name}`, value: r.nights, sub: money(r.revenue) }))} unit="notti" unitOne="notte" />
        </Card>
        <Card title="Conversioni del sito" className="print:hidden">
          <p className="text-sm text-charcoal/80">Disponibili solo collegando uno strumento di analisi (es. Plausible o GA4 con consenso dei visitatori).</p>
          <p className="mt-3 text-xs text-mist">Non mostriamo numeri inventati: il tracciamento non è collegato in questa demo.</p>
        </Card>
        <Card title="Chiedi a voce" className="xl:col-span-1 print:hidden">
          <AssistantChat compact whisper={transcriptionConfigured()} suggestions={['Quanto abbiamo guadagnato il mese scorso?', 'Quante prenotazioni sono arrivate dal sito questo mese?', 'Incassi degli ultimi 7 giorni']} />
        </Card>
      </div>
    </div>
  );
}
