import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { bookingRow, roomOptions } from '@/server/admin-data';
import { startOfMonth, todayISO } from '@/lib/dates';
import { PageHeader } from '@/components/admin/ui';
import { PlanningBoard } from '@/components/admin/planning';

export const metadata = { title: 'Planning camere' };

export default async function PlanningPage({ searchParams }: { searchParams: Promise<{ m?: string; view?: string; blocca?: string }> }) {
  await requirePageUser('bookings.manage');
  const sp = await searchParams;
  const db = readDb();
  const today = todayISO();
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? `${sp.m}-01` : startOfMonth(today);
  const now = new Date();
  return (
    <div>
      <PageHeader eyebrow="Disponibilità" title="Planning camere" description="Come il foglio di carta: righe = camere, colonne = giorni, una X per ogni notte occupata. Tocca una X per vedere l’ospite, tocca due caselle libere per bloccare le date." />
      <PlanningBoard
        rooms={roomOptions(db)}
        bookings={db.bookings.map((b) => bookingRow(db, b, now))}
        blocks={db.blocks.map((k) => ({ id: k.id, roomId: k.roomId, from: k.from, to: k.to, reason: k.reason, ...(k.source ? { source: k.source } : {}) }))}
        periods={db.ratePeriods}
        today={today}
        initialMonth={month}
        initialView={sp.view === 'calendario' ? 'calendario' : sp.view === 'booking' ? 'booking' : 'planning'}
        openBlock={sp.blocca === '1'}
      />
    </div>
  );
}
