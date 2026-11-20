import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { platformReady, stripeMode } from '@/server/payments/stripe';
import { OWNER_ID } from '@/server/setup';
import { syncConnectStatus } from '@/server/payments/connect-sync';
import { addDays, fmtDate, startOfMonth, todayISO } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/admin/ui';
import { AccountCard, GuestPayments, MoneyHero } from '@/components/admin/payments-simple';
import { PaymentsLedger } from '@/components/admin/payments-ledger';
import { PendingCharges } from '@/components/admin/pending-charges';
import { pendingCharges } from '@/server/payments/charge-later';
import { chargeLaterRule } from '@/lib/charge-later';

export const metadata = { title: 'Pagamenti' };

const PROVIDER: Record<string, string> = { stripe: 'Carta online', stripe_test: 'Carta (prova)', simulazione: 'Simulazione', contanti: 'Contanti', pos: 'Carta (POS)', bonifico: 'Bonifico', ota: 'Incassato dal portale' };
const CARD = new Set(['stripe', 'stripe_test', 'simulazione']);
const NOTICE: Record<string, { tone: 'green' | 'gold' | 'red'; text: string }> = {
  ok: { tone: 'green', text: 'Conto collegato: i prossimi pagamenti con carta arriveranno sul tuo conto.' },
  incompleto: { tone: 'gold', text: 'Collegamento avviato: Stripe chiede ancora alcune informazioni. Clicca “Completa la verifica”.' },
  errore: { tone: 'red', text: 'Stripe non ha risposto. Riprova tra qualche minuto.' },
};

/** Payments, as simple as possible: the money, the account, how guests pay (saved by itself), the movements. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePageUser('payments.manage');
  const sp = await searchParams;
  await syncConnectStatus();
  const db = readDb();
  const today = todayISO();
  const day = (iso: string) => todayISO(new Date(iso));
  const month = startOfMonth(today);
  const nextMonth = addDays(month, 32).slice(0, 8) + '01';
  const ok = db.payments.filter((p) => p.status === 'succeeded' && p.amount > 0);
  const monthPays = ok.filter((p) => day(p.createdAt) >= month && day(p.createdAt) < nextMonth);
  const sum = (list: typeof ok) => Math.round(list.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map((d) => ({ date: d, label: fmtDate(d, 'it', { day: 'numeric', month: 'short' }), amount: sum(ok.filter((p) => day(p.createdAt) === d)) }));
  const due = db.bookings.filter((b) => b.status === 'confirmed' && b.checkOut > today).reduce((s, b) => s + Math.max(0, b.total - b.amountPaid), 0);
  const cashDue = db.bookings.filter((b) => b.status === 'confirmed' && b.paymentMethod === 'cash' && b.checkOut > today).reduce((s, b) => s + Math.max(0, b.total - b.amountPaid), 0);
  const notice = sp.stripe ? NOTICE[sp.stripe] : null;
  const c = db.settings.stripeConnect;
  const payments = [...db.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 500);
  return (
    <div>
      <PageHeader eyebrow="Incassi" title="Pagamenti" description="Quanto è entrato, dove arrivano i soldi e come pagano gli ospiti." />
      {notice && (
        <p className="mb-5">
          <Badge tone={notice.tone}>{notice.text}</Badge>
        </p>
      )}
      <div className="grid gap-4 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <MoneyHero
          monthLabel={fmtDate(today, 'it', { month: 'long' })}
          month={sum(monthPays)}
          today={sum(ok.filter((p) => day(p.createdAt) === today))}
          due={Math.round(due * 100) / 100}
          cashDue={Math.round(cashDue * 100) / 100}
          byCard={sum(monthPays.filter((p) => CARD.has(p.provider) || p.provider === 'pos'))}
          byCash={sum(monthPays.filter((p) => p.provider === 'contanti'))}
          days={days}
        />
        <AccountCard
          mode={stripeMode()}
          demo={process.env.DEMO_MODE !== 'false'}
          platformOk={await platformReady()}
          support={user.role === 'admin' && user.id !== OWNER_ID}
          c={{
            accountId: c.accountId,
            simulated: c.simulated,
            chargesEnabled: c.chargesEnabled,
            payoutsEnabled: c.payoutsEnabled,
            detailsSubmitted: c.detailsSubmitted,
            payoutInterval: c.payoutInterval,
            weeklyAnchor: c.weeklyAnchor,
            monthlyAnchor: c.monthlyAnchor,
            businessName: c.businessName,
            bankLast4: c.bankLast4,
            requirements: c.requirements,
            autoInstant: c.autoInstant ?? false,
            direct: c.direct === true,
            updatedAt: c.updatedAt,
          }}
        />
      </div>
      {/* "paga dopo": the cards to charge before arrival, with the button to charge now */}
      <PendingCharges rows={pendingCharges()} today={today} enabled={chargeLaterRule(db.settings.payments).enabled} cardsOn={stripeMode() !== 'off'} />
      <div className="mt-4">
        <GuestPayments initial={db.settings.payments} cardsOn={stripeMode() !== 'off'} />
      </div>
      {/* last on the page, scrolling inside its own box */}
      <PaymentsLedger
        hotel={db.settings.hotel.name}
        rows={payments.map((p) => {
          const b = db.bookings.find((x) => x.id === p.bookingId);
          return {
            id: p.id,
            at: p.createdAt,
            bookingId: b?.id ?? null,
            label: b ? `${b.code} · ${b.guest.lastName}` : '—',
            code: b?.code,
            guest: b ? `${b.guest.firstName} ${b.guest.lastName}`.trim() : undefined,
            kind: p.kind === 'refund' ? 'Rimborso' : p.kind === 'deposit' ? 'Acconto' : p.kind === 'balance' ? 'Saldo' : 'Totale',
            method: CARD.has(p.provider) || p.provider === 'pos' ? 'card' : p.provider === 'contanti' ? 'cash' : p.provider === 'bonifico' ? 'transfer' : p.provider === 'ota' ? 'ota' : 'other',
            provider: PROVIDER[p.provider] ?? p.provider,
            amount: p.amount,
            status: p.status === 'succeeded' ? 'succeeded' : p.status === 'failed' ? 'failed' : 'pending',
          };
        })}
      />
    </div>
  );
}
