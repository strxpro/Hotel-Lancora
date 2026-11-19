import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { guestProfiles } from '@/server/guests';
import { PageHeader } from '@/components/admin/ui';
import { GuestsBoard } from '@/components/admin/guests-board';
import { ospiti } from '@/lib/utils';

export const metadata = { title: 'Clienti' };

export default async function GuestsPage() {
  await requirePageUser('bookings.manage');
  const guests = guestProfiles(readDb());
  return (
    <div>
      <PageHeader eyebrow="Ospiti" title="Clienti" description={`${ospiti(guests.length)}. Tocca una persona per aprire la scheda: contatti, soggiorni, pagamenti, messaggi, note, email e rimborsi.`} />
      <GuestsBoard guests={guests} />
    </div>
  );
}
