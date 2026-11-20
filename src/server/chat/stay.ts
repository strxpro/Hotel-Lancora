import 'server-only';
import type { DB, Locale } from '@/lib/types';
import type { AIProvider } from '../ai/provider';
import { parseJsonLoose } from '../ai/provider';
import { addDays, diffDays, fmtDate, isValidISODate, weekdayMon } from '@/lib/dates';
import { localePath, plural } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { money } from '@/lib/utils';
import { availability } from '../public-data';
import { isPubliclyBookable } from '@/lib/availability';
import type { ChatAction, ChatReply } from './engine';

/**
 * Live availability in the guest chat.
 * "Avete posto dal 12 al 15 agosto per 2?", "wolne pokoje 3-6 lipca dla 2 dorosłych i dziecka",
 * "next weekend for four", "Ferragosto, 3 notti"… → the dates are read (rules first, the AI only for
 * the fuzzy ones), the real inventory is queried right now, and the guest gets the free rooms with
 * their total plus a button that opens exactly that search on the site.
 */

export interface Stay {
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  adults: number | null;
  children: number | null;
}
export interface ChatRoom {
  id: string;
  name: string;
  photo: string | null;
  /** up to three photos for the card */
  photos?: string[];
  /** with dates: the stay total, its nights and the average night; without (nights 0): `from` per night */
  total: number;
  avg: number;
  nights: number;
  from?: number;
  beds?: string;
  maxGuests: number;
  href: string;
}
export type StayReply = ChatReply & { rooms?: ChatRoom[]; suggest?: string[]; stay?: { checkIn: string; checkOut: string; adults: number; children: number } };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .replace(/[’']/g, ' ');

const MONTHS: string[][] = [
  ['gennaio', 'gen', 'january', 'jan', 'styczen', 'stycznia', 'styczniu', 'sty', 'januar', 'janvier', 'janv', 'enero', 'ene'],
  ['febbraio', 'february', 'feb', 'luty', 'lutego', 'lutym', 'lut', 'februar', 'fevrier', 'fevr', 'febrero'],
  ['marzo', 'march', 'marzec', 'marca', 'marcu', 'marz', 'mars'],
  ['aprile', 'april', 'apr', 'kwiecien', 'kwietnia', 'kwietniu', 'kwi', 'avril', 'avr', 'abril', 'abr'],
  ['maggio', 'mag', 'may', 'maj', 'maja', 'maju', 'mai', 'mayo'],
  ['giugno', 'giu', 'june', 'jun', 'czerwiec', 'czerwca', 'czerwcu', 'cze', 'juni', 'juin', 'junio'],
  ['luglio', 'lug', 'july', 'jul', 'lipiec', 'lipca', 'lipcu', 'lip', 'juli', 'juillet', 'juil', 'julio'],
  ['agosto', 'august', 'aug', 'sierpien', 'sierpnia', 'sierpniu', 'aout'],
  ['settembre', 'sett', 'september', 'sep', 'wrzesien', 'wrzesnia', 'wrzesniu', 'wrz', 'septembre', 'septiembre', 'setiembre'],
  ['ottobre', 'ott', 'october', 'oct', 'pazdziernik', 'pazdziernika', 'pazdzierniku', 'paz', 'oktober', 'okt', 'octobre', 'octubre'],
  ['novembre', 'november', 'nov', 'listopad', 'listopada', 'listopadzie', 'lis', 'noviembre'],
  ['dicembre', 'dic', 'december', 'dec', 'grudzien', 'grudnia', 'grudniu', 'gru', 'dezember', 'dez', 'decembre', 'diciembre'],
];
const MONTH_RX = new RegExp(`\\b(${MONTHS.flat().sort((a, b) => b.length - a.length).join('|')})\\b\\.?`, 'g');
const MONTH_TEST = new RegExp(MONTH_RX.source);
const monthOf = (w: string) => MONTHS.findIndex((m) => m.includes(w)) + 1;

const NUM: Record<string, number> = {
  uno: 1, una: 1, un: 1, one: 1, a: 1, jeden: 1, jedna: 1, jedno: 1, jednym: 1, ein: 1, eine: 1, einem: 1, einer: 1, une: 1,
  due: 2, two: 2, dwa: 2, dwie: 2, dwoje: 2, dwoch: 2, dwojga: 2, dwojgiem: 2, zwei: 2, deux: 2, dos: 2,
  tre: 3, three: 3, trzy: 3, troje: 3, trzech: 3, trojga: 3, drei: 3, trois: 3, tres: 3,
  quattro: 4, four: 4, cztery: 4, czworo: 4, czterech: 4, czworga: 4, vier: 4, quatre: 4, cuatro: 4,
  cinque: 5, five: 5, piec: 5, pieciu: 5, funf: 5, cinq: 5, cinco: 5,
  sei: 6, six: 6, szesc: 6, szesciu: 6, sechs: 6, seis: 6,
  sette: 7, seven: 7, siedem: 7, siedmiu: 7, sieben: 7, siete: 7,
};
const NUMW = `(\\d{1,2}|${Object.keys(NUM).join('|')})`;
const NUMW2 = `(\\d{1,2}|${Object.keys(NUM).filter((k) => NUM[k]! >= 2).join('|')})`;
const toN = (s: string) => (/^\d+$/.test(s) ? Number(s) : (NUM[s] ?? 0));

const NIGHTS_RX = new RegExp(`\\b${NUMW}\\s*(notti|notte|nights?|noce|nocy|noc|nachte|nacht|nuits?|noches?)\\b`);
const WEEK_RX = /\b(una settimana|a week|one week|tydzien|eine woche|une semaine|una semana)\b/;
const ADULTS_RX = new RegExp(`\\b${NUMW}\\s*(adult\\w*|doros\\w*|erwachsen\\w*)`);
const KIDS_RX = new RegExp(`\\b${NUMW}\\s*(bambin\\w*|child\\w*|kids?|dzieci\\w*|dzieck\\w*|kinder|kind|enfants?|nin[oa]s?|hij[oa]s?|figli\\w*)`);
const ONE_KID_RX = /\b(con (un|una) (bambin|figli|nin)\w*|with (a|our|my) (child|kid|baby|son|daughter)|(z|i|oraz|plus) (jednym |jednego )?dzieck\w*|mit (einem |unserem )?kind|avec (un|notre) enfant|con (un|una) (nin|hij)\w*)/;
const PERSONS_RX = new RegExp(`\\b${NUMW}\\s*(person\\w*|people|guests?|ospit\\w*|osob\\w*|personen|gaste|personnes|personas)`);
const FOR_N_RX = new RegExp(`\\b(per|for|dla|fur|pour|para)\\s+(?:noi\\s+)?${NUMW2}\\b(?!\\s*(notti|notte|nights?|noce|nocy|noc|nachte|nacht|nuits?|noches?|@m|[./-]\\d))`);
const PLUS_NIGHT_RX = /(nott[ei] in piu|more nights?|another night|extra night|noca? (wiecej|dluzej)|nacht (mehr|langer)|nuit de plus|noche mas)/;
const COUPLE_RX = /\b(coppia|in due|couple|we two|the two of us|we dwoje|dla dwojga|zu zweit|paar|en couple|pareja|para dos)\b/;

const NIGHT_UNIT = '(?!\\s*(?:notti|notte|nights?|noce|nocy|noc|nachte|nacht|nuits?|noches?|person\\w*|people|guests?|ospit\\w*|osob\\w*|adult\\w*|doros\\w*|erwachsen\\w*|bambin\\w*|child\\w*|dziec\\w*|kinder|enfants?|nin[oa]s?))';
const SEP = '(?:-|–|—|al|a|to|till|until|through|do|bis|zum|au|y|e|ed|and|und|et|i|hasta)';

const RX = {
  availability: /(disponib|liber|available|availability|free|vacan|wolne|wolny|dostepn|frei|verfugbar|disponible|libre|posto|posti|room for|camera per|pokoj na|zimmer fur|chambre pour|habitacion para)/,
  dayAfter: /\b(dopodomani|day after tomorrow|pojutrze|ubermorgen|apres.demain|pasado manana)\b/,
  tomorrow: /\b(domani|tomorrow|jutro|morgen|demain|manana)\b(?<!guten morgen)/,
  today: /\b(oggi|stasera|stanotte|today|tonight|dzis|dzisiaj|heute|aujourd hui|ce soir|hoy|esta noche)\b/,
  weekend: /\b(week.?end|fine settimana|weekendzie|wochenende|fin de semana)\b/,
  fuzzy: /\b(settiman|week|tydzien|tygodni|woche|semaine|semana|ferragosto|pasqua|easter|wielkanoc|ostern|paques|pascua|natale|christmas|swieta|weihnacht|noel|navidad|capodanno|new year|sylwester|silvester|nouvel an|nochevieja|ponte|long weekend|majowk|pfingst|pentecost|prossim|next|przyszl|nachst|prochain|proxim|inizio|fine|meta|beginning|end of|mid|poczatk|koniec|polow|anfang|ende|mitte|debut|fin|mediados|principios|finales)/,
};

function nextOrSame(today: string, d: number, m: number, y?: number): string | null {
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  const year = y ? (y < 100 ? 2000 + y : y) : Number(today.slice(0, 4));
  let iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!isValidISODate(iso)) return null;
  if (!y && iso < today) iso = `${year + 1}${iso.slice(4)}`;
  return isValidISODate(iso) ? iso : null;
}

/** Deterministic parsing: explicit dates, ranges, nights and guests in it/en/pl/de/fr/es. */
export function parseStay(text: string, today: string): Stay {
  let s = ` ${norm(text)} `;
  const found: { at: number; iso: string }[] = [];
  const mask = (m: RegExpExecArray) => {
    s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length);
  };
  const scan = (rx: RegExp, fn: (m: RegExpExecArray) => (string | null)[]) => {
    const all = [...s.matchAll(new RegExp(rx.source, 'g'))];
    for (const m of all) {
      const out = fn(m).filter(Boolean) as string[];
      if (!out.length) continue;
      out.forEach((iso, i) => found.push({ at: m.index! + i, iso }));
      mask(m);
    }
  };

  // month words → @m<n>
  s = s.replace(MONTH_RX, (w) => ` @m${monthOf(w.replace('.', ''))} `);

  scan(/\b(20\d\d)-(\d{2})-(\d{2})\b/, (m) => [isValidISODate(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null]);
  // 12-15 @m8 · 12 al 15 @m8 · 12. bis 15. @m12 · 12 al 15 de @m12 · 30 @m6
  scan(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|\\.|º)?\\s*(?:${SEP}\\s*(?:il\\s+|le\\s+|el\\s+|the\\s+|den\\s+)?(\\d{1,2})(?:st|nd|rd|th|\\.|º)?\\s*)?(?:de\\s+|of\\s+)?@m(\\d{1,2})(?:\\s+(20\\d\\d))?`), (m) => {
    const mo = Number(m[3]);
    const y = m[4] ? Number(m[4]) : undefined;
    const a = nextOrSame(today, Number(m[1]), mo, y);
    const b = m[2] ? nextOrSame(today, Number(m[2]), mo, y) : null;
    return [a, b && a && b > a ? b : null];
  });
  // @m12 12-15 · @m8 3 to @m8 7
  scan(new RegExp(`@m(\\d{1,2})\\s*(\\d{1,2})(?:st|nd|rd|th)?${NIGHT_UNIT}(?:\\s*(?:-|–|to|till|until|through)\\s*(?:@m(\\d{1,2})\\s*)?(\\d{1,2})(?:st|nd|rd|th)?${NIGHT_UNIT})?`), (m) => {
    const a = nextOrSame(today, Number(m[2]), Number(m[1]));
    const b = m[4] ? nextOrSame(today, Number(m[4]), Number(m[3] ?? m[1])) : null;
    return [a, b && a && b > a ? b : null];
  });
  // 12/8 · 12.08.2027 · 12-15/08
  scan(/\b(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?[./](\d{1,2})(?:[./](\d{2,4}))?\b/, (m) => {
    const y = m[4] ? Number(m[4]) : undefined;
    const a = nextOrSame(today, Number(m[1]), Number(m[3]), y);
    const b = m[2] ? nextOrSame(today, Number(m[2]), Number(m[3]), y) : null;
    return [a, b && a && b > a ? b : null];
  });
  // "dal 12 al 15" with no month → this month, or the next one if those days are gone
  if (!found.length) {
    scan(new RegExp(`\\b(?:dal|from|od|vom|du|del|tra|fra|between)\\s+(?:il\\s+|the\\s+|le\\s+|el\\s+)?(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s*${SEP}\\s*(?:il\\s+|the\\s+|le\\s+|el\\s+|zum\\s+)?(\\d{1,2})(?:st|nd|rd|th|\\.)?\\b${NIGHT_UNIT}`), (m) => {
      const d1 = Number(m[1]);
      const d2 = Number(m[2]);
      if (d2 <= d1) return [null];
      let mo = Number(today.slice(5, 7));
      let y = Number(today.slice(0, 4));
      if (d1 < Number(today.slice(8, 10))) {
        mo = mo === 12 ? 1 : mo + 1;
        if (mo === 1) y += 1;
      }
      return [nextOrSame(today, d1, mo, y), nextOrSame(today, d2, mo, y)];
    });
  }
  found.sort((a, b) => a.at - b.at);

  let checkIn = found[0]?.iso ?? null;
  let checkOut = found.find((f) => checkIn && f.iso > checkIn)?.iso ?? null;

  if (!checkIn) {
    if (RX.dayAfter.test(s)) checkIn = addDays(today, 2);
    else if (RX.tomorrow.test(s)) checkIn = addDays(today, 1);
    else if (RX.today.test(s)) checkIn = today;
    else if (RX.weekend.test(s)) {
      const w = weekdayMon(today); // 0 = Mon … 4 = Fri, 5 = Sat, 6 = Sun
      checkIn = addDays(today, w <= 4 ? 4 - w : w === 5 ? 0 : 5);
      checkOut = addDays(checkIn, w === 5 ? 1 : 2);
    }
  }

  const nm = s.match(NIGHTS_RX);
  const nights = nm ? Math.min(30, Math.max(1, toN(nm[1]!))) : WEEK_RX.test(s) ? 7 : null;
  if (checkIn && !checkOut && nights) checkOut = addDays(checkIn, nights);

  // guests
  const am = s.match(ADULTS_RX);
  const km = s.match(KIDS_RX);
  const total = toN(s.match(PERSONS_RX)?.[1] ?? s.match(FOR_N_RX)?.[2] ?? '');
  let children = km ? toN(km[1]!) : ONE_KID_RX.test(s) ? 1 : null;
  let adults = am ? toN(am[1]!) : null;
  if (adults == null && total) adults = Math.max(1, total - (children ?? 0));
  if (adults == null && COUPLE_RX.test(s)) adults = 2;
  if (adults != null) adults = Math.min(8, Math.max(1, adults));
  if (children != null) children = Math.min(6, Math.max(0, children));

  return { checkIn, checkOut, nights: checkIn && checkOut ? diffDays(checkIn, checkOut) : nights, adults, children };
}

/** Is this message about a stay at all (so it is worth parsing / asking the AI)? */
export function staySignals(text: string): boolean {
  const n = norm(text);
  return (
    RX.availability.test(n) ||
    MONTH_TEST.test(n) ||
    NIGHTS_RX.test(n) ||
    PLUS_NIGHT_RX.test(n) ||
    RX.weekend.test(n) ||
    RX.tomorrow.test(n) ||
    RX.today.test(n) ||
    /\b\d{1,2}\s*[-–/.]\s*\d{1,2}\b/.test(n) ||
    /\b20\d\d-\d\d-\d\d\b/.test(n)
  );
}
const hasGuestsOnly = (text: string) => {
  const n = norm(text);
  return ADULTS_RX.test(n) || KIDS_RX.test(n) || PERSONS_RX.test(n) || ONE_KID_RX.test(n) || COUPLE_RX.test(n) || FOR_N_RX.test(n);
};

async function aiStay(provider: AIProvider, userTurns: string[], today: string): Promise<Stay | null> {
  const dow = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const sys = [
    `You read hotel stay requests. Today is ${today} (${dow}). The hotel is in Sardinia, Italy.`,
    'Return ONLY JSON: {"checkIn":"YYYY-MM-DD"|null,"checkOut":"YYYY-MM-DD"|null,"nights":number|null,"adults":number|null,"children":number|null}.',
    'Use the latest message first; earlier messages only fill what it leaves out. Resolve relative or fuzzy expressions (next weekend = Friday→Sunday, Ferragosto = 15 August, "first week of July" = 1→8 July, "Easter", "Christmas", "a week" = 7 nights). Dates are always in the future.',
    'Never invent: if the guest did not give or clearly imply a value, use null. People: a couple = 2 adults; "for 3" = 3 adults.',
  ].join('\n');
  const task = provider.complete(
    [
      { role: 'system', content: sys },
      { role: 'user', content: userTurns.map((t, i) => `${i === userTurns.length - 1 ? 'LATEST' : 'earlier'}: ${t}`).join('\n') },
    ],
    { json: true, maxTokens: 160, temperature: 0 },
  );
  const out = await Promise.race([task, new Promise<null>((r) => setTimeout(() => r(null), 6000))]).catch(() => null);
  const j = out ? parseJsonLoose<Partial<Stay>>(out) : null;
  if (!j) return null;
  const iso = (v: unknown) => (typeof v === 'string' && isValidISODate(v) && v >= today ? v : null);
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(max, Math.round(v)) : null);
  const checkIn = iso(j.checkIn);
  let checkOut = iso(j.checkOut);
  const nights = num(j.nights, 30);
  if (checkIn && checkOut && checkOut <= checkIn) checkOut = null;
  if (checkIn && !checkOut && nights) checkOut = addDays(checkIn, nights);
  return { checkIn, checkOut, nights: checkIn && checkOut ? diffDays(checkIn, checkOut) : nights, adults: num(j.adults, 8) || null, children: num(j.children, 6) };
}

const merge = (a: Stay, b: Stay | null): Stay => {
  if (!b) return a;
  const guests = { adults: a.adults ?? b.adults, children: a.children ?? b.children };
  if (a.checkIn) return { ...a, ...guests };
  const checkIn = b.checkIn;
  const checkOut = checkIn && a.nights ? addDays(checkIn, a.nights) : b.checkOut;
  return { checkIn, checkOut, nights: a.nights ?? b.nights, ...guests };
};

/** The stay the guest is asking about, reading the latest message first and the previous ones as context. */
export function isStayTurn(userTurns: string[]): boolean {
  const last = userTurns.at(-1) ?? '';
  if (staySignals(last)) return true;
  return hasGuestsOnly(last) && userTurns.slice(-4, -1).some(staySignals);
}

export async function extractStay(userTurns: string[], today: string, provider: AIProvider | null): Promise<Stay | null> {
  if (!isStayTurn(userTurns)) return null;
  const last = userTurns.at(-1) ?? '';
  const prev = userTurns.slice(-4, -1);
  const n = norm(last);
  const plusNight = PLUS_NIGHT_RX.test(n);

  let stay = parseStay(last, today);
  if (plusNight && !stay.checkIn) stay.nights = null;
  for (const p of [...prev].reverse()) if (staySignals(p)) stay = merge(stay, parseStay(p, today));
  if (stay.checkIn && !stay.checkOut) stay.checkOut = addDays(stay.checkIn, stay.nights ?? 1);
  if (plusNight && stay.checkOut) stay.checkOut = addDays(stay.checkOut, 1);

  const dateHint = MONTH_TEST.test(n) || RX.fuzzy.test(n) || RX.weekend.test(n) || /\d/.test(n) || NIGHTS_RX.test(n) || WEEK_RX.test(n);
  const fuzzy = RX.fuzzy.test(n) && !/\d/.test(last);
  // the AI only reads what the rules could not (holidays, "next week", "early July"…); the weekend stays the coming Fri→Sun
  if (provider && dateHint && !plusNight && (!stay.checkIn || (fuzzy && !RX.weekend.test(n)))) {
    const ai = await aiStay(provider, [...prev, last], today);
    if (ai?.checkIn) stay = { ...ai, adults: stay.adults ?? ai.adults, children: stay.children ?? ai.children };
    else if (ai) stay = merge(stay, ai);
    if (stay.checkIn && !stay.checkOut) stay.checkOut = addDays(stay.checkIn, stay.nights ?? 1);
  }
  if (stay.checkIn && stay.checkOut && (stay.checkIn < today || diffDays(stay.checkIn, stay.checkOut) > 30)) stay.checkOut = null;
  return stay;
}

/* ---------------------------------------------------------------- copy (6 languages) */

const C = {
  found: {
    it: 'Ho appena controllato: {range} ({nights} · {guests}) ci sono {n} camere libere. La più conveniente è {room}: {total} in totale ({avg} a notte).',
    en: 'I just checked: {range} ({nights} · {guests}) there are {n} rooms free. The best price is {room}: {total} in total ({avg} per night).',
    pl: 'Sprawdziłem przed chwilą: {range} ({nights} · {guests}) wolnych pokoi: {n}. Najkorzystniej wychodzi {room}: {total} łącznie ({avg} za noc).',
    de: 'Gerade geprüft: {range} ({nights} · {guests}) sind {n} Zimmer frei. Am günstigsten ist {room}: {total} insgesamt ({avg} pro Nacht).',
    fr: 'Je viens de vérifier : {range} ({nights} · {guests}), {n} chambres sont libres. Le meilleur prix : {room}, {total} au total ({avg} la nuit).',
    es: 'Acabo de comprobarlo: {range} ({nights} · {guests}) hay {n} habitaciones libres. La mejor opción es {room}: {total} en total ({avg} por noche).',
  },
  one: {
    it: 'Ho appena controllato: {range} ({nights} · {guests}) è rimasta una sola camera libera: {room}, {total} in totale ({avg} a notte). Se ti interessa, conviene bloccarla ora.',
    en: 'I just checked: {range} ({nights} · {guests}) only one room is left: {room}, {total} in total ({avg} per night). If you like it, it is worth booking now.',
    pl: 'Sprawdziłem przed chwilą: {range} ({nights} · {guests}) został tylko jeden wolny pokój: {room}, {total} łącznie ({avg} za noc). Jeśli pasuje, warto zarezerwować teraz.',
    de: 'Gerade geprüft: {range} ({nights} · {guests}) ist nur noch ein Zimmer frei: {room}, {total} insgesamt ({avg} pro Nacht). Am besten jetzt buchen.',
    fr: 'Je viens de vérifier : {range} ({nights} · {guests}), il ne reste qu’une chambre : {room}, {total} au total ({avg} la nuit). Mieux vaut réserver maintenant.',
    es: 'Acabo de comprobarlo: {range} ({nights} · {guests}) solo queda una habitación: {room}, {total} en total ({avg} por noche). Si te gusta, mejor reservar ya.',
  },
  none: {
    it: 'Ho controllato: {range} per {guests} è tutto occupato. Le date libere più vicine: {alts}.',
    en: 'I checked: {range} for {guests} we are fully booked. The nearest free dates: {alts}.',
    pl: 'Sprawdziłem: {range} dla {guests} wszystko jest zajęte. Najbliższe wolne terminy: {alts}.',
    de: 'Geprüft: {range} für {guests} sind wir ausgebucht. Die nächsten freien Daten: {alts}.',
    fr: 'J’ai vérifié : {range} pour {guests}, tout est complet. Les dates libres les plus proches : {alts}.',
    es: 'Lo he comprobado: {range} para {guests} está todo ocupado. Las fechas libres más cercanas: {alts}.',
  },
  noneAtAll: {
    it: 'Ho controllato: {range} per {guests} non ci sono camere libere online, nemmeno nei giorni vicini. Scrivici: a volte si liberano posti.',
    en: 'I checked: {range} for {guests} no rooms are free online, not even on nearby days. Write to us: rooms sometimes free up.',
    pl: 'Sprawdziłem: {range} dla {guests} nie ma wolnych pokoi online, także w sąsiednich dniach. Napisz do nas — czasem coś się zwalnia.',
    de: 'Geprüft: {range} für {guests} ist online nichts frei, auch nicht an den Tagen davor oder danach. Schreiben Sie uns: manchmal wird etwas frei.',
    fr: 'J’ai vérifié : {range} pour {guests}, aucune chambre libre en ligne, même aux dates proches. Écrivez-nous : des places se libèrent parfois.',
    es: 'Lo he comprobado: {range} para {guests} no hay habitaciones libres online, ni en días cercanos. Escríbenos: a veces se libera alguna.',
  },
  tooMany: {
    it: 'Per {guests} non abbiamo una camera unica: scrivici e prepariamo una soluzione con più camere.',
    en: 'We have no single room for {guests}: write to us and we will arrange several rooms.',
    pl: 'Nie mamy jednego pokoju dla {guests}: napisz do nas, przygotujemy kilka pokoi.',
    de: 'Für {guests} haben wir kein einzelnes Zimmer: Schreiben Sie uns, wir planen mehrere Zimmer.',
    fr: 'Pas de chambre unique pour {guests} : écrivez-nous, nous organiserons plusieurs chambres.',
    es: 'No tenemos una habitación para {guests}: escríbenos y preparamos varias habitaciones.',
  },
  assumed: {
    it: ' Ho considerato 2 adulti: dimmi se siete di più.',
    en: ' I assumed 2 adults: tell me if you are more.',
    pl: ' Przyjąłem 2 dorosłe osoby — daj znać, jeśli będzie was więcej.',
    de: ' Ich habe 2 Erwachsene angenommen – sagen Sie mir, wenn Sie mehr sind.',
    fr: ' J’ai compté 2 adultes : dites-moi si vous êtes plus.',
    es: ' He contado 2 adultos: dime si sois más.',
  },
  ask: {
    it: 'Volentieri, controllo subito la disponibilità reale. Per quali date? Scrivi ad esempio “dal 12 al 15 agosto, 2 adulti”, oppure scegli qui sotto.',
    en: 'Happy to check real availability right away. Which dates? Write for example “12 to 15 August, 2 adults”, or pick below.',
    pl: 'Chętnie sprawdzę dostępność na żywo. Na jakie daty? Napisz np. „12–15 sierpnia, 2 dorosłe osoby” albo wybierz poniżej.',
    de: 'Gern prüfe ich sofort die echte Verfügbarkeit. Für welche Daten? Schreiben Sie z. B. „12. bis 15. August, 2 Erwachsene“ oder wählen Sie unten.',
    fr: 'Avec plaisir, je vérifie tout de suite. Pour quelles dates ? Écrivez par exemple « du 12 au 15 août, 2 adultes », ou choisissez ci-dessous.',
    es: 'Con gusto lo compruebo ahora mismo. ¿Para qué fechas? Escribe por ejemplo «del 12 al 15 de agosto, 2 adultos», o elige abajo.',
  },
  see: { it: 'Vedi le {n} camere libere', en: 'See the {n} free rooms', pl: 'Pokaż wolne pokoje ({n})', de: 'Die {n} freien Zimmer ansehen', fr: 'Voir les {n} chambres libres', es: 'Ver las {n} habitaciones libres' },
  seeOne: { it: 'Vedi la camera libera', en: 'See the free room', pl: 'Pokaż wolny pokój', de: 'Das freie Zimmer ansehen', fr: 'Voir la chambre libre', es: 'Ver la habitación libre' },
  book: { it: 'Prenota {room}', en: 'Book {room}', pl: 'Zarezerwuj {room}', de: '{room} buchen', fr: 'Réserver {room}', es: 'Reservar {room}' },
  alt: { it: 'Vedi {range}', en: 'See {range}', pl: 'Pokaż {range}', de: '{range} ansehen', fr: 'Voir {range}', es: 'Ver {range}' },
  write: { it: 'Scrivici', en: 'Write to us', pl: 'Napisz do nas', de: 'Schreiben Sie uns', fr: 'Écrivez-nous', es: 'Escríbenos' },
  weekend: { it: 'Questo weekend, 2 adulti', en: 'This weekend, 2 adults', pl: 'Ten weekend, 2 osoby', de: 'Dieses Wochenende, 2 Erwachsene', fr: 'Ce week-end, 2 adultes', es: 'Este fin de semana, 2 adultos' },
  nextWeek: { it: '{a} → {b}, 2 adulti', en: '{a} → {b}, 2 adults', pl: '{a} → {b}, 2 osoby', de: '{a} → {b}, 2 Erwachsene', fr: '{a} → {b}, 2 adultes', es: '{a} → {b}, 2 adultos' },
  plusChild: { it: 'Siamo 2 adulti e 1 bambino', en: 'We are 2 adults and 1 child', pl: 'Jesteśmy we dwoje z dzieckiem', de: 'Wir sind 2 Erwachsene und 1 Kind', fr: 'Nous sommes 2 adultes et 1 enfant', es: 'Somos 2 adultos y 1 niño' },
  plusNight: { it: 'E con una notte in più?', en: 'And with one more night?', pl: 'A z jedną nocą więcej?', de: 'Und mit einer Nacht mehr?', fr: 'Et avec une nuit de plus ?', es: '¿Y con una noche más?' },
  adults: { it: ['1 adulto', '{n} adulti'], en: ['1 adult', '{n} adults'], pl: ['1 dorosły', '{n} dorosłych'], de: ['1 Erwachsener', '{n} Erwachsene'], fr: ['1 adulte', '{n} adultes'], es: ['1 adulto', '{n} adultos'] },
  kids: { it: ['1 bambino', '{n} bambini'], en: ['1 child', '{n} children'], pl: ['1 dziecko', '{n} dzieci'], de: ['1 Kind', '{n} Kinder'], fr: ['1 enfant', '{n} enfants'], es: ['1 niño', '{n} niños'] },
} as const;

const f = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

export function guestsLabel(lang: Locale, adults: number, children: number): string {
  const a = C.adults[lang];
  const k = C.kids[lang];
  const pa = (adults === 1 ? a[0] : a[1]).replace('{n}', String(adults));
  return children ? `${pa}, ${(children === 1 ? k[0] : k[1]).replace('{n}', String(children))}` : pa;
}
const rangeLabel = (lang: Locale, a: string, b: string) => {
  const o: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  return `${fmtDate(a, lang, o)} → ${fmtDate(b, lang, o)}`;
};

/** Live answer for a stay: free rooms + exact totals now, or the nearest free dates. */
export function answerStay(db: DB, stay: Stay, lang: Locale, today: string): StayReply {
  const t = getDictionary(lang);
  const L = (p: string) => localePath(lang, p);
  const contact: ChatAction = { label: C.write[lang], href: L('/contatti#scrivici') };

  if (!stay.checkIn || !stay.checkOut) {
    const a = addDays(today, 7);
    const b = addDays(a, 3);
    const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
    return {
      lang,
      intent: 'availability',
      text: C.ask[lang],
      actions: [{ label: t.search.cta, href: L('/camere#ricerca') }],
      suggest: [C.weekend[lang], f(C.nextWeek[lang], { a: fmtDate(a, lang, o), b: fmtDate(b, lang, o) })],
    };
  }

  const assumed = stay.adults == null;
  const adults = stay.adults ?? 2;
  const children = stay.children ?? 0;
  const q = { checkIn: stay.checkIn, checkOut: stay.checkOut, adults, children };
  const params = new URLSearchParams({ checkIn: q.checkIn, checkOut: q.checkOut, adults: String(adults), ...(children ? { children: String(children) } : {}) });
  const res = availability(db, q, lang);
  const nightsN = diffDays(q.checkIn, q.checkOut);
  const vars = {
    range: rangeLabel(lang, q.checkIn, q.checkOut),
    nights: plural(lang, nightsN, t.search.nights),
    guests: guestsLabel(lang, adults, children),
  };
  const base = { lang, intent: 'availability', stay: q } as const;

  if (!db.rooms.some((r) => isPubliclyBookable(r) && r.maxGuests >= adults + children)) {
    return { ...base, text: f(C.tooMany[lang], vars), actions: [contact] };
  }

  if (!res.count) {
    const alts = res.alternatives.slice(0, 3);
    if (!alts.length) return { ...base, text: f(C.noneAtAll[lang], vars), actions: [contact] };
    const altText = alts.map((a) => `${rangeLabel(lang, a.checkIn, a.checkOut)} (${money(a.from, lang)}/${plural(lang, 1, t.search.nights).replace(/^1\s*/, '')})`).join('; ');
    const first = alts[0]!;
    const p2 = new URLSearchParams(params);
    p2.set('checkIn', first.checkIn);
    p2.set('checkOut', first.checkOut);
    return {
      ...base,
      text: f(C.none[lang], { ...vars, alts: altText }),
      actions: [{ label: f(C.alt[lang], { range: rangeLabel(lang, first.checkIn, first.checkOut) }), href: L(`/camere?${p2}#camere`) }, contact],
    };
  }

  const sorted = [...res.results].sort((a, b) => a.total - b.total);
  const best = sorted[0]!;
  const text =
    f(res.count === 1 ? C.one[lang] : C.found[lang], { ...vars, n: res.count, room: best.room.name, total: money(best.total, lang), avg: money(best.averageNight, lang) }) + (assumed ? C.assumed[lang] : '');
  const rooms: ChatRoom[] = sorted.slice(0, 3).map((r) => ({
    id: r.room.id,
    name: r.room.name,
    photo: r.room.photo?.src ?? null,
    photos: r.room.photos.slice(0, 3).map((p) => p.src),
    beds: r.room.beds,
    total: r.total,
    avg: r.averageNight,
    nights: r.nights,
    maxGuests: r.room.maxGuests,
    href: L(`/prenotazione?${params}&room=${encodeURIComponent(r.room.slug)}`),
  }));
  return {
    ...base,
    text,
    rooms,
    actions: [
      { label: res.count === 1 ? C.seeOne[lang] : f(C.see[lang], { n: res.count }), href: L(`/camere?${params}#camere`) },
      { label: f(C.book[lang], { room: best.room.name }), href: rooms[0]!.href },
    ],
    suggest: [children ? C.plusNight[lang] : C.plusChild[lang], ...(children ? [] : [C.plusNight[lang]])],
  };
}
