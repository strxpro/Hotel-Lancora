import { cronDenied, runJobs } from '@/server/cron/auth';
import { releaseExpiredHolds } from '@/server/bookings';
import { expireCardRequests } from '@/server/booking-care';
import { dailyTick } from '@/server/daily';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Every minute (what the server's own timers did on the computer):
 * free the rooms of unpaid holds, cancel bookings whose "new card" deadline passed,
 * morning messages, rooms to prepare, the evening report.
 */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  return runJobs({
    holds: () => releaseExpiredHolds(),
    cards: () => expireCardRequests(),
    day: () => dailyTick(),
  });
}
