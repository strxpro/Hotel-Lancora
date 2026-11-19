import { cronDenied, runJobs } from '@/server/cron/auth';
import { syncAllCalendars } from '@/server/channels/ical';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Every 15 minutes: the portals' calendars (Booking.com, Airbnb) in both directions. */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  return runJobs({ calendars: () => syncAllCalendars() });
}
