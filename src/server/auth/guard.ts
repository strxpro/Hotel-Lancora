import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { User } from '@/lib/types';
import { readDb } from '../db/store';
import { SESSION_COOKIE, verifySession } from './session';
import { stampOf } from './login';

export { can, type Permission } from './permissions';
import { can, type Permission } from './permissions';

export type SafeUser = Omit<User, 'passwordHash' | 'twoFactor'> & { twoFactorOn: boolean };

export class AuthError extends Error {
  constructor(message: string, public status: 401 | 403 = 403) {
    super(message);
  }
}

export async function getCurrentUser(): Promise<SafeUser | null> {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = readDb().users.find((u) => u.id === session.uid);
  if (!user) return null;
  // the password or the phone code changed since this session began: log in again.
  // (A session from before these fingerprints existed is accepted only without the phone code.)
  if (session.st ? session.st !== stampOf(user) : Boolean(user.twoFactor)) return null;
  const { passwordHash: _ph, twoFactor, ...safe } = user;
  void _ph;
  return { ...safe, twoFactorOn: Boolean(twoFactor) };
}

/** For pages: redirects to the login page when not authenticated. */
export async function requirePageUser(perm?: Permission): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/admin/login');
  if (perm && !can(user.role, perm)) redirect('/admin?negato=1');
  return user;
}

/** For server actions / route handlers: throws AuthError. */
export async function requireUser(perm?: Permission): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError('Sessione scaduta: accedi di nuovo.', 401);
  if (perm && !can(user.role, perm)) throw new AuthError('Non hai i permessi per questa operazione.');
  return user;
}
