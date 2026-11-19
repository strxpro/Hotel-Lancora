import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Block, DB, NotificationType } from '@/lib/types';
import { todayISO } from '@/lib/dates';
import { DATA_DIR, mutate, readDb } from './db/store';
import { CLOUD, piecePut } from './db/cloud-row';
import { audit } from './events';
import { resetVisits } from './visits';

/**
 * "Passa ai dati veri": the one-time switch from the demonstration to the hotel's real work.
 *
 * Removed: everything that happened during the demo (bookings and their guests, payments, e-mails,
 * notifications, reviews, messages, tasks, campaigns, sample discount codes, chats with the
 * assistant, the activity log, the visit counts).
 * Kept: what describes the hotel (rooms, photos, prices and seasons, settings, staff accounts,
 * the Telegram chats already linked, the portals' calendars and the nights they closed).
 *
 * A full copy of the data is written first to data/backup/, so nothing is lost for good.
 * Afterwards `settings.demoMode` is false: no demo reviews are added back, the "restore demo"
 * button is refused and the site no longer calls itself a demo.
 */
export interface DemoSummary {
  bookings: number;
  guests: number;
  payments: number;
  reviews: number;
  messages: number;
  emails: number;
  promotions: number;
  blocks: number;
  rooms: number;
  photos: number;
  seasons: number;
  telegramChats: number;
}

const DAILY = new Set<NotificationType>(['nuovo_arrivo', 'partenza_oggi', 'camera_da_controllare', 'report_giornaliero']);

/** nights closed by a portal's calendar are real: the next sync would put them back anyway */
const fromPortal = (b: Block) => Boolean(b.source && b.extUid);

export function demoSummary(db: DB): DemoSummary {
  const guests = new Set(db.bookings.map((b) => (b.guest.email || `${b.guest.firstName} ${b.guest.lastName}`).trim().toLowerCase()));
  return {
    bookings: db.bookings.length,
    guests: guests.size,
    payments: db.payments.length,
    reviews: db.feedback.length,
    messages: db.messages.length,
    emails: db.outbox.length,
    promotions: db.promotions.length,
    blocks: db.blocks.filter((b) => !fromPortal(b)).length,
    rooms: db.rooms.length,
    photos: db.rooms.reduce((n, r) => n + r.photos.length, 0),
    seasons: db.ratePeriods.length,
    telegramChats: db.telegram.linkedChats.length,
  };
}

export class GoLiveError extends Error {}

export function startRealData(actor: string): { backup: string; removed: DemoSummary } {
  const before = readDb();
  if (!before.settings.demoMode) throw new GoLiveError('Il sito usa già i dati veri.');
  const removed = demoSummary(before);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let backup: string;
  if (CLOUD) {
    // no disk on this hosting: the copy goes next to the data in Supabase
    piecePut(`backup-${stamp}`, before);
    backup = `Supabase hotel_state · backup-${stamp}`;
  } else {
    const dir = path.join(DATA_DIR, 'backup');
    fs.mkdirSync(dir, { recursive: true });
    backup = path.join(dir, `dati-demo-${stamp}.json`);
    fs.writeFileSync(backup, JSON.stringify(before));
  }

  mutate((db) => {
    db.bookings = [];
    db.payments = [];
    db.outbox = [];
    // today's daily messages stay: server/daily.ts looks at them to know they already went out,
    // otherwise pressing the button in the morning or evening would send them again on Telegram
    const today = todayISO();
    db.notifications = db.notifications.filter((n) => DAILY.has(n.type) && todayISO(new Date(n.createdAt)) === today);
    db.audit = [];
    db.feedback = [];
    db.messages = [];
    db.tasks = [];
    db.campaigns = [];
    db.unsubscribed = [];
    db.assistantLog = [];
    db.pendingActions = [];
    db.promotions = [];
    db.blocks = db.blocks.filter(fromPortal);
    db.channel.log = [];
    db.channel.importedCount = 0;
    db.settings.demoMode = false;
    audit(db, actor, 'go_live', 'database', null, `Dati di esempio cancellati (${removed.bookings} prenotazioni, ${removed.payments} pagamenti, ${removed.reviews} recensioni). Copia salvata: ${path.basename(backup)}`);
  });
  resetVisits();
  return { backup, removed };
}
