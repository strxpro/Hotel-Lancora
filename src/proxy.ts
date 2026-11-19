import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './server/auth/session';

const LOCALES = ['en', 'pl', 'de', 'fr', 'es'];

/**
 * Same-site redirect built on the request's own address, not on a fixed APP_URL: the browser stays
 * on the address it is using (localhost, the LAN, a temporary public tunnel or the real domain).
 * Next needs an absolute URL here and sends a same-origin one to the browser as a relative path.
 */
function redirectTo(req: NextRequest, path: string, search: string, status: 307 | 308) {
  const url = req.nextUrl.clone();
  url.pathname = path;
  url.search = search;
  return NextResponse.redirect(url, status);
}

/**
 * 1. Protects /admin (except the login page) with the signed session cookie.
 * 2. Locale routing: Italian has no prefix (/camere), other languages use /en/camere …
 *    Internally every public page lives under /[locale]/…
 */
export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') return NextResponse.next();
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return redirectTo(req, '/admin/login', `?next=${encodeURIComponent(pathname + search)}`, 307);
    return NextResponse.next();
  }

  const seg = pathname.split('/')[1] ?? '';
  const headers = new Headers(req.headers);

  if (seg === 'it') return redirectTo(req, pathname.replace(/^\/it/, '') || '/', search, 308);
  if (LOCALES.includes(seg)) {
    headers.set('x-locale', seg);
    return NextResponse.next({ request: { headers } });
  }
  headers.set('x-locale', 'it');
  const url = req.nextUrl.clone();
  url.pathname = `/it${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ['/((?!api|_next|media|favicon|icon|apple-icon|robots.txt|sitemap.xml|manifest|.*\\..*).*)'],
};
