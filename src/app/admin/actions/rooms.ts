'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { addBlock, addRatePeriod, deleteRoom, removeBlock, removeRatePeriod, saveRoom, saveTranslation, setPeriodPrice, setRoomPrice, setRoomsPrice, setRoomVisibility } from '@/server/rooms';
import { improveRoomText, translateFields, translateRoomText, translationProvider } from '@/server/ai/content';
import { mutate, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { can } from '@/server/auth/guard';
import { LOCALES, type Locale } from '@/lib/types';
import { slugify } from '@/lib/utils';

const PhotoSchema = z.object({ id: z.string(), src: z.string().regex(/^\/(api\/media|media\/demo)\/[\w./-]+$/), alt: z.string().max(160), width: z.number().int().positive(), height: z.number().int().positive(), demo: z.boolean(), credit: z.string().optional() });
const TextSchema = z.object({ title: z.string().max(80), short: z.string().max(240), description: z.string().max(3000) });

const RoomSchema = z.object({
  id: z.string().optional(),
  number: z.string().trim().min(1).max(8),
  name: z.string().trim().max(60),
  type: z.enum(['singola', 'doppia', 'matrimoniale', 'tripla', 'family', 'suite']),
  maxGuests: z.number().int().min(1).max(10),
  beds: z.string().trim().max(80),
  bedsCount: z.number().int().min(1).max(8),
  size: z.number().min(5).max(300).nullable(),
  floor: z.enum(['terra', 'superiore', 'inferiore']),
  basePrice: z.number().min(1).max(5000),
  cashPrice: z.number().min(1).max(5000).nullable().optional(),
  payment: z.enum(['both', 'card', 'cash']).optional(),
  bedConfig: z.array(z.object({ kind: z.enum(['matrimoniale', 'francese', 'singolo', 'divano_letto', 'castello', 'culla']), count: z.number().int().min(1).max(8) })).max(6).optional(),
  status: z.enum(['available', 'unavailable', 'draft']),
  hidden: z.boolean(),
  amenities: z.array(z.string().max(60)).max(40),
  photos: z.array(PhotoSchema).max(24),
  text: TextSchema,
  blocks: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string().max(120) })).max(10).optional(),
  /** prices for some dates or months; price null = that period goes back to the base price */
  prices: z.array(z.object({ from: z.string(), to: z.string(), price: z.number().min(1).max(5000).nullable(), label: z.string().max(60) })).max(24).optional(),
});

export async function saveRoomAction(raw: unknown) {
  return act('rooms.edit', (u) => {
    const input = RoomSchema.parse(raw);
    if (input.id) {
      const prev = readDb().rooms.find((r) => r.id === input.id);
      if (prev && (prev.basePrice !== input.basePrice || (input.cashPrice !== undefined && (prev.cashPrice ?? null) !== input.cashPrice)) && !can(u.role, 'prices.edit')) throw new UserError('Solo l’amministratore può cambiare i prezzi.');
    }
    const before = input.id ? readDb().rooms.find((r) => r.id === input.id) : undefined;
    const room = saveRoom(input, u.name);
    for (const b of input.blocks ?? []) addBlock(room.id, b.from, b.to, b.reason || 'Blocco manuale', u.name);
    if (input.prices?.length && input.id && !can(u.role, 'prices.edit')) throw new UserError('Solo l’amministratore può cambiare i prezzi.');
    for (const p of input.prices ?? []) setPeriodPrice({ roomIds: [room.id], ranges: [{ from: p.from, to: p.to }], price: p.price, label: p.label }, u.name);
    // Translations are automatic: whenever the Italian text changes (or a language is still missing)
    const textChanged = !before || JSON.stringify(before.text) !== JSON.stringify(input.text);
    const missing = LOCALES.some((l) => l !== 'it' && !room.translations[l as Exclude<Locale, 'it'>]?.published);
    const translating = translationProvider().configured && Boolean(input.text.description.trim() || input.text.short.trim()) && (textChanged || missing);
    if (translating) void autoTranslate(room.id, u.name);
    return { id: room.id, slug: room.slug, number: room.number, translating };
  });
}

/** Background job: translate the Italian text into every language and publish it. Hand-edited languages are kept. */
async function autoTranslate(roomId: string, actor: string) {
  const room = readDb().rooms.find((r) => r.id === roomId);
  if (!room) return;
  for (const l of LOCALES) {
    if (l === 'it') continue;
    const lang = l as Exclude<Locale, 'it'>;
    if (room.translations[lang]?.manual) continue;
    try {
      const t = await translateRoomText(room.text, lang);
      saveTranslation(room.id, lang, t, { approve: true, manual: false }, `${actor} · traduzione automatica`);
    } catch (e) {
      console.error('[auto-translate]', lang, (e as Error).message);
      break;
    }
  }
}

const LOCAL_NAMES = ['Cala Spinosa', 'La Marmorata', 'Rena Majore', 'Porto Pozzo', 'Santa Reparata', 'Cala Sambuco', 'Lavezzi', 'Spargi', 'Budelli', 'Razzoli', 'Caprera', 'Isola Rossa', 'Monti Russu', 'Lu Impostu'];
const BY_TYPE = {
  singola: { maxGuests: 1, beds: '1 letto singolo', bedsCount: 1, size: 14, price: 75 },
  doppia: { maxGuests: 2, beds: '2 letti singoli', bedsCount: 2, size: 18, price: 90 },
  matrimoniale: { maxGuests: 2, beds: '1 letto matrimoniale', bedsCount: 1, size: 18, price: 99 },
  tripla: { maxGuests: 3, beds: '1 matrimoniale + 1 singolo', bedsCount: 2, size: 24, price: 125 },
  family: { maxGuests: 4, beds: '1 matrimoniale + divano letto', bedsCount: 2, size: 28, price: 149 },
  suite: { maxGuests: 3, beds: '1 matrimoniale + divano letto', bedsCount: 2, size: 32, price: 189 },
} as const;
const BASE_AMENITIES = ['wifi', 'aria_condizionata', 'tv', 'bagno_privato', 'asciugacapelli'];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : null;
};

/**
 * "Aiutami con AI": fills only what the owner has not filled yet: number, name, beds, size,
 * price (median of similar rooms), typical amenities and the descriptions (AI or guided text).
 */
export async function suggestRoomAction(raw: unknown) {
  return act('rooms.edit', async () => {
    const p = z
      .object({
        id: z.string().optional(),
        number: z.string().max(8),
        name: z.string().max(60),
        type: z.enum(['singola', 'doppia', 'matrimoniale', 'tripla', 'family', 'suite']),
        floor: z.enum(['terra', 'superiore', 'inferiore']),
        maxGuests: z.number(),
        beds: z.string().max(80),
        bedsCount: z.number(),
        size: z.number().nullable(),
        basePrice: z.number(),
        amenities: z.array(z.string().max(40)).max(30),
        text: TextSchema,
        touched: z.array(z.string().max(30)).max(30),
      })
      .parse(raw);
    const db = readDb();
    const others = db.rooms.filter((r) => r.id !== p.id);
    const same = others.filter((r) => r.type === p.type);
    const touched = new Set(p.touched);
    const spec = BY_TYPE[p.type];
    const v: Record<string, unknown> = {};
    const filled: string[] = [];
    if (!p.number.trim()) {
      const nums = others.map((r) => parseInt(r.number, 10)).filter(Number.isFinite);
      let n = (nums.length ? Math.max(...nums) : 100) + 1;
      while (others.some((r) => r.number === String(n))) n++;
      v.number = String(n);
      filled.push('numero');
    }
    const name = p.name.trim() || LOCAL_NAMES.find((x) => !others.some((r) => r.name.toLowerCase() === x.toLowerCase())) || `Camera ${String(v.number ?? p.number)}`;
    if (!p.name.trim()) {
      v.name = name;
      filled.push('nome');
    }
    if (!touched.has('maxGuests')) v.maxGuests = spec.maxGuests;
    if (!touched.has('beds')) v.beds = spec.beds;
    if (!touched.has('bedsCount')) v.bedsCount = spec.bedsCount;
    if (!touched.has('maxGuests') || !touched.has('beds')) filled.push('letti e ospiti');
    if (!p.size && !touched.has('size')) {
      v.size = median(same.map((r) => r.size ?? 0).filter(Boolean)) ?? spec.size;
      filled.push('superficie');
    }
    if (!touched.has('basePrice')) {
      v.basePrice = median(same.map((r) => r.basePrice)) ?? spec.price;
      filled.push(same.length ? 'prezzo (come camere simili)' : 'prezzo (tipico)');
    }
    if (!touched.has('amenities')) {
      const count = new Map<string, number>();
      for (const r of same) for (const a of r.amenities) count.set(a, (count.get(a) ?? 0) + 1);
      const common = [...count].filter(([, c]) => c >= Math.max(1, same.length / 2)).map(([a]) => a);
      v.amenities = [...new Set([...BASE_AMENITIES, ...common, ...p.amenities])];
      filled.push('servizi');
    }
    let mode: 'ai' | 'template' | null = null;
    if (!p.text.short.trim() || !p.text.description.trim()) {
      try {
        const r = await improveRoomText(
          { name, type: p.type, maxGuests: Number(v.maxGuests ?? p.maxGuests), beds: String(v.beds ?? p.beds), size: (v.size as number | null | undefined) ?? p.size, floor: p.floor, amenities: (v.amenities as string[] | undefined) ?? p.amenities },
          { title: p.text.title || name, short: p.text.short, description: p.text.description },
        );
        v.text = r.text;
        mode = r.mode;
        filled.push('descrizione');
      } catch {
        /* the text stays as it is */
      }
    }
    return { values: v, filled, mode };
  });
}

export async function setPriceAction(roomId: string, price: number) {
  return act('prices.edit', (u) => void setRoomPrice(z.string().parse(roomId), z.number().parse(price), u.name), 'Prezzo aggiornato: già visibile sul sito.');
}

/** Same price for several rooms at once. cash: number = own cash price, null = standard cash discount. */
export async function setRoomsPriceAction(roomIds: string[], price: number, cash: number | null) {
  return act('prices.edit', (u) => {
    const ids = z.array(z.string()).min(1).max(100).parse(roomIds);
    const p = z.number().min(1).max(5000).parse(price);
    const c = z.number().min(1).max(5000).nullable().parse(cash);
    if (c !== null && c > p) throw new UserError('Il prezzo in contanti deve essere uguale o più basso di quello con carta.');
    return { rooms: setRoomsPrice(ids, p, c, u.name) };
  }, 'Prezzi aggiornati: già visibili sul sito.');
}

export async function setVisibilityAction(roomId: string, patch: { status?: 'available' | 'unavailable' | 'draft'; hidden?: boolean }) {
  return act('rooms.edit', (u) => void setRoomVisibility(roomId, z.object({ status: z.enum(['available', 'unavailable', 'draft']).optional(), hidden: z.boolean().optional() }).parse(patch), u.name), 'Camera aggiornata.');
}

const PAY_LABEL = { both: 'carta o contanti', card: 'solo carta', cash: 'solo contanti' } as const;

/** One click from the room list: how guests can pay for this room (card online, cash at the hotel, or both). */
export async function setRoomPaymentAction(roomId: string, payment: 'both' | 'card' | 'cash') {
  return act('rooms.edit', (u) => {
    const pay = z.enum(['both', 'card', 'cash']).parse(payment);
    return mutate((db) => {
      const r = db.rooms.find((x) => x.id === roomId);
      if (!r) throw new UserError('Camera non trovata.');
      const prev = r.payment ?? 'both';
      if (prev === pay) return { payment: pay };
      r.payment = pay;
      r.updatedAt = new Date().toISOString();
      audit(db, u.name, 'room_payment', 'room', r.id, `Camera ${r.number}: ${PAY_LABEL[prev]} → ${PAY_LABEL[pay]}`);
      return { payment: pay };
    });
  }, 'Pagamento della camera aggiornato: già valido sul sito.');
}

export async function deleteRoomAction(roomId: string) {
  return act('rooms.delete', (u) => deleteRoom(roomId, u.name), 'Camera eliminata.');
}

export async function addBlockAction(roomId: string, from: string, to: string, reason: string) {
  return act('bookings.manage', (u) => addBlock(roomId, from, to, reason.slice(0, 120), u.name), 'Date bloccate: la camera non è più prenotabile in quelle notti.');
}

export async function removeBlockAction(blockId: string) {
  return act('bookings.manage', (u) => removeBlock(blockId, u.name), 'Blocco rimosso.');
}

export async function addRatePeriodAction(raw: unknown) {
  return act('prices.edit', (u) => {
    const p = z.object({ label: z.string().trim().min(1).max(60), from: z.string(), to: z.string(), roomIds: z.union([z.literal('all'), z.array(z.string()).min(1)]), mode: z.enum(['fixed', 'percent']), value: z.number() }).parse(raw);
    addRatePeriod(p, u.name);
  }, 'Variazione di prezzo salvata.');
}

/** Price of some rooms in some months or dates (Prezzi): price null = back to the base price there. */
export async function setPeriodPriceAction(raw: unknown) {
  return act('prices.edit', (u) => {
    const p = z.object({ roomIds: z.array(z.string()).min(1).max(100), ranges: z.array(z.object({ from: z.string(), to: z.string() })).min(1).max(24), price: z.number().min(1).max(5000).nullable(), cash: z.number().min(1).max(5000).nullable().optional() }).parse(raw);
    return setPeriodPrice(p, u.name);
  }, 'Prezzi del periodo salvati: già visibili sul sito.');
}

export async function removeRatePeriodAction(id: string) {
  return act('prices.edit', (u) => removeRatePeriod(id, u.name), 'Variazione rimossa.');
}

export async function improveTextAction(raw: unknown) {
  return act('rooms.edit', async () => {
    const p = z.object({ facts: z.object({ name: z.string(), type: z.enum(['singola', 'doppia', 'matrimoniale', 'tripla', 'family', 'suite']), maxGuests: z.number(), beds: z.string(), size: z.number().nullable(), floor: z.enum(['terra', 'superiore', 'inferiore']), amenities: z.array(z.string()) }), text: TextSchema }).parse(raw);
    try {
      return await improveRoomText(p.facts, p.text);
    } catch (e) {
      throw new UserError((e as Error).message);
    }
  });
}

/** Translate into all languages. Manually edited translations are skipped unless `overwriteManual`. */
export async function translateAllAction(roomId: string, overwriteManual: boolean) {
  return act('rooms.edit', async (u) => {
    const room = readDb().rooms.find((r) => r.id === roomId);
    if (!room) throw new UserError('Camera non trovata.');
    const done: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const l of LOCALES) {
      if (l === 'it') continue;
      const lang = l as Exclude<Locale, 'it'>;
      if (room.translations[lang]?.manual && !overwriteManual) {
        skipped.push(lang);
        continue;
      }
      try {
        const t = await translateRoomText(room.text, lang);
        saveTranslation(room.id, lang, t, { approve: false, manual: false }, u.name);
        done.push(lang);
      } catch (e) {
        if (!done.length && !failed.length) throw new UserError((e as Error).message);
        failed.push(lang);
      }
    }
    return { done, skipped, failed };
  });
}

export async function saveTranslationAction(roomId: string, lang: string, text: unknown, approve: boolean) {
  return act('rooms.edit', (u) => {
    const l = z.enum(['en', 'pl', 'de', 'fr', 'es']).parse(lang);
    saveTranslation(roomId, l, TextSchema.parse(text), { approve, manual: true }, u.name);
  }, approve ? 'Traduzione pubblicata sul sito.' : 'Bozza di traduzione salvata.');
}

export async function approveAllTranslationsAction(roomId: string) {
  return act('rooms.edit', (u) =>
    mutate((db) => {
      const r = db.rooms.find((x) => x.id === roomId);
      if (!r) throw new UserError('Camera non trovata.');
      let n = 0;
      for (const [, tr] of Object.entries(r.translations)) {
        if (!tr || !tr.title) continue;
        tr.published = { title: tr.title, short: tr.short, description: tr.description };
        tr.status = 'tradotto';
        n++;
      }
      audit(db, u.name, 'translation_publish', 'room', r.id, `${n} lingue pubblicate`);
    }),
  'Traduzioni pubblicate: le versioni linguistiche del sito sono aggiornate.');
}

/* ---------------- amenities the owner adds himself (shared by every room) ---------------- */

export async function addCustomAmenityAction(label: string) {
  return act('rooms.edit', (u) => {
    const clean = z.string().trim().min(2, 'Scrivi almeno 2 lettere').max(40, 'Massimo 40 caratteri').parse(label);
    const key = `x_${slugify(clean).replace(/-/g, '_').slice(0, 40)}`;
    const res = mutate((db) => {
      const known = db.settings.customAmenities.find((c) => c.key === key || c.label.toLowerCase() === clean.toLowerCase());
      if (known) return known;
      const c = { key, label: clean.charAt(0).toUpperCase() + clean.slice(1) };
      db.settings.customAmenities.push(c);
      audit(db, u.name, 'amenity_add', 'settings', key, c.label);
      return c;
    });
    // the label is translated in the background for the other languages of the site
    void (async () => {
      const labels: Partial<Record<Locale, string>> = { it: res.label };
      for (const l of LOCALES) {
        if (l === 'it') continue;
        try {
          const tr = await translateFields({ label: res.label }, l);
          if (tr) labels[l] = tr.label;
        } catch {
          break;
        }
      }
      mutate((db) => {
        const c = db.settings.customAmenities.find((x) => x.key === res.key);
        if (c) c.labels = labels;
      });
    })();
    return { key: res.key, label: res.label };
  });
}

export async function removeCustomAmenityAction(key: string) {
  return act('rooms.edit', (u) => {
    const k = z.string().regex(/^x_[a-z0-9_]{1,40}$/).parse(key);
    return mutate((db) => {
      const c = db.settings.customAmenities.find((x) => x.key === k);
      db.settings.customAmenities = db.settings.customAmenities.filter((x) => x.key !== k);
      let rooms = 0;
      for (const r of db.rooms) {
        if (r.amenities.includes(k)) {
          r.amenities = r.amenities.filter((a) => a !== k);
          rooms++;
        }
      }
      audit(db, u.name, 'amenity_remove', 'settings', k, `${c?.label ?? k} · tolto da ${rooms} camere`);
      return { rooms };
    });
  });
}
