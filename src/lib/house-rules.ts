import type { Locale, Settings } from './types';

/**
 * "Da sapere": the hotel's rules the guest should know before booking (pets, smoking, parties,
 * children, quiet hours, a free note). Set in Impostazioni → Arrivo e partenza; shown on every room
 * page, in the booking summary and used by the chatbot.
 */
export interface HouseRules {
  pets: 'no' | 'yes' | 'request';
  smoking: 'no' | 'outside';
  parties: 'no' | 'yes';
  children: 'yes' | 'no';
  /** "23:00": quiet from this hour (empty = not shown) */
  quietFrom: string;
  /** a line in the owner's words (Italian) */
  note: string;
}

/**
 * The rules in force: what the owner saved, else sensible defaults. Pets follow the "Animali" line
 * of the services when the owner never chose: only "available" lets them in.
 */
export function houseRules(s: Pick<Settings, 'hotel' | 'services'>): HouseRules {
  const saved = s.hotel.rules;
  const animali = s.services.find((x) => x.key === 'animali')?.status;
  return {
    pets: saved?.pets ?? (animali === 'confermato' ? 'yes' : 'no'),
    smoking: saved?.smoking ?? 'outside',
    parties: saved?.parties ?? 'no',
    children: saved?.children ?? 'yes',
    quietFrom: saved?.quietFrom ?? '',
    note: saved?.note ?? '',
  };
}

export type RuleIcon = 'pets' | 'smoke' | 'party' | 'kids' | 'quiet' | 'note';
export interface RuleLine {
  icon: RuleIcon;
  text: string;
  /** false = something not allowed (shown with a stroke) */
  ok: boolean;
}

const T: Record<Locale, { petsNo: string; petsYes: string; petsAsk: string; smokeNo: string; smokeOut: string; partyNo: string; partyYes: string; kidsYes: string; kidsNo: string; quiet: string }> = {
  it: { petsNo: 'Animali non ammessi', petsYes: 'Animali ammessi', petsAsk: 'Animali ammessi su richiesta', smokeNo: 'Vietato fumare in tutta la struttura', smokeOut: 'Vietato fumare in camera (si può all’aperto)', partyNo: 'Feste ed eventi non ammessi', partyYes: 'Feste ed eventi ammessi su richiesta', kidsYes: 'Bambini benvenuti', kidsNo: 'Solo adulti', quiet: 'Silenzio dalle {t}' },
  en: { petsNo: 'Pets not allowed', petsYes: 'Pets allowed', petsAsk: 'Pets allowed on request', smokeNo: 'No smoking anywhere in the property', smokeOut: 'No smoking in the rooms (allowed outdoors)', partyNo: 'No parties or events', partyYes: 'Parties and events on request', kidsYes: 'Children welcome', kidsNo: 'Adults only', quiet: 'Quiet hours from {t}' },
  pl: { petsNo: 'Zwierzęta niedozwolone', petsYes: 'Zwierzęta dozwolone', petsAsk: 'Zwierzęta na życzenie', smokeNo: 'Zakaz palenia w całym obiekcie', smokeOut: 'Zakaz palenia w pokojach (na zewnątrz można)', partyNo: 'Imprezy i wydarzenia niedozwolone', partyYes: 'Imprezy i wydarzenia na życzenie', kidsYes: 'Dzieci mile widziane', kidsNo: 'Tylko dla dorosłych', quiet: 'Cisza nocna od {t}' },
  de: { petsNo: 'Haustiere nicht erlaubt', petsYes: 'Haustiere erlaubt', petsAsk: 'Haustiere auf Anfrage', smokeNo: 'Rauchen im ganzen Haus verboten', smokeOut: 'Rauchen in den Zimmern verboten (draußen erlaubt)', partyNo: 'Keine Partys oder Veranstaltungen', partyYes: 'Partys und Veranstaltungen auf Anfrage', kidsYes: 'Kinder willkommen', kidsNo: 'Nur für Erwachsene', quiet: 'Nachtruhe ab {t} Uhr' },
  fr: { petsNo: 'Animaux non admis', petsYes: 'Animaux admis', petsAsk: 'Animaux admis sur demande', smokeNo: 'Interdit de fumer dans tout l’établissement', smokeOut: 'Interdit de fumer dans les chambres (permis à l’extérieur)', partyNo: 'Fêtes et événements non autorisés', partyYes: 'Fêtes et événements sur demande', kidsYes: 'Enfants bienvenus', kidsNo: 'Adultes uniquement', quiet: 'Silence à partir de {t}' },
  es: { petsNo: 'No se admiten mascotas', petsYes: 'Se admiten mascotas', petsAsk: 'Mascotas bajo petición', smokeNo: 'Prohibido fumar en todo el alojamiento', smokeOut: 'Prohibido fumar en las habitaciones (se puede al aire libre)', partyNo: 'No se permiten fiestas ni eventos', partyYes: 'Fiestas y eventos bajo petición', kidsYes: 'Niños bienvenidos', kidsNo: 'Solo adultos', quiet: 'Silencio a partir de las {t}' },
};

/** The rules as short lines in the guest's language (the free note stays in the owner's words). */
export function ruleLines(r: HouseRules, locale: Locale): RuleLine[] {
  const x = T[locale];
  const out: RuleLine[] = [
    { icon: 'pets', text: r.pets === 'no' ? x.petsNo : r.pets === 'yes' ? x.petsYes : x.petsAsk, ok: r.pets !== 'no' },
    { icon: 'smoke', text: r.smoking === 'no' ? x.smokeNo : x.smokeOut, ok: false },
    { icon: 'party', text: r.parties === 'no' ? x.partyNo : x.partyYes, ok: r.parties !== 'no' },
    { icon: 'kids', text: r.children === 'yes' ? x.kidsYes : x.kidsNo, ok: r.children === 'yes' },
  ];
  if (/^\d{2}:\d{2}$/.test(r.quietFrom)) out.push({ icon: 'quiet', text: x.quiet.replace('{t}', r.quietFrom), ok: true });
  if (r.note.trim()) out.push({ icon: 'note', text: r.note.trim(), ok: true });
  return out;
}

/** The same, in Italian, for the chatbot's notes. */
export function rulesForPrompt(r: HouseRules): string {
  return ruleLines(r, 'it')
    .map((l) => l.text)
    .join('; ');
}
