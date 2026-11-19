import type { Locale } from './types';

/**
 * The room number is only for the hotel. Owners (and the text helper) often write it into the
 * title or the description ("Camera 102 – Matrimoniale…", "La Camera 102 è…"): on the site it is
 * taken out, the rest of the sentence stays readable.
 */
const WORD = '(?:camera|stanza|room|pok[oó]j|zimmer|chambre|habitaci[oó]n)';
const MARK = '(?:n\\.?|nr\\.?|n°|no\\.?|#)?';
const THIS: Record<Locale, string> = { it: 'questa camera', en: 'this room', pl: 'ten pokój', de: 'dieses Zimmer', fr: 'cette chambre', es: 'esta habitación' };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function titleWithoutNumber(title: string, number: string): string {
  const n = number.trim();
  if (!n || !title) return title;
  const N = esc(n);
  const t = title
    // "Camera 102 – Matrimoniale…", "102 · Matrimoniale…"
    .replace(new RegExp(`^\\s*(?:${WORD}\\s*)?${MARK}\\s*${N}(?![\\p{L}\\d])\\s*[–—\\-:·|,.]*\\s*`, 'iu'), '')
    // "Matrimoniale – Camera 102", "Matrimoniale (102)"
    .replace(new RegExp(`\\s*[–—\\-:·|,(]*\\s*(?:${WORD}\\s*)?${MARK}\\s*${N}\\)?\\s*$`, 'iu'), '')
    .trim();
  return t ? cap(t) : '';
}

export function textWithoutNumber(text: string, number: string, locale: Locale): string {
  const n = number.trim();
  if (!n || !text) return text;
  const re = new RegExp(`(?<![\\p{L}\\d])((?:la|il|the|der|die|das|le|el)\\s+)?(${WORD})\\s*${MARK}\\s*${esc(n)}(?![\\p{L}\\d])`, 'giu');
  return text.replace(re, (_m: string, article: string | undefined, word: string, offset: number, all: string) => {
    const before = all.slice(0, offset);
    const start = !before.trim() || /[.!?\n]\s*$/.test(before);
    // "La Camera 102 è…" → "Questa camera è…"; "nella camera 102" → "nella camera"
    if (article || start) return start ? cap(THIS[locale]) : THIS[locale];
    return word.toLowerCase();
  });
}
