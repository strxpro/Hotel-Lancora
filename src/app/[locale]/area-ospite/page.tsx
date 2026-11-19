import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { isLocale } from '@/lib/i18n/config';
import { ACCOUNT_T } from '@/lib/i18n/account-dict';
import type { Locale } from '@/lib/types';
import { GUEST_COOKIE, guestOverview, readGuest } from '@/server/guest-access';
import { GuestSignIn, GuestStays } from '@/components/site/account';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: ACCOUNT_T[(isLocale(locale) ? locale : 'it') as Locale].nav, robots: { index: false, follow: false } };
}

/** Guest area: sign in with a code sent by e-mail, then every booking made with that address. */
export default async function GuestAreaPage() {
  const email = readGuest((await cookies()).get(GUEST_COOKIE)?.value);
  const view = email ? guestOverview(email) : null;
  return (
    <div className="min-h-[80svh] bg-ivory pb-28 pt-32 md:pt-44">
      <div className="container-x">{view && email ? <GuestStays email={email} name={view.name} stays={view.stays} /> : <GuestSignIn />}</div>
    </div>
  );
}
