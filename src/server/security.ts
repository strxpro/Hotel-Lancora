import 'server-only';
import { headers } from 'next/headers';

type Bucket = { hits: number[] };
const g = globalThis as unknown as { __lancoraRate?: Map<string, Bucket> };
const buckets = (g.__lancoraRate ??= new Map());

/** Sliding-window in-memory rate limiter (per process). Returns true when allowed. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t: number) => now - t < windowMs);
  if (b.hits.length >= limit) {
    buckets.set(key, b);
    return false;
  }
  b.hits.push(now);
  buckets.set(key, b);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.hits.length) buckets.delete(k);
  return true;
}

/**
 * The visitor's address, for the limits on attempts. The LAST entry of X-Forwarded-For is the one
 * written by our own proxy (Cloudflare's tunnel, or the web server on the real host): the first ones
 * come from the visitor and can be anything, so trusting them would let a script pretend to be a new
 * visitor at every attempt (password guessing, emptying the AI's daily quota…).
 */
export function ipOf(h: Headers): string {
  const chain = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return (chain[chain.length - 1] || h.get('x-real-ip') || 'local').trim().slice(0, 64);
}

export async function clientIp(): Promise<string> {
  return ipOf(await headers());
}

/**
 * The address the visitor is really using: localhost, the LAN address, a temporary tunnel or the real
 * domain. Links that send the visitor back to the site (e.g. Stripe's return page) use it, so a guest
 * who books through a public link comes back to that link and not to this computer's localhost.
 * Falls back to APP_URL outside a request or when the Host header looks wrong.
 */
export async function requestOrigin(): Promise<string> {
  const fallback = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  try {
    const h = await headers();
    const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0]!.trim();
    if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return fallback;
    const local = /^(localhost|127\.|10\.|192\.168\.|\[?::1)/i.test(host);
    const proto = (h.get('x-forwarded-proto') || '').split(',')[0]!.trim().toLowerCase() || (local ? 'http' : 'https');
    return `${proto === 'https' ? 'https' : 'http'}://${host}`;
  } catch {
    return fallback;
  }
}

/** Basic CSRF defence for JSON route handlers: the Origin must match the Host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return req.method === 'GET';
  try {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Only allow relative, same-site redirect targets (prevents open redirects). */
export function safeRedirect(target: string | null | undefined, fallback = '/admin'): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return fallback;
  return target;
}

export function clean(s: unknown, max = 2000): string {
  return typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '';
}
