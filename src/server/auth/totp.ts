import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { TwoFactor } from '@/lib/types';
import { hashPassword, verifyPassword } from './password';

/**
 * The second step of the login: 6-digit codes that change every 30 seconds (RFC 6238, the standard
 * read by Google Authenticator, Microsoft Authenticator, Authy, 1Password…). Everything is computed
 * here: no outside service is involved and nothing leaves the server.
 */

export const ISSUER = 'Hotel L’Ancora';
const STEP_SECONDS = 30;
const DIGITS = 6;

// ── base32 (RFC 4648), the format the apps expect for the key ────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Chiave non valida');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new key for the app: 160 random bits, as the RFC recommends for HMAC-SHA1. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code of one 30-second step (RFC 4226 dynamic truncation). */
export function codeAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepOf = (ms: number = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Checks a code allowing one step before and after (a phone clock a little off). Returns the step
 * that matched, or null. A step at or before `lastStep` is refused: a code works only once.
 */
export function checkCode(secret: string, code: string, opts: { now?: number; lastStep?: number } = {}): number | null {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== DIGITS) return null;
  const now = stepOf(opts.now);
  for (const step of [now, now - 1, now + 1]) {
    if (opts.lastStep !== undefined && step <= opts.lastStep) continue;
    const a = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(a, Buffer.from(digits))) return step;
  }
  return null;
}

/** What the QR code holds: the app reads the key, the hotel's name and the account from it. */
export function otpauthUri(secret: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** The key written by hand, in groups of four ("ABCD EFGH …"). */
export const groupKey = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

// ── the key at rest: sealed with the site's secret (AES-256-GCM) ─────────────
// A copy of the database alone (Supabase, a backup) is not enough to produce the codes.

function siteKey(): Buffer {
  const s = process.env.SESSION_SECRET;
  const base = s && s.length >= 32 ? s : process.env.NODE_ENV === 'production' ? null : 'solo-sviluppo-locale-cambiare-SESSION_SECRET-0123456789abcdef';
  if (!base) throw new Error('SESSION_SECRET mancante o troppo corto (min 32 caratteri)');
  return createHash('sha256').update(`lancora-2fa|${base}`).digest();
}

/** A short fingerprint of the key: tells "sealed with another secret" from "damaged". */
const keyId = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 8);
const b64u = (b: Buffer) => b.toString('base64url');

export function sealSecret(secret: string): string {
  const key = siteKey();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `v1.${keyId(key)}.${b64u(iv)}.${b64u(c.getAuthTag())}.${b64u(ct)}`;
}

export class SealError extends Error {}

/** The key back. SealError when it was sealed on a server with a different SESSION_SECRET. */
export function openSecret(sealed: string): string {
  const [v, kid, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !kid || !iv || !tag || !ct) throw new SealError('Formato non valido');
  const key = siteKey();
  if (kid !== keyId(key)) throw new SealError('Chiave del sito diversa');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** False when the key was sealed on a server with another SESSION_SECRET (the site was moved). */
export function secretReadable(sealed: string): boolean {
  try {
    openSecret(sealed);
    return true;
  } catch {
    return false;
  }
}

/**
 * A short-lived sealed note (the key being set up, before the first code confirms it). Bound to one
 * account and refused after `ttlMs`.
 */
export function sealNote(data: Record<string, unknown>, ttlMs: number): string {
  return sealSecret(JSON.stringify({ ...data, exp: Date.now() + ttlMs }));
}

export function openNote<T extends Record<string, unknown>>(note: string): T | null {
  try {
    const d = JSON.parse(openSecret(note)) as T & { exp: number };
    return typeof d.exp === 'number' && d.exp > Date.now() ? d : null;
  } catch {
    return null;
  }
}

// ── emergency codes (phone lost or changed) ─────────────────────────────────
// No 0/O, 1/I/L: easy to read on paper and to type.
const RC = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    let s = '';
    for (let i = 0; i < 10; i++) s += RC[randomInt(RC.length)];
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

const normRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Looks like an emergency code rather than a 6-digit one. */
export const isRecoveryShape = (code: string) => normRecovery(code).length === 10;

export const hashRecovery = (code: string) => hashPassword(normRecovery(code));

/** The position of the matching emergency code, or -1. */
export function findRecovery(tf: TwoFactor, code: string): number {
  const c = normRecovery(code);
  if (c.length !== 10) return -1;
  let hit = -1;
  // every fingerprint is checked, so the time taken does not say which one matched
  tf.recovery.forEach((h, i) => {
    if (verifyPassword(c, h) && hit < 0) hit = i;
  });
  return hit;
}

export type CodeCheck = { ok: true; via: 'app' | 'recovery'; step?: number; index?: number } | { ok: false; reason: 'wrong' | 'moved' };

/**
 * Checks what was typed at the second step: a code from the app, or an emergency code. `moved`:
 * the key was sealed on a server with another SESSION_SECRET, only an emergency code can help.
 */
export function checkSecondStep(tf: TwoFactor, code: string, now?: number): CodeCheck {
  if (isRecoveryShape(code)) {
    const index = findRecovery(tf, code);
    return index >= 0 ? { ok: true, via: 'recovery', index } : { ok: false, reason: 'wrong' };
  }
  let secret: string;
  try {
    secret = openSecret(tf.secret);
  } catch {
    return { ok: false, reason: 'moved' };
  }
  const step = checkCode(secret, code, { now, lastStep: tf.lastStep });
  return step === null ? { ok: false, reason: 'wrong' } : { ok: true, via: 'app', step };
}
