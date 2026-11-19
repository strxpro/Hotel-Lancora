import { LOCALES, type Locale } from './types';

const COUNTRY_LANG: Record<string, Locale> = {
  IT: 'it', SM: 'it', VA: 'it',
  DE: 'de', AT: 'de', CH: 'de', LI: 'de',
  PL: 'pl',
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr',
  ES: 'es', AR: 'es', MX: 'es', CL: 'es', CO: 'es',
  GB: 'en', IE: 'en', US: 'en', CA: 'en', AU: 'en', NZ: 'en', NL: 'en', SE: 'en', DK: 'en', NO: 'en', FI: 'en',
};

export const isLocaleCode = (l: unknown): l is Locale => typeof l === 'string' && (LOCALES as readonly string[]).includes(l);

/** Language for a guest: the one used on the website, else guessed from the country, else Italian. */
export function guestLang(g: { lang?: Locale; country?: string }): Locale {
  if (isLocaleCode(g.lang)) return g.lang;
  const c = (g.country ?? '').toUpperCase();
  return COUNTRY_LANG[c] ?? (c ? 'en' : 'it');
}
