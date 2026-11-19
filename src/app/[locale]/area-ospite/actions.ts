'use server';
import { cookies } from 'next/headers';
import { isLocale } from '@/lib/i18n/config';
import { GUEST_COOKIE, GUEST_TTL_SECONDS, normalizeEmail, requestAccessCode, signGuest, verifyAccessCode } from '@/server/guest-access';
import { clientIp, rateLimit } from '@/server/security';

const HOUR = 60 * 60_000;

export type AskResult = { ok: true; cooldown: number } | { ok: false; error: 'email' | 'busy' | 'no_email' };

/** Step 1: e-mail → code by e-mail (same answer whether or not the address has bookings). */
export async function askCode(rawEmail: string, rawLocale: string): Promise<AskResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: 'email' };
  const ip = await clientIp();
  if (!rateLimit(`guest-code-ip:${ip}`, 8, HOUR) || !rateLimit(`guest-code-mail:${email}`, 5, HOUR)) return { ok: false, error: 'busy' };
  const r = requestAccessCode(email, isLocale(rawLocale) ? rawLocale : 'it');
  return r.ok ? { ok: true, cooldown: r.cooldown } : { ok: false, error: 'no_email' };
}

export type CheckResult = { ok: true } | { ok: false; error: 'wrong' | 'expired' | 'locked' | 'busy'; left?: number };

/** Step 2: the 6 digits → this device stays signed in for 14 days. */
export async function checkCode(rawEmail: string, code: string): Promise<CheckResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: 'expired' };
  const ip = await clientIp();
  if (!rateLimit(`guest-verify-ip:${ip}`, 30, HOUR)) return { ok: false, error: 'busy' };
  const r = verifyAccessCode(email, code);
  if (!r.ok) return { ok: false, error: r.reason, left: r.left };
  (await cookies()).set(GUEST_COOKIE, signGuest(email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.APP_URL ?? '').startsWith('https://'),
    path: '/',
    maxAge: GUEST_TTL_SECONDS,
  });
  return { ok: true };
}

export async function signOutGuest(): Promise<void> {
  (await cookies()).delete(GUEST_COOKIE);
}
