import { NextResponse } from 'next/server';
import { can, getCurrentUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { requestOrigin } from '@/server/security';
import { connectOnboardingLink, stripeMode } from '@/server/payments/stripe';

export const dynamic = 'force-dynamic';

/** Onboarding links are single-use and short-lived: Stripe calls this to get a fresh one. */
export async function GET() {
  // back to the address the owner started from (their panel session lives there)
  const base = await requestOrigin();
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'payments.manage')) return NextResponse.redirect(`${base}/admin/login`);
  const c = readDb().settings.stripeConnect;
  if (stripeMode() === 'off' || !c.accountId || c.simulated) return NextResponse.redirect(`${base}/admin/pagamenti`);
  try {
    return NextResponse.redirect(await connectOnboardingLink(c.accountId, base));
  } catch {
    return NextResponse.redirect(`${base}/admin/pagamenti?stripe=errore`);
  }
}
