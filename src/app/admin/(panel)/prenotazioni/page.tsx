import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { bookingRow, roomOptions } from '@/server/admin-data';
import { PageHeader } from '@/components/admin/ui';
import { BookingsTable } from '@/components/admin/bookings-table';

export const metadata = { title: 'Prenotazioni' };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ filtro?: string; id?: string; nuova?: string }> }) {
  const user = await requirePageUser('bookings.manage');
  const sp = await searchParams;
  const db = readDb();
  const now = new Date();
  return (
    <div>
      <PageHeader eyebrow="Gestione" title="Prenotazioni" description="Sito, telefono e OTA in un unico elenco. Apri una prenotazione per assegnare la camera, registrare pagamenti o inviare email." />
      <BookingsTable
        rows={db.bookings.map((b) => bookingRow(db, b, now))}
        rooms={roomOptions(db)}
        blocks={db.blocks.map((k) => ({ id: k.id, roomId: k.roomId, from: k.from, to: k.to, reason: k.reason }))}
        initialFilter={sp.filtro ?? 'tutte'}
        openId={sp.id}
        openNew={sp.nuova === '1'}
        isAdmin={user.role === 'admin'}
        freeCancellationDays={db.settings.payments.freeCancellationDays}
        cancellationFee={db.settings.payments.cancellationFee}
      />
    </div>
  );
}
