import type { Locale } from './types';

/**
 * "Supplementi": extras the owner prices in Prezzi (beach towels, breakfast, cot, parking…).
 * Each one is optional: when it is on, guests see it on the room page and can tick it in the
 * booking summary. It is never part of the online payment: the hotel collects it at the desk.
 */
export type ExtraUnit = 'stay' | 'night' | 'person' | 'person_night';

export interface Extra {
  id: string;
  /** Italian is what the owner writes; the other languages are the built-in ones of the suggested extras */
  name: Partial<Record<Locale, string>>;
  /** euro per unit */
  price: number;
  unit: ExtraUnit;
  /** shown on the site */
  enabled: boolean;
  /** one of the suggested ones (name translated in every language) */
  preset?: boolean;
}

/** Suggested extras: all off until the owner turns them on and sets a price. */
export const EXTRA_PRESETS: Extra[] = [
  { id: 'teli-mare', preset: true, enabled: false, price: 5, unit: 'person', name: { it: 'Teli mare', en: 'Beach towels', pl: 'Ręczniki plażowe', de: 'Strandtücher', fr: 'Serviettes de plage', es: 'Toallas de playa' } },
  { id: 'colazione', preset: true, enabled: false, price: 8, unit: 'person_night', name: { it: 'Colazione', en: 'Breakfast', pl: 'Śniadanie', de: 'Frühstück', fr: 'Petit-déjeuner', es: 'Desayuno' } },
  { id: 'culla', preset: true, enabled: false, price: 10, unit: 'night', name: { it: 'Culla', en: 'Baby cot', pl: 'Łóżeczko dziecięce', de: 'Babybett', fr: 'Lit bébé', es: 'Cuna' } },
  { id: 'parcheggio', preset: true, enabled: false, price: 10, unit: 'night', name: { it: 'Parcheggio', en: 'Parking', pl: 'Parking', de: 'Parkplatz', fr: 'Parking', es: 'Aparcamiento' } },
  { id: 'ombrellone', preset: true, enabled: false, price: 25, unit: 'night', name: { it: 'Ombrellone e lettini in spiaggia', en: 'Beach umbrella and sunbeds', pl: 'Parasol i leżaki na plaży', de: 'Sonnenschirm und Liegen am Strand', fr: 'Parasol et transats à la plage', es: 'Sombrilla y tumbonas en la playa' } },
  { id: 'late-checkout', preset: true, enabled: false, price: 20, unit: 'stay', name: { it: 'Partenza posticipata (late check-out)', en: 'Late check-out', pl: 'Późne wymeldowanie', de: 'Später Check-out', fr: 'Départ tardif', es: 'Salida tardía' } },
];

/** The owner's list (the suggested ones until the first save), every entry complete. */
export function extrasList(saved: Extra[] | undefined | null): Extra[] {
  return saved?.length ? saved : EXTRA_PRESETS;
}

/** What the guests of a stay see: only the extras that are on and have a name. */
export function activeExtras(saved: Extra[] | undefined | null): Extra[] {
  return extrasList(saved).filter((e) => e.enabled && (e.name.it ?? '').trim() && e.price >= 0);
}

export const extraName = (e: Extra, lang: Locale) => (e.name[lang] || e.name.it || '').trim();

/** How many times the price counts for this stay. */
export function extraUnits(unit: ExtraUnit, nights: number, guests: number): number {
  const n = Math.max(1, nights);
  const g = Math.max(1, guests);
  return unit === 'stay' ? 1 : unit === 'night' ? n : unit === 'person' ? g : n * g;
}

export const extraTotal = (e: Pick<Extra, 'price' | 'unit'>, nights: number, guests: number) => Math.round(e.price * extraUnits(e.unit, nights, guests) * 100) / 100;

type ExtraText = {
  title: string;
  note: string;
  atHotel: string;
  unit: Record<ExtraUnit, string>;
  free: string;
};
export const EXTRA_T: Record<Locale, ExtraText> = {
  it: { title: 'Supplementi', note: 'Facoltativi, si pagano in hotel', atHotel: 'Supplementi da pagare in hotel', unit: { stay: 'a soggiorno', night: 'a notte', person: 'a persona', person_night: 'a persona a notte' }, free: 'gratis' },
  en: { title: 'Extras', note: 'Optional, paid at the hotel', atHotel: 'Extras to pay at the hotel', unit: { stay: 'per stay', night: 'per night', person: 'per person', person_night: 'per person per night' }, free: 'free' },
  pl: { title: 'Dodatki', note: 'Opcjonalne, płatne w hotelu', atHotel: 'Dodatki do zapłaty w hotelu', unit: { stay: 'za pobyt', night: 'za noc', person: 'za osobę', person_night: 'za osobę za noc' }, free: 'gratis' },
  de: { title: 'Extras', note: 'Optional, im Hotel zu zahlen', atHotel: 'Extras, im Hotel zu zahlen', unit: { stay: 'pro Aufenthalt', night: 'pro Nacht', person: 'pro Person', person_night: 'pro Person und Nacht' }, free: 'gratis' },
  fr: { title: 'Suppléments', note: 'En option, à payer à l’hôtel', atHotel: 'Suppléments à payer à l’hôtel', unit: { stay: 'par séjour', night: 'par nuit', person: 'par personne', person_night: 'par personne et par nuit' }, free: 'gratuit' },
  es: { title: 'Suplementos', note: 'Opcionales, se pagan en el hotel', atHotel: 'Suplementos a pagar en el hotel', unit: { stay: 'por estancia', night: 'por noche', person: 'por persona', person_night: 'por persona y noche' }, free: 'gratis' },
};

/** The line the reception reads in the booking ("Supplementi richiesti (da pagare in hotel): Teli mare × 2 = 10 €"). */
export function extrasForReception(chosen: Extra[], nights: number, guests: number): string {
  if (!chosen.length) return '';
  const fmt = (n: number) => `${n.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
  const parts = chosen.map((e) => {
    const u = extraUnits(e.unit, nights, guests);
    return `${extraName(e, 'it')}${u > 1 ? ` (${fmt(e.price)} × ${u})` : ''} = ${fmt(extraTotal(e, nights, guests))}`;
  });
  const sum = chosen.reduce((s, e) => s + extraTotal(e, nights, guests), 0);
  return `Supplementi richiesti, da pagare in hotel: ${parts.join('; ')} · totale ${fmt(Math.round(sum * 100) / 100)}`;
}
