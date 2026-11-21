import { NextResponse } from 'next/server';
import { dataVersion } from '@/server/db/store';

export const dynamic = 'force-dynamic';

/**
 * Lightweight "realtime": clients poll the data version and refresh when it changes;
 * `build` names the version of the code, so pages opened before a new version went live reload themselves.
 */
export function GET() {
  return NextResponse.json({ version: dataVersion(), build: process.env.NEXT_PUBLIC_BUILD_ID || null }, { headers: { 'cache-control': 'no-store' } });
}
