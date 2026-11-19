import { normIt, parseMonthRanges, parseRange } from './dates-it';

export type PriceIntent = { room?: string; rooms?: string[] | 'tutte'; price?: number; cash?: number; ranges?: { from: string; to: string }[]; base?: true };

/**
 * A price command written or said in Italian (the voice assistant always passes Italian):
 *  · "cambia il prezzo della camera 101 a 85 euro, 80 in contanti"   → base price, card + cash
 *  · "metti il prezzo di tutte le camere a 150 euro ad agosto"        → August, every room
 *  · "camere 101 e 102 a 120 euro dal 10 al 20 luglio"                → those nights
 *  · "riporta la camera 101 al prezzo base a luglio"                   → July back to base
 * null when the sentence is not a price command.
 */
export function priceIntent(text: string, today: string): PriceIntent | null {
  const t = normIt(text);
  if (!/(cambia|imposta|metti|porta|riporta|modifica|aggiorna|torna)/.test(t) || !/prezz|tariff/.test(t)) return null;
  const room = t.match(/\b(?:camera|stanza|n\.?|numero)\s*(\d{1,4}[a-z]?)\b/)?.[1];
  const everyRoom = /\btutte\b/.test(t) && /(camer|stanz|tutte)/.test(t);
  const roomList = t.match(/\b(?:camere|stanze)\s+((?:\d{1,4}[a-z]?(?:\s*(?:,|e|ed)\s*)?){2,})/)?.[1]?.match(/\d{1,4}[a-z]?/g) ?? null;
  if (!room && !roomList && !everyRoom) return null;
  const target: PriceIntent = everyRoom ? { rooms: 'tutte' } : roomList ? { rooms: roomList } : { room };
  const r = parseRange(text, today);
  const ranges = r ? [r] : parseMonthRanges(text, today);
  // "99 €", "99 euro", "€ 99" (a "\b" after "€" would never match: € is not a word character)
  const euros = [...t.matchAll(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|(?:euro|eur)\b)|€\s*(\d+(?:[.,]\d{1,2})?)/g)].map((m) => Number((m[1] ?? m[2])!.replace(',', '.')));
  const toBase = /(prezzo base|al base|riporta|torna al|togli il prezzo)/.test(t);
  if (toBase && !euros.length) return ranges.length ? { ...target, ranges, base: true } : null;
  if (!euros.length) return null;
  const cashM = t.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro|eur)?\s*(?:in\s+)?(?:contant|cash|gotów|gotow)/);
  const cash = cashM ? Number(cashM[1]!.replace(',', '.')) : undefined;
  const card = cash !== undefined ? (euros.find((v) => v !== cash) ?? euros[0]!) : euros[0]!;
  // the cash price goes with the card price, for the whole year or only in those dates
  return { ...target, price: card, ...(cash !== undefined && cash !== card ? { cash } : {}), ...(ranges.length ? { ranges } : {}) };
}
