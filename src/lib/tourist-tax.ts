import type { Locale } from './types';
import { eachNight } from './dates';

/**
 * "Tassa di soggiorno": the town's tax per adult and per night, only in the season the town chose
 * (e.g. 1 June – 30 September). It is not part of the room price: the guest pays it at the hotel,
 * and the site shows how much it will be wherever a stay has a price.
 */
export interface TouristTax {
  enabled: boolean;
  /** euro per adult per night */
  amount: number;
  /** first and last day of the season, "MM-DD" (a season across New Year works too) */
  from: string;
  to: string;
  /** nights that pay at most (0 = no limit) */
  maxNights: number;
}

export const TAX_DEFAULT: TouristTax = { enabled: false, amount: 2, from: '06-01', to: '09-30', maxNights: 0 };

export function inTaxSeason(date: string, from: string, to: string): boolean {
  const md = date.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

export interface TaxQuote {
  total: number;
  nights: number;
  adults: number;
  perNight: number;
}

/** What the guests of a stay pay at the hotel (null when nothing is due). */
export function touristTaxFor(t: TouristTax | undefined | null, checkIn: string, checkOut: string, adults: number): TaxQuote | null {
  if (!t?.enabled || !(t.amount > 0) || !(adults >= 1) || !checkIn || !checkOut || checkOut <= checkIn) return null;
  let nights = eachNight(checkIn, checkOut).filter((d) => inTaxSeason(d, t.from, t.to)).length;
  if (t.maxNights > 0) nights = Math.min(nights, t.maxNights);
  if (!nights) return null;
  return { total: Math.round(nights * adults * t.amount * 100) / 100, nights, adults, perNight: t.amount };
}

type TaxText = { label: string; note: string; detail: string };
export const TAX_T: Record<Locale, TaxText> = {
  it: { label: 'Tassa di soggiorno', note: 'non inclusa, si paga in hotel', detail: '{adults} adulti × {nights} notti × {amount}' },
  en: { label: 'Tourist tax', note: 'not included, paid at the hotel', detail: '{adults} adults × {nights} nights × {amount}' },
  pl: { label: 'Opłata miejscowa', note: 'nie wliczona, płatna w hotelu', detail: '{adults} dor. × {nights} noce × {amount}' },
  de: { label: 'Kurtaxe', note: 'nicht inbegriffen, im Hotel zu zahlen', detail: '{adults} Erw. × {nights} Nächte × {amount}' },
  fr: { label: 'Taxe de séjour', note: 'non incluse, à payer à l’hôtel', detail: '{adults} adultes × {nights} nuits × {amount}' },
  es: { label: 'Tasa turística', note: 'no incluida, se paga en el hotel', detail: '{adults} adultos × {nights} noches × {amount}' },
};

export function taxDetail(lang: Locale, q: TaxQuote, money: (n: number) => string): string {
  return TAX_T[lang].detail.replace('{adults}', String(q.adults)).replace('{nights}', String(q.nights)).replace('{amount}', money(q.perNight));
}

/** The rule in one line for the rooms pages: "2 € per adult per night · 1 June – 30 September · max 7 nights". */
export const TAX_RULE: Record<Locale, { per: string; always: string; max: string; kids: string }> = {
  it: { per: 'per adulto a notte', always: 'tutto l’anno', max: 'max {n} notti', kids: 'bambini esenti' },
  en: { per: 'per adult per night', always: 'all year', max: 'max {n} nights', kids: 'children exempt' },
  pl: { per: 'za osobę dorosłą za noc', always: 'cały rok', max: 'maks. {n} nocy', kids: 'dzieci zwolnione' },
  de: { per: 'pro Erwachsenem und Nacht', always: 'ganzjährig', max: 'max. {n} Nächte', kids: 'Kinder befreit' },
  fr: { per: 'par adulte et par nuit', always: 'toute l’année', max: '{n} nuits max.', kids: 'enfants exonérés' },
  es: { per: 'por adulto y noche', always: 'todo el año', max: 'máx. {n} noches', kids: 'niños exentos' },
};

/** "1 giugno – 30 settembre" from the "MM-DD" season (empty when it is the whole year). */
export function taxSeasonLabel(t: Pick<TouristTax, 'from' | 'to'>, lang: Locale): string {
  if ((t.from === '01-01' && t.to === '12-31') || !t.from || !t.to) return '';
  const f = (md: string) => new Date(`2001-${md}T12:00:00Z`).toLocaleDateString(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${f(t.from)} – ${f(t.to)}`;
}
