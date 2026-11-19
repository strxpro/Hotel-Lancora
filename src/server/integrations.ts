import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db/store';

/**
 * Keys the owner connects from the panel (Impostazioni → Collegamenti) instead of editing .env.
 * Stored only on the server, in data/integrations.json (never in db.json, never sent to the
 * browser: the panel only sees "collegato · …abcd"). Environment variables always win.
 */
export interface StoredIntegrations {
  groqKey?: string;
  /** Google AI Studio key (Gemini Live): the live voice conversation with the assistant */
  geminiKey?: string;
  smtp?: { host: string; port: number; secure: boolean; user: string; pass: string; from: string };
  translations?: 'mymemory' | 'off';
  /** e-mail through Cloudflare Email Service (REST API, domain onboarded on Cloudflare) */
  cloudflareEmail?: { accountId: string; apiToken: string; fromAddress: string; fromName: string };
  /** e-mail handed to a Make.com / Zapier / n8n webhook that sends it (e.g. with the hotel's Gmail) */
  emailWebhook?: { url: string; secret?: string };
  /** the hotel's own mailbox (Posta tab): read the inbox and answer; optionally sends the guest e-mails too */
  mailbox?: {
    provider: 'gmail' | 'libero' | 'aruba' | 'yahoo' | 'icloud' | 'altro';
    email: string;
    name: string;
    user: string;
    pass: string;
    imap: { host: string; port: number; secure: boolean };
    smtp: { host: string; port: number; secure: boolean };
    /** confirmations, reminders, refunds… leave from this mailbox */
    sendGuests: boolean;
    connectedAt: string;
  };
  /** the hotel's own Stripe account, connected by pasting its two API keys */
  stripe?: { secretKey: string; publishableKey: string; webhookSecret?: string; webhookId?: string; accountName?: string; /** the Connect endpoint (account.updated of the hotel's account) and the address both point at */ connectWebhookId?: string; connectWebhookSecret?: string; webhookUrl?: string };
  updatedAt?: string;
}

const FILE = path.join(DATA_DIR, 'integrations.json');
const g = globalThis as unknown as { __lancoraInt?: { mtimeMs: number; data: StoredIntegrations } };

export function readIntegrations(): StoredIntegrations {
  try {
    const st = fs.statSync(FILE);
    if (g.__lancoraInt?.mtimeMs === st.mtimeMs) return g.__lancoraInt.data;
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8')) as StoredIntegrations;
    g.__lancoraInt = { mtimeMs: st.mtimeMs, data };
    return data;
  } catch {
    return {};
  }
}

export function writeIntegrations(patch: Partial<StoredIntegrations>): StoredIntegrations {
  const next: StoredIntegrations = { ...readIntegrations(), ...patch, updatedAt: new Date().toISOString() };
  for (const k of Object.keys(next) as (keyof StoredIntegrations)[]) if (next[k] === undefined) delete next[k];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  g.__lancoraInt = undefined;
  return next;
}

/** Google AI Studio key for the live voice conversation: GEMINI_API_KEY in .env or connected from the panel. */
export function geminiKey(): string | null {
  return process.env.GEMINI_API_KEY || readIntegrations().geminiKey || null;
}

/** Free Groq key (chat + voice): GROQ_API_KEY in .env or connected from the panel. */
export function groqKey(): string | null {
  return process.env.GROQ_API_KEY || readIntegrations().groqKey || null;
}

export function smtpSettings(): StoredIntegrations['smtp'] | null {
  if (process.env.SMTP_HOST && process.env.SMTP_FROM) {
    return {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
      from: process.env.SMTP_FROM,
    };
  }
  return readIntegrations().smtp ?? null;
}

export function translationsMode(): 'mymemory' | 'off' {
  const env = (process.env.TRANSLATION_PROVIDER || '').toLowerCase();
  const stored = readIntegrations().translations;
  if (stored) return stored;
  return env === 'mymemory' ? 'mymemory' : 'off';
}

/** Stripe keys: .env first, else the account connected from the panel. */
export function stripeKeys(): { secret: string; publishable: string; webhook: string } {
  const st = readIntegrations().stripe;
  return {
    secret: process.env.STRIPE_SECRET_KEY || st?.secretKey || '',
    publishable: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || st?.publishableKey || '',
    webhook: process.env.STRIPE_WEBHOOK_SECRET || st?.webhookSecret || '',
  };
}

/** "…abcd" — enough for the owner to recognise the key, useless to anyone else. */
export function maskKey(k: string | null | undefined): string | null {
  if (!k) return null;
  return `…${k.slice(-4)}`;
}

/** How e-mails leave the hotel: SMTP (Brevo, Gmail…), Cloudflare Email Service or a Make.com webhook. */
export type EmailTransport =
  | { kind: 'smtp'; source: 'env' | 'panel'; smtp: NonNullable<StoredIntegrations['smtp']> }
  | { kind: 'cloudflare'; source: 'env' | 'panel'; cf: NonNullable<StoredIntegrations['cloudflareEmail']> }
  | { kind: 'webhook'; source: 'env' | 'panel'; hook: NonNullable<StoredIntegrations['emailWebhook']> };

export function emailTransport(): EmailTransport | null {
  const env = process.env;
  if (env.SMTP_HOST && env.SMTP_FROM) return { kind: 'smtp', source: 'env', smtp: smtpSettings()! };
  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_EMAIL_TOKEN && env.EMAIL_FROM)
    return { kind: 'cloudflare', source: 'env', cf: { accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_EMAIL_TOKEN, fromAddress: env.EMAIL_FROM, fromName: env.EMAIL_FROM_NAME || 'Hotel L’Ancora' } };
  if (env.EMAIL_WEBHOOK_URL) return { kind: 'webhook', source: 'env', hook: { url: env.EMAIL_WEBHOOK_URL, secret: env.EMAIL_WEBHOOK_SECRET } };
  const st = readIntegrations();
  // the hotel's own mailbox, when the owner chose to send the guest e-mails from it (not the test mailbox)
  const mb = st.mailbox;
  if (mb?.sendGuests && env.HOTEL_MAIL_FAKE !== '1') return { kind: 'smtp', source: 'panel', smtp: { host: mb.smtp.host, port: mb.smtp.port, secure: mb.smtp.secure, user: mb.user, pass: mb.pass, from: `${mb.name.replace(/[<>"]/g, '')} <${mb.email}>` } };
  if (st.smtp) return { kind: 'smtp', source: 'panel', smtp: st.smtp };
  if (st.cloudflareEmail) return { kind: 'cloudflare', source: 'panel', cf: st.cloudflareEmail };
  if (st.emailWebhook) return { kind: 'webhook', source: 'panel', hook: st.emailWebhook };
  return null;
}
