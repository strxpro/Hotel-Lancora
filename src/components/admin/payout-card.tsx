import type { PayoutInfo } from '@/server/payments/payout';
import { diffDays, fmtDate, todayISO } from '@/lib/dates';
import { money } from '@/lib/utils';
import { PayoutHero, type PayoutView } from './payout-hero';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Oggi" / "Domani" / "Tra 3 giorni". */
function relDay(date: string, today: string): string {
  const d = diffDays(today, date);
  return d <= 0 ? 'Oggi' : d === 1 ? 'Domani' : `Tra ${d} giorni`;
}

/** Everything the card says, worked out here (server, hotel time) so the page never disagrees with itself. */
function viewOf(info: PayoutInfo): PayoutView {
  const today = todayISO();
  const est = info.source === 'estimate';
  const manual = info.status === 'manual';
  // payouts "a mano" on Stripe: no fixed day; the day the money can leave, when some is still waiting
  const day = info.date ?? (manual && info.availableOn && info.availableOn > today ? info.availableOn : null);
  const bank = info.bank ? ` ${info.bank}` : '';

  const label =
    info.status === 'in_transit' ? `In viaggio: arriva sul tuo conto${bank}`
    : info.status === 'pending' ? `Arriva sul tuo conto${bank}`
    : info.status === 'scheduled' ? `Parte da Stripe verso il tuo conto${bank}`
    : manual ? (day ? 'Da quel giorno puoi avviarlo tu da Stripe' : 'Su Stripe i bonifici sono “a mano”')
    : cap(`bonifici ${info.schedule}`);

  const note = est
    ? `Stima calcolata dai pagamenti con carta ricevuti dal ${fmtDate(info.from ?? today, 'it', { day: 'numeric', month: 'long' })} a oggi (${info.count ?? 0} ${info.count === 1 ? 'pagamento' : 'pagamenti'}${info.refunds ? `, meno ${money(info.refunds, 'it', 2)} di rimborsi` : ''}), prima delle commissioni Stripe.${bank ? ` Conto${bank}.` : ''}${info.simulated ? ' Collegamento simulato (demo).' : ''}`
    : manual
      ? 'I soldi restano su Stripe finché non avvii tu il bonifico. Qui sotto, in “Bonifici”, scegli “ogni giorno” per riceverli da soli.'
      : [
          info.status === 'scheduled' && info.amount ? 'Sul conto arriva di solito entro 1–2 giorni lavorativi.' : '',
          info.status === 'scheduled' && !info.amount ? 'Per ora non c’è nulla da trasferire: partirà con i prossimi pagamenti con carta.' : '',
          info.status === 'scheduled' && info.pending && info.availableOn ? `Gli incassi in arrivo diventano disponibili dal ${fmtDate(info.availableOn, 'it', { day: 'numeric', month: 'long' })}.` : '',
          `Bonifici ${info.schedule}.`,
        ].filter(Boolean).join(' ');

  return {
    tile: day ? { weekday: fmtDate(day, 'it', { weekday: 'short' }).replace('.', ''), day: fmtDate(day, 'it', { day: 'numeric' }), month: fmtDate(day, 'it', { month: 'long' }) } : null,
    heading: day ? cap(`${manual && !info.date ? 'disponibile da ' : ''}${fmtDate(day, 'it', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`) : 'Quando lo avvii tu',
    rel: day ? relDay(day, today) : null,
    label,
    amount: info.amount,
    approx: est,
    empty: !info.amount,
    badge: est ? { text: 'Stima', tone: 'gold' } : { text: info.mode === 'test' ? 'Stripe · prova' : 'Stripe', tone: 'violet' },
    manual,
    note,
    error: info.error ? `Stripe non risponde ora: mostro la stima.` : null,
    stats: est
      ? null
      : [
          ['Disponibile', info.available !== null ? money(info.available, 'it', 2) : '—'],
          ['In arrivo', info.pending !== null ? money(info.pending, 'it', 2) : '—'],
          ['Ultimo bonifico', info.last ? `${money(info.last.amount)} · ${fmtDate(info.last.date, 'it', { day: 'numeric', month: 'short' })}` : '—'],
        ],
  };
}

/** Top of "Oggi" and "Pagamenti": the next payout to the bank, its day big, from Stripe or clearly marked as an estimate. */
export function PayoutCard({ info, link = true }: { info: PayoutInfo; /** false on Pagamenti itself: a card, not a link */ link?: boolean }) {
  return <PayoutHero view={viewOf(info)} link={link} />;
}

export function PayoutCardSkeleton() {
  return (
    <div className="mb-6 flex items-center gap-5 rounded-[2rem] border border-gold/40 bg-white p-5 md:p-7" aria-busy="true" aria-label="Prossimo bonifico: caricamento">
      <span className="h-28 w-24 shrink-0 animate-pulse rounded-[1.4rem] bg-sand-2 md:h-32 md:w-28" />
      <span className="flex-1 space-y-3">
        <span className="block h-4 w-40 animate-pulse rounded-full bg-sand-2" />
        <span className="block h-9 w-72 max-w-full animate-pulse rounded-full bg-sand-2" />
        <span className="block h-4 w-56 max-w-full animate-pulse rounded-full bg-sand-2" />
      </span>
    </div>
  );
}
