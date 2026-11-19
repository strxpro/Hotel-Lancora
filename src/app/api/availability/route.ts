import { NextResponse } from 'next/server';
import { readDb } from '@/server/db/store';
import { availability } from '@/server/public-data';
import { isLocale } from '@/lib/i18n/config';
import { todayISO } from '@/lib/dates';
import { queryFromParams } from '@/components/site/booking/query';
import { ipOf, rateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ip = ipOf(req.headers);
  if (!rateLimit(`avail:${ip}`, 120, 60_000)) return NextResponse.json({ error: 'Troppe richieste' }, { status: 429 });
  const sp = new URL(req.url).searchParams;
  const locale = isLocale(sp.get('locale')) ? (sp.get('locale') as 'it') : 'it';
  const q = queryFromParams(sp, todayISO());
  if (!q.checkIn || !q.checkOut) return NextResponse.json({ error: 'Date non valide' }, { status: 400 });
  const data = availability(readDb(), { checkIn: q.checkIn, checkOut: q.checkOut, adults: q.adults, children: q.children }, locale);
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}
