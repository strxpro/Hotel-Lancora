import type { Metadata } from 'next';
import { LOCALES, localePath } from '@/lib/i18n/config';
import type { Locale } from '@/lib/types';

/** Canonical + hreflang alternates for a public path. */
export function alternates(locale: Locale, path: string): Metadata['alternates'] {
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[l] = localePath(l, path);
  languages['x-default'] = localePath('it', path);
  return { canonical: localePath(locale, path), languages };
}
