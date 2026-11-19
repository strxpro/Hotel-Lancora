import Link from 'next/link';
import { ArrowUpRight, CalendarClock, Landmark } from 'lucide-react';
import type { PayoutInfo } from '@/server/payments/payout';
import { diffDays, fmtDate, todayISO } from '@/lib/dates';
import { money } from '@/lib/utils';

const STATUS: Record<PayoutInfo['status'], string> = { in_transit: 'in viaggio verso la banca', pending: 'creato da Stripe', scheduled: 'previsto dal calendario Stripe', manual: 'bonifici manuali', estimate: 'stima' };

function when(date: string | null): string {
  if (!date) return 'quando lo avvii da Stripe';
  const d = diffDays(todayISO(), date);
  const day = fmtDate(date, 'it', { weekday: 'long', day: 'numeric', month: 'long' });
  const s = d <= 0 ? `oggi, ${day}` : d === 1 ? `domani, ${day}` : `${day} · tra ${d} giorni`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Oggi" card: when the next payout reaches the bank, from Stripe or clearly marked as an estimate. */
export function PayoutCard({ info }: { info: PayoutInfo }) {
  const est = info.source === 'estimate';
  return (
    <Link href="/admin/pagamenti" data-testid="payout-card" className="group relative mb-6 flex flex-col gap-4 overflow-hidden rounded-3xl border border-line bg-white p-5 transition-[border-color,box-shadow] hover:border-navy/30 hover:shadow-[0_24px_60px_-40px_rgba(16,40,61,0.6)] md:p-6 xl:flex-row xl:items-center">
      <span aria-hidden="true" className="pointer-events-none absolute -left-10 -top-16 h-40 w-40 rounded-full bg-[#635bff]/10 blur-2xl" />
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-navy text-gold">
        <Landmark className="h-5 w-5" />
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-mist">
          Prossimo bonifico sul tuo conto
          {est ? (
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[0.6rem] tracking-[0.12em] text-[#7a5a1f]">Stima</span>
          ) : (
            <span className="rounded-full bg-[#635bff]/10 px-2 py-0.5 text-[0.6rem] tracking-[0.12em] text-[#4b44c9]">Dati Stripe{info.mode === 'test' ? ' · modalità prova' : ''}</span>
          )}
        </p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="serif text-[2.4rem] leading-none text-navy">{est ? '≈ ' : ''}{money(info.amount, 'it', 2)}</span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-navy">
            <CalendarClock className="h-4 w-4 text-gold-2" /> {when(info.date)}
          </span>
        </p>
        <p className="mt-2 text-xs leading-relaxed text-mist">
          {est
            ? `Calcolata dai pagamenti con carta ricevuti dal ${fmtDate(info.from ?? todayISO(), 'it', { day: 'numeric', month: 'long' })} a oggi (${info.count ?? 0} ${info.count === 1 ? 'pagamento' : 'pagamenti'}${info.refunds ? `, meno ${money(info.refunds, 'it', 2)} di rimborsi` : ''}), al lordo delle commissioni Stripe. Non è un dato letto da Stripe.`
            : `${STATUS[info.status]} · bonifici ${info.schedule}${info.bank ? ` · conto ${info.bank}` : ''}.${info.status === 'scheduled' && info.pending && info.availableOn ? ` Gli incassi in arrivo diventano disponibili dal ${fmtDate(info.availableOn, 'it', { day: 'numeric', month: 'long' })}.` : ''}${info.status === 'scheduled' && !info.amount ? ' Per ora non c’è nulla da trasferire.' : ''}`}
          {est && ` Bonifici ${info.schedule}${info.bank ? ` · conto ${info.bank}` : ''}${info.simulated ? ' · collegamento Stripe simulato (demo)' : ''}.`}
          {info.error && <span className="block text-terracotta">Stripe non leggibile ora ({info.error}): mostro la stima.</span>}
        </p>
      </div>
      {!est && (
        <dl className="relative grid shrink-0 grid-cols-3 gap-2 text-center xl:w-[22rem]">
          {[
            ['Disponibile', info.available !== null ? money(info.available, 'it', 2) : '—'],
            ['In arrivo', info.pending !== null ? money(info.pending, 'it', 2) : '—'],
            ['Ultimo', info.last ? `${money(info.last.amount)} · ${fmtDate(info.last.date, 'it', { day: 'numeric', month: 'short' })}` : '—'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-ivory px-2 py-2.5">
              <dt className="text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-mist">{k}</dt>
              <dd className="mt-1 truncate text-[0.8rem] font-semibold text-navy">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <span className="relative flex shrink-0 items-center gap-1 self-end text-xs font-semibold text-navy xl:self-center">
        Pagamenti <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export function PayoutCardSkeleton() {
  return (
    <div className="mb-6 flex items-center gap-4 rounded-3xl border border-line bg-white p-5 md:p-6" aria-busy="true" aria-label="Prossimo bonifico: caricamento">
      <span className="h-12 w-12 shrink-0 animate-pulse rounded-2xl bg-sand-2" />
      <span className="flex-1 space-y-2">
        <span className="block h-3 w-48 animate-pulse rounded-full bg-sand-2" />
        <span className="block h-8 w-40 animate-pulse rounded-full bg-sand-2" />
      </span>
    </div>
  );
}
