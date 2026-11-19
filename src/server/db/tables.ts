import { createHash } from 'node:crypto';
import type { AppNotification, AssistantLogEntry, AuditEntry, Block, Booking, Campaign, DB, Feedback, GuestMessage, OutboxEmail, Payment, PendingAction, Promotion, RatePeriod, Room, Task, User } from '@/lib/types';
import { isBookingActive } from '@/lib/availability';
import { isValidISODate, rangesOverlap } from '@/lib/dates';

/**
 * The hotel's document (src/lib/types.ts → DB) laid out as rows of real tables
 * (supabase/hotel-tables.sql). Pure functions, no network: the site's exporter
 * (tables-sync.ts), the back-fill script and the tests all use the same mapping.
 *
 * Every mapper takes its object apart field by field and hands what is left to `all()`:
 * when someone adds a field to a type and forgets it here, TypeScript refuses to compile.
 * tests/tables.test.ts then checks the column names against the SQL file.
 */

/** Tables with their primary key columns, parents before children (same order as hotel_tables() in SQL). */
export const TABLES = {
  hotel_meta: ['id'],
  settings: ['id'],
  staff_users: ['id'],
  rooms: ['id'],
  room_photos: ['room_id', 'id'],
  room_translations: ['room_id', 'locale'],
  rate_periods: ['id'],
  bookings: ['id'],
  room_blocks: ['id'],
  payments: ['id'],
  outbox: ['id'],
  notifications: ['id'],
  audit_log: ['id'],
  channel_state: ['id'],
  telegram_state: ['id'],
  telegram_links: ['chat_id'],
  pending_actions: ['id'],
  assistant_log: ['id'],
  promotions: ['id'],
  feedback: ['id'],
  review_replies: ['review_id', 'id'],
  guest_messages: ['id'],
  tasks: ['id'],
  campaigns: ['id'],
  unsubscribed: ['email'],
  hotel_list_order: ['list'],
} as const satisfies Record<string, readonly string[]>;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

type SortKey = readonly [column: string, direction: 'asc' | 'desc', kind?: 'number'];
/**
 * The lists of the document whose order is part of the data: the table that holds their rows, the
 * column with the id the document uses, and the order the rows are given when nothing else is known
 * (oldest first where the site appends, newest first where it prepends). Only columns the site
 * itself writes may be used here: the exporter and the reader must come to the same order.
 */
export const LISTS = {
  users: { table: 'staff_users', id: 'id', sort: [['created_at', 'asc']] },
  rooms: { table: 'rooms', id: 'id', sort: [['sort_order', 'asc', 'number'], ['created_at', 'asc']] },
  bookings: { table: 'bookings', id: 'id', sort: [['created_at', 'asc']] },
  blocks: { table: 'room_blocks', id: 'id', sort: [['created_at', 'asc']] },
  ratePeriods: { table: 'rate_periods', id: 'id', sort: [['created_at', 'asc']] },
  payments: { table: 'payments', id: 'id', sort: [['created_at', 'asc']] },
  outbox: { table: 'outbox', id: 'id', sort: [['created_at', 'desc']] },
  notifications: { table: 'notifications', id: 'id', sort: [['created_at', 'desc']] },
  audit: { table: 'audit_log', id: 'id', sort: [['at', 'desc']] },
  linkedChats: { table: 'telegram_links', id: 'chat_id', sort: [['linked_at', 'asc']] },
  pendingActions: { table: 'pending_actions', id: 'id', sort: [['created_at', 'asc']] },
  assistantLog: { table: 'assistant_log', id: 'id', sort: [['at', 'asc']] },
  promotions: { table: 'promotions', id: 'id', sort: [] },
  feedback: { table: 'feedback', id: 'id', sort: [['created_at', 'desc']] },
  messages: { table: 'guest_messages', id: 'id', sort: [['created_at', 'desc']] },
  tasks: { table: 'tasks', id: 'id', sort: [['created_at', 'desc']] },
  campaigns: { table: 'campaigns', id: 'id', sort: [['created_at', 'desc']] },
  unsubscribed: { table: 'unsubscribed', id: 'email', sort: [] },
} as const satisfies Record<string, { table: TableName; id: string; sort: readonly SortKey[] }>;

export type ListName = keyof typeof LISTS;
export const LIST_NAMES = Object.keys(LISTS) as ListName[];

export type Row = Record<string, unknown>;
export type Keys = Record<string, string>;
export type TableRows = Record<TableName, Row[]>;
/** table → (primary key → fingerprint of the row): what the tables are known to contain */
export type Snapshot = Record<TableName, Map<string, string>>;
/** the argument of hotel_sync() in SQL */
export type SyncPayload = { upsert?: Partial<Record<TableName, Row[]>>; delete?: Partial<Record<TableName, Keys[]>>; keep?: Partial<Record<TableName, Keys[]>> };

/** Compile-time proof that every field was mapped: what is left after destructuring must be empty. */
const all = (_rest: Record<string, never>): void => {};

/** optional timestamps and dates: anything PostgreSQL would refuse becomes null instead of breaking the copy */
const ts = (v: string | null | undefined): string | null => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? v : null);
const day = (v: string | null | undefined): string | null => (isValidISODate(v) ? v : null);

function userRow(u: User): Row {
  const { id, email, name, role, passwordHash, createdAt, twoFactor, ...rest } = u;
  all(rest);
  return { id, email, name, role, password_hash: passwordHash, created_at: createdAt, two_factor: twoFactor ?? null };
}

function roomRows(r: Room): { room: Row; photos: Row[]; translations: Row[] } {
  const { id, number, numberAuto, slug, name, type, maxGuests, beds, bedsCount, bedConfig, size, floor, basePrice, cashPrice, payment, status, hidden, photos, amenities, text, translations, sortOrder, createdAt, updatedAt, demo, ...rest } = r;
  all(rest);
  const { title, short, description, ...textRest } = text;
  all(textRest);
  return {
    room: { id, number, number_auto: numberAuto ?? null, slug, name, type, max_guests: maxGuests, beds, beds_count: bedsCount, bed_config: bedConfig ?? null, size_m2: size ?? null, floor, base_price: basePrice, cash_price: cashPrice ?? null, payment: payment ?? null, status, hidden, amenities: amenities ?? [], title, short_text: short, description, sort_order: sortOrder, created_at: createdAt, updated_at: updatedAt, is_demo: demo },
    photos: (photos ?? []).map((p, position) => {
      const { id: photoId, src, alt, width, height, demo: photoDemo, credit, ...photoRest } = p;
      all(photoRest);
      return { room_id: id, id: photoId, position, src, alt, width, height, is_demo: photoDemo, credit: credit ?? null };
    }),
    translations: Object.entries(translations ?? {}).flatMap(([locale, tr]) => {
      if (!tr) return [];
      const { title: trTitle, short: trShort, description: trDescription, status: trStatus, manual, updatedAt: trUpdatedAt, published, ...trRest } = tr;
      all(trRest);
      return [{ room_id: id, locale, title: trTitle, short_text: trShort, description: trDescription, status: trStatus, manual, updated_at: trUpdatedAt, published: published ?? null }];
    }),
  };
}

function ratePeriodRow(p: RatePeriod): Row {
  const { id, label, from, to, roomIds, mode, value, createdAt, cash, ...rest } = p;
  all(rest);
  return { id, label, date_from: from, date_to: to, room_ids: roomIds === 'all' ? null : roomIds, mode, value, created_at: createdAt, cash_price: cash ?? null };
}

function bookingRow(b: Booking, now: Date): Row {
  const { id, code, token, roomId, guest, adults, children, childrenAges, checkIn, checkOut, total, discount, promoCode, amountPaid, status, holdExpiresAt, source, otaRef, specialRequests, notes, consents, createdAt, updatedAt, cancelledAt, simulated, demo, paymentMethod, reviewRequestedAt, card, cardRequest, noShow, changeRequest, ...rest } = b;
  all(rest);
  const { firstName, lastName, email, phone, country, lang, ...guestRest } = guest;
  all(guestRest);
  const { privacy, terms, marketing, ...consentRest } = consents;
  all(consentRest);
  return {
    id, code, token, room_id: roomId ?? null,
    first_name: firstName, last_name: lastName, email, phone, country: country ?? null, lang: lang ?? null,
    adults, children, children_ages: childrenAges ?? [], check_in: checkIn, check_out: checkOut,
    total, discount, promo_code: promoCode ?? null, amount_paid: amountPaid, status,
    // the app's own rule (cancelled stays and expired payment holds free the room), evaluated at the moment of the export
    occupies_room: isBookingActive(b, now),
    hold_expires_at: ts(holdExpiresAt), source, ota_ref: otaRef ?? null, special_requests: specialRequests, notes,
    consent_privacy: privacy, consent_terms: terms, consent_marketing: marketing,
    payment_method: paymentMethod ?? null, review_requested_at: ts(reviewRequestedAt), simulated, is_demo: demo,
    created_at: createdAt, updated_at: updatedAt, cancelled_at: ts(cancelledAt),
    card: card ?? null, card_request: cardRequest ?? null, no_show: noShow ?? null, change_request: changeRequest ?? null,
  };
}

function blockRow(k: Block): Row {
  const { id, roomId, from, to, reason, createdBy, createdAt, source, extUid, ...rest } = k;
  all(rest);
  return { id, room_id: roomId, date_from: from, date_to: to, reason, created_by: createdBy, created_at: createdAt, source: source ?? null, ext_uid: extUid ?? null };
}

function paymentRow(p: Payment): Row {
  const { id, bookingId, amount, kind, provider, status, reference, createdAt, ...rest } = p;
  all(rest);
  return { id, booking_id: bookingId, amount, kind, provider, status, reference: reference ?? null, created_at: createdAt };
}

function outboxRow(e: OutboxEmail): Row {
  const { id, to, subject, template, html, text, bookingId, status, error, createdAt, sentAt, listUnsubscribe, ...rest } = e;
  all(rest);
  return { id, to_email: to, subject, template, html, text_body: text, booking_id: bookingId ?? null, status, error: error ?? null, created_at: createdAt, sent_at: ts(sentAt), list_unsubscribe: listUnsubscribe ?? null };
}

function notificationRow(n: AppNotification): Row {
  const { id, type, title, body, href, read, telegram, createdAt, ...rest } = n;
  all(rest);
  return { id, type, title, body, href: href ?? null, read, telegram, created_at: createdAt };
}

function auditRow(a: AuditEntry): Row {
  const { id, at, actor, action, entity, entityId, details, ...rest } = a;
  all(rest);
  return { id, at, actor, action, entity, entity_id: entityId ?? null, details };
}

function pendingActionRow(p: PendingAction): Row {
  const { id, channel, chatId, userId, tool, args, summary, createdAt, expiresAt, lang, ...rest } = p;
  all(rest);
  return { id, channel, chat_id: chatId ?? null, user_id: userId, tool, args: args ?? {}, summary, created_at: createdAt, expires_at: expiresAt, lang: lang ?? null };
}

function assistantLogRow(e: AssistantLogEntry): Row {
  const { id, userId, channel, role, text, pendingId, resolved, engine, voice, image, images, ui, at, ...rest } = e;
  all(rest);
  return { id, user_id: userId, channel, role, body: text, pending_id: pendingId ?? null, resolved: resolved ?? null, engine: engine ?? null, voice: voice ?? null, image: image ?? null, images: images ?? null, ui: ui ?? null, at };
}

function promotionRow(p: Promotion): Row {
  const { id, code, description, percent, validFrom, validTo, active, minNights, ...rest } = p;
  all(rest);
  return { id, code, description, percent, valid_from: day(validFrom), valid_to: day(validTo), active, min_nights: minNights };
}

function feedbackRows(f: Feedback): { feedback: Row; replies: Row[] } {
  const { email, id, bookingId, roomId, photos, translations, replies, verified, pending, editedAt, name, rating, comment, lang, publishConsent, showOnSite, demo, createdAt, ...rest } = f;
  all(rest);
  return {
    feedback: { id, booking_id: bookingId ?? null, room_id: roomId ?? null, email: email ?? null, name, rating, comment, lang, photos: photos ?? null, translations: translations ?? null, verified: verified ?? null, pending: pending ?? null, edited_at: ts(editedAt), publish_consent: publishConsent, show_on_site: showOnSite, is_demo: demo, created_at: createdAt },
    replies: (replies ?? []).map((r, position) => {
      const { id: replyId, author, name: replyName, email, text, lang: replyLang, translations: replyTranslations, createdAt: replyCreatedAt, ...replyRest } = r;
      all(replyRest);
      return { review_id: id, id: replyId, position, author, name: replyName, email: email ?? null, body: text, lang: replyLang, translations: replyTranslations ?? null, created_at: replyCreatedAt };
    }),
  };
}

function messageRow(m: GuestMessage): Row {
  const { id, bookingId, name, email, subject, body, source, read, createdAt, sender, ...rest } = m;
  all(rest);
  return { id, booking_id: bookingId ?? null, name, email, subject, body, source, read, created_at: createdAt, sender: sender ?? null };
}

function taskRow(t: Task): Row {
  const { id, label, done, createdAt, ...rest } = t;
  all(rest);
  return { id, label, done, created_at: createdAt };
}

function campaignRow(c: Campaign): Row {
  const { id, name, subject, headline, body, ctaLabel, ctaUrl, image, audience, selected, langs, translate, personal, theme, status, sentAt, recipients, createdAt, ...rest } = c;
  all(rest);
  return { id, name, subject, headline, body, cta_label: ctaLabel, cta_url: ctaUrl, image, audience, selected: selected ?? null, langs: langs ?? null, translate: translate ?? null, personal: personal ?? null, theme: theme ?? null, status, sent_at: ts(sentAt), recipients, created_at: createdAt };
}

function settingsRow(s: DB['settings']): Row {
  const { hotel, floors, payments, pricing, stripeConnect, notifications, services, reviews, customAmenities, faq, demoMode, panel, places, ...rest } = s;
  all(rest);
  // same defaults as normalize() in store.ts, for documents written by older versions of the site
  return {
    id: 1,
    hotel,
    floors,
    payments: { ...payments, cashDiscountPercent: payments.cashDiscountPercent ?? 5, allowCashAtHotel: payments.allowCashAtHotel ?? true, allowOnline: payments.allowOnline ?? true },
    pricing: { singleUsePercent: 20, board: 'room_only', ...(pricing ?? {}) },
    stripe_connect: stripeConnect ?? {},
    notifications,
    services: services ?? [],
    reviews: reviews ?? { autoRequest: true, delayDays: 1 },
    custom_amenities: customAmenities ?? [],
    faq: faq ?? [],
    demo_mode: demoMode,
    panel: panel ?? null,
    places: places ?? null,
  };
}

const instant = (v: unknown): number => {
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? 0 : t;
};

/**
 * The order a list gets from its rows alone: by id first (so the result never depends on the order
 * the rows arrive in), then by the list's own columns. The exporter and the reader both use this.
 */
export function defaultOrder(list: ListName, rows: Row[]): Row[] {
  const { id, sort }: { id: string; sort: readonly SortKey[] } = LISTS[list];
  const out = [...rows].sort((a, b) => {
    const x = String(a[id]);
    const y = String(b[id]);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (const [column, direction, kind] of [...sort].reverse()) {
    const value = (r: Row) => (kind === 'number' ? Number(r[column]) : instant(r[column]));
    out.sort((a, b) => (direction === 'asc' ? value(a) - value(b) : value(b) - value(a)));
  }
  return out;
}

/** The rows of a list in the order the document keeps them: the stored order when there is one, the default otherwise. */
export function inListOrder(list: ListName, rows: Row[], ids?: string[] | null): Row[] {
  const base = defaultOrder(list, rows);
  if (!ids?.length) return base;
  const { id } = LISTS[list];
  const position = new Map(ids.map((x, i) => [x, i]));
  const known = base.filter((r) => position.has(String(r[id]))).sort((a, b) => position.get(String(a[id]))! - position.get(String(b[id]))!);
  // a row the stored order does not know (it cannot happen while rows and order are written together) goes last
  return [...known, ...base.filter((r) => !position.has(String(r[id])))];
}

const keyText = (table: TableName, row: Row): string => TABLES[table].map((c) => String(row[c])).join('\u0001');
const keysOf = (table: TableName, key: string): Keys => {
  const parts = key.split('\u0001');
  return Object.fromEntries(TABLES[table].map((c, i) => [c, parts[i]!]));
};

/** The whole document as table rows. `now` decides which payment holds have run out (bookings.occupies_room). */
export function toTables(db: DB, now: Date = new Date()): TableRows {
  const { schemaVersion, version, seededAt, updatedAt, settings, users, rooms, bookings, blocks, ratePeriods, payments, outbox, notifications, audit, channel, telegram, pendingActions, promotions, feedback, messages, tasks, campaigns, unsubscribed, assistantLog, ...rest } = db;
  all(rest);
  const { providerName, status: channelStatus, lastSync, importedCount, log, mapping, calendars, icalKey, ...channelRest } = channel;
  all(channelRest);
  const { linkedChats, linkCode, lastTestAt, lastError, ...telegramRest } = telegram;
  all(telegramRest);

  const roomParts = rooms.map(roomRows);
  const feedbackParts = feedback.map(feedbackRows);
  const out: TableRows = {
    hotel_meta: [{ id: 1, schema_version: schemaVersion, version, seeded_at: seededAt, updated_at: updatedAt, synced_at: now.toISOString() }],
    settings: [settingsRow(settings)],
    staff_users: users.map(userRow),
    rooms: roomParts.map((x) => x.room),
    room_photos: roomParts.flatMap((x) => x.photos),
    room_translations: roomParts.flatMap((x) => x.translations),
    rate_periods: ratePeriods.map(ratePeriodRow),
    bookings: bookings.map((b) => bookingRow(b, now)),
    room_blocks: blocks.map(blockRow),
    payments: payments.map(paymentRow),
    outbox: outbox.map(outboxRow),
    notifications: notifications.map(notificationRow),
    audit_log: audit.map(auditRow),
    channel_state: [{ id: 1, provider_name: providerName, status: channelStatus, last_sync: ts(lastSync), imported_count: importedCount, log: log ?? [], mapping: mapping ?? [], calendars: calendars ?? null, ical_key: icalKey ?? null }],
    telegram_state: [{ id: 1, link_code: linkCode ?? null, last_test_at: ts(lastTestAt), last_error: lastError ?? null }],
    telegram_links: linkedChats.map((c) => {
      const { chatId, userId, name, linkedAt, ...chatRest } = c;
      all(chatRest);
      return { chat_id: chatId, user_id: userId, name, linked_at: linkedAt };
    }),
    pending_actions: pendingActions.map(pendingActionRow),
    assistant_log: (assistantLog ?? []).map(assistantLogRow),
    promotions: promotions.map(promotionRow),
    feedback: feedbackParts.map((x) => x.feedback),
    review_replies: feedbackParts.flatMap((x) => x.replies),
    guest_messages: messages.map(messageRow),
    tasks: tasks.map(taskRow),
    campaigns: (campaigns ?? []).map(campaignRow),
    unsubscribed: (unsubscribed ?? []).map((email) => ({ email })),
    hotel_list_order: [],
  };
  // one row per primary key (the last one wins): a duplicate would make the database refuse the whole change
  for (const t of TABLE_NAMES) {
    const byKey = new Map<string, Row>();
    for (const row of out[t]) byKey.set(keyText(t, row), row);
    if (byKey.size !== out[t].length) out[t] = [...byKey.values()];
  }
  // the order of a list is stored only when its rows alone would not give it back
  // (demo rows with invented dates, rows created in the same instant, lists without a date)
  for (const list of LIST_NAMES) {
    const { table, id } = LISTS[list];
    const ids = out[table].map((r) => String(r[id]));
    const natural = defaultOrder(list, out[table]);
    if (ids.some((x, i) => x !== String(natural[i]![id]))) out.hotel_list_order.push({ list, ids });
  }
  return out;
}

const fingerprint = (row: Row): string => createHash('sha1').update(JSON.stringify(row)).digest('base64');

export function snapshotOf(rows: TableRows): Snapshot {
  const snap = {} as Snapshot;
  for (const t of TABLE_NAMES) snap[t] = new Map(rows[t].map((r) => [keyText(t, r), fingerprint(r)]));
  return snap;
}

/** Everything: all rows, and for every table the list of keys to keep (whatever else is there is removed). */
export function fullPayload(rows: TableRows): SyncPayload {
  const keep: SyncPayload['keep'] = {};
  for (const t of TABLE_NAMES) keep[t] = rows[t].map((r) => keysOf(t, keyText(t, r)));
  return { upsert: rows, keep };
}

/** Only what changed since `prev`: new and modified rows, and the keys of the rows that disappeared. */
export function diffPayload(prev: Snapshot, rows: TableRows): { payload: SyncPayload; upserts: number; deletes: number } {
  const payload: Required<Pick<SyncPayload, 'upsert' | 'delete'>> = { upsert: {}, delete: {} };
  let upserts = 0;
  let deletes = 0;
  for (const t of TABLE_NAMES) {
    const before = prev[t];
    const seen = new Set<string>();
    const changed: Row[] = [];
    for (const row of rows[t]) {
      const k = keyText(t, row);
      seen.add(k);
      if (before.get(k) !== fingerprint(row)) changed.push(row);
    }
    const gone: Keys[] = [];
    for (const k of before.keys()) if (!seen.has(k)) gone.push(keysOf(t, k));
    if (changed.length) payload.upsert[t] = changed;
    if (gone.length) payload.delete[t] = gone;
    upserts += changed.length;
    deletes += gone.length;
  }
  return { payload, upserts, deletes };
}

export function rowCounts(rows: TableRows): Record<TableName, number> {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, rows[t].length])) as Record<TableName, number>;
}

/**
 * Things in the document the database would refuse (checked before a full copy, so the owner gets a
 * readable reason instead of a PostgreSQL error): stays that overlap, rows pointing at something
 * that no longer exists, repeated ids.
 */
export function documentIssues(db: DB, now: Date = new Date()): string[] {
  const issues: string[] = [];
  const dup = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const id of ids) (seen.has(id) ? twice : seen).add(id);
    if (twice.size) issues.push(`${label}: id ripetuti (${[...twice].slice(0, 5).join(', ')})`);
  };
  dup('camere', db.rooms.map((r) => r.id));
  dup('numeri camera', db.rooms.map((r) => r.number));
  dup('prenotazioni', db.bookings.map((b) => b.id));
  dup('codici prenotazione', db.bookings.map((b) => b.code));
  dup('pagamenti', db.payments.map((p) => p.id));

  const active = db.bookings.filter((b) => b.roomId && isBookingActive(b, now));
  const byRoom = new Map<string, Booking[]>();
  for (const b of active) byRoom.set(b.roomId!, [...(byRoom.get(b.roomId!) ?? []), b]);
  for (const list of byRoom.values()) {
    list.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!;
      const b = list[i]!;
      if (rangesOverlap(a.checkIn, a.checkOut, b.checkIn, b.checkOut)) issues.push(`doppia prenotazione nella camera ${a.roomId}: ${a.code} (${a.checkIn} → ${a.checkOut}) e ${b.code} (${b.checkIn} → ${b.checkOut})`);
    }
  }
  for (const b of db.bookings) if (!isValidISODate(b.checkIn) || !isValidISODate(b.checkOut) || b.checkOut <= b.checkIn) issues.push(`prenotazione ${b.code}: date non valide (${b.checkIn} → ${b.checkOut})`);

  const bookingIds = new Set(db.bookings.map((b) => b.id));
  const roomIds = new Set(db.rooms.map((r) => r.id));
  const userIds = new Set(db.users.map((u) => u.id));
  const orphans = (label: string, n: number) => {
    if (n) issues.push(`${label}: ${n} righe collegate a qualcosa che non esiste più`);
  };
  orphans('pagamenti', db.payments.filter((p) => !bookingIds.has(p.bookingId)).length);
  orphans('email', db.outbox.filter((e) => e.bookingId && !bookingIds.has(e.bookingId)).length);
  orphans('recensioni', db.feedback.filter((f) => f.bookingId && !bookingIds.has(f.bookingId)).length);
  orphans('messaggi', db.messages.filter((m) => m.bookingId && !bookingIds.has(m.bookingId)).length);
  orphans('blocchi camera', db.blocks.filter((k) => !roomIds.has(k.roomId)).length);
  orphans('chat Telegram', db.telegram.linkedChats.filter((c) => !userIds.has(c.userId)).length);
  orphans('azioni in attesa', db.pendingActions.filter((p) => !userIds.has(p.userId)).length);
  orphans('chat assistente', (db.assistantLog ?? []).filter((e) => !userIds.has(e.userId)).length);
  return issues;
}
