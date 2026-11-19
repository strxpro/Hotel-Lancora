import { Suspense } from 'react';
import Link from 'next/link';
import { BedDouble, CalendarRange, ClipboardList, Euro, Sparkles } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { dashboardStats, arrivalsOn, departuresOn, inHouseOn } from '@/server/stats';
import { bookingRow, occupancyStrip, roomOptions } from '@/server/admin-data';
import { addDays, diffDays, fmtDateLong, todayISO } from '@/lib/dates';
import { isBookingActive } from '@/lib/availability';
import { money } from '@/lib/utils';
import { Stat } from '@/components/admin/ui';
import { ArrivalsList, DayLists, OccupancyStrip, QuickPrice, RecentBookings, TaskList, type DayRow } from '@/components/admin/dashboard';
import { EarningsByMethod, InHouseCard, RevenueArea, type MethodKey } from '@/components/admin/live-charts';
import { OpenAssistantButton } from '@/components/admin/assistant-panel';
import { PayoutCard, PayoutCardSkeleton } from '@/components/admin/payout-card';
import { payoutInfo } from '@/server/payments/payout';
import { syncConnectStatus } from '@/server/payments/connect-sync';
import type { DB } from '@/lib/types';
import { setupView } from '@/server/setup';
import { SetupChecklist } from '@/components/admin/setup';

const METHOD_OF: Record<string, MethodKey> = { stripe: 'card', stripe_test: 'card', simulazione: 'card', contanti: 'cash', pos: 'card', bonifico: 'transfer', ota: 'ota' };

export const metadata = { title: 'Oggi' };

/** Streams in after the rest of the page: Stripe is asked at most every few minutes and never blocks "Oggi". */
async function PayoutTile({ db }: { db: DB }) {
  return <PayoutCard info={await payoutInfo(db)} />;
}

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(new Date()));
  return h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ negato?: string }> }) {
  const user = await requirePageUser();
  const { negato } = await searchParams;
  await syncConnectStatus();
  const db = readDb();
  const today = todayISO();
  const now = new Date();
  const s = dashboardStats(db, today, now);
  const upcoming = db.bookings
    .filter((b) => isBookingActive(b, now) && b.checkIn >= today && b.checkIn < addDays(today, 7))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    .slice(0, 8)
    .map((b) => bookingRow(db, b, now));
  const recent = [...db.bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map((b) => bookingRow(db, b, now));
  const derivedTasks = [
    ...db.bookings.filter((b) => !b.roomId && isBookingActive(b, now) && b.checkOut > today).map((b) => ({ id: `d-${b.id}`, label: `Assegna una camera a ${b.code} (${b.guest.lastName}, ${b.source === 'booking' ? 'Booking.com' : b.source})`, href: `/admin/prenotazioni?id=${b.id}` })),
    ...db.bookings.filter((b) => b.status === 'pending_payment' && isBookingActive(b, now)).slice(0, 4).map((b) => ({ id: `p-${b.id}`, label: `Pagamento in attesa: ${b.code} · ${b.guest.lastName}`, href: `/admin/prenotazioni?id=${b.id}` })),
    ...arrivalsOn(db, today, now).map((b) => ({ id: `a-${b.id}`, label: `Preparare camera ${db.rooms.find((r) => r.id === b.roomId)?.number ?? '—'} per ${b.guest.lastName}`, href: `/admin/prenotazioni?id=${b.id}` })),
  ];
  const important = db.notifications.filter((n) => !n.read).slice(0, 5);

  // live widgets
  const inHouse = inHouseOn(db, today, now);
  const people = inHouse
    .map((b) => ({ id: b.id, name: `${b.guest.firstName} ${b.guest.lastName}`.trim(), room: db.rooms.find((r) => r.id === b.roomId)?.number ?? '—', nights: `notte ${diffDays(b.checkIn, today) + 1}/${diffDays(b.checkIn, b.checkOut)}` }))
    .sort((a, b) => a.room.localeCompare(b.room));
  // the three lists of the day (same bookings the planning shows)
  const dayRow = (b: (typeof inHouse)[number], night?: string): DayRow => ({
    id: b.id,
    guest: `${b.guest.firstName} ${b.guest.lastName}`.trim(),
    room: db.rooms.find((r) => r.id === b.roomId)?.number ?? null,
    guests: b.adults + b.children,
    from: b.checkIn,
    to: b.checkOut,
    night,
    paid: b.amountPaid >= b.total - 0.005,
  });
  const dayArrivals = arrivalsOn(db, today, now).map((b) => dayRow(b));
  const dayDepartures = departuresOn(db, today, now).map((b) => dayRow(b));
  const dayStaying = inHouse.filter((b) => b.checkIn < today && b.checkOut > today).map((b) => dayRow(b, `notte ${diffDays(b.checkIn, today) + 1} di ${diffDays(b.checkIn, b.checkOut)} · parte il ${new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(new Date(b.checkOut + 'T12:00:00'))}`));
  const monthStart = today.slice(0, 8) + '01';
  const byMethod: Record<MethodKey, number> = { card: 0, cash: 0, transfer: 0, ota: 0 };
  for (const p of db.payments) if (p.status === 'succeeded' && p.amount > 0 && p.createdAt.slice(0, 10) >= monthStart && p.createdAt.slice(0, 10) <= today) byMethod[METHOD_OF[p.provider] ?? 'card'] += p.amount;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const daily = days.map((d) => {
    const ps = db.payments.filter((p) => p.status === 'succeeded' && p.amount > 0 && p.createdAt.slice(0, 10) === d);
    const card = ps.filter((p) => METHOD_OF[p.provider] === 'card').reduce((a, p) => a + p.amount, 0);
    return { date: d, card, other: ps.reduce((a, p) => a + p.amount, 0) - card };
  });
  const monthLabel = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(now);

  const actions = [
    { href: '/admin/camere/nuova', label: '+ Aggiungi camera', icon: BedDouble },
    { href: '/admin/prenotazioni?nuova=1', label: 'Nuova prenotazione', icon: ClipboardList },
    { href: '/admin/prezzi', label: 'Modifica prezzi', icon: Euro },
    { href: '/admin/disponibilita', label: 'Apri calendario', icon: CalendarRange },
  ];

  return (
    <div>
      {negato && <p className="mb-6 rounded-2xl border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-sm text-terracotta">Non hai i permessi per aprire quella sezione.</p>}
      <header className="pb-8">
        <p className="eyebrow text-gold-2">{fmtDateLong(today)}</p>
        <h1 className="serif mt-3 text-[clamp(2.1rem,4.6vw,3.6rem)] leading-[1.02] text-navy">
          {greeting()}, benvenuto nel tuo hotel.
        </h1>
        <p className="mt-2 text-sm text-mist">
          {user.name} · oggi {s.arrivals} {s.arrivals === 1 ? 'arrivo' : 'arrivi'}, {s.departures} {s.departures === 1 ? 'partenza' : 'partenze'} e {s.available} camere libere.
        </p>
      </header>

      {user.role === 'admin' && <SetupChecklist view={setupView(db, user.id)} />}

      <div data-tour="quick-actions" className="no-scrollbar -mx-4 mb-8 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
        {actions.map((a, i) => (
          <Link key={a.href} href={a.href} className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-3 text-[0.8rem] font-semibold transition-colors ${i === 0 ? 'bg-navy text-ivory hover:bg-navy-3' : 'border border-line bg-white text-navy hover:border-navy'}`}>
            <a.icon className={`h-4 w-4 ${i === 0 ? 'text-gold' : 'text-gold-2'}`} /> {a.label}
          </Link>
        ))}
        <OpenAssistantButton className="inline-flex shrink-0 items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-4 py-3 text-[0.8rem] font-semibold text-navy transition-colors hover:bg-gold/20">
          <Sparkles className="h-4 w-4 text-gold-2" /> Chiedi all’assistente
        </OpenAssistantButton>
      </div>

      <section aria-label="In tempo reale" className="mb-6 grid gap-4 [&>*]:min-w-0 lg:grid-cols-12">
        <div data-tour="inhouse" className="lg:col-span-4 [&>*]:h-full">
          <InHouseCard guests={inHouse.reduce((a, b) => a + b.adults + b.children, 0)} rooms={s.occupied} totalRooms={s.occupied + s.available} arrivals={s.arrivals} departures={s.departures} people={people} />
        </div>
        <div data-tour="earnings" className="lg:col-span-4 [&>*]:h-full">
          <EarningsByMethod items={byMethod} month={monthLabel} />
        </div>
        <div className="lg:col-span-4 [&>*]:h-full">
          <RevenueArea data={daily} />
        </div>
      </section>

      <Suspense fallback={<PayoutCardSkeleton />}>
        <PayoutTile db={db} />
      </Suspense>

      <section aria-label="Indicatori" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat href="/admin/prenotazioni?filtro=tutte" label="Prenotazioni di oggi" value={s.bookingsToday} sub="ricevute oggi" tone="navy" />
        <Stat href="/admin/prenotazioni?filtro=arrivi" label="Arrivi previsti" value={s.arrivals} sub="check-in di oggi" />
        <Stat href="/admin/prenotazioni?filtro=partenze" label="Partenze previste" value={s.departures} sub="check-out di oggi" />
        <Stat href="/admin/prenotazioni?filtro=in_casa" label="Camere occupate" value={s.occupied} sub="stanotte" />
        <Stat href={`/admin/disponibilita?m=${today.slice(0, 7)}`} label="Camere disponibili" value={s.available} sub="stanotte, escluse le bloccate" />
        <Stat href="/admin/pagamenti" label="Incassi" value={money(s.revenueMonth)} sub="pagamenti ricevuti nel mese" />
        <Stat href="/admin/statistiche" label="Tasso di occupazione" value={`${s.occupancyRate}%`} sub="stanotte" />
        <Stat href="/admin/statistiche" label="Prenotazioni dirette" value={`${s.directShare}%`} sub={`${s.directBookings} nel mese (sito, telefono, email)`} />
      </section>

      <DayLists arrivals={dayArrivals} departures={dayDepartures} staying={dayStaying} planningHref={`/admin/disponibilita?m=${today.slice(0, 7)}`} dateLabel={new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(now)} />

      <div className="mt-8 grid gap-6 [&>*]:min-w-0 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <OccupancyStrip days={occupancyStrip(db, today, 21, now)} />
          <ArrivalsList rows={upcoming} />
          <RecentBookings rows={recent} />
        </div>
        <div className="space-y-6">
          <section className="overflow-clip rounded-3xl border border-line bg-white">
            <h2 className="border-b border-line px-5 py-4 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-navy">Notifiche importanti</h2>
            <ul className="divide-y divide-line">
              {important.length === 0 && <li className="px-5 py-5 text-sm text-mist">Tutto in ordine.</li>}
              {important.map((n) => (
                <li key={n.id}>
                  <Link href={n.href ?? '/admin'} className="block px-5 py-3.5 hover:bg-ivory">
                    <p className="text-sm font-medium text-navy">{n.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-mist">{n.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <TaskList derived={derivedTasks} manual={db.tasks} />
          <QuickPrice rooms={roomOptions(db)} canEdit={user.role === 'admin'} />
        </div>
      </div>
    </div>
  );
}
