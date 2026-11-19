import 'server-only';
import type { DB, FloorKey, Locale, Photo, RatePeriod, Room, RoomStatus, RoomText, RoomType } from '@/lib/types';
import { LOCALES } from '@/lib/types';
import { isBookingActive, isPubliclyBookable } from '@/lib/availability';
import { addDays, fmtDate, isValidISODate, rangesOverlap, todayISO } from '@/lib/dates';
import { carveRooms } from '@/lib/period-prices';
import { slugify } from '@/lib/utils';
import { bedsCountOf, bedsText, parseBeds, type BedConfig } from '@/lib/beds';
import { mutate, newId, readDb } from './db/store';
import { audit } from './events';

export class RoomError extends Error {}

export type LocalizedRoom = Room & { t: RoomText; translated: boolean };

/** Text, beds and owner-added amenities in the visitor's language. */
export function localizeRoom(room: Room, locale: Locale): LocalizedRoom {
  const custom = readDb().settings.customAmenities ?? [];
  const amenities = room.amenities.map((k) => {
    if (!k.startsWith('x_')) return k;
    const c = custom.find((x) => x.key === k);
    return c ? `custom:${c.labels?.[locale] ?? c.label}` : k;
  });
  // rooms saved before the bed builder only have Italian free text: translate it when it can be read
  const cfg = room.bedConfig?.length ? room.bedConfig : locale === 'it' ? [] : parseBeds(room.beds);
  const beds = cfg.length ? bedsText(cfg, locale) : room.beds;
  const base = { ...room, amenities, beds };
  if (locale === 'it') return { ...base, t: room.text, translated: true };
  const tr = room.translations[locale as Exclude<Locale, 'it'>];
  return { ...base, t: tr?.published ?? room.text, translated: Boolean(tr?.published) };
}

export function publicRooms(db: DB, locale: Locale): LocalizedRoom[] {
  return db.rooms
    .filter(isPubliclyBookable)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => localizeRoom(r, locale));
}

export function findPublicRoom(slug: string, locale: Locale): LocalizedRoom | null {
  const room = readDb().rooms.find((r) => r.slug === slug);
  if (!room || room.hidden || room.status === 'draft') return null;
  return localizeRoom(room, locale);
}

export interface RoomInput {
  id?: string;
  number: string;
  name: string;
  type: RoomType;
  maxGuests: number;
  beds: string;
  bedsCount: number;
  size: number | null;
  floor: FloorKey;
  basePrice: number;
  cashPrice?: number | null;
  payment?: 'both' | 'card' | 'cash';
  bedConfig?: BedConfig;
  status: RoomStatus;
  hidden: boolean;
  amenities: string[];
  photos: Photo[];
  text: RoomText;
}

export function saveRoom(input: RoomInput, actor: string): Room {
  return mutate((db) => {
    // rooms without numbers: the site gives one for inside the panel (1, 2, 3…) and never shows it to guests
    const typed = input.number.trim();
    const before = input.id ? db.rooms.find((r) => r.id === input.id) : null;
    let numberAuto = !typed;
    let number = typed;
    if (!typed) {
      if (before?.numberAuto) number = before.number;
      else {
        let n = 1;
        while (db.rooms.some((r) => r.number === String(n) && r.id !== input.id)) n += 1;
        number = String(n);
      }
    } else if (before?.numberAuto && typed === before.number) numberAuto = true;
    if (!/^[A-Za-z0-9-]{1,8}$/.test(number)) throw new RoomError('Numero camera non valido (max 8 caratteri, lettere e numeri), oppure lascialo vuoto.');
    if (db.rooms.some((r) => r.number === number && r.id !== input.id)) throw new RoomError(`Esiste già una camera con il numero ${number}.`);
    if (input.floor === 'inferiore' && !db.settings.floors.enableLower) throw new RoomError('Il piano inferiore è disattivato nelle impostazioni.');
    if (input.basePrice < 0 || input.basePrice > 5000) throw new RoomError('Prezzo non valido.');
    if (typeof input.cashPrice === 'number' && (input.cashPrice <= 0 || input.cashPrice > input.basePrice)) throw new RoomError('Il prezzo in contanti deve essere più basso (o uguale) del prezzo con carta.');
    if (input.bedConfig?.length) {
      input = { ...input, beds: bedsText(input.bedConfig, 'it'), bedsCount: bedsCountOf(input.bedConfig) };
    }
    if (input.maxGuests < 1 || input.maxGuests > 10) throw new RoomError('Numero ospiti non valido.');
    const now = new Date().toISOString();
    const existing = input.id ? db.rooms.find((r) => r.id === input.id) : undefined;
    const name = input.name.trim() || `Camera ${number}`;
    const text: RoomText = { title: input.text.title.trim() || name, short: input.text.short.trim(), description: input.text.description.trim() };

    if (existing) {
      const textChanged = existing.text.short !== text.short || existing.text.description !== text.description || existing.text.title !== text.title;
      const priceChanged = existing.basePrice !== input.basePrice;
      Object.assign(existing, {
        number,
        numberAuto,
        name,
        type: input.type,
        maxGuests: input.maxGuests,
        beds: input.beds,
        bedsCount: input.bedsCount,
        size: input.size,
        floor: input.floor,
        basePrice: input.basePrice,
        ...(input.cashPrice !== undefined ? { cashPrice: input.cashPrice } : {}),
        ...(input.payment ? { payment: input.payment } : {}),
        ...(input.bedConfig ? { bedConfig: input.bedConfig } : {}),
        status: input.status,
        hidden: input.hidden,
        amenities: input.amenities,
        photos: input.photos,
        text,
        updatedAt: now,
      });
      if (textChanged) {
        // keep published translations online, but flag them as outdated
        for (const l of LOCALES) {
          const tr = existing.translations[l as Exclude<Locale, 'it'>];
          if (tr) tr.status = 'da_tradurre';
        }
      }
      audit(db, actor, 'update', 'room', existing.id, `Camera ${number}${priceChanged ? ` · prezzo € ${input.basePrice}` : ''}${textChanged ? ' · testo IT aggiornato' : ''} · stato ${input.status}${input.hidden ? ' (nascosta)' : ''}`);
      return existing;
    }

    let slug = `${number}-${slugify(name)}`.replace(/-+$/, '');
    while (db.rooms.some((r) => r.slug === slug)) slug += '-x';
    const room: Room = {
      id: newId('room-'),
      number,
      numberAuto,
      slug,
      name,
      type: input.type,
      maxGuests: input.maxGuests,
      beds: input.beds,
      bedsCount: input.bedsCount,
      size: input.size,
      floor: input.floor,
      basePrice: input.basePrice,
      cashPrice: input.cashPrice ?? null,
      payment: input.payment ?? 'both',
      ...(input.bedConfig ? { bedConfig: input.bedConfig } : {}),
      status: input.status,
      hidden: input.hidden,
      photos: input.photos,
      amenities: input.amenities,
      text,
      translations: {},
      sortOrder: Math.max(0, ...db.rooms.map((r) => r.sortOrder)) + 1,
      createdAt: now,
      updatedAt: now,
      demo: false,
    };
    db.rooms.push(room);
    audit(db, actor, 'create', 'room', room.id, `Nuova camera ${number} “${name}” · € ${input.basePrice} · ${input.status}`);
    return room;
  });
}

/** `cash`: undefined = keep, null = use the global cash discount, number = own cash price. */
export function setRoomPrice(roomId: string, price: number, actor: string, cash?: number | null): Room {
  if (!(price > 0 && price < 5000)) throw new RoomError('Prezzo non valido.');
  if (typeof cash === 'number' && !(cash > 0 && cash <= price)) throw new RoomError('Il prezzo in contanti deve essere tra 1 € e il prezzo con carta.');
  return mutate((db) => {
    const r = db.rooms.find((x) => x.id === roomId);
    if (!r) throw new RoomError('Camera non trovata.');
    const prev = r.basePrice;
    r.basePrice = Math.round(price * 100) / 100;
    if (cash !== undefined) r.cashPrice = cash === null ? null : Math.round(cash * 100) / 100;
    if (typeof r.cashPrice === 'number' && r.cashPrice > r.basePrice) r.cashPrice = r.basePrice;
    r.updatedAt = new Date().toISOString();
    audit(db, actor, 'price', 'room', r.id, `Camera ${r.number}: € ${prev} → € ${r.basePrice}${typeof r.cashPrice === 'number' ? ` · contanti € ${r.cashPrice}` : ''}`);
    return r;
  });
}

/** Same new price (and cash price) for several rooms at once. */
export function setRoomsPrice(roomIds: string[], price: number, cash: number | null | undefined, actor: string): number {
  if (!(price > 0 && price < 5000)) throw new RoomError('Prezzo non valido.');
  if (typeof cash === 'number' && !(cash > 0 && cash <= price)) throw new RoomError('Il prezzo in contanti deve essere tra 1 € e il prezzo con carta.');
  return mutate((db) => {
    let n = 0;
    for (const r of db.rooms) {
      if (!roomIds.includes(r.id)) continue;
      r.basePrice = Math.round(price * 100) / 100;
      if (cash !== undefined) r.cashPrice = cash === null ? null : Math.round(cash * 100) / 100;
      r.updatedAt = new Date().toISOString();
      n++;
    }
    audit(db, actor, 'price', 'room', null, `${n} camere a € ${price}${typeof cash === 'number' ? ` · contanti € ${cash}` : ''}`);
    return n;
  });
}

export function setRoomVisibility(roomId: string, patch: { status?: RoomStatus; hidden?: boolean }, actor: string): Room {
  return mutate((db) => {
    const r = db.rooms.find((x) => x.id === roomId);
    if (!r) throw new RoomError('Camera non trovata.');
    if (patch.status) r.status = patch.status;
    if (typeof patch.hidden === 'boolean') r.hidden = patch.hidden;
    r.updatedAt = new Date().toISOString();
    audit(db, actor, 'visibility', 'room', r.id, `Camera ${r.number}: stato ${r.status}${r.hidden ? ', nascosta dal sito' : ''}`);
    return r;
  });
}

export function deleteRoom(roomId: string, actor: string): void {
  mutate((db) => {
    const r = db.rooms.find((x) => x.id === roomId);
    if (!r) throw new RoomError('Camera non trovata.');
    const today = todayISO();
    if (db.bookings.some((b) => b.roomId === roomId && b.checkOut > today && isBookingActive(b))) throw new RoomError('La camera ha prenotazioni future: spostale o annullale prima di eliminarla. In alternativa nascondila dal sito.');
    db.rooms = db.rooms.filter((x) => x.id !== roomId);
    db.blocks = db.blocks.filter((b) => b.roomId !== roomId);
    audit(db, actor, 'delete', 'room', roomId, `Camera ${r.number} eliminata`);
  });
}

export function addBlock(roomId: string, from: string, to: string, reason: string, actor: string): void {
  if (!isValidISODate(from) || !isValidISODate(to) || to <= from) throw new RoomError('Intervallo non valido: la data finale deve essere successiva a quella iniziale.');
  mutate((db) => {
    const r = db.rooms.find((x) => x.id === roomId);
    if (!r) throw new RoomError('Camera non trovata.');
    const clash = db.bookings.find((b) => b.roomId === roomId && isBookingActive(b) && rangesOverlap(from, to, b.checkIn, b.checkOut));
    if (clash) throw new RoomError(`Ci sono già ospiti in quelle notti (${clash.code}, ${fmtDate(clash.checkIn)} → ${fmtDate(clash.checkOut)}). Sposta prima la prenotazione.`);
    const blockClash = db.blocks.find((b) => b.roomId === roomId && rangesOverlap(from, to, b.from, b.to));
    if (blockClash) throw new RoomError(`La camera è già bloccata dal ${fmtDate(blockClash.from)} al ${fmtDate(blockClash.to)}.`);
    db.blocks.push({ id: newId('blk-'), roomId, from, to, reason: reason || 'Blocco manuale', createdBy: actor, createdAt: new Date().toISOString() });
    audit(db, actor, 'block', 'room', roomId, `Camera ${r.number} bloccata ${from} → ${to}: ${reason}`);
  });
}

export function removeBlock(blockId: string, actor: string): void {
  mutate((db) => {
    const b = db.blocks.find((x) => x.id === blockId);
    if (!b) throw new RoomError('Blocco non trovato.');
    db.blocks = db.blocks.filter((x) => x.id !== blockId);
    audit(db, actor, 'unblock', 'room', b.roomId, `Rimosso blocco ${b.from} → ${b.to}`);
  });
}

export function addRatePeriod(p: Omit<RatePeriod, 'id' | 'createdAt'>, actor: string): void {
  if (!isValidISODate(p.from) || !isValidISODate(p.to) || p.to <= p.from) throw new RoomError('Intervallo non valido.');
  if (p.mode === 'fixed' && !(p.value > 0)) throw new RoomError('Prezzo non valido.');
  if (p.mode === 'percent' && (p.value < -90 || p.value > 300)) throw new RoomError('Variazione percentuale non valida.');
  mutate((db) => {
    db.ratePeriods.push({ ...p, id: newId('rp-'), createdAt: new Date().toISOString() });
    audit(db, actor, 'rate_period', 'pricing', null, `${p.label}: ${p.from} → ${p.to} ${p.mode === 'fixed' ? `€ ${p.value}` : `${p.value > 0 ? '+' : ''}${p.value}%`}`);
  });
}

/**
 * A season or event in Prezzi, new or changed in place (same id: it keeps its place in the list,
 * so it still wins over the ones before it). A fixed price can carry its own cash price.
 */
export function saveRatePeriod(input: { id?: string | null; label: string; from: string; to: string; roomIds: string[] | 'all'; mode: 'fixed' | 'percent'; value: number; cash?: number | null }, actor: string): RatePeriod {
  if (!isValidISODate(input.from) || !isValidISODate(input.to) || input.to <= input.from) throw new RoomError('Scegli le date: “al” deve venire dopo “dal”.');
  const label = input.label.trim().slice(0, 60) || periodLabel(input.from, input.to);
  const value = Math.round(input.value * 100) / 100;
  if (input.mode === 'fixed' && !(value >= 1 && value <= 5000)) throw new RoomError('Prezzo con carta tra 1 e 5000 €.');
  if (input.mode === 'percent' && (value < -90 || value > 300 || value === 0)) throw new RoomError('Variazione percentuale tra −90% e +300%.');
  const cash = input.mode === 'fixed' && typeof input.cash === 'number' && input.cash > 0 ? Math.round(input.cash * 100) / 100 : null;
  if (cash !== null && cash > value) throw new RoomError('Il prezzo in contanti non può superare quello con carta.');
  return mutate((db) => {
    const roomIds: RatePeriod['roomIds'] = input.roomIds === 'all' ? 'all' : [...new Set(input.roomIds)].filter((id) => db.rooms.some((r) => r.id === id));
    if (roomIds !== 'all' && !roomIds.length) throw new RoomError('Scegli almeno una camera.');
    const fields = { label, from: input.from, to: input.to, roomIds, mode: input.mode, value };
    const what = `${label}: ${fmtDate(input.from)} → ${fmtDate(addDays(input.to, -1))} · ${input.mode === 'fixed' ? `€ ${value}${cash !== null ? ` · contanti € ${cash}` : ''}` : `${value > 0 ? '+' : ''}${value}%`}`;
    const old = input.id ? db.ratePeriods.find((x) => x.id === input.id) : null;
    if (input.id && !old) throw new RoomError('Questa variazione non esiste più: ricarica la pagina.');
    if (old) {
      Object.assign(old, fields);
      if (cash !== null) old.cash = cash;
      else delete old.cash;
      audit(db, actor, 'rate_period', 'pricing', old.id, `Modificata · ${what}`);
      return old;
    }
    const p: RatePeriod = { ...fields, ...(cash !== null ? { cash } : {}), id: newId('rp-'), createdAt: new Date().toISOString() };
    db.ratePeriods.push(p);
    audit(db, actor, 'rate_period', 'pricing', p.id, what);
    return p;
  });
}

/**
 * "These rooms cost X in these dates" (months or any dates), or `price: null` = back to the base
 * price there. Older per-room prices of those rooms in those dates are replaced, not stacked.
 */
export function setPeriodPrice(input: { roomIds: string[]; ranges: { from: string; to: string }[]; price: number | null; cash?: number | null; label?: string }, actor: string): { rooms: number; ranges: number } {
  const ranges = input.ranges.filter((r) => isValidISODate(r.from) && isValidISODate(r.to) && r.to > r.from);
  if (!ranges.length || ranges.length !== input.ranges.length) throw new RoomError('Periodo non valido.');
  if (ranges.length > 24) throw new RoomError('Troppi periodi in una volta.');
  if (input.price !== null && !(input.price >= 1 && input.price <= 5000)) throw new RoomError('Prezzo tra 1 e 5000 €.');
  const cash = input.price !== null && typeof input.cash === 'number' ? Math.round(input.cash * 100) / 100 : null;
  if (cash !== null && !(cash >= 1 && cash <= input.price!)) throw new RoomError('Il prezzo in contanti deve essere tra 1 € e il prezzo con carta.');
  return mutate((db) => {
    const ids = [...new Set(input.roomIds)].filter((id) => db.rooms.some((r) => r.id === id));
    if (!ids.length) throw new RoomError('Scegli almeno una camera.');
    const now = new Date().toISOString();
    for (const r of ranges) {
      db.ratePeriods = carveRooms(db.ratePeriods, ids, r.from, r.to, () => newId('rp-'));
      if (input.price !== null) db.ratePeriods.push({ id: newId('rp-'), label: input.label?.trim() || periodLabel(r.from, r.to), from: r.from, to: r.to, roomIds: ids, mode: 'fixed', value: Math.round(input.price * 100) / 100, ...(cash !== null ? { cash } : {}), createdAt: now });
    }
    const rooms = ids.map((id) => db.rooms.find((x) => x.id === id)!.number).join(', ');
    audit(db, actor, input.price === null ? 'rate_period_delete' : 'rate_period', 'pricing', null, `${ids.length === 1 ? 'Camera' : 'Camere'} ${rooms}: ${ranges.map((r) => periodLabel(r.from, r.to)).join(' + ')} → ${input.price === null ? 'prezzo base' : `€ ${input.price}${cash !== null ? ` · contanti € ${cash}` : ''}`}`);
    return { rooms: ids.length, ranges: ranges.length };
  });
}

/** "agosto 2027", "luglio – agosto 2027" or "12 ago → 15 ago" (last night shown). */
export function periodLabel(from: string, to: string): string {
  const whole = from.endsWith('-01') && to.endsWith('-01');
  if (whole) {
    const last = addDays(to, -1);
    const a = fmtDate(from, 'it', { month: 'long' });
    const b = fmtDate(last, 'it', { month: 'long', year: 'numeric' });
    return from.slice(0, 7) === last.slice(0, 7) ? b : `${a} – ${b}`;
  }
  return `${fmtDate(from)} → ${fmtDate(addDays(to, -1))}`;
}

export function removeRatePeriod(id: string, actor: string): void {
  mutate((db) => {
    const p = db.ratePeriods.find((x) => x.id === id);
    db.ratePeriods = db.ratePeriods.filter((x) => x.id !== id);
    audit(db, actor, 'rate_period_delete', 'pricing', id, p ? `${p.label} rimosso` : 'rimosso');
  });
}

export function saveTranslation(roomId: string, lang: Exclude<Locale, 'it'>, text: RoomText, opts: { approve: boolean; manual: boolean }, actor: string): void {
  mutate((db) => {
    const r = db.rooms.find((x) => x.id === roomId);
    if (!r) throw new RoomError('Camera non trovata.');
    const prev = r.translations[lang];
    r.translations[lang] = {
      ...text,
      status: opts.approve ? 'tradotto' : 'da_verificare',
      manual: opts.manual || Boolean(prev?.manual && !opts.approve ? prev.manual : opts.manual),
      updatedAt: new Date().toISOString(),
      published: opts.approve ? { ...text } : (prev?.published ?? null),
    };
    r.updatedAt = new Date().toISOString();
    audit(db, actor, opts.approve ? 'translation_publish' : 'translation_draft', 'room', r.id, `Camera ${r.number} · ${lang.toUpperCase()}`);
  });
}
