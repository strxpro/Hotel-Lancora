/**
 * The language a visitor gets on the first visit (proxy.ts and the password page):
 *  · the browser's own language when the site has it and it is not English;
 *  · else the country the visit comes from (Vercel's x-vercel-ip-country), when it speaks one of
 *    the site's languages: many people in Poland, Germany… keep their phone in English;
 *  · else English for a browser in English or a visit from abroad, Italian otherwise.
 */
export type VisitorLang = 'it' | 'en' | 'pl' | 'de' | 'fr' | 'es';

const SITE: VisitorLang[] = ['it', 'en', 'pl', 'de', 'fr', 'es'];

const BY_COUNTRY: Record<string, VisitorLang> = {
  IT: 'it', SM: 'it', VA: 'it',
  PL: 'pl',
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
  ES: 'es', AD: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es', DO: 'es', HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es', PR: 'es',
  GB: 'en', IE: 'en', US: 'en', CA: 'en', AU: 'en', NZ: 'en', MT: 'en',
};

/** The first language of the browser's list that the site has. */
export function browserLang(acceptLanguage: string | null | undefined): VisitorLang | null {
  const parts = (acceptLanguage ?? '')
    .split(',')
    .map((p, i) => {
      const [tag, ...params] = p.trim().split(';');
      const q = Number(params.find((x) => x.trim().startsWith('q='))?.split('=')[1] ?? 1);
      return { code: (tag ?? '').trim().slice(0, 2).toLowerCase(), q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.code && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return (parts.find((x) => (SITE as string[]).includes(x.code))?.code as VisitorLang | undefined) ?? null;
}

export function visitorLang(acceptLanguage: string | null | undefined, country: string | null | undefined): VisitorLang {
  const browser = browserLang(acceptLanguage);
  const cc = (country ?? '').trim().toUpperCase();
  const local = BY_COUNTRY[cc] ?? null;
  if (browser && browser !== 'en') return browser;
  if (local && local !== 'it' && local !== 'en') return local;
  if (browser === 'en') return 'en';
  if (local) return local;
  // a visit from a country without one of the site's languages: English
  return cc && cc !== 'XX' ? 'en' : 'it';
}

/** Search engines and link previews keep the address they asked for (each language has its own). */
export const isBot = (ua: string | null | undefined) => /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|preview|lighthouse|headless|curl|wget|python|node-fetch/i.test(ua ?? '');
