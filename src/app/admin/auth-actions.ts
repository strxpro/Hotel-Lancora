'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readDb, mutate } from '@/server/db/store';
import { verifyPassword } from '@/server/auth/password';
import { SESSION_COOKIE } from '@/server/auth/session';
import { clearCodeStep, codeStepUser, deviceTrusted, issueSession, stampOf, startCodeStep, trustThisDevice } from '@/server/auth/login';
import { checkSecondStep, type CodeCheck } from '@/server/auth/totp';
import { clientIp, rateLimit, safeRedirect } from '@/server/security';
import { audit } from '@/server/events';

export type LoginState = { error?: string; step?: 'code'; name?: string } | undefined;

const TOO_MANY = 'Troppi tentativi. Riprova tra 15 minuti.';

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`, 8, 15 * 60_000)) return { error: TOO_MANY };
  const email = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 200);
  const password = String(form.get('password') ?? '').slice(0, 200);
  // one account guessed from many addresses at once is slowed down too
  if (email && !rateLimit(`login-account:${email}`, 12, 60 * 60_000)) return { error: 'Troppi tentativi su questo accesso. Riprova tra un’ora.' };
  const demoRole = process.env.DEMO_MODE === 'true'
    ? email === 'admin' ? 'admin' : email === 'per' ? 'staff' : null
    : null;
  const user = readDb().users.find((u) => demoRole ? u.role === demoRole : u.email === email);
  // constant work even when the user does not exist
  const ok = user ? verifyPassword(password, user.passwordHash) : (verifyPassword(password, 'scrypt$00$00'), false);
  if (!user || !ok) return { error: 'Login o password non corretti.' };
  // the phone code: asked unless this device was trusted for 30 days after a code
  if (user.twoFactor && !(await deviceTrusted(user))) {
    await startCodeStep(user);
    return { step: 'code', name: user.name.split(' ')[0] };
  }
  await issueSession(user);
  mutate((db) => audit(db, user.name, 'login', 'user', user.id, `Accesso (${user.role})${user.twoFactor ? ' · dispositivo fidato' : ''}`));
  redirect(safeRedirect(String(form.get('next') ?? ''), '/admin'));
}

/** Second step: the 6-digit code from the app, or one of the emergency codes. */
export async function loginCode(_: LoginState, form: FormData): Promise<LoginState> {
  const step = await codeStepUser();
  if (!step) return { error: 'Il tempo per inserire il codice è scaduto: inserisci di nuovo la password.' };
  const ip = await clientIp();
  if (!rateLimit(`code:${ip}`, 10, 15 * 60_000) || !rateLimit(`code-user:${step.uid}`, 6, 15 * 60_000)) return { step: 'code', error: TOO_MANY };
  const code = String(form.get('code') ?? '').slice(0, 40);
  let result: CodeCheck = { ok: false, reason: 'wrong' };
  let left = 0;
  // checked and written together: the same code can never open two sessions
  const user = mutate((db) => {
    const u = db.users.find((x) => x.id === step.uid);
    if (!u?.twoFactor || stampOf(u) !== step.st) return null;
    result = checkSecondStep(u.twoFactor, code);
    if (result.ok) {
      if (result.via === 'app') u.twoFactor.lastStep = result.step;
      else u.twoFactor.recovery.splice(result.index!, 1);
      left = u.twoFactor.recovery.length;
      audit(db, u.name, 'login', 'user', u.id, `Accesso (${u.role}) con ${result.via === 'app' ? 'codice dal telefono' : `codice di emergenza (ne restano ${left})`}`);
    } else {
      // the password was right: worth seeing in the history if it was not you
      audit(db, 'Sistema', 'login_failed', 'user', u.id, `Password giusta ma codice dal telefono sbagliato per ${u.email}`);
    }
    return { ...u };
  });
  if (!user) {
    await clearCodeStep();
    return { error: 'Il tempo per inserire il codice è scaduto: inserisci di nuovo la password.' };
  }
  const r = result as CodeCheck;
  if (!r.ok) {
    return {
      step: 'code',
      name: user.name.split(' ')[0],
      error: r.reason === 'moved'
        ? 'Il sito è stato spostato su un nuovo server e non riconosce più i codici dell’app: usa uno dei codici di emergenza, poi riattiva il codice in Impostazioni.'
        : 'Codice non corretto. Controlla l’app e riprova (il codice cambia ogni 30 secondi).',
    };
  }
  if (form.get('trust') === 'on') await trustThisDevice(user);
  await issueSession(user);
  // an emergency code used: the settings show how many are left and offer new ones
  redirect(r.via === 'recovery' ? `/admin/impostazioni?codici=${left}#sicurezza` : safeRedirect(String(form.get('next') ?? ''), '/admin'));
}

/** "Back": forgets the password step on this browser. */
export async function cancelLoginCode(): Promise<void> {
  await clearCodeStep();
}

/** One-click access for presentations. Only available while DEMO_MODE=true. */
export async function demoLogin(role: 'admin' | 'staff'): Promise<void> {
  if (process.env.DEMO_MODE !== 'true' || process.env.PUBLIC_DEMO === 'true') redirect('/admin/login');
  const user = readDb().users.find((u) => u.role === role);
  // a login protected by the phone code never opens with one click
  if (!user || user.twoFactor) redirect('/admin/login');
  await issueSession(user);
  mutate((db) => audit(db, user.name, 'login', 'user', user.id, `Accesso demo (${role})`));
  redirect('/admin');
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/admin/login');
}
