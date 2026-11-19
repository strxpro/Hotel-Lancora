import type { Locale, Photo } from './types';
import { EXPERIENCES, PLACE_GALLERY } from '@/content/experiences';
import { MEDIA } from '@/content/media';

const LANGS: Locale[] = ['it', 'en', 'pl', 'de', 'fr', 'es'];

/**
 * A place around the hotel (beach, viewpoint, town…) as the owner edits it in Impostazioni →
 * Spiagge e dintorni: photos, name, texts, distance. The site starts from the places written in
 * content/experiences.ts; once the owner saves, this list (db.settings.places) is the one shown.
 */
export interface PlaceEdit {
  id: string;
  name: string;
  /** "Spiaggia", "Belvedere"… per language (Italian is the one the owner writes; the others are translated) */
  kind: Partial<Record<Locale, string>>;
  text: Partial<Record<Locale, string>>;
  time: Partial<Record<Locale, string>>;
  distance: string;
  lat: number;
  lng: number;
  beach: boolean;
  photos: Photo[];
  hidden?: boolean;
  /** added by the owner (not one of the site's original places) */
  custom?: boolean;
}

/** What the site shows: every language filled (Italian when a translation is missing), first photo = cover. */
export interface PlaceItem {
  id: string;
  name: string;
  kind: Record<Locale, string>;
  text: Record<Locale, string>;
  time: Record<Locale, string>;
  distance: string;
  lat: number;
  lng: number;
  beach: boolean;
  photo: { src: string; alt: string };
  gallery: { src: string; alt: string }[];
}

const mediaPhoto = (k: keyof typeof MEDIA, i: number): Photo => {
  const m = MEDIA[k];
  return { id: `media-${String(k)}-${i}`, src: m.src, alt: m.alt, width: m.width, height: m.height, demo: m.demo, credit: m.credit };
};

/** The site's original places, as an editable list. */
export function defaultPlaces(): PlaceEdit[] {
  return EXPERIENCES.map((p) => ({
    id: p.id,
    name: p.name,
    kind: { ...p.kind },
    text: { ...p.text },
    time: { ...p.time },
    distance: p.distance,
    lat: p.lat,
    lng: p.lng,
    beach: p.beach,
    photos: (PLACE_GALLERY[p.id] ?? [p.image]).map(mediaPhoto),
  }));
}

const fillLangs = (r: Partial<Record<Locale, string>>): Record<Locale, string> => Object.fromEntries(LANGS.map((l) => [l, r[l]?.trim() || r.it?.trim() || ''])) as Record<Locale, string>;

const FALLBACK = MEDIA.mareProfondo;

export function toPlaceItems(list: PlaceEdit[]): PlaceItem[] {
  return list
    .filter((p) => !p.hidden)
    .map((p) => {
      const gallery = (p.photos.length ? p.photos : [{ src: FALLBACK.src, alt: FALLBACK.alt }]).map((x) => ({ src: x.src, alt: x.alt || p.name }));
      return { id: p.id, name: p.name, kind: fillLangs(p.kind), text: fillLangs(p.text), time: fillLangs(p.time), distance: p.distance, lat: p.lat, lng: p.lng, beach: p.beach, photo: gallery[0]!, gallery };
    });
}

/**
 * "41.2453, 9.1897" or a Google Maps link (…/@41.2453,9.1897,15z… or ?q=41.2453,9.1897) → the point.
 */
export function parseLatLng(s: string): { lat: number; lng: number } | null {
  const m = s.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) ?? s.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
