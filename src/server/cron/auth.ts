import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * The scheduled jobs (/api/cron/*) answer only to the scheduler: Vercel Cron sends
 * "Authorization: Bearer <CRON_SECRET>" by itself; another service (e.g. cron-job.org) can send the
 * same header, or call the address with ?key=<CRON_SECRET>.
 */
export function cronDenied(req: Request): NextResponse | null {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (secret.length < 16) return NextResponse.json({ error: 'CRON_SECRET non impostato' }, { status: 503 });
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') || new URL(req.url).searchParams.get('key') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'non autorizzato' }, { status: 401 });
  return null;
}

/** Runs each job on its own: one failing never stops the others, and the answer says what happened. */
export async function runJobs(jobs: Record<string, () => unknown | Promise<unknown>>): Promise<NextResponse> {
  const out: Record<string, unknown> = {};
  for (const [name, job] of Object.entries(jobs)) {
    try {
      out[name] = (await job()) ?? 'ok';
    } catch (e) {
      out[name] = `errore: ${(e as Error).message.slice(0, 200)}`;
      console.error(`[cron] ${name}:`, (e as Error).message);
    }
  }
  return NextResponse.json(out, { headers: { 'cache-control': 'no-store' } });
}
