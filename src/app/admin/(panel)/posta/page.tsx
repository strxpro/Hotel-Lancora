import { can, requirePageUser } from '@/server/auth/guard';
import { mailboxPublic } from '@/server/mail/mailbox';
import { PageHeader } from '@/components/admin/ui';
import { ConnectMailbox, Mailbox } from '@/components/admin/mailbox';

export const metadata = { title: 'Posta' };

/** The hotel's own mailbox inside the panel: read, answer, write. */
export default async function MailPage() {
  const user = await requirePageUser('bookings.manage');
  const box = mailboxPublic();
  return (
    <div>
      <PageHeader eyebrow="Comunicazioni" title="Posta" description={box ? `La casella ${box.email}, qui nel pannello.` : 'Collega la casella dell’hotel e leggi le email senza uscire dal pannello.'} />
      {box ? <Mailbox box={box} canEdit={can(user.role, 'settings.edit')} /> : <ConnectMailbox canEdit={can(user.role, 'settings.edit')} />}
    </div>
  );
}
