import type { AppNotification, AssistantLogEntry, AuditEntry, Block, Booking, Campaign, ChannelState, DB, Feedback, GuestMessage, Locale, OutboxEmail, Payment, PendingAction, Photo, Promotion, RatePeriod, ReviewReply, Room, RoomTranslation, Settings, Task, TelegramState, User } from '@/lib/types';
import { LISTS, inListOrder, type ListName, type Row, type TableRows } from './tables';

/**
 * Stage 3a of the move to real tables: the way back. `fromTables()` rebuilds the hotel's document
 * from the rows of supabase/hotel-tables.sql (the inverse of `toTables()` in tables.ts) and
 * `compareDocuments()` says exactly where the rebuilt document differs from the one the site uses.
 *
 * Nothing here is used to serve the site yet: the result is only compared and logged
 * (tables-sync.ts → shadowRead), so that reads can move to the tables once the two agree.
 */

const str = (v: unknown): string => (v == null ? '' : String(v));
const num = (v: unknown): number => Number(v);
const numN = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: unknown): boolean => v === true;
const strN = (v: unknown): string | null => (v == null ? null : String(v));
/** timestamps come back as "2026-11-12T18:17:36.902+00:00": the site writes "…902Z" */
const iso = (v: unknown): string => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
const isoN = (v: unknown): string | null => (v == null ? null : iso(v));
/** optional fields (`x?: T`) are left out when the column is null */
const opt = <K extends string, V>(key: K, v: unknown): { [P in K]?: V } => (v == null ? {} : ({ [key]: v } as { [P in K]?: V }));

/** Child rows (photos of a room, replies to a review) carry their position. */
function byPosition(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => Number(a.position) - Number(b.position));
}
function groupBy(rows: Row[], column: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const k = str(r[column]);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

function userOf(r: Row): User {
  return { id: str(r.id), email: str(r.email), name: str(r.name), role: r.role as User['role'], passwordHash: str(r.password_hash), createdAt: iso(r.created_at), ...opt<'twoFactor', User['twoFactor']>('twoFactor', r.two_factor) };
}

function photoOf(r: Row): Photo {
  return { id: str(r.id), src: str(r.src), alt: str(r.alt), width: num(r.width), height: num(r.height), demo: bool(r.is_demo), ...opt<'credit', string>('credit', r.credit) };
}

function roomOf(r: Row, photos: Row[], translations: Row[]): Room {
  return {
    id: str(r.id), number: str(r.number), slug: str(r.slug), name: str(r.name), type: r.type as Room['type'], maxGuests: num(r.max_guests), beds: str(r.beds), bedsCount: num(r.beds_count),
    ...opt<'bedConfig', NonNullable<Room['bedConfig']>>('bedConfig', r.bed_config),
    size: numN(r.size_m2), floor: r.floor as Room['floor'], basePrice: num(r.base_price), cashPrice: numN(r.cash_price), ...opt<'payment', NonNullable<Room['payment']>>('payment', r.payment), ...(r.number_auto ? { numberAuto: true } : {}), status: r.status as Room['status'], hidden: bool(r.hidden),
    photos: byPosition(photos).map(photoOf),
    amenities: (r.amenities as string[] | null) ?? [],
    text: { title: str(r.title), short: str(r.short_text), description: str(r.description) },
    translations: Object.fromEntries(translations.map((t): [string, RoomTranslation] => [str(t.locale), { title: str(t.title), short: str(t.short_text), description: str(t.description), status: t.status as RoomTranslation['status'], manual: bool(t.manual), updatedAt: iso(t.updated_at), published: (t.published as RoomTranslation['published']) ?? null }])),
    sortOrder: num(r.sort_order), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), demo: bool(r.is_demo),
  };
}

function ratePeriodOf(r: Row): RatePeriod {
  return { id: str(r.id), label: str(r.label), from: str(r.date_from), to: str(r.date_to), roomIds: r.room_ids == null ? 'all' : (r.room_ids as string[]), mode: r.mode as RatePeriod['mode'], value: num(r.value), createdAt: iso(r.created_at), ...(r.cash_price != null ? { cash: num(r.cash_price) } : {}) };
}

function bookingOf(r: Row): Booking {
  return {
    id: str(r.id), code: str(r.code), token: str(r.token), roomId: strN(r.room_id),
    guest: { firstName: str(r.first_name), lastName: str(r.last_name), email: str(r.email), phone: str(r.phone), ...opt<'country', string>('country', r.country), ...opt<'lang', Locale>('lang', r.lang) },
    adults: num(r.adults), children: num(r.children), childrenAges: (r.children_ages as number[] | null) ?? [], checkIn: str(r.check_in), checkOut: str(r.check_out),
    total: num(r.total), discount: num(r.discount), promoCode: strN(r.promo_code), amountPaid: num(r.amount_paid), status: r.status as Booking['status'],
    holdExpiresAt: isoN(r.hold_expires_at), source: r.source as Booking['source'], otaRef: strN(r.ota_ref), specialRequests: str(r.special_requests), notes: str(r.notes),
    consents: { privacy: bool(r.consent_privacy), terms: bool(r.consent_terms), marketing: bool(r.consent_marketing) },
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), cancelledAt: isoN(r.cancelled_at), simulated: bool(r.simulated), demo: bool(r.is_demo),
    ...opt<'paymentMethod', NonNullable<Booking['paymentMethod']>>('paymentMethod', r.payment_method),
    reviewRequestedAt: isoN(r.review_requested_at),
    ...opt<'card', NonNullable<Booking['card']>>('card', r.card), ...opt<'cardRequest', NonNullable<Booking['cardRequest']>>('cardRequest', r.card_request),
    ...opt<'noShow', NonNullable<Booking['noShow']>>('noShow', r.no_show), ...opt<'changeRequest', NonNullable<Booking['changeRequest']>>('changeRequest', r.change_request),
  };
}

function blockOf(r: Row): Block {
  return { id: str(r.id), roomId: str(r.room_id), from: str(r.date_from), to: str(r.date_to), reason: str(r.reason), createdBy: str(r.created_by), createdAt: iso(r.created_at), ...opt<'source', NonNullable<Block['source']>>('source', r.source), ...opt<'extUid', string>('extUid', r.ext_uid) };
}

function paymentOf(r: Row): Payment {
  return { id: str(r.id), bookingId: str(r.booking_id), amount: num(r.amount), kind: r.kind as Payment['kind'], provider: r.provider as Payment['provider'], status: r.status as Payment['status'], reference: strN(r.reference), createdAt: iso(r.created_at) };
}

function outboxOf(r: Row): OutboxEmail {
  return { id: str(r.id), to: str(r.to_email), subject: str(r.subject), template: r.template as OutboxEmail['template'], html: str(r.html), text: str(r.text_body), bookingId: strN(r.booking_id), status: r.status as OutboxEmail['status'], error: strN(r.error), createdAt: iso(r.created_at), sentAt: isoN(r.sent_at), ...opt<'listUnsubscribe', string>('listUnsubscribe', r.list_unsubscribe) };
}

function notificationOf(r: Row): AppNotification {
  return { id: str(r.id), type: r.type as AppNotification['type'], title: str(r.title), body: str(r.body), href: strN(r.href), read: bool(r.read), telegram: r.telegram as AppNotification['telegram'], createdAt: iso(r.created_at) };
}

function auditOf(r: Row): AuditEntry {
  return { id: str(r.id), at: iso(r.at), actor: str(r.actor), action: str(r.action), entity: str(r.entity), entityId: strN(r.entity_id), details: str(r.details) };
}

function pendingActionOf(r: Row): PendingAction {
  return { id: str(r.id), channel: r.channel as PendingAction['channel'], chatId: strN(r.chat_id), userId: str(r.user_id), tool: str(r.tool), args: (r.args as Record<string, unknown> | null) ?? {}, summary: str(r.summary), createdAt: iso(r.created_at), expiresAt: iso(r.expires_at), ...opt<'lang', Locale>('lang', r.lang) };
}

function assistantLogOf(r: Row): AssistantLogEntry {
  return {
    id: str(r.id), userId: str(r.user_id), channel: r.channel as AssistantLogEntry['channel'], role: r.role as AssistantLogEntry['role'], text: str(r.body),
    ...opt<'pendingId', string>('pendingId', r.pending_id), ...opt<'resolved', boolean>('resolved', r.resolved), ...opt<'engine', string>('engine', r.engine), ...opt<'voice', boolean>('voice', r.voice),
    ...opt<'image', string>('image', r.image), ...opt<'images', string[]>('images', r.images), ...opt<'ui', NonNullable<AssistantLogEntry['ui']>>('ui', r.ui),
    at: iso(r.at),
  };
}

function promotionOf(r: Row): Promotion {
  return { id: str(r.id), code: str(r.code), description: str(r.description), percent: num(r.percent), validFrom: str(r.valid_from), validTo: str(r.valid_to), active: bool(r.active), minNights: num(r.min_nights) };
}

function replyOf(r: Row): ReviewReply {
  return { id: str(r.id), author: r.author as ReviewReply['author'], name: str(r.name), ...opt<'email', string>('email', r.email), text: str(r.body), lang: r.lang as Locale, ...opt<'translations', NonNullable<ReviewReply['translations']>>('translations', r.translations), createdAt: iso(r.created_at) };
}

function feedbackOf(r: Row, replies: Row[]): Feedback {
  return {
    id: str(r.id), bookingId: strN(r.booking_id), roomId: strN(r.room_id), ...opt<'email', string>('email', r.email),
    ...opt<'photos', string[]>('photos', r.photos), ...opt<'translations', NonNullable<Feedback['translations']>>('translations', r.translations),
    replies: byPosition(replies).map(replyOf),
    ...opt<'verified', boolean>('verified', r.verified), ...opt<'pending', boolean>('pending', r.pending), editedAt: isoN(r.edited_at),
    name: str(r.name), rating: num(r.rating), comment: str(r.comment), lang: r.lang as Locale, publishConsent: bool(r.publish_consent), showOnSite: bool(r.show_on_site), demo: bool(r.is_demo), createdAt: iso(r.created_at),
  };
}

function messageOf(r: Row): GuestMessage {
  return { id: str(r.id), bookingId: strN(r.booking_id), name: str(r.name), email: str(r.email), subject: str(r.subject), body: str(r.body), source: r.source as GuestMessage['source'], read: bool(r.read), createdAt: iso(r.created_at), ...opt<'sender', NonNullable<GuestMessage['sender']>>('sender', r.sender) };
}

function taskOf(r: Row): Task {
  return { id: str(r.id), label: str(r.label), done: bool(r.done), createdAt: iso(r.created_at) };
}

function campaignOf(r: Row): Campaign {
  return {
    id: str(r.id), name: str(r.name), subject: str(r.subject), headline: str(r.headline), body: str(r.body), ctaLabel: str(r.cta_label), ctaUrl: str(r.cta_url), image: str(r.image), audience: r.audience as Campaign['audience'],
    ...opt<'selected', string[]>('selected', r.selected), ...opt<'langs', Locale[]>('langs', r.langs), ...opt<'translate', boolean>('translate', r.translate), ...opt<'personal', boolean>('personal', r.personal), ...opt<'theme', NonNullable<Campaign['theme']>>('theme', r.theme),
    status: r.status as Campaign['status'], sentAt: isoN(r.sent_at), recipients: num(r.recipients), createdAt: iso(r.created_at),
  };
}

/**
 * The document rebuilt from table rows. Lists are put back in the order the site keeps them: the
 * order stored in hotel_list_order when there is one, otherwise the order their own columns give
 * (oldest first where the site appends, newest first where it prepends). On a database that does
 * not have hotel_list_order yet, lists whose order cannot be told from the dates can come back in
 * a different order: compareDocuments() reports that.
 */
export function fromTables(t: TableRows): DB {
  const meta = t.hotel_meta[0];
  const s = t.settings[0];
  const channel = t.channel_state[0];
  const telegram = t.telegram_state[0];
  if (!meta || !s || !channel || !telegram) throw new Error('Le tabelle sono vuote: manca la riga di hotel_meta, settings, channel_state o telegram_state.');
  const photos = groupBy(t.room_photos, 'room_id');
  const translations = groupBy(t.room_translations, 'room_id');
  const replies = groupBy(t.review_replies, 'review_id');
  const stored = new Map((t.hotel_list_order ?? []).map((r) => [str(r.list), r.ids as string[]]));
  const list = (name: ListName): Row[] => inListOrder(name, t[LISTS[name].table], stored.get(name));
  const settings: Settings = {
    hotel: s.hotel as Settings['hotel'], floors: s.floors as Settings['floors'], payments: s.payments as Settings['payments'], pricing: s.pricing as Settings['pricing'], stripeConnect: s.stripe_connect as Settings['stripeConnect'],
    notifications: s.notifications as Settings['notifications'], services: s.services as Settings['services'], reviews: s.reviews as Settings['reviews'], customAmenities: s.custom_amenities as Settings['customAmenities'], faq: s.faq as Settings['faq'], demoMode: bool(s.demo_mode),
    ...opt<'panel', NonNullable<Settings['panel']>>('panel', s.panel),
  };
  const channelState: ChannelState = { providerName: str(channel.provider_name), status: channel.status as ChannelState['status'], lastSync: isoN(channel.last_sync), importedCount: num(channel.imported_count), log: channel.log as ChannelState['log'], mapping: channel.mapping as ChannelState['mapping'], ...opt<'calendars', NonNullable<ChannelState['calendars']>>('calendars', channel.calendars), ...opt<'icalKey', string>('icalKey', channel.ical_key) };
  const telegramState: TelegramState = {
    linkedChats: list('linkedChats').map((r) => ({ chatId: str(r.chat_id), userId: str(r.user_id), name: str(r.name), linkedAt: iso(r.linked_at) })),
    linkCode: (telegram.link_code as TelegramState['linkCode']) ?? null, lastTestAt: isoN(telegram.last_test_at), lastError: strN(telegram.last_error),
  };
  return {
    schemaVersion: num(meta.schema_version), version: num(meta.version), seededAt: iso(meta.seeded_at), updatedAt: iso(meta.updated_at),
    settings,
    users: list('users').map(userOf),
    rooms: list('rooms').map((r) => roomOf(r, photos.get(str(r.id)) ?? [], translations.get(str(r.id)) ?? [])),
    bookings: list('bookings').map(bookingOf),
    blocks: list('blocks').map(blockOf),
    ratePeriods: list('ratePeriods').map(ratePeriodOf),
    payments: list('payments').map(paymentOf),
    outbox: list('outbox').map(outboxOf),
    notifications: list('notifications').map(notificationOf),
    audit: list('audit').map(auditOf),
    channel: channelState,
    telegram: telegramState,
    pendingActions: list('pendingActions').map(pendingActionOf),
    promotions: list('promotions').map(promotionOf),
    feedback: list('feedback').map((r) => feedbackOf(r, replies.get(str(r.id)) ?? [])),
    messages: list('messages').map(messageOf),
    tasks: list('tasks').map(taskOf),
    campaigns: list('campaigns').map(campaignOf),
    unsubscribed: list('unsubscribed').map((r) => str(r.email)),
    assistantLog: list('assistantLog').map(assistantLogOf),
  };
}

export type Difference = { path: string; document: unknown; tables: unknown };
export type Comparison = {
  /** a value that really differs, a row that is missing or one too many: must be empty before reads can move */
  real: Difference[];
  /** the same value written differently: a date-only timestamp read back as a full one, an empty list for a missing one */
  format: Difference[];
  /** lists that come back complete but in a different order than the document keeps them */
  order: { list: string; rows: number; outOfPlace: number }[];
};

const isEmpty = (v: unknown): boolean => (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && v !== null && Object.keys(v).length === 0);
const looksLikeDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}/.test(v);
const brief = (v: unknown): unknown => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 77)}…` : Array.isArray(v) ? `[${v.length} elementi]` : typeof v === 'object' && v !== null ? '{…}' : v === undefined ? null : v);

function deepDiff(path: string, a: unknown, b: unknown, out: Comparison): void {
  if (a === b || (a == null && b == null)) return; // null and "not there" mean the same to the site
  if (a == null || b == null) {
    (isEmpty(a ?? b) ? out.format : out.real).push({ path, document: brief(a), tables: brief(b) });
    return;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-9) out.real.push({ path, document: a, tables: b });
    return;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    const sameInstant = looksLikeDate(a) && looksLikeDate(b) && !Number.isNaN(Date.parse(a)) && Date.parse(a) === Date.parse(b);
    (sameInstant ? out.format : out.real).push({ path, document: brief(a), tables: brief(b) });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.real.push({ path, document: `${a.length} elementi`, tables: `${b.length} elementi` });
      return;
    }
    a.forEach((x, i) => deepDiff(`${path}[${i}]`, x, b[i], out));
    return;
  }
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) deepDiff(path ? `${path}.${k}` : k, ao[k], bo[k], out);
    return;
  }
  out.real.push({ path, document: brief(a), tables: brief(b) });
}

/** Rows of a list are matched by their id, so a different order never hides (or fakes) a different value. */
function diffList<T>(name: string, doc: T[], tab: T[], idOf: (x: T) => string, out: Comparison): void {
  const inTables = new Map(tab.map((x) => [idOf(x), x]));
  const inDocument = new Set(doc.map(idOf));
  for (const x of doc) {
    const other = inTables.get(idOf(x));
    if (other === undefined) out.real.push({ path: `${name}[${idOf(x)}]`, document: 'presente', tables: 'assente' });
    else deepDiff(`${name}[${idOf(x)}]`, x, other, out);
  }
  for (const x of tab) if (!inDocument.has(idOf(x))) out.real.push({ path: `${name}[${idOf(x)}]`, document: 'assente', tables: 'presente' });
  const a = doc.map(idOf).filter((id) => inTables.has(id));
  const b = tab.map(idOf).filter((id) => inDocument.has(id));
  const outOfPlace = a.filter((id, i) => b[i] !== id).length;
  if (outOfPlace) out.order.push({ list: name, rows: a.length, outOfPlace });
}

/** Where the document rebuilt from the tables differs from the document the site uses. */
export function compareDocuments(document: DB, rebuilt: DB): Comparison {
  const out: Comparison = { real: [], format: [], order: [] };
  const split = (db: DB) => {
    const { users, rooms, bookings, blocks, ratePeriods, payments, outbox, notifications, audit, pendingActions, promotions, feedback, messages, tasks, campaigns, unsubscribed, assistantLog, telegram, ...rest } = db;
    const { linkedChats, ...telegramRest } = telegram;
    return { lists: { users, rooms, bookings, blocks, ratePeriods, payments, outbox, notifications, audit, pendingActions, promotions, feedback, messages, tasks, campaigns, assistantLog }, unsubscribed: unsubscribed ?? [], linkedChats, rest: { ...rest, telegram: telegramRest } };
  };
  const a = split(document);
  const b = split(rebuilt);
  deepDiff('', a.rest, b.rest, out);
  for (const name of Object.keys(a.lists) as (keyof typeof a.lists)[]) diffList<{ id: string }>(name, a.lists[name] ?? [], b.lists[name] ?? [], (x) => x.id, out);
  diffList('telegram.linkedChats', a.linkedChats, b.linkedChats, (x) => x.chatId, out);
  diffList('unsubscribed', a.unsubscribed, b.unsubscribed, (x) => x, out);
  return out;
}
