import 'server-only';
import { emailTransport } from './integrations';
import { sendEmail } from './email/transport';
import type { AppNotification, Booking, DB, EmailTemplate, NotificationType, OutboxEmail } from '@/lib/types';
import { afterCommit, mutate, newId } from './db/store';
import { renderEmail, type EmailContext } from './email/templates';
import { escapeHtml, sendMessage, telegramConfigured } from './telegram/api';

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

/**
 * Records an in-panel notification and, if enabled and configured, forwards it to every
 * linked Telegram chat after the database write succeeded.
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
  if (enabled && configured) {
    const chats = db.telegram.linkedChats.map((c) => c.chatId);
    afterCommit(async () => {
      const text = `${ICON[type]} <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`;
      let status: AppNotification['telegram'] = 'inviato';
      for (const chat of chats) {
        try {
          await sendMessage(chat, text);
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
    await sendEmail({ to: email.to, subject: email.subject, html: email.html, text: email.text, unsubscribe: email.listUnsubscribe ?? null, replyTo: db.settings.hotel.email, meta });
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
