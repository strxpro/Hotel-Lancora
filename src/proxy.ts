import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from './server/auth/session';
import { GATE_COOKIE, gateLang, gateOn, gatePage, gateToken } from './lib/site-gate';
import { isBot, visitorLang } from './lib/visitor-lang';

const LOCALES = ['en', 'pl', 'de', 'fr', 'es'];
/** the language of the pages the visitor last opened: after the first visit the site never chooses for them */
const LANG_COOKIE = 'la_lang';

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

  // 0. the site lock: every page asks for the password once (lib/site-gate.ts)
  if (gateOn() && req.cookies.get(GATE_COOKIE)?.value !== (await gateToken())) {
    const params = new URLSearchParams(search);
    const wrong = params.get('accesso') === 'errato';
    params.delete('accesso');
    const rest = params.toString();
    // on a first visit to an Italian address the page asks in the visitor's language and, once the
    // password is right, opens the site in that language; a language picked on this page stays as it is
    const prefixed = /^\/(en|pl|de|fr|es)(\/|$)/.test(pathname);
    const pub = !prefixed && !pathname.startsWith('/admin');
    const lang = pub && firstOpen(req) ? gateLang(pathname, req.headers.get('accept-language'), req.headers.get('x-vercel-ip-country'), req.cookies.get(LANG_COOKIE)?.value ?? null) : gateLang(pathname, null, null, prefixed ? null : 'it');
    const path = pub && lang !== 'it' ? `/${lang}${pathname === '/' ? '' : pathname}` : pathname;
    return new NextResponse(gatePage(`${path}${rest ? `?${rest}` : ''}`, wrong, lang), {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
    });
  }

  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') return NextResponse.next();
    const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return redirectTo(req, '/admin/login', `?next=${encodeURIComponent(pathname + search)}`, 307);
    return NextResponse.next();
  }

  const seg = pathname.split('/')[1] ?? '';
  const headers = new Headers(req.headers);
  const chosen = req.cookies.get(LANG_COOKIE)?.value;
  // remembers the language of the page (only when it changes: no cookie on every answer)
  const remember = (res: NextResponse, lang: string) => {
    if (chosen !== lang) res.cookies.set(LANG_COOKIE, lang, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
    return res;
  };

  if (seg === 'it') return redirectTo(req, pathname.replace(/^\/it/, '') || '/', search, 308);
  if (LOCALES.includes(seg)) {
    headers.set('x-locale', seg);
    return remember(NextResponse.next({ request: { headers } }), seg);
  }

  // first visit to an Italian address: the visitor's own language (browser, then country), once
  if (!chosen && firstOpen(req)) {
    const lang = visitorLang(req.headers.get('accept-language'), req.headers.get('x-vercel-ip-country'));
    if (lang !== 'it') return remember(redirectTo(req, `/${lang}${pathname === '/' ? '' : pathname}`, search, 307), lang);
  }
  headers.set('x-locale', 'it');
  const url = req.nextUrl.clone();
  url.pathname = `/it${pathname === '/' ? '' : pathname}`;
  return remember(NextResponse.rewrite(url, { request: { headers } }), 'it');
}

/**
 * A person opening a page of the site (typed, from a search, a link in a message): not a click inside
 * the site, not the site's own background requests, not a search engine or a link preview.
 */
function firstOpen(req: NextRequest): boolean {
  if (req.method !== 'GET' || isBot(req.headers.get('user-agent'))) return false;
  if (req.headers.get('rsc') || req.headers.get('next-router-prefetch') || req.headers.get('next-action')) return false;
  const dest = req.headers.get('sec-fetch-dest');
  if (dest && dest !== 'document') return false;
  const from = req.headers.get('referer');
  if (from) {
    try {
      if (new URL(from).host === req.nextUrl.host) return false;
    } catch {
      /* not an address */
    }
  }
  return true;
}

export const config = {
  matcher: ['/((?!api|_next|media|favicon|icon|apple-icon|robots.txt|sitemap.xml|manifest|.*\\..*).*)'],
};
