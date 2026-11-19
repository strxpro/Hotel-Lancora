import 'server-only';
import { z } from 'zod';
import type { FloorKey, Locale, RoomText, RoomType } from '@/lib/types';
import { amenityLabel } from '@/content/amenities';
import { getProvider, parseJsonLoose } from './provider';
import { translationsMode } from '../integrations';

const TYPE_IT: Record<RoomType, string> = { singola: 'camera singola', doppia: 'camera doppia', matrimoniale: 'camera matrimoniale', tripla: 'camera tripla', family: 'camera family', suite: 'junior suite' };
const FLOOR_IT: Record<FloorKey, string> = { terra: 'piano terra', superiore: 'piano superiore', inferiore: 'piano inferiore' };
const LANG_NAME: Record<Locale, string> = { it: 'italiano', en: 'inglese (British English)', pl: 'polacco', de: 'tedesco', fr: 'francese', es: 'spagnolo' };

export interface RoomFacts {
  name: string;
  type: RoomType;
  maxGuests: number;
  beds: string;
  size: number | null;
  floor: FloorKey;
  amenities: string[];
}

const TextSchema = z.object({ title: z.string().min(1).max(80), short: z.string().min(10).max(220), description: z.string().min(40).max(1400) });

/** Words that describe services the hotel may not have: if the AI introduces them, we warn. */
const RISKY = ['piscina', 'spa', 'idromassaggio', 'jacuzzi', 'colazione', 'ristorante', 'parcheggio', 'terrazza', 'vasca', 'sauna', 'palestra', 'navetta', 'transfer', 'animali', 'vista mare', 'balcone', 'patio', 'cucina', 'angolo cottura', 'minibar', 'macchina del caffè', 'nespresso'];

export function inventedFacts(before: string, after: string, facts: RoomFacts): string[] {
  const known = (before + ' ' + facts.amenities.map((a) => amenityLabel(a, 'it')).join(' ') + ' ' + facts.beds).toLowerCase();
  return RISKY.filter((w) => after.toLowerCase().includes(w) && !known.includes(w));
}

export async function improveRoomText(facts: RoomFacts, current: RoomText): Promise<{ mode: 'ai' | 'template'; provider: string; text: RoomText; warnings: string[] }> {
  const provider = getProvider();
  if (provider) {
    const sys = [
      'Sei un copywriter per un piccolo hotel 3 stelle a Santa Teresa Gallura (Sardegna).',
      'Scrivi in italiano elegante, caldo e sobrio (niente superlativi esagerati, niente emoji).',
      'REGOLE INDEROGABILI: usa SOLO i fatti forniti. Non aggiungere dotazioni, servizi, viste o dimensioni non elencati. Se un dato manca, non inventarlo.',
      'Rispondi solo con JSON: {"title": string (max 60 caratteri, puoi mantenere il nome), "short": string (1 frase, max 140 caratteri, per la card), "description": string (2 brevi paragrafi separati da \\n\\n, max 650 caratteri)}.',
    ].join('\n');
    const user = JSON.stringify({
      nome: facts.name,
      tipologia: TYPE_IT[facts.type],
      ospiti_max: facts.maxGuests,
      letti: facts.beds,
      superficie_m2: facts.size,
      piano: FLOOR_IT[facts.floor],
      dotazioni: facts.amenities.map((a) => amenityLabel(a, 'it')),
      testo_attuale: current,
    });
    const raw = await provider.complete([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, temperature: 0.5, maxTokens: 700 });
    const parsed = TextSchema.safeParse(parseJsonLoose(raw));
    if (parsed.success) {
      const t = parsed.data;
      return { mode: 'ai', provider: provider.label, text: t, warnings: inventedFacts(`${current.title} ${current.short} ${current.description}`, `${t.title} ${t.short} ${t.description}`, facts) };
    }
    throw new Error('Il modello non ha restituito un testo valido. Riprova.');
  }
  // Deterministic, clearly-labelled composition from the facts (no AI)
  const am = facts.amenities.map((a) => amenityLabel(a, 'it').toLowerCase());
  const short = `${cap(TYPE_IT[facts.type])} al ${FLOOR_IT[facts.floor]} per ${facts.maxGuests} ${facts.maxGuests === 1 ? 'ospite' : 'ospiti'}${facts.size ? `, ${facts.size} m²` : ''}.`;
  const p1 = `${cap(TYPE_IT[facts.type])} al ${FLOOR_IT[facts.floor]}, pensata per ${facts.maxGuests} ${facts.maxGuests === 1 ? 'ospite' : 'ospiti'}: ${facts.beds.toLowerCase()}${facts.size ? ` e ${facts.size} m² di spazio` : ''}.`;
  const p2 = am.length ? `In camera: ${am.join(', ')}.` : '';
  const own = current.description.trim();
  return { mode: 'template', provider: 'Composizione guidata (senza AI)', text: { title: current.title || facts.name, short, description: [p1, p2, own].filter(Boolean).join('\n\n') }, warnings: [] };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function translationProvider(): { configured: boolean; label: string } {
  const p = getProvider();
  if (p) return { configured: true, label: p.label };
  if (translationsMode() === 'mymemory') return { configured: true, label: 'MyMemory (servizio gratuito con limiti giornalieri)' };
  return { configured: false, label: 'Nessun provider di traduzione configurato' };
}

async function myMemory(text: string, target: Locale, source: Locale = 'it'): Promise<string> {
  if (!text.trim()) return '';
  const chunks = text.split(/(?<=[.!?])\s+/).reduce<string[]>((acc, s) => {
    const last = acc.at(-1);
    if (last && (last + ' ' + s).length < 450) acc[acc.length - 1] = `${last} ${s}`;
    else acc.push(s);
    return acc;
  }, []);
  const out: string[] = [];
  for (const c of chunks) {
    const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(c)}&langpair=${source}|${target}${process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : ''}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const j = (await r.json()) as { responseData?: { translatedText?: string }; responseStatus?: number };
    if (j.responseStatus !== 200 || !j.responseData?.translatedText) throw new Error('Limite del servizio di traduzione raggiunto');
    out.push(j.responseData.translatedText);
  }
  return out.join(' ');
}

/** Translate the Italian room text, preserving paragraph breaks. Throws if no provider is configured. */
export async function translateRoomText(src: RoomText, target: Exclude<Locale, 'it'>): Promise<RoomText> {
  const provider = getProvider();
  if (provider) {
    const raw = await provider.complete(
      [
        { role: 'system', content: `Traduci dall'italiano in ${LANG_NAME[target]} il testo di una camera d'hotel. Mantieni significato, tono elegante, paragrafi (\\n\\n) e nomi propri. Non aggiungere informazioni. Rispondi solo JSON {"title","short","description"}.` },
        { role: 'user', content: JSON.stringify(src) },
      ],
      { json: true, temperature: 0.2, maxTokens: 900 },
    );
    const parsed = TextSchema.safeParse(parseJsonLoose(raw));
    if (!parsed.success) throw new Error(`Traduzione ${target.toUpperCase()} non valida, riprova.`);
    return parsed.data;
  }
  if (translationsMode() === 'mymemory') {
    const paras = src.description.split(/\n{2,}/);
    const description = (await Promise.all(paras.map((p) => myMemory(p, target)))).join('\n\n');
    return { title: src.title, short: await myMemory(src.short, target), description };
  }
  throw new Error('Provider di traduzione non configurato: imposta AI_PROVIDER oppure TRANSLATION_PROVIDER=mymemory. Puoi comunque scrivere le traduzioni a mano.');
}

/**
 * What the owner wrote (in Italian) for a guest who reads another language: translated when a
 * translator is connected, otherwise — or when it fails — the owner's own words, unchanged.
 */
export async function translateForGuest<T extends Record<string, string>>(fields: T, lang: Locale): Promise<{ fields: T; translated: boolean }> {
  if (lang === 'it') return { fields, translated: false };
  try {
    const tr = await translateFields(fields, lang, 'it');
    if (tr && Object.keys(fields).every((k) => typeof tr[k] === 'string' && tr[k]!.trim())) return { fields: tr, translated: true };
  } catch (e) {
    console.warn('[traduzione]', (e as Error).message.slice(0, 160));
  }
  return { fields, translated: false };
}

/**
 * Translate a few short fields (email subject, headline, body…) keeping placeholders like {nome}
 * untouched. Uses the AI provider, else MyMemory; returns null when nothing is configured.
 */
export async function translateFields<T extends Record<string, string>>(fields: T, target: Locale, source: Locale = 'it'): Promise<T | null> {
  if (target === source) return fields;
  const provider = getProvider();
  if (provider) {
    const raw = await provider.complete(
      [
        { role: 'system', content: `Traduci da ${LANG_NAME[source]} in ${LANG_NAME[target]} i campi JSON di un'email di un hotel. Tono caldo ed elegante, stessi paragrafi (\n\n). NON tradurre e NON modificare i segnaposto tra graffe come {nome}, {cognome}, {camera}, {arrivo}, {partenza}, {codice}. Rispondi solo con lo stesso JSON tradotto.` },
        { role: 'user', content: JSON.stringify(fields) },
      ],
      { json: true, temperature: 0.2, maxTokens: 1600 },
    );
    const j = parseJsonLoose<Record<string, unknown>>(raw);
    if (!j) return null;
    const out = { ...fields } as Record<string, string>;
    for (const k of Object.keys(fields)) if (typeof j[k] === 'string' && (j[k] as string).trim()) out[k] = j[k] as string;
    return out as T;
  }
  if (translationsMode() === 'mymemory') {
    const out = {} as Record<string, string>;
    for (const [k, v] of Object.entries(fields)) {
      // protect placeholders: MyMemory would translate the word inside the braces
      const tokens: string[] = [];
      const masked = v.replace(/\{[a-z]+\}/gi, (m) => `[[${tokens.push(m) - 1}]]`);
      const paras = masked.split(/\n{2,}/);
      const done = (await Promise.all(paras.map((p) => (p.trim() ? myMemory(p, target, source) : Promise.resolve(''))))).join('\n\n');
      out[k] = done.replace(/\[\[\s*(\d+)\s*\]\]/g, (_, i: string) => tokens[Number(i)] ?? '');
    }
    return out as T;
  }
  return null;
}
