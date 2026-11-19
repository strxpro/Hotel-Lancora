import { requirePageUser, can } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { providerStatus } from '@/server/ai/provider';
import { translationProvider } from '@/server/ai/content';
import { PageHeader } from '@/components/admin/ui';
import { RoomWizard } from '@/components/admin/room-wizard';

export const metadata = { title: 'Nuova camera' };

export default async function NewRoomPage() {
  const user = await requirePageUser('rooms.edit');
  const db = readDb();
  return (
    <div>
      <PageHeader eyebrow="Camere" title="Aggiungi camera" description="Sei passaggi semplici. Puoi salvare una bozza in qualsiasi momento e completare dopo." />
      <RoomWizard room={null} enableLower={db.settings.floors.enableLower} canEditPrice={can(user.role, 'prices.edit') || true} canDelete={false} translation={translationProvider()} ai={providerStatus()} blocks={[]} periods={[]} existing={db.rooms.map((r) => ({ id: r.id, number: r.number, name: r.name }))} customAmenities={db.settings.customAmenities.map(({ key, label }) => ({ key, label }))} cash={{ enabled: db.settings.payments.allowCashAtHotel, percent: db.settings.payments.cashDiscountPercent }} />
    </div>
  );
}
