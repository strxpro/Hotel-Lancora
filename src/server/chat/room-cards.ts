import 'server-only';
import type { DB, Locale } from '@/lib/types';
import type { RoomCardData } from '@/lib/room-card';
import { localePath } from '@/lib/i18n/config';
import { publicCards } from '../public-data';
import type { ChatRoom } from './stay';

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/** A room as a chat card without dates: photos, "from" price, a link to its page (calendar and booking). */
function toChat(c: RoomCardData, lang: Locale): ChatRoom {
  const from = c.fromPrice ?? c.basePrice;
  return {
    id: c.id,
    name: c.name,
    photo: c.photo?.src ?? null,
    photos: c.photos.slice(0, 3).map((p) => p.src),
    total: 0,
    avg: from,
    nights: 0,
    from,
    beds: c.beds,
    maxGuests: c.maxGuests,
    href: localePath(lang, `/camere/${c.slug}`),
  };
}

/**
 * The rooms a reply talks about, in the order it names them (Italian name or the guest's language),
 * so the guest sees their photos right under the answer. Two rooms with the same name: one card.
 */
export function roomsNamedIn(db: DB, text: string, lang: Locale, max = 3): ChatRoom[] {
  const t = norm(text);
  const it = new Map(publicCards(db, 'it').map((c) => [c.id, c.name]));
  const seen = new Set<string>();
  return publicCards(db, lang)
    .map((c) => {
      const names = [c.name, it.get(c.id) ?? ''].map(norm).filter((n) => n.trim().length >= 4);
      const at = Math.min(...names.map((n) => t.indexOf(n)).filter((i) => i >= 0), Infinity);
      return { c, at, key: names[0] ?? c.id };
    })
    .filter((x) => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at)
    .filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)))
    .slice(0, max)
    .map((x) => toChat(x.c, lang));
}

/** "Which room do you suggest?" in any of the site's languages. */
export function asksForRoom(text: string): boolean {
  return /(consigli|propon|suggerisc|qual[e ]? camera|che camera|recommend|suggest|which room|best room|polec|zaproponuj|jaki pok|ktory pok|ktory bys|empfehl|welches zimmer|recommand|quelle chambre|recomiend|que habitacion|cual habitacion)/.test(norm(text));
}

/** How many people the guest mentions ("per 3 persone", "dla 2 osób", "for 4 people"). */
export function guestsIn(text: string): number {
  const m = norm(text).match(/ (\d{1,2}) (?:persone|persona|ospiti|adulti|osob|osoby|osoba|people|persons|guests|adults|personen|erwachsene|personnes|adultes|personas|adultos) /);
  const n = m ? Number(m[1]) : 1;
  return n >= 1 && n <= 10 ? n : 1;
}

/** The rooms to show when the guest asks for a suggestion: big enough, the most chosen first, then the cheapest. */
export function topRooms(db: DB, lang: Locale, guests = 1, max = 3): ChatRoom[] {
  return publicCards(db, lang)
    .filter((c) => c.maxGuests >= guests)
    .sort((a, b) => b.popularity - a.popularity || (a.fromPrice ?? a.basePrice) - (b.fromPrice ?? b.basePrice))
    .slice(0, max)
    .map((c) => toChat(c, lang));
}
