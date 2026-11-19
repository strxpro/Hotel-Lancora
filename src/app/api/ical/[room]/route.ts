import { timingSafeEqual } from 'node:crypto';
import { readDb } from '@/server/db/store';
import { exportIcs, recordCalendarRead } from '@/server/channels/ical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The hotel's calendar for one room (iCal), read by Booking.com / Expedia / Airbnb every few hours
 * so they close the nights sold here. Secret key in the link; only dates, never guest data.
 * /api/ical/105.ics?k=…&per=booking   (per = leave out the nights that came from that portal)
 */
export async function GET(req: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room: raw } = await params;
  const url = new URL(req.url);
  const db = readDb();
  const key = db.channel.icalKey ?? '';
  const got = url.searchParams.get('k') ?? '';
  if (!key || got.length !== key.length || !timingSafeEqual(Buffer.from(got), Buffer.from(key))) return new Response('Not found', { status: 404 });
  const ref = raw.replace(/\.ics$/i, '');
  const room = db.rooms.find((r) => r.number === ref || r.slug === ref || r.id === ref);
  if (!room) return new Response('Not found', { status: 404 });
  // the portal's own server reads it (a browser opening the link to look at it does not count)
  if (!req.headers.get('sec-fetch-mode')) recordCalendarRead(room.id, url.searchParams.get('per'));
  return new Response(exportIcs(db, room.id, url.searchParams.get('per')), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `inline; filename="camera-${room.number}.ics"` },
  });
}
