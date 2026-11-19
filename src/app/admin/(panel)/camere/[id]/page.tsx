import { notFound } from 'next/navigation';
import { requirePageUser, can } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { providerStatus } from '@/server/ai/provider';
import { translationProvider } from '@/server/ai/content';
import { PageHeader } from '@/components/admin/ui';
import { monthPrices } from '@/lib/period-prices';
import { todayISO } from '@/lib/dates';
import { RoomWizard } from '@/components/admin/room-wizard';

export const metadata = { title: 'Modifica camera' };

export default async function EditRoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ passo?: string }> }) {
  const user = await requirePageUser('rooms.edit');
  const { id } = await params;
  const { passo } = await searchParams;
  const db = readDb();
  const room = db.rooms.find((r) => r.id === id);
  if (!room) notFound();
  const step = Math.min(4, Math.max(0, (Number(passo) || 1) - 1));
  return (
    <div>
      <PageHeader eyebrow={`Camera ${room.number}`} title={room.name} description={room.demo ? 'Camera dimostrativa: foto e testi di esempio.' : undefined} />
      <RoomWizard
        room={room}
        initialStep={step}
        enableLower={db.settings.floors.enableLower}
        canEditPrice={can(user.role, 'prices.edit')}
        canDelete={can(user.role, 'rooms.delete')}
        translation={translationProvider()}
        ai={providerStatus()}
        blocks={db.blocks.filter((b) => b.roomId === room.id).map((b) => ({ id: b.id, from: b.from, to: b.to, reason: b.reason }))}
        existing={db.rooms.filter((r) => r.id !== room.id).map((r) => ({ id: r.id, number: r.number, name: r.name }))}
        customAmenities={db.settings.customAmenities.map(({ key, label }) => ({ key, label }))}
        cash={{ enabled: db.settings.payments.allowCashAtHotel, percent: db.settings.payments.cashDiscountPercent }}
        months={monthPrices(room, db.ratePeriods, todayISO())}
        periods={db.ratePeriods.filter((p) => p.roomIds !== 'all' && p.roomIds.includes(room.id)).map((p) => ({ id: p.id, label: p.label, from: p.from, to: p.to, value: p.value, mode: p.mode }))}
      />
    </div>
  );
}
