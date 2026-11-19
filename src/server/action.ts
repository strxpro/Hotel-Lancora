import 'server-only';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { AuthError, requireUser, type Permission, type SafeUser } from './auth/guard';
import { BookingError } from './bookings';
import { RoomError } from './rooms';

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export class UserError extends Error {}

/** Wraps every admin mutation: server-side permission check, error mapping, cache refresh. */
export async function act<T>(perm: Permission, fn: (user: SafeUser) => T | Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const user = await requireUser(perm);
    const data = await fn(user);
    revalidatePath('/', 'layout');
    return { ok: true, data, message };
  } catch (e) {
    if (e instanceof AuthError || e instanceof BookingError || e instanceof RoomError || e instanceof UserError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: `Dati non validi: ${e.issues.map((i) => i.path.join('.') || i.message).slice(0, 3).join(', ')}` };
    console.error('[admin action]', e);
    return { ok: false, error: 'Operazione non riuscita. Riprova.' };
  }
}
