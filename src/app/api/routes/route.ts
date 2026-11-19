import { NextResponse } from 'next/server';
import { readDb } from '@/server/db/store';
import { placeRoutes } from '@/server/routes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Real road / footpath from the hotel to each place on the map (computed once, then cached). */
export async function GET() {
  const { lat, lng } = readDb().settings.hotel;
  const routes = await placeRoutes({ lat, lng });
  return NextResponse.json({ routes }, { headers: { 'cache-control': 'public, max-age=3600' } });
}
