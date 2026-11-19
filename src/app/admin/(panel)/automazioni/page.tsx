import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { roomOptions } from '@/server/admin-data';
import { telegramConfigured } from '@/server/telegram/api';
import { configuredAdapter } from '@/server/channels/adapter';
import { PageHeader } from '@/components/admin/ui';
import { ChannelPanel } from '@/components/admin/automation';
import { AutomationHub } from '@/components/admin/automation-hub';
import { reportSchedule } from '@/server/daily';

export const metadata = { title: 'Automazioni' };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ avanzato?: string }> }) {
  await requirePageUser('automations.manage');
  const { avanzato } = await searchParams;
  const db = readDb();
  return (
    <div className="space-y-14">
      <div>
        <PageHeader eyebrow="Automazioni" title="Collegamenti e avvisi" description="Telegram e i portali si collegano con un tocco. Gli avvisi arrivano sul telefono, e ogni sera il report della giornata." />
        <AutomationHub
          telegramReady={telegramConfigured()}
          chats={db.telegram.linkedChats.map((c) => ({ chatId: c.chatId, name: c.name, linkedAt: c.linkedAt }))}
          toggles={db.settings.notifications}
          checkOutBy={db.settings.hotel.checkOutBy}
          schedule={reportSchedule(db)}
        />
      </div>
      {/* channel manager tools stay for a technician (/admin/automazioni?avanzato=1), not on the owner's screen */}
      {avanzato === '1' && (
        <div>
          <PageHeader eyebrow="Avanzato" title="Channel manager" description="Solo per strutture con un channel manager in abbonamento." />
          <ChannelPanel channel={db.channel} rooms={roomOptions(db)} hasRealAdapter={Boolean(configuredAdapter())} />
        </div>
      )}
    </div>
  );
}
