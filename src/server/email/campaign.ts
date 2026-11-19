import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Campaign, DB, EmailTheme, Locale, OutboxEmail, Settings } from '@/lib/types';
import { todayISO } from '@/lib/dates';
import { DEFAULT_THEME, sanitizeTheme } from '@/lib/email-themes';
import { afterCommit, newId } from '../db/store';
import { deliverEmail, smtpConfigured } from '../events';
import { guestLang, guestTokens } from '../guests';
import { appUrl } from './templates';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function key(): string {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? s : 'solo-sviluppo-locale-cambiare-SESSION_SECRET-0123456789abcdef';
}

export function unsubscribeToken(email: string): string {
  return createHmac('sha256', key()).update(`unsub:${email.toLowerCase()}`).digest('base64url').slice(0, 32);
}

export function verifyUnsubscribe(email: string, token: string): boolean {
  const a = Buffer.from(unsubscribeToken(email));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(email: string): string {
  return `${appUrl()}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;
}

export interface Recipient {
  email: string;
  firstName: string;
  lang?: Locale;
  /** values for {nome}, {cognome}, {camera}, {arrivo}, {partenza}, {codice} */
  tokens?: Record<string, string>;
}

/**
 * Promotional audience: only guests who ticked the marketing consent, never someone who
 * unsubscribed, one email per address (latest booking wins).
 */
export function campaignAudience(db: DB, audience: Campaign['audience']): Recipient[] {
  const today = todayISO();
  const blocked = new Set(db.unsubscribed.map((e) => e.toLowerCase()));
  const map = new Map<string, Recipient & { last: string }>();
  for (const b of db.bookings) {
    if (!b.consents.marketing || b.status === 'cancelled') continue;
    const email = b.guest.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || blocked.has(email)) continue;
    if (audience === 'past_guests' && !(b.checkOut <= today)) continue;
    if (audience === 'future_guests' && !(b.checkIn >= today)) continue;
    const prev = map.get(email);
    if (!prev || prev.last < b.createdAt) map.set(email, { email, firstName: b.guest.firstName, lang: guestLang(b.guest), last: b.createdAt });
  }
  return [...map.values()].map(({ email, firstName, lang }) => ({ email, firstName, lang }));
}

/**
 * Who really receives a campaign: the chosen people (personal message → no marketing consent
 * needed, but never someone who unsubscribed) or the consenting audience; then the language filter.
 */
export function campaignRecipients(db: DB, c: Pick<Campaign, 'audience' | 'selected' | 'langs' | 'personal'>): Recipient[] {
  const blocked = new Set(db.unsubscribed.map((e) => e.toLowerCase()));
  let list: Recipient[];
  if (c.selected?.length) {
    const wanted = new Set(c.selected.map((e) => e.toLowerCase()));
    const map = new Map<string, Recipient>();
    for (const b of [...db.bookings].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
      const email = b.guest.email.trim().toLowerCase();
      if (!wanted.has(email) || blocked.has(email)) continue;
      if (!c.personal && !db.bookings.some((x) => x.guest.email.trim().toLowerCase() === email && x.consents.marketing)) continue;
      map.set(email, { email, firstName: b.guest.firstName, lang: guestLang(b.guest) });
    }
    list = [...map.values()];
  } else {
    list = campaignAudience(db, c.audience);
  }
  if (c.langs?.length) list = list.filter((r) => c.langs!.includes(r.lang ?? 'it'));
  return list.map((r) => ({ ...r, tokens: guestTokens(db, r.email) }));
}

const SAMPLE: Record<string, string> = { nome: 'Giulia', cognome: 'Rossi', camera: '104 Granito', arrivo: '12 dicembre', partenza: '15 dicembre', codice: 'LA-7Q24N' };

function personal(s: string, r: Recipient): string {
  const t: Record<string, string> = { ...(r.tokens ?? {}), nome: r.tokens?.nome || r.firstName || '' };
  return s
    .replace(/\{(nome|cognome|camera|arrivo|partenza|codice)\}/gi, (_, k: string) => t[k.toLowerCase()] ?? (r.email.endsWith('@example.com') ? SAMPLE[k.toLowerCase()] : '') ?? '')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

const FOOT: Record<Locale, { why: string; personal: string; stop: string }> = {
  it: { why: 'Ricevi questa email perché hai acconsentito alle comunicazioni dell’hotel durante la prenotazione.', personal: 'Ti scriviamo in merito al tuo soggiorno.', stop: 'Non voglio più ricevere queste email' },
  en: { why: 'You receive this email because you agreed to hear from the hotel when you booked.', personal: 'We are writing to you about your stay.', stop: 'I no longer want these emails' },
  pl: { why: 'Otrzymujesz tę wiadomość, ponieważ podczas rezerwacji zgodziłeś się na kontakt od hotelu.', personal: 'Piszemy w sprawie Twojego pobytu.', stop: 'Nie chcę więcej otrzymywać tych wiadomości' },
  de: { why: 'Sie erhalten diese E-Mail, weil Sie bei der Buchung Nachrichten des Hotels zugestimmt haben.', personal: 'Wir schreiben Ihnen bezüglich Ihres Aufenthalts.', stop: 'Ich möchte diese E-Mails nicht mehr erhalten' },
  fr: { why: 'Vous recevez cet email car vous avez accepté les communications de l’hôtel lors de la réservation.', personal: 'Nous vous écrivons au sujet de votre séjour.', stop: 'Je ne veux plus recevoir ces emails' },
  es: { why: 'Recibes este email porque aceptaste las comunicaciones del hotel al reservar.', personal: 'Te escribimos en relación con tu estancia.', stop: 'No quiero recibir más estos emails' },
};

type Content = Pick<Campaign, 'subject' | 'headline' | 'body' | 'ctaLabel' | 'ctaUrl' | 'image'> & { theme?: EmailTheme | null; personal?: boolean };

export function renderCampaign(c: Content, settings: Settings, r: Recipient): { subject: string; html: string; text: string; unsubscribe: string } {
  const h = settings.hotel;
  const t = sanitizeTheme(c.theme ?? null, DEFAULT_THEME);
  const lang = r.lang ?? 'it';
  const f = FOOT[lang];
  const base = appUrl();
  const img = c.image ? (c.image.startsWith('http') ? c.image : `${base}${c.image}`) : '';
  const cta = c.ctaUrl ? (c.ctaUrl.startsWith('http') ? c.ctaUrl : `${base}${c.ctaUrl}`) : '';
  const unsubscribe = unsubscribeUrl(r.email);
  const serif = "Georgia,'Times New Roman',serif";
  const sans = 'Arial,Helvetica,sans-serif';
  const headFont = t.font === 'serif' ? serif : sans;
  const rad = `${t.radius}px`;
  const paragraphs = personal(c.body, r)
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<p style="font-size:16px;line-height:1.75;margin:0 0 16px;color:${t.ink};">${esc(x).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const header =
    t.layout === 'minimal'
      ? `<tr><td style="padding:34px 40px 0;font-family:${headFont};color:${t.headerInk};font-size:13px;letter-spacing:5px;">HOTEL L’ANCORA</td></tr>`
      : `<tr><td style="background:${t.headerBg};padding:26px 36px;text-align:center;">
  <div style="font-family:${serif};color:${t.headerInk};font-size:12px;letter-spacing:6px;">HOTEL</div>
  <div style="font-family:${serif};color:${t.headerInk};font-size:26px;letter-spacing:4px;margin-top:2px;">L’ANCORA</div>
</td></tr>`;
  const image = img
    ? t.layout === 'postcard'
      ? `<tr><td style="padding:28px 28px 0;"><img src="${esc(img)}" width="544" alt="" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:${Math.max(8, t.radius - 6)}px;"></td></tr>`
      : `<tr><td><img src="${esc(img)}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>`
    : '';
  const headline = `<h1 style="font-family:${headFont};font-weight:normal;font-size:${t.layout === 'hero' ? 34 : 30}px;line-height:1.2;color:${t.layout === 'minimal' ? t.ink : t.accent};margin:0 0 20px;">${esc(personal(c.headline, r))}</h1>`;
  const button = cta && c.ctaLabel ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 10px;"><tr><td style="background:${t.accent};border-radius:999px;"><a href="${esc(cta)}" style="display:inline-block;padding:16px 30px;color:${t.card};text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-family:${sans};">${esc(c.ctaLabel)}</a></td></tr></table>` : '';
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(personal(c.subject, r))}</title></head>
<body style="margin:0;padding:0;background:${t.bg};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(personal(c.headline, r))}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${t.bg};padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:${t.card};border-radius:${rad};overflow:hidden;">
${t.layout === 'hero' ? image + header : header + image}
<tr><td style="padding:40px 40px 10px;font-family:${sans};">
  ${headline}
  ${paragraphs}
  ${button}
</td></tr>
<tr><td style="padding:26px 40px 34px;font-family:${sans};font-size:12px;line-height:1.7;color:${t.ink};opacity:0.7;border-top:1px solid ${t.bg};">
  ${esc(h.name)} · ${esc(h.city)} (${esc(h.province)}) · ${esc(h.email)}<br>
  ${c.personal ? f.personal : f.why}<br>
  <a href="${esc(unsubscribe)}" style="color:${t.accent};">${f.stop}</a>
</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${personal(c.headline, r)}\n\n${personal(c.body, r)}\n\n${cta ? `${c.ctaLabel}: ${cta}\n\n` : ''}—\n${h.name} · ${h.email}\n${f.stop}: ${unsubscribe}`;
  return { subject: personal(c.subject, r), html, text, unsubscribe };
}

/**
 * Queues one personalised email per recipient in the outbox (inside the caller's mutate) and,
 * when SMTP is configured, delivers them after the commit with a gentle pace.
 * `byLang` holds the translated text for each language (falls back to the original).
 */
export function queueCampaign(db: DB, c: Campaign, recipients: Recipient[], byLang: Partial<Record<Locale, Pick<Campaign, 'subject' | 'headline' | 'body' | 'ctaLabel'>>> = {}): OutboxEmail[] {
  const now = new Date().toISOString();
  const emails = recipients.map((r) => {
    const tr = byLang[r.lang ?? 'it'];
    const m = renderCampaign({ ...c, ...(tr ?? {}) }, db.settings, r);
    const e: OutboxEmail = { id: newId('em-'), to: r.email, subject: m.subject, template: 'campagna', html: m.html, text: m.text, bookingId: null, status: 'demo_outbox', error: null, createdAt: now, sentAt: null, listUnsubscribe: m.unsubscribe };
    return e;
  });
  db.outbox.unshift(...emails);
  if (db.outbox.length > 600) db.outbox.length = 600;
  if (smtpConfigured() && emails.length) {
    afterCommit(async () => {
      for (const e of emails) {
        await deliverEmail(e.id);
        await new Promise((r) => setTimeout(r, 350));
      }
    });
  }
  return emails;
}
