import 'server-only';
import { emailTransport } from './integrations';
import { sendEmail } from './email/transport';
import type { AppNotification, Booking, DB, EmailTemplate, NotificationType, OutboxEmail } from '@/lib/types';
import { afterCommit, mutate, newId } from './db/store';
import { NOTICE_HEADING, renderEmail, type EmailContext } from './email/templates';
import { escapeHtml, sendMessage, telegramConfigured, type InlineButton } from './telegram/api';
import { diffDays, fmtDate } from '@/lib/dates';
import { money } from '@/lib/utils';

export function audit(db: DB, actor: string, action: string, entity: string, entityId: string | null, details: string): void {
  db.audit.unshift({ id: newId('a-'), at: new Date().toISOString(), actor, action, entity, entityId, details });
  if (db.audit.length > 800) db.audit.length = 800;
}

const ICON: Record<NotificationType, string> = {
  nuova_prenotazione: '🛎',
  nuovo_pagamento: '💶',
  prenotazione_cancellata: '✖️',
  nuovo_arrivo: '🧳',
  partenza_oggi: '👋',
  pagamento_non_completato: '⚠️',
  camera_da_controllare: '🧹',
  errore_sincronizzazione: '🔌',
  messaggio_ospite: '✉️',
  report_giornaliero: '📊',
};

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  nuova_prenotazione: 'Nuova prenotazione',
  nuovo_pagamento: 'Nuovo pagamento',
  prenotazione_cancellata: 'Prenotazione cancellata',
  nuovo_arrivo: 'Nuovo arrivo',
  partenza_oggi: 'Partenza di oggi',
  pagamento_non_completato: 'Pagamento non completato',
  camera_da_controllare: 'Camera da controllare',
  errore_sincronizzazione: 'Errore sincronizzazione',
  messaggio_ospite: 'Messaggio ospite',
  report_giornaliero: 'Report della giornata',
};

/** Notices about one booking of the hotel: the booking they speak of (from the link to it). */
const BOOKING_NOTICE: NotificationType[] = ['nuova_prenotazione', 'prenotazione_cancellata', 'pagamento_non_completato'];
function noticeBooking(db: DB, type: NotificationType, href: string | null): Booking | undefined {
  if (!BOOKING_NOTICE.includes(type)) return undefined;
  const id = href ? /[?&]id=([^&#]+)/.exec(href)?.[1] : undefined;
  return id ? db.bookings.find((x) => x.id === id) : undefined;
}

const HOW: Record<NonNullable<Booking['paymentMethod']>, string> = { card: 'pagata con carta', cash: 'in contanti all’arrivo', transfer: 'con bonifico', ota: 'tramite il portale' };

/**
 * The Telegram message of a booking notice, one thing per line so it reads at a glance:
 * guest, room, stay, money, contacts, requests; then what happened (cancelled, not paid…).
 */
export function bookingText(db: DB, type: NotificationType, title: string, body: string, b: Booking): string {
  const room = db.rooms.find((r) => r.id === b.roomId);
  const nights = diffDays(b.checkIn, b.checkOut);
  const people = b.adults + b.children;
  const lines = [
    `${ICON[type]} <b>${escapeHtml(title)}</b>`,
    '',
    `👤 <b>${escapeHtml(guestName(b))}</b>`,
    `🛏 ${room ? escapeHtml(`Camera ${room.number}${room.text.title && !room.text.title.includes(room.number) ? ` · ${room.text.title}` : ''}`) : 'Camera da assegnare'}`,
    `📅 ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut, 'it', { day: 'numeric', month: 'short', year: 'numeric' })} · ${nights === 1 ? '1 notte' : `${nights} notti`} · ${people === 1 ? '1 ospite' : `${people} ospiti`}`,
    `💶 ${money(b.total, 'it', 2)}${b.paymentMethod ? ` · ${HOW[b.paymentMethod]}` : ''}${b.amountPaid > 0 && b.amountPaid < b.total ? ` · versati ${money(b.amountPaid, 'it', 2)}` : ''}`,
  ];
  const contact = [b.guest.phone && `📞 ${escapeHtml(b.guest.phone)}`, b.guest.email && `✉️ ${escapeHtml(b.guest.email)}`].filter(Boolean).join('   ');
  if (contact) lines.push(contact);
  if (b.specialRequests?.trim()) lines.push(`📝 ${escapeHtml(b.specialRequests.trim().slice(0, 300))}`);
  // what happened, in the words of the notice (the guest and the dates are already above)
  const what = type === 'prenotazione_cancellata'
    ? ['Le notti sono di nuovo libere.', /rimborso € [\d.,]+/.exec(body)?.[0]?.replace('rimborso', 'Rimborso')].filter(Boolean).join(' ')
    : type === 'pagamento_non_completato'
      ? `Il pagamento non è stato concluso: le date sono di nuovo libere.${/abbiamo scritto/i.test(body) ? ' Gli abbiamo scritto un’email con il link per finire la prenotazione.' : ''}`
      : '';
  if (what) lines.push('', `<i>${escapeHtml(what)}</i>`);
  return lines.join('\n');
}

/** The button under a notice: straight to the right page of the panel (only with the site's real https address). */
function panelButton(href: string | null): InlineButton[][] | undefined {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!href || !/^https:\/\//.test(base)) return undefined;
  return [[{ text: href.startsWith('/admin/prenotazioni') ? '📋 Apri la prenotazione nel pannello' : '📋 Apri nel pannello', url: `${base}${href}` }]];
}

/**
 * Records an in-panel notification and, if enabled and configured, forwards it to every
 * linked Telegram chat after the database write succeeded. A booking notice (new, cancelled,
 * not paid) also goes by e-mail to the hotel's own address (see mailHotel).
 */
export function notify(db: DB, type: NotificationType, title: string, body: string, href: string | null = null): AppNotification {
  // a type added after the settings were saved starts switched on
  const enabled = db.settings.notifications[type] ?? true;
  const configured = telegramConfigured() && db.telegram.linkedChats.length > 0;
  const n: AppNotification = {
    id: newId('n-'),
    type,
    title,
    body,
    href,
    read: false,
    telegram: !enabled ? 'disattivato' : configured ? 'in_coda' : 'non_configurato',
    createdAt: new Date().toISOString(),
  };
  db.notifications.unshift(n);
  if (db.notifications.length > 300) db.notifications.length = 300;
  const booking = noticeBooking(db, type, href);
  mailHotel(db, type, title, body, href, booking);
  if (enabled && configured) {
    const chats = db.telegram.linkedChats.map((c) => c.chatId);
    const text = booking && !booking.demo ? bookingText(db, type, title, body, booking) : `${ICON[type]} <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`;
    const buttons = panelButton(href);
    afterCommit(async () => {
      let status: AppNotification['telegram'] = 'inviato';
      for (const chat of chats) {
        try {
          await sendMessage(chat, text, buttons);
        } catch (e) {
          status = 'errore';
          console.error('[telegram]', (e as Error).message);
        }
      }
      mutate((d) => {
        const x = d.notifications.find((k) => k.id === n.id);
        if (x) x.telegram = status;
        if (status === 'errore') d.telegram.lastError = new Date().toISOString();
      });
    });
  }
  return n;
}

/**
 * A new booking, a cancellation or a booking left unpaid (the guest's contacts, to call them back),
 * by e-mail to the hotel's address (Impostazioni → Hotel), with the booking's details. Only notices
 * about one booking of the hotel (not the portals' calendars, which write to the hotel themselves),
 * never for simulations or demo data, once per booking and kind.
 */
function mailHotel(db: DB, type: NotificationType, title: string, body: string, href: string | null, b: Booking | undefined): void {
  const to = db.settings.hotel.email?.trim();
  if (!to || !b || b.simulated || b.demo) return;
  const kind = type === 'nuova_prenotazione' ? 'nuova' : type === 'prenotazione_cancellata' ? 'cancellata' : 'non_completata';
  // "nuova" is a booking made just now (new dates accepted on an old booking are not a new booking)
  if (kind === 'nuova' && Date.now() - Date.parse(b.createdAt) > 60 * 60_000) return;
  // a cancellation can be announced twice (the reason, then the cancellation itself): one e-mail is enough
  const heading = NOTICE_HEADING[kind];
  if (db.outbox.some((e) => e.template === 'avviso_hotel' && e.bookingId === b.id && e.html.includes(`>${heading}</h1>`))) return;
  const room = db.rooms.find((r) => r.id === b.roomId) ?? null;
  queueEmail(db, 'avviso_hotel', to, { booking: b, room, extra: { notice: { kind, title, body, href } } });
}

/**
 * Addresses on reserved test domains (RFC 2606/6761: example.com/.net/.org, *.example, *.invalid,
 * *.test, *.localhost) belong to demo guests: their e-mails stay in the Outbox and are never handed
 * to SMTP / Make / Cloudflare, so a demo or a test never mails anyone (and never bounces).
 */
export function isTestAddress(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return true;
  const labels = domain.split('.');
  const tld = labels.at(-1) ?? '';
  if (['example', 'invalid', 'test', 'localhost'].includes(tld)) return true;
  return labels.length >= 2 && labels.at(-2) === 'example' && ['com', 'net', 'org'].includes(tld);
}

export function smtpConfigured(): boolean {
  return Boolean(emailTransport());
}

/** Queues an email: always stored in the outbox; really sent only when SMTP is configured. */
export function queueEmail(db: DB, template: EmailTemplate, to: string, ctx: Omit<EmailContext, 'settings'>): OutboxEmail {
  const r = renderEmail(template, { ...ctx, settings: db.settings });
  const email: OutboxEmail = {
    id: newId('em-'),
    to,
    subject: r.subject,
    template,
    html: r.html,
    text: r.text,
    bookingId: ctx.booking?.id ?? null,
    status: 'demo_outbox',
    error: null,
    createdAt: new Date().toISOString(),
    sentAt: null,
  };
  db.outbox.unshift(email);
  if (db.outbox.length > 400) db.outbox.length = 400;
  if (smtpConfigured()) afterCommit(async () => {
    await deliverEmail(email.id);
  });
  return email;
}

export async function deliverEmail(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!smtpConfigured()) return { ok: false, error: 'Email non collegate: il messaggio resta nella Demo Outbox.' };
  const { readDb } = await import('./db/store');
  const email = readDb().outbox.find((e) => e.id === id);
  if (!email) return { ok: false, error: 'Email non trovata' };
  if (isTestAddress(email.to)) return { ok: false, error: 'Indirizzo di prova (dominio riservato): l’email resta nella Outbox e non viene spedita.' };
  try {
    const db = readDb();
    const b = email.bookingId ? db.bookings.find((x) => x.id === email.bookingId) : undefined;
    // the language the e-mail is written in: every template declares it in <html lang="…">
    const lang = /<html lang="([a-z]{2})"/.exec(email.html)?.[1] ?? 'it';
    const meta = { id: email.id, template: email.template, lang, bookingCode: b?.code ?? null, guestName: b ? `${b.guest.firstName} ${b.guest.lastName}`.trim() : null, hotel: db.settings.hotel.name };
    // a notice to the hotel answers to the guest; every other e-mail answers to the hotel
    const guest = email.template === 'avviso_hotel' ? b?.guest.email : undefined;
    const messageId = `<${email.id}.${Date.now().toString(36)}@lancora.hotel>`;
    const transport = emailTransport();
    await sendEmail({ to: email.to, subject: email.subject, html: email.html, text: email.text, unsubscribe: email.listUnsubscribe ?? null, replyTo: guest || db.settings.hotel.email, meta, messageId }, transport);
    // sent from the hotel's own Gmail to itself: make sure it is in "Posta in arrivo", unread
    if (email.template === 'avviso_hotel' && transport?.kind === 'smtp' && transport.source === 'panel') {
      const { keepInInbox } = await import('./mail/mailbox');
      await keepInInbox(email.to, messageId, { from: transport.smtp.from, to: email.to, subject: email.subject, html: email.html, text: email.text }).catch((err) => console.error('[mail] avviso in arrivo', (err as Error).message));
    }
    mutate((d) => {
      const e = d.outbox.find((x) => x.id === id);
      if (e) Object.assign(e, { status: 'sent', sentAt: new Date().toISOString(), error: null });
    });
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    mutate((d) => {
      const e = d.outbox.find((x) => x.id === id);
      if (e) Object.assign(e, { status: 'failed', error: msg });
    });
    return { ok: false, error: msg };
  }
}

export function guestName(b: Booking): string {
  return `${b.guest.firstName} ${b.guest.lastName}`;
}
