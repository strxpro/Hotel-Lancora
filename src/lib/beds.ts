import type { BedKind, Locale } from './types';

export const BED_KINDS: { kind: BedKind; sleeps: number; it: [string, string] }[] = [
  { kind: 'matrimoniale', sleeps: 2, it: ['letto matrimoniale', 'letti matrimoniali'] },
  // the owner's "Matrimoniale · 1 persona" (a double bed sold to one guest): guests read "letto matrimoniale"
  { kind: 'francese', sleeps: 1, it: ['letto matrimoniale', 'letti matrimoniali'] },
  { kind: 'singolo', sleeps: 1, it: ['letto singolo', 'letti singoli'] },
  { kind: 'divano_letto', sleeps: 2, it: ['divano letto', 'divani letto'] },
  { kind: 'castello', sleeps: 2, it: ['letto a castello', 'letti a castello'] },
  { kind: 'culla', sleeps: 0, it: ['culla', 'culle'] },
];

const NOUN: Record<Exclude<Locale, 'it'>, Record<BedKind, string>> = {
  en: { matrimoniale: 'double bed', francese: 'double bed', singolo: 'single bed', divano_letto: 'sofa bed', castello: 'bunk bed', culla: 'cot' },
  pl: { matrimoniale: 'łóżko małżeńskie', francese: 'łóżko małżeńskie', singolo: 'łóżko pojedyncze', divano_letto: 'sofa z funkcją spania', castello: 'łóżko piętrowe', culla: 'łóżeczko dziecięce' },
  de: { matrimoniale: 'Doppelbett', francese: 'Doppelbett', singolo: 'Einzelbett', divano_letto: 'Schlafsofa', castello: 'Etagenbett', culla: 'Kinderbett' },
  fr: { matrimoniale: 'lit double', francese: 'lit double', singolo: 'lit simple', divano_letto: 'canapé-lit', castello: 'lits superposés', culla: 'lit bébé' },
  es: { matrimoniale: 'cama de matrimonio', francese: 'cama de matrimonio', singolo: 'cama individual', divano_letto: 'sofá cama', castello: 'litera', culla: 'cuna' },
};

/** The same beds, kind by kind (a double for one guest is not the same as a double for two). */
export const sameBeds = (a: BedConfig, b: BedConfig) => {
  const key = (c: BedConfig) => JSON.stringify(BED_KINDS.map((k) => c.filter((x) => x.kind === k.kind).reduce((s, x) => s + x.count, 0)));
  return key(a) === key(b);
};

export type BedConfig = { kind: BedKind; count: number }[];

/** "1 letto matrimoniale + 1 letto singolo" — in the visitor's language. */
export function bedsText(config: BedConfig, locale: Locale = 'it'): string {
  // beds the guest reads the same way (a double for one, a double for two) are counted together
  const seen = new Map<string, { n: number; one: string; many: string }>();
  for (const b of BED_KINDS) {
    const n = config.filter((c) => c.kind === b.kind).reduce((s, c) => s + c.count, 0);
    if (n <= 0) continue;
    const one = locale === 'it' ? b.it[0] : NOUN[locale][b.kind];
    const many = locale === 'it' ? b.it[1] : NOUN[locale][b.kind];
    const cur = seen.get(one);
    seen.set(one, { n: (cur?.n ?? 0) + n, one, many });
  }
  return [...seen.values()]
    .map(({ n, one, many }) => {
      if (locale === 'it') return `${n} ${n === 1 ? one : many}`;
      if (locale === 'en') return `${n} ${n === 1 ? one : `${one}s`}`;
      return n === 1 ? `1 ${one}` : `${n}× ${one}`;
    })
    .join(' + ');
}

export const bedsCountOf = (config: BedConfig) => Math.max(1, config.filter((c) => c.kind !== 'culla').reduce((s, c) => s + c.count, 0));
export const sleepsOf = (config: BedConfig) => config.reduce((s, c) => s + (BED_KINDS.find((b) => b.kind === c.kind)?.sleeps ?? 0) * c.count, 0);

/** Best guess of the structure of an old free-text "beds" field. */
export function parseBeds(text: string): BedConfig {
  const t = text.toLowerCase();
  const out: BedConfig = [];
  const grab = (re: RegExp, kind: BedKind) => {
    const m = t.match(re);
    if (m) out.push({ kind, count: Number(m[1] ?? 1) || 1 });
  };
  grab(/(\d+)?\s*(?:letti?|lett[oi])?\s*matrimonial/, 'matrimoniale');
  grab(/(\d+)?\s*(?:letti?|letto)?\s*(?:alla\s+)?frances/, 'francese');
  grab(/(\d+)?\s*(?:letti?|letto)?\s*singol/, 'singolo');
  grab(/(\d+)?\s*divan/, 'divano_letto');
  grab(/(\d+)?\s*(?:letti?|letto)?\s*a\s*castello/, 'castello');
  grab(/(\d+)?\s*cull/, 'culla');
  return out;
}
