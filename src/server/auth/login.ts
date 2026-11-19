import 'server-only';
import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import type { User } from '@/lib/types';
import { LOGIN_STEP_COOKIE, LOGIN_STEP_TTL_SECONDS, SESSION_COOKIE, SESSION_TTL_SECONDS, TRUST_COOKIE, TRUST_TTL_SECONDS, signSession, signStep, verifyStep } from './session';

/**
 * Fingerprint of what proves who someone is: the password and, when on, the phone code. Written in
 * every session: changing the password or turning the code on/off ends the sessions open elsewhere
 * (a lost phone, a computer left logged in at the reception…).
 */
export function stampOf(u: Pick<User, 'passwordHash' | 'twoFactor'>): string {
  return createHash('sha256').update(`${u.passwordHash}|${u.twoFactor?.enabledAt ?? ''}`).digest('base64url').slice(0, 16);
}

const cookieOpts = (maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge });

/** Logs the person in on this browser (and keeps them logged in after their own password/code change). */
export async function issueSession(u: Pick<User, 'id' | 'role' | 'name' | 'passwordHash' | 'twoFactor'>): Promise<void> {
  const token = await signSession({ uid: u.id, role: u.role, name: u.name, st: stampOf(u) });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOpts(SESSION_TTL_SECONDS));
  jar.delete(LOGIN_STEP_COOKIE);
}

/** Password right, code still to come: remembered for 5 minutes on this browser only. */
export async function startCodeStep(u: Pick<User, 'id' | 'passwordHash' | 'twoFactor'>): Promise<void> {
  (await cookies()).set(LOGIN_STEP_COOKIE, await signStep('login2fa', u.id, stampOf(u)), cookieOpts(LOGIN_STEP_TTL_SECONDS));
}

export async function codeStepUser(): Promise<{ uid: string; st: string } | null> {
  const p = await verifyStep('login2fa', (await cookies()).get(LOGIN_STEP_COOKIE)?.value);
  return p ? { uid: p.uid, st: p.st } : null;
}

export async function clearCodeStep(): Promise<void> {
  (await cookies()).delete(LOGIN_STEP_COOKIE);
}

/** "Don't ask for the code again on this device for 30 days" (ends when the code is turned off/on again or the password changes). */
export async function trustThisDevice(u: Pick<User, 'id' | 'passwordHash' | 'twoFactor'>): Promise<void> {
  (await cookies()).set(TRUST_COOKIE, await signStep('trust', u.id, stampOf(u)), cookieOpts(TRUST_TTL_SECONDS));
}

export async function deviceTrusted(u: Pick<User, 'id' | 'passwordHash' | 'twoFactor'>): Promise<boolean> {
  const p = await verifyStep('trust', (await cookies()).get(TRUST_COOKIE)?.value);
  return Boolean(p && p.uid === u.id && p.st === stampOf(u));
}
