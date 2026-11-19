import { NextResponse } from 'next/server';
import { GATE_COOKIE, gatePasswordOk, gateToken, safeNext } from '@/lib/site-gate';
import { ipOf, rateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

/** The password of the site lock (see lib/site-gate.ts): right = cookie for 30 days, wrong = ask again. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(String(form?.get('next') ?? '/'));
  const back = (path: string) => {
    const url = new URL(path, req.url);
    return NextResponse.redirect(url, 303);
  };
  // a few tries a minute per address: nobody guesses it by trying
  if (!rateLimit(`gate:${ipOf(req.headers)}`, 8, 60_000)) return back(`${next}${next.includes('?') ? '&' : '?'}accesso=errato`);
  if (!(await gatePasswordOk(String(form?.get('password') ?? '')))) return back(`${next}${next.includes('?') ? '&' : '?'}accesso=errato`);
  const res = back(next);
  res.cookies.set(GATE_COOKIE, await gateToken(), { httpOnly: true, sameSite: 'lax', secure: new URL(req.url).protocol === 'https:', path: '/', maxAge: 30 * 24 * 3600 });
  return res;
}
