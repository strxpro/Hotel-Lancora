import { LOCALES, type Locale } from '../types';

export { LOCALES };
export type { Locale };
export const DEFAULT_LOCALE: Locale = 'it';

export const LOCALE_NAMES: Record<Locale, { native: string; code: string }> = {
  it: { native: 'Italiano', code: 'IT' },
  en: { native: 'English', code: 'EN' },
  pl: { native: 'Polski', code: 'PL' },
  de: { native: 'Deutsch', code: 'DE' },
  fr: { native: 'Français', code: 'FR' },
  es: { native: 'Español', code: 'ES' },
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Italian is served without prefix; other languages under /en, /pl … */
export function localePath(locale: Locale, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return p;
  return p === '/' ? `/${locale}` : `/${locale}${p}`;
}

/** Strip a locale prefix from a pathname: "/en/camere" → "/camere" */
export function stripLocale(pathname: string): { locale: Locale; path: string } {
  const seg = pathname.split('/')[1];
  if (isLocale(seg) && seg !== DEFAULT_LOCALE) {
    const rest = pathname.slice(seg.length + 1) || '/';
    return { locale: seg, path: rest };
  }
  return { locale: DEFAULT_LOCALE, path: pathname || '/' };
}

export function plural(locale: Locale, n: number, forms: { one: string; few?: string; many?: string; other: string }): string {
  const rule = new Intl.PluralRules(locale).select(n) as 'one' | 'few' | 'many' | 'other' | 'two' | 'zero';
  const s = (rule === 'one' ? forms.one : rule === 'few' ? forms.few : rule === 'many' ? forms.many : undefined) ?? forms.other;
  return s.replace('{n}', String(n));
}

export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
