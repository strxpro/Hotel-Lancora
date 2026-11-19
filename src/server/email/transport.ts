import 'server-only';
import { emailTransport, type EmailTransport } from '../integrations';

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** promotional (has an unsubscribe link) vs service e-mail */
  unsubscribe?: string | null;
  replyTo?: string;
  /** what the e-mail is, for automations (Make.com routes on template and language) */
  meta?: { id: string; template: string; lang: string; bookingCode: string | null; guestName: string | null; hotel: string };
};

/**
 * Sends one e-mail with whatever the owner connected:
 *  · SMTP (Brevo, Gmail, Aruba…)       → nodemailer
 *  · Cloudflare Email Service          → REST API (service e-mails only, by Cloudflare's rules)
 *  · Make.com / Zapier / n8n webhook   → JSON to the scenario, which sends it (e.g. hotel Gmail)
 * Throws with a readable reason when it fails.
 */
export async function sendEmail(mail: OutgoingEmail, t: EmailTransport | null = emailTransport()): Promise<void> {
  if (!t) throw new Error('Email non collegate: il messaggio resta nella Outbox.');
  const headers = mail.unsubscribe ? { 'List-Unsubscribe': `<${mail.unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;

  if (t.kind === 'smtp') {
    const nodemailer = await import('nodemailer');
    const c = t.smtp;
    const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
    await transport.sendMail({ from: c.from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, ...(mail.replyTo ? { replyTo: mail.replyTo } : {}), ...(headers ? { headers } : {}) });
    return;
  }

  if (t.kind === 'cloudflare') {
    // Cloudflare Email Service is for transactional mail: promotional campaigns go through Make/Brevo
    if (mail.unsubscribe) throw new Error('Cloudflare invia solo email di servizio: per le campagne promozionali collega Make.com o Brevo.');
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(t.cf.accountId)}/email/sending/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.cf.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: mail.to, from: { address: t.cf.fromAddress, name: t.cf.fromName }, subject: mail.subject, html: mail.html, text: mail.text, ...(mail.replyTo ? { reply_to: mail.replyTo } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    const j = (await r.json().catch(() => null)) as { success?: boolean; errors?: { code: number; message: string }[]; result?: { permanent_bounces?: string[] } } | null;
    if (!r.ok || !j?.success) {
      const e = j?.errors?.[0];
      const hint = r.status === 401 || r.status === 403 ? ' (token senza permesso “Email Sending”)' : /domain/i.test(e?.message ?? '') ? ' (il dominio del mittente non è attivo in Email Service → Email Sending)' : /plan|paid|subscription/i.test(e?.message ?? '') ? ' (per scrivere agli ospiti serve il piano Workers Paid)' : '';
      throw new Error(`Cloudflare: ${e?.message ?? `errore ${r.status}`}${hint}`);
    }
    if (j.result?.permanent_bounces?.length) throw new Error(`Indirizzo rifiutato: ${j.result.permanent_bounces.join(', ')}`);
    return;
  }

  // webhook (Make.com): the scenario receives everything it needs to send the mail
  const r = await fetch(t.hook.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(t.hook.secret ? { 'x-hotel-key': t.hook.secret } : {}) },
    body: JSON.stringify({
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      reply_to: mail.replyTo ?? '',
      kind: mail.unsubscribe ? 'promozionale' : 'servizio',
      unsubscribe_url: mail.unsubscribe ?? '',
      // for the Make scenario: which e-mail, in which language, for which booking
      email_id: mail.meta?.id ?? '',
      template: mail.meta?.template ?? '',
      lang: mail.meta?.lang ?? '',
      booking_code: mail.meta?.bookingCode ?? '',
      guest_name: mail.meta?.guestName ?? '',
      hotel_name: mail.meta?.hotel ?? '',
      key: t.hook.secret ?? '',
    }),
    // the scenario answers only after Gmail has sent the e-mail (a few seconds; more when Make is busy)
    signal: AbortSignal.timeout(45000),
  });
  await webhookAnswer(r);
}

/**
 * What the Make scenario answered. The hotel's scenario replies {"ok":true} once Gmail has sent the
 * e-mail, {"ok":false,…} with 422 when Gmail refused it and 403 when the site's key is wrong; an
 * older scenario without a reply step answers "Accepted" (taken in charge, not confirmed).
 */
export async function webhookAnswer(r: Response): Promise<'sent' | 'accepted'> {
  const body = (await r.text().catch(() => '')).trim();
  let j: { ok?: boolean; error?: string } | null = null;
  try {
    j = body.startsWith('{') ? (JSON.parse(body) as { ok?: boolean; error?: string }) : null;
  } catch {
    j = null;
  }
  if (r.status === 403) throw new Error('Make.com ha rifiutato la chiave del sito: la chiave in Impostazioni → Collegamenti deve essere la stessa del filtro nello scenario.');
  if (!r.ok || j?.ok === false) {
    const why = j?.error ?? (/<html/i.test(body) ? `errore ${r.status}` : body.slice(0, 140) || `errore ${r.status}`);
    throw new Error(`Make.com: ${why}`);
  }
  return j?.ok === true ? 'sent' : 'accepted';
}

export function transportLabel(t: EmailTransport | null): string | null {
  if (!t) return null;
  return t.kind === 'smtp' ? `SMTP · ${t.smtp.host}` : t.kind === 'cloudflare' ? `Cloudflare · ${t.cf.fromAddress}` : `Make.com · ${new URL(t.hook.url).host}`;
}
