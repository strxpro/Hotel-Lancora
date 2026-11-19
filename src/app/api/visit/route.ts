import { recordVisit } from '@/server/visits';
import { ipOf, rateLimit, sameOrigin } from '@/server/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Anonymous page-view beacon from the public site (daily totals only, see server/visits.ts). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response(null, { status: 204 });
  const ip = ipOf(req.headers);
  if (!rateLimit(`visit:${ip}`, 120, 60_000)) return new Response(null, { status: 204 });
  let p = '/';
  try {
    const body = (await req.json()) as { p?: unknown };
    if (typeof body.p === 'string' && body.p.startsWith('/') && body.p.length < 300) p = body.p;
  } catch {
    /* empty beacon */
  }
  recordVisit(ip, req.headers.get('user-agent') ?? '', p);
  return new Response(null, { status: 204 });
}
