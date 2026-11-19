import type { Metadata } from 'next';
import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { releaseExpiredHolds } from '@/server/bookings';
import { sendReviewRequests } from '@/server/reviews';
import { isBookingActive } from '@/lib/availability';
import { todayISO } from '@/lib/dates';
import { AdminShell } from '@/components/admin/shell';
import { transcriptionConfigured } from '@/server/ai/transcribe';
import { setupView } from '@/server/setup';
import { liveConfigured } from '@/server/ai/live';
import { mailUnreadCached } from '@/server/mail/mailbox';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { default: 'Pannello', template: '%s · Pannello L’Ancora' }, robots: { index: false, follow: false } };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  releaseExpiredHolds();
  sendReviewRequests();
  const db = readDb();
  const today = todayISO();
  const counts = {
    notifications: db.notifications.filter((n) => !n.read).length,
    messages: db.messages.filter((m) => !m.read).length,
    unassigned: db.bookings.filter((b) => !b.roomId && isBookingActive(b) && b.checkOut > today).length,
    // last known unread e-mails of the hotel mailbox (read in the background, never slows the page)
    mail: mailUnreadCached() ?? 0,
  };
  return (
    <AdminShell user={{ name: user.name, role: user.role }} counts={counts} notifications={db.notifications.slice(0, 12)} demo={process.env.DEMO_MODE === 'true' && db.settings.demoMode} whisper={transcriptionConfigured()} setup={user.role === 'admin' ? setupView(db, user.id) : undefined} live={liveConfigured()}>
      {children}
    </AdminShell>
  );
}
