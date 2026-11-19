import { NextResponse } from 'next/server';
import { dataVersion } from '@/server/db/store';

export const dynamic = 'force-dynamic';

/** Lightweight "realtime": clients poll the data version and refresh when it changes. */
export function GET() {
  return NextResponse.json({ version: dataVersion() }, { headers: { 'cache-control': 'no-store' } });
}
