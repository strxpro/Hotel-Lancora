import { NextResponse } from 'next/server';
import { can, getCurrentUser } from '@/server/auth/guard';
import { mutate, readDb } from '@/server/db/store';
import { requestOrigin } from '@/server/security';
import { retrieveConnectStatus, stripeMode } from '@/server/payments/stripe';

export const dynamic = 'force-dynamic';

/** Stripe sends the owner back here after onboarding: refresh the account status and go back to the panel. */
export async function GET() {
  // back to the address the owner started from (their panel session lives there)
  const base = await requestOrigin();
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'payments.manage')) return NextResponse.redirect(`${base}/admin/login`);
  const c = readDb().settings.stripeConnect;
  if (stripeMode() === 'off' || !c.accountId || c.simulated) return NextResponse.redirect(`${base}/admin/pagamenti`);
  try {
    const s = await retrieveConnectStatus(c.accountId);
    mutate((db) => Object.assign(db.settings.stripeConnect, { ...s, updatedAt: new Date().toISOString() }));
    return NextResponse.redirect(`${base}/admin/pagamenti?stripe=${s.chargesEnabled ? 'ok' : 'incompleto'}`);
  } catch {
    return NextResponse.redirect(`${base}/admin/pagamenti?stripe=errore`);
  }
}
