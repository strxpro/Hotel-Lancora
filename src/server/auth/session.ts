/**
 * Stateless signed session tokens (HMAC-SHA256 via Web Crypto, so they can be verified both in
 * the Next.js proxy and in server code). Payload is not secret, only tamper-proof.
 */
import type { Role } from '@/lib/types';

export const SESSION_COOKIE = 'la_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  uid: string;
  role: Role;
  name: string;
  iat: number;
  exp: number;
  /** fingerprint of the password and of the phone code: a session dies when either changes */
  st?: string;
}

/** Between the password and the code from the phone (5 minutes). */
export const LOGIN_STEP_COOKIE = 'la_2fa';
export const LOGIN_STEP_TTL_SECONDS = 5 * 60;
/** "Don't ask for the code on this device for 30 days". */
export const TRUST_COOKIE = 'la_trust';
export const TRUST_TTL_SECONDS = 60 * 60 * 24 * 30;

/** The other signed notes carry a kind, so none of them can ever be used as a session. */
export interface StepPayload {
  k: 'login2fa' | 'trust';
  uid: string;
  st: string;
  iat: number;
  exp: number;
}

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET mancante o troppo corto (min 32 caratteri)');
  return 'solo-sviluppo-locale-cambiare-SESSION_SECRET-0123456789abcdef';
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncode(text: string): string {
  return b64urlFromBytes(enc.encode(text));
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64urlFromBytes(new Uint8Array(sig));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sign(payload: object, ttl: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlEncode(JSON.stringify({ ...payload, iat: now, exp: now + ttl }));
  return `${body}.${await hmac(body)}`;
}

async function verify(token: string | undefined | null): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    if (!safeEqual(await hmac(body), sig)) return null;
    const p = JSON.parse(b64urlDecode(body)) as Record<string, unknown>;
    if (typeof p.uid !== 'string' || !p.uid || typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

export async function signSession(p: Omit<SessionPayload, 'iat' | 'exp'>): Promise<string> {
  return sign(p, SESSION_TTL_SECONDS);
}

export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  const p = await verify(token);
  // a note of another kind (the step before the code, a trusted device) is never a session
  if (!p || 'k' in p) return null;
  return p as unknown as SessionPayload;
}

export async function signStep(kind: StepPayload['k'], uid: string, st: string): Promise<string> {
  return sign({ k: kind, uid, st }, kind === 'trust' ? TRUST_TTL_SECONDS : LOGIN_STEP_TTL_SECONDS);
}

export async function verifyStep(kind: StepPayload['k'], token: string | undefined | null): Promise<StepPayload | null> {
  const p = await verify(token);
  return p && p.k === kind && typeof p.st === 'string' ? (p as unknown as StepPayload) : null;
}
