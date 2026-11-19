export const LOCALES = ['it', 'en', 'pl', 'de', 'fr', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export type FloorKey = 'terra' | 'superiore' | 'inferiore';
export type RoomStatus = 'available' | 'unavailable' | 'draft';
export type RoomType = 'singola' | 'doppia' | 'matrimoniale' | 'tripla' | 'family' | 'suite';
export type TranslationStatus = 'da_tradurre' | 'da_verificare' | 'tradotto';

export interface RoomText {
  title: string;
  short: string;
  description: string;
}

export interface RoomTranslation extends RoomText {
  status: TranslationStatus;
  /** true when the owner edited this language by hand: auto-translation must not overwrite it silently */
  manual: boolean;
  updatedAt: string;
  /** what the public site shows; set when the owner approves */
  published: RoomText | null;
}

export interface Photo {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  /** demo/stock photo, not the real hotel */
  demo: boolean;
  credit?: string;
}

export type BedKind = 'matrimoniale' | 'francese' | 'singolo' | 'divano_letto' | 'castello' | 'culla';

export interface Room {
  id: string;
  number: string;
  slug: string;
  name: string;
  type: RoomType;
  maxGuests: number;
  beds: string;
  bedsCount: number;
  /** structured beds ("1 matrimoniale + 1 singolo"); `beds` is the readable text derived from it */
  bedConfig?: { kind: BedKind; count: number }[];
  size: number | null;
  floor: FloorKey;
  basePrice: number;
  /** price per night when the guest pays cash at the hotel (null = global cash discount) */
  cashPrice?: number | null;
  /** how guests can pay for this room: card online, cash at the hotel, or both (default) */
  payment?: 'both' | 'card' | 'cash';
  status: RoomStatus;
  hidden: boolean;
  photos: Photo[];
  amenities: string[];
  /** Italian is the source language and is always published on save */
  text: RoomText;
  translations: Partial<Record<Exclude<Locale, 'it'>, RoomTranslation>>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
}

export type BookingStatus = 'confirmed' | 'pending_payment' | 'cancelled';
export type BookingSource = 'sito' | 'telefono' | 'email' | 'walkin' | 'booking' | 'expedia' | 'altro_ota';

export interface Guest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country?: string;
  /** language the guest used on the website (emails are translated into it) */
  lang?: Locale;
}

export interface Booking {
  id: string;
  code: string;
  token: string;
  roomId: string | null;
  guest: Guest;
  adults: number;
  children: number;
  childrenAges: number[];
  checkIn: string; // YYYY-MM-DD, first occupied night
  checkOut: string; // YYYY-MM-DD, not an occupied night
  total: number;
  discount: number;
  promoCode: string | null;
  amountPaid: number;
  status: BookingStatus;
  holdExpiresAt: string | null;
  source: BookingSource;
  otaRef: string | null;
  specialRequests: string;
  notes: string;
  consents: { privacy: boolean; terms: boolean; marketing: boolean };
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  simulated: boolean;
  demo: boolean;
  paymentMethod?: 'card' | 'cash' | 'transfer' | 'ota';
  /** when the "rate your room" email was sent */
  reviewRequestedAt?: string | null;
  /** the guest's card kept with the booking (no-show fee, late cancellation, balance) */
  card?: SavedCard | null;
  /** the hotel asked the guest for a new card (the old one was refused / expired) */
  cardRequest?: CardRequest | null;
  /** the guest did not arrive: marked by the hotel, with the fee charged or waived */
  noShow?: NoShow | null;
  /** new dates proposed by the hotel or asked by the guest, or a free cancellation asked by the guest */
  changeRequest?: ChangeRequest | null;
}

export interface SavedCard {
  /** payment service ids (never the card number) */
  customer: string;
  paymentMethod: string;
  brand: string;
  last4: string;
  /** MM/YY */
  exp: string;
  /** saved with test or real payments (a test card can only be charged with test payments) */
  mode: 'test' | 'live';
  savedAt: string;
}

export interface CardRequest {
  at: string;
  by: string;
  /** the guest has to update the card before this moment */
  deadline: string;
  /** euro the guest pays with the new card (0 = only the card is updated, nothing is charged) */
  amount: number;
  /** why, in Italian (shown to the owner) */
  reason: string;
  /** the booking is cancelled when the deadline passes without a new card */
  cancelOnExpiry: boolean;
  doneAt?: string | null;
  /** 'done' = new card received · 'expired' = deadline passed · 'withdrawn' = the hotel took it back */
  outcome?: 'done' | 'expired' | 'withdrawn' | null;
}

export interface NoShow {
  at: string;
  by: string;
  /** the fee asked for the missed stay */
  fee: number;
  /** charged = the fee is kept/charged · waived = no fee, money given back · due = fee still to collect */
  outcome: 'charged' | 'waived' | 'due';
}

export interface ChangeRequest {
  id: string;
  kind: 'dates' | 'free_cancel';
  /** who asked: the other side answers */
  by: 'hotel' | 'guest';
  checkIn: string;
  checkOut: string;
  roomId: string | null;
  /** price of the stay with the new dates */
  total: number;
  note: string;
  at: string;
  status: 'pending' | 'accepted' | 'refused' | 'withdrawn';
  answeredAt?: string | null;
  answer?: string;
}

export interface Block {
  id: string;
  roomId: string;
  from: string;
  to: string; // exclusive
  reason: string;
  createdBy: string;
  createdAt: string;
  /** set when the nights come from a portal's calendar (iCal sync) */
  source?: 'booking' | 'expedia' | 'airbnb' | 'altro';
  /** "<calendar id>:<event uid>" for blocks created by the calendar sync */
  extUid?: string;
}

export interface RatePeriod {
  id: string;
  label: string;
  from: string;
  to: string; // exclusive
  roomIds: string[] | 'all';
  mode: 'fixed' | 'percent';
  value: number;
  /** fixed periods: the cash price of a night (the hotel's own price list); none = card price minus the usual cash discount */
  cash?: number | null;
  createdAt: string;
}

export type PaymentKind = 'deposit' | 'full' | 'balance' | 'refund';
export type PaymentProvider = 'stripe' | 'stripe_test' | 'simulazione' | 'contanti' | 'bonifico' | 'ota' | 'pos';

export interface Payment {
  id: string;
  bookingId: string;
  amount: number;
  kind: PaymentKind;
  provider: PaymentProvider;
  status: 'succeeded' | 'failed' | 'pending';
  reference: string | null;
  createdAt: string;
}

export type EmailTemplate =
  | 'conferma'
  | 'promemoria'
  | 'modifica'
  | 'cancellazione'
  | 'rimborso'
  | 'ringraziamento'
  | 'offerta_ritorno'
  | 'richiesta_ospite'
  | 'richiesta_recensione'
  | 'codice_accesso'
  | 'campagna'
  | 'messaggio_hotel'
  | 'no_show'
  | 'carta_da_aggiornare'
  | 'richiesta_modifica'
  | 'risposta_modifica';

export interface OutboxEmail {
  id: string;
  to: string;
  subject: string;
  template: EmailTemplate;
  html: string;
  text: string;
  bookingId: string | null;
  status: 'demo_outbox' | 'sent' | 'failed';
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  /** one-click unsubscribe URL (marketing emails only) */
  listUnsubscribe?: string;
}

export type NotificationType =
  | 'nuova_prenotazione'
  | 'nuovo_pagamento'
  | 'prenotazione_cancellata'
  | 'nuovo_arrivo'
  | 'partenza_oggi'
  | 'pagamento_non_completato'
  | 'camera_da_controllare'
  | 'errore_sincronizzazione'
  | 'messaggio_ospite'
  | 'report_giornaliero';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  telegram: 'non_configurato' | 'disattivato' | 'inviato' | 'errore' | 'in_coda';
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: string;
}

export type Role = 'admin' | 'staff';

/**
 * The second step of the login: a 6-digit code from an authenticator app (Google Authenticator,
 * Microsoft Authenticator…). Never sent to the browser.
 */
export interface TwoFactor {
  /** the app's key, sealed with the site's secret (see server/auth/totp.ts) */
  secret: string;
  enabledAt: string;
  /** emergency codes, one use each, stored only as fingerprints */
  recovery: string[];
  /** the last 30-second step accepted: the same code cannot be used twice */
  lastStep?: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  createdAt: string;
  twoFactor?: TwoFactor;
}

export interface Settings {
  hotel: {
    name: string;
    stars: number;
    tagline: string;
    addressLine: string;
    postalCode: string;
    city: string;
    province: string;
    country: string;
    addressVerified: boolean;
    lat: number;
    lng: number;
    phone: string;
    /** WhatsApp number for bookings */
    whatsapp?: string;
    email: string;
    /** partita IVA */
    vat?: string;
    cin: string;
    checkInFrom: string;
    checkInTo: string;
    checkOutBy: string;
    factsVerified: boolean;
    googleReviewUrl: string;
  };
  floors: { enableLower: boolean };
  payments: {
    mode: 'full' | 'deposit_percent' | 'deposit_fixed';
    depositPercent: number;
    depositFixed: number;
    /** free cancellation until 00:00 (hotel time) of the day that falls this many days before arrival */
    freeCancellationDays: number;
    /** what cancelling costs from that midnight on (default: the whole stay) */
    cancellationFee?: { type: 'percent' | 'first_night' | 'fixed'; value: number };
    cancellationPolicy: string;
    refundPolicy: string;
    holdMinutes: number;
    /** discount for paying cash at the hotel (Italy forbids card surcharges, so the difference is a cash discount) */
    cashDiscountPercent: number;
    allowCashAtHotel: boolean;
    /** card / online payment offered on the site (false = guests only pay at the hotel) */
    allowOnline?: boolean;
    /** guests who pay cash at the hotel leave a card as a guarantee (nothing is charged) */
    cardGuarantee?: boolean;
  };
  /** tariff rules the owner can change in Prezzi */
  pricing?: {
    /** "Uso singola": discount when ONE guest takes a double or twin room (0 = off) */
    singleUsePercent: number;
    /** what the price includes */
    board: 'room_only' | 'breakfast';
    /** the town's tax per adult and night, paid at the hotel (lib/tourist-tax.ts) */
    touristTax?: { enabled: boolean; amount: number; from: string; to: string; maxNights: number };
  };
  stripeConnect: {
    accountId: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    payoutInterval: 'daily' | 'weekly' | 'monthly';
    weeklyAnchor: string;
    monthlyAnchor: number;
    updatedAt: string | null;
    /** demo only: the onboarding was simulated (no Stripe platform key) */
    simulated: boolean;
    businessName: string | null;
    bankLast4: string | null;
    requirements: string[];
  };
  notifications: Record<NotificationType, boolean>;
  services: { key: string; label: string; status: 'confermato' | 'non_disponibile' | 'da_confermare'; note: string }[];
  /** ask every guest who booked on the website to rate the room, the day after check-out */
  reviews: { autoRequest: boolean; delayDays: number };
  /** amenities the owner added himself in the room wizard, shared by every room */
  customAmenities: { key: string; label: string; labels?: Partial<Record<Locale, string>> }[];
  faq: { id: string; question: string; answer: string; keywords: string[] }[];
  demoMode: boolean;
  /** the owner's first set-up and the times of the Telegram reports */
  panel?: PanelPrefs;
}

export interface PanelPrefs {
  setup?: {
    /** the owner chose his own e-mail and password */
    accountAt?: string | null;
    /** the hotel's details were checked */
    hotelAt?: string | null;
    /** "hotel" = no card payments for now: the step counts as done */
    payments?: 'stripe' | 'hotel' | null;
    telegramSkipped?: boolean;
    portalsSkipped?: boolean;
    wizardDoneAt?: string | null;
    /** the "welcome" moment was shown */
    celebratedAt?: string | null;
  };
  /** when the Telegram messages of the day arrive ("HH:MM", hotel time) and on which days (1 = Monday … 7 = Sunday) */
  reports?: {
    morning?: { time: string; days: number[] };
    evening?: { time: string; days: number[] };
  };
}

export interface ChannelState {
  providerName: string;
  status: 'non_collegato' | 'simulazione' | 'collegato';
  lastSync: string | null;
  importedCount: number;
  log: { at: string; level: 'info' | 'error'; message: string }[];
  mapping: { externalCode: string; externalName: string; roomIds: string[] }[];
  /** portal calendars (iCal) linked to rooms */
  calendars?: { id: string; roomId: string; source: 'booking' | 'expedia' | 'airbnb' | 'altro'; url: string; lastSync: string | null; lastError: string | null; nights: number; /** when the owner pasted the site's link into the portal */ returnAt?: string | null }[];
  /** secret in our own calendar links (the ones pasted into the portals) */
  icalKey?: string;
}

export interface TelegramState {
  linkedChats: { chatId: string; userId: string; name: string; linkedAt: string }[];
  linkCode: { code: string; userId: string; expiresAt: string } | null;
  lastTestAt: string | null;
  lastError: string | null;
}

export interface PendingAction {
  id: string;
  channel: 'panel' | 'telegram';
  chatId: string | null;
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: string;
  expiresAt: string;
  /** language the owner wrote in: the result is answered in it */
  lang?: Locale;
}

export interface Promotion {
  id: string;
  code: string;
  description: string;
  percent: number;
  validFrom: string;
  validTo: string;
  active: boolean;
  minNights: number;
}

export interface ReviewReply {
  id: string;
  author: 'hotel' | 'guest';
  name: string;
  /** guests leave an e-mail with a reply (never shown on the site) */
  email?: string;
  text: string;
  lang: Locale;
  translations?: Partial<Record<Locale, string>>;
  createdAt: string;
}

export interface Feedback {
  id: string;
  bookingId: string | null;
  /** the room the review is about (null = the hotel in general) */
  roomId?: string | null;
  /** up to 3 photos uploaded by the guest (/api/media/…) */
  photos?: string[];
  /** the comment in the other languages of the site */
  translations?: Partial<Record<Locale, string>>;
  replies?: ReviewReply[];
  /** written by a guest who really stayed (link from the post-stay email) */
  verified?: boolean;
  /** written on the website without a stay: waits for the owner's approval */
  pending?: boolean;
  editedAt?: string | null;
  /** e-mail of a guest who wrote on the website (required there; private: never shown on the site) */
  email?: string;
  name: string;
  rating: number;
  comment: string;
  lang: Locale;
  publishConsent: boolean;
  showOnSite: boolean;
  demo: boolean;
  createdAt: string;
}

export interface GuestMessage {
  id: string;
  bookingId: string | null;
  name: string;
  email: string;
  subject: string;
  body: string;
  source: 'contatti' | 'area_ospite';
  read: boolean;
  createdAt: string;
  /** who wrote: the guest (default) or the hotel, in the conversation of a booking */
  sender?: 'guest' | 'hotel';
}

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  image: string;
  audience: 'consent_all' | 'past_guests' | 'future_guests';
  /** exact people chosen by the owner (emails); empty/undefined = the whole audience */
  selected?: string[];
  /** send only to guests whose language is in the list (empty = all languages) */
  langs?: Locale[];
  /** translate the text into each guest's language before sending */
  translate?: boolean;
  /** a personal/service message to chosen guests (not promotional) */
  personal?: boolean;
  theme?: EmailTheme;
  status: 'draft' | 'sent';
  sentAt: string | null;
  recipients: number;
  createdAt: string;
}

export interface EmailTheme {
  id: string;
  name: string;
  layout: 'classic' | 'hero' | 'minimal' | 'postcard';
  bg: string;
  card: string;
  accent: string;
  ink: string;
  headerBg: string;
  headerInk: string;
  font: 'serif' | 'sans';
  radius: number;
}

export interface AssistantLogEntry {
  id: string;
  userId: string;
  channel: 'panel' | 'telegram';
  role: 'user' | 'assistant';
  text: string;
  pendingId?: string | null;
  resolved?: boolean;
  engine?: string;
  voice?: boolean;
  /** picture sent by the owner (/api/media/…) */
  image?: string;
  /** pictures shown by the assistant */
  images?: string[];
  /** "watch me do it" steps, replayable from the chat */
  ui?: import('./assist').UiStep[];
  at: string;
}

export interface Task {
  id: string;
  label: string;
  done: boolean;
  createdAt: string;
}

export interface DB {
  schemaVersion: number;
  version: number;
  seededAt: string;
  updatedAt: string;
  settings: Settings;
  users: User[];
  rooms: Room[];
  bookings: Booking[];
  blocks: Block[];
  ratePeriods: RatePeriod[];
  payments: Payment[];
  outbox: OutboxEmail[];
  notifications: AppNotification[];
  audit: AuditEntry[];
  channel: ChannelState;
  telegram: TelegramState;
  pendingActions: PendingAction[];
  promotions: Promotion[];
  feedback: Feedback[];
  messages: GuestMessage[];
  tasks: Task[];
  campaigns: Campaign[];
  /** emails that unsubscribed from promotional messages */
  unsubscribed: string[];
  /** one conversation per user, shared by the panel assistant and Telegram */
  assistantLog: AssistantLogEntry[];
}
