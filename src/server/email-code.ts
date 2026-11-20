import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DB } from '@/lib/types';

/**
 * Six-digit codes sent by e-mail (guest area sign-in, "pay at the hotel" confirmation). Nothing is
 * stored: the code is a signature of what it opens and of a 10-minute window, so every server
 * (Vercel runs many at once) recognises it. A code works in its window and the next one (10–20 min).
 */
const WINDOW_MS = 10 * 60_000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET mancante o troppo corto (min 32 caratteri)');
  return 'solo-sviluppo-locale-cambiare-SESSION_SECRET-0123456789abcdef';
}

export function codeFor(purpose: 'guest' | 'cash', subject: string, at = Date.now()): string {
  const w = Math.floor(at / WINDOW_MS);
  const h = createHmac('sha256', secret()).update(`code|${purpose}|${subject.toLowerCase()}|${w}`).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export function codeMatches(purpose: 'guest' | 'cash', subject: string, typed: string, now = Date.now()): boolean {
  const c = String(typed ?? '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  return [now, now - WINDOW_MS].some((t) => {
    const a = Buffer.from(codeFor(purpose, subject, t));
    const b = Buffer.from(c);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** "m•••@gmail.com": where the code went, without showing the whole address. */
export function maskEmail(email: string): string {
  const [u = '', d = ''] = email.split('@');
  return `${u.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(5, u.length - 1)))}@${d}`;
}

/* ---------- "pay at the hotel" from the same phone or computer ---------- */

export const CASH_COOKIE = 'la_cash';
const DAY_MS = 24 * 3600_000;
/** cash bookings confirmed from one device (or one e-mail) in 24 hours before the site asks to use the guest area */
export const CASH_PER_DAY = 2;

const signBody = (body: string) => createHmac('sha256', secret()).update(`cash:${body}`).digest('base64url');

/** When this device confirmed its last "pay at the hotel" bookings (signed, so it cannot be edited). */
export function readCashCookie(raw: string | undefined | null, now = Date.now()): number[] {
  if (!raw) return [];
  const [body, sig] = raw.split('.');
  if (!body || !sig) return [];
  const want = Buffer.from(signBody(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return [];
  try {
    const list = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    return Array.isArray(list) ? list.filter((t): t is number => typeof t === 'number' && now - t < DAY_MS) : [];
  } catch {
    return [];
  }
}

export function writeCashCookie(times: number[]): string {
  const body = Buffer.from(JSON.stringify(times.slice(-6))).toString('base64url');
  return `${body}.${signBody(body)}`;
}

/** "Pay at the hotel" bookings this address confirmed in the last 24 hours. */
export function recentCashBookings(db: DB, email: string, now = Date.now()): number {
  const e = email.trim().toLowerCase();
  return db.bookings.filter((b) => b.guest.email.trim().toLowerCase() === e && b.paymentMethod === 'cash' && b.source === 'sito' && b.status !== 'cancelled' && now - new Date(b.createdAt).getTime() < DAY_MS).length;
}
