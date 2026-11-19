import 'server-only';
import type { DB } from '@/lib/types';
import { defaultPlaces, toPlaceItems, type PlaceEdit, type PlaceItem } from '@/lib/places';

/** The places around the hotel as the owner left them (the site's originals until the first save). */
export function placeList(db: DB): PlaceEdit[] {
  return db.settings.places?.length ? db.settings.places : defaultPlaces();
}

/** What the site shows (hidden places left out, every language filled). */
export function publicPlaces(db: DB): PlaceItem[] {
  return toPlaceItems(placeList(db));
}

const OTHER: Exclude<import('@/lib/types').Locale, 'it'>[] = ['en', 'pl', 'de', 'fr', 'es'];

/**
 * The owner writes in Italian: the other languages of the changed places are translated after the
 * answer (until then the site shows the Italian text). Nothing happens without a translator.
 */
export function translatePlacesLater(ids: string[]): void {
  if (!ids.length) return;
  const job = async () => {
    const { translateFields } = await import('./ai/content');
    const { mutate, readDb } = await import('./db/store');
    for (const id of ids) {
      const p = readDb().settings.places?.find((x) => x.id === id);
      if (!p) continue;
      const src = { kind: p.kind.it ?? '', text: p.text.it ?? '', time: p.time.it ?? '' };
      for (const l of OTHER) {
        const t = await translateFields(src, l).catch(() => null);
        if (!t) return; // no translator connected: the Italian text stays for everyone
        mutate((db) => {
          const cur = db.settings.places?.find((x) => x.id === id);
          // changed again in the meantime: that save translates the new text
          if (!cur || cur.text.it !== src.text || cur.kind.it !== src.kind || cur.time.it !== src.time) return;
          cur.kind[l] = t.kind;
          cur.text[l] = t.text;
          cur.time[l] = t.time;
        });
      }
    }
  };
  void (async () => {
    try {
      const { after } = await import('next/server');
      after(job);
    } catch {
      job().catch((e) => console.error('[places]', e));
    }
  })();
}
