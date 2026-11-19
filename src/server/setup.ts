import 'server-only';
import type { DB } from '@/lib/types';

/**
 * The owner's first set-up. The site is handed over with a starter login (admin@lancora.demo): whoever
 * signs in with it gets the set-up wizard (own e-mail and password, hotel details, card payments,
 * Telegram), ending with a summary with ticks; leaving it plays the welcome moment once. "Oggi" then
 * shows what is still missing, with a tick next to what is done.
 * Most steps are read from the real data (Stripe connected, a phone linked, calendars, real photos):
 * only the owner's choices ("not now", "cash only") and the moments are stored (settings.panel.setup).
 */
export const OWNER_ID = 'u-admin';
export const STARTER_DOMAIN = '@lancora.demo';
export const isStarterEmail = (email: string) => email.trim().toLowerCase().endsWith(STARTER_DOMAIN);

export type SetupKey = 'account' | 'hotel' | 'payments' | 'telegram' | 'portals' | 'photos';
export interface SetupItem {
  key: SetupKey;
  title: string;
  text: string;
  done: boolean;
  /** started but not finished (e.g. Stripe asked for more details) */
  waiting?: string;
  href: string;
  cta: string;
}

export interface SetupState {
  items: SetupItem[];
  done: number;
  total: number;
  allDone: boolean;
  /** the full-screen wizard (only the owner, until he finished it) */
  wizard: boolean;
  /** the welcome moment (only the owner, once, when everything is done) */
  celebrate: boolean;
  ownerName: string;
  hotelName: string;
}

/** What the panel needs to draw the wizard, the "Oggi" list and the welcome moment. */
export function setupView(db: DB, userId: string) {
  const h = db.settings.hotel;
  const c = db.settings.stripeConnect;
  return {
    ...setupState(db, userId),
    hotel: { name: h.name, phone: h.phone, email: h.email, addressLine: h.addressVerified ? h.addressLine : '', postalCode: h.postalCode, city: h.city },
    stripeStarted: Boolean(c.accountId && !c.simulated),
    telegramLinked: db.telegram.linkedChats.length > 0,
  };
}

export function setupState(db: DB, userId: string): SetupState {
  const s = db.settings.panel?.setup ?? {};
  const owner = db.users.find((u) => u.id === OWNER_ID);
  const c = db.settings.stripeConnect;
  const cardsLive = Boolean(c.accountId && !c.simulated && c.chargesEnabled);
  const rooms = db.rooms.filter((r) => r.status !== 'draft');
  const realPhotos = rooms.length > 0 && rooms.every((r) => r.photos.length > 0 && r.photos.every((p) => !p.demo));
  const items: SetupItem[] = [
    { key: 'account', title: 'Il tuo accesso', text: 'E-mail e password solo tue per entrare nel pannello.', done: Boolean(owner && !isStarterEmail(owner.email) && s.accountAt), href: '/admin/impostazioni', cta: 'Crea l’accesso' },
    { key: 'hotel', title: 'I dati dell’hotel', text: 'Nome, telefono, e-mail e indirizzo che vedono gli ospiti.', done: Boolean(s.hotelAt), href: '/admin/impostazioni', cta: 'Controlla i dati' },
    {
      key: 'payments',
      title: 'Pagamenti con carta',
      text: s.payments === 'hotel' ? 'Per ora gli ospiti pagano in hotel.' : 'Il conto dove arrivano i soldi delle prenotazioni.',
      done: cardsLive || s.payments === 'hotel',
      waiting: !cardsLive && c.accountId && !c.simulated ? 'Stripe sta controllando i dati' : undefined,
      href: '/admin/pagamenti',
      cta: c.accountId && !c.simulated ? 'Completa' : 'Collega',
    },
    { key: 'telegram', title: 'Avvisi sul telefono', text: 'Nuove prenotazioni, messaggi e report su Telegram.', done: db.telegram.linkedChats.length > 0 || Boolean(s.telegramSkipped), href: '/admin/automazioni', cta: 'Collega il telefono' },
    { key: 'portals', title: 'Booking.com e Airbnb', text: 'Le notti vendute sui portali si chiudono da sole.', done: (db.channel.calendars?.length ?? 0) > 0 || Boolean(s.portalsSkipped), href: '/admin/automazioni', cta: 'Collega i portali' },
    { key: 'photos', title: 'Le foto vere delle camere', text: 'Sostituisci le foto di esempio con quelle dell’hotel.', done: realPhotos, href: '/admin/camere', cta: 'Carica le foto' },
  ];
  const done = items.filter((i) => i.done).length;
  const isOwner = userId === OWNER_ID;
  return {
    items,
    done,
    total: items.length,
    allDone: done === items.length,
    wizard: isOwner && !s.wizardDoneAt,
    // the welcome moment plays once, right after the owner leaves the guided set-up ("Entra nel pannello");
    // whatever is still missing stays in the "Da completare" list on Oggi
    celebrate: isOwner && Boolean(s.wizardDoneAt) && !s.celebratedAt,
    ownerName: owner?.name && owner.name !== 'Proprietario' ? owner.name.split(' ')[0]! : '',
    hotelName: db.settings.hotel.name,
  };
}
