import 'server-only';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Booking, DB, Locale } from '@/lib/types';
import { todayISO } from '@/lib/dates';
import { mutate, readDb } from './db/store';
import { queueEmail, smtpConfigured } from './events';

/**
 * Guest area without passwords: the guest types the e-mail used to book, receives a 6-digit code
 * (valid 10 minutes, 5 attempts) and is then remembered on this device for 14 days with a signed
 * cookie. The code lives only in this server's memory, hashed; the e-mail is kept in the Outbox
 * like every other service e-mail, so the owner can see that it was sent.
 */
export const GUEST_COOKIE = 'la_guest';
export const GUEST_TTL_SECONDS = 60 * 60 * 24 * 14;
const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_TRIES = 5;

type Pending = { hash: string; exp: number; tries: number; sentAt: number };
const g = globalThis as typeof globalThis & { __lancoraGuestCodes?: Map<string, Pending> };
const codes = (g.__lancoraGuestCodes ??= new Map());

export function normalizeEmail(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return s.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

const hashOf = (email: string, code: string) => createHash('sha256').update(`${email}:${code}`).digest('hex');

/** A website hold that ran out unpaid is not a booking for the guest: it never existed for them. */
const abandoned = (b: Booking) => b.status === 'cancelled' && b.holdExpiresAt !== null && b.amountPaid === 0;

export function bookingsForEmail(db: DB, email: string): Booking[] {
  return db.bookings.filter((b) => b.guest.email.trim().toLowerCase() === email && !abandoned(b));
}

export type CodeRequest = { ok: true; cooldown: number } | { ok: false; reason: 'no_email' };

/**
 * Sends a code when the address has bookings. The answer is the same whether or not it has any,
 * so nobody can find out who stays at the hotel by trying addresses.
 */
export function requestAccessCode(email: string, locale: Locale): CodeRequest {
  if (!smtpConfigured()) return { ok: false, reason: 'no_email' };
  const now = Date.now();
  const prev = codes.get(email);
  if (prev && now - prev.sentAt < RESEND_AFTER_MS) return { ok: true, cooldown: Math.ceil((RESEND_AFTER_MS - (now - prev.sentAt)) / 1000) };
  const db = readDb();
  const mine = bookingsForEmail(db, email);
  if (!mine.length) {
    // remember the attempt so the "send again" timer behaves the same for every address
    codes.set(email, { hash: '', exp: now + CODE_TTL_MS, tries: MAX_TRIES, sentAt: now });
    return { ok: true, cooldown: RESEND_AFTER_MS / 1000 };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  codes.set(email, { hash: hashOf(email, code), exp: now + CODE_TTL_MS, tries: 0, sentAt: now });
  if (codes.size > 2000) for (const [k, v] of codes) if (v.exp < now) codes.delete(k);
  // newest stay first, so the e-mail greets the guest by the name of the latest booking
  const latest = [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
  mutate((d) => {
    queueEmail(d, 'codice_accesso', email, { booking: latest, room: null, extra: { code, lang: locale } });
  });
  return { ok: true, cooldown: RESEND_AFTER_MS / 1000 };
}

export type CodeCheck = { ok: true } | { ok: false; reason: 'wrong' | 'expired' | 'locked'; left?: number };

export function verifyAccessCode(email: string, code: string): CodeCheck {
  const p = codes.get(email);
  const now = Date.now();
  if (!p || !p.hash || p.exp < now) return { ok: false, reason: 'expired' };
  if (p.tries >= MAX_TRIES) return { ok: false, reason: 'locked' };
  p.tries += 1;
  const a = Buffer.from(hashOf(email, code.replace(/\D/g, '')));
  const b = Buffer.from(p.hash);
  if (a.length === b.length && timingSafeEqual(a, b)) {
    codes.delete(email);
    return { ok: true };
  }
  return p.tries >= MAX_TRIES ? { ok: false, reason: 'locked' } : { ok: false, reason: 'wrong', left: MAX_TRIES - p.tries };
}

/* ---------- the signed "remember me" cookie ---------- */

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET mancante o troppo corto (min 32 caratteri)');
  return 'solo-sviluppo-locale-cambiare-SESSION_SECRET-0123456789abcdef';
}
const sign = (body: string) => createHmac('sha256', secret()).update(`guest:${body}`).digest('base64url');

export function signGuest(email: string): string {
  const body = Buffer.from(JSON.stringify({ e: email, x: Math.floor(Date.now() / 1000) + GUEST_TTL_SECONDS })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readGuest(token: string | undefined | null): string | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { e?: string; x?: number };
    return p.e && typeof p.x === 'number' && p.x > Date.now() / 1000 ? normalizeEmail(p.e) : null;
  } catch {
    return null;
  }
}

/* ---------- what the guest sees ---------- */

export type GuestStay = {
  token: string;
  code: string;
  roomName: string | null;
  roomNumber: string | null;
  photo: string | null;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  total: number;
  paid: number;
  method: Booking['paymentMethod'] | null;
  state: 'pending' | 'upcoming' | 'inhouse' | 'past' | 'cancelled';
  source: Booking['source'];
};

export function guestOverview(email: string): { name: string; stays: GuestStay[] } {
  const db = readDb();
  const today = todayISO();
  const mine = bookingsForEmail(db, email);
  const latest = [...mine].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const stays = mine.map((b): GuestStay => {
    const r = db.rooms.find((x) => x.id === b.roomId);
    const state: GuestStay['state'] =
      b.status === 'cancelled' ? 'cancelled' : b.status === 'pending_payment' ? 'pending' : b.checkOut <= today ? 'past' : b.checkIn <= today ? 'inhouse' : 'upcoming';
    return {
      token: b.token,
      code: b.code,
      roomName: r?.name ?? null,
      roomNumber: null,
      photo: r?.photos?.[0]?.src ?? null,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      adults: b.adults,
      children: b.children,
      total: b.total,
      paid: b.amountPaid,
      method: b.paymentMethod ?? null,
      state,
      source: b.source,
    };
  });
  const rank: Record<GuestStay['state'], number> = { inhouse: 0, pending: 1, upcoming: 2, past: 3, cancelled: 4 };
  stays.sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'past' || a.state === 'cancelled' ? b.checkIn.localeCompare(a.checkIn) : a.checkIn.localeCompare(b.checkIn)));
  return { name: latest?.guest.firstName ?? '', stays };
}
