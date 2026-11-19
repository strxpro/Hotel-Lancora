import { redirect } from 'next/navigation';
import { isLocale, localePath } from '@/lib/i18n/config';

type Props = { params: Promise<{ locale: string }> };

/** No separate page any more: old links open the privacy popup on the home page. */
export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  redirect(`${localePath(isLocale(locale) ? locale : 'it', '/')}#privacy`);
}
