import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { isLocale, LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { readDb } from '@/server/db/store';
import { transcriptionConfigured } from '@/server/ai/transcribe';
import { SiteProviders } from '@/components/site/providers';
import { TransitionProvider } from '@/components/site/transition';
import { Header } from '@/components/site/header';
import { Footer } from '@/components/site/footer';
import { Preloader } from '@/components/site/preloader';
import { ChatWidget } from '@/components/site/chat-widget';
import { LegalDialog } from '@/components/site/legal-dialog';
import { cancelText, cancelTitle } from '@/lib/cancellation';
import { BackToTop } from '@/components/site/back-to-top';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = getDictionary(isLocale(locale) ? locale : 'it');
  return {
    description: `${t.hero.title} ${t.hero.subtitle}`,
    openGraph: { siteName: 'Hotel L’Ancora', type: 'website', locale, images: [{ url: '/media/demo/hero-capo-testa.jpg', width: 2600, height: 1463 }] },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const { hotel, payments, demoMode } = readDb().settings;
  const footerHotel = {
    name: hotel.name,
    stars: hotel.stars,
    addressLine: hotel.addressLine,
    postalCode: hotel.postalCode,
    city: hotel.city,
    province: hotel.province,
    addressVerified: hotel.addressVerified,
    phone: hotel.phone,
    email: hotel.email,
    cin: hotel.cin,
    lat: hotel.lat,
    lng: hotel.lng,
    checkInFrom: hotel.checkInFrom,
    checkOutBy: hotel.checkOutBy,
  };
  return (
    <SiteProviders locale={locale} dict={dict}>
      <TransitionProvider>
        <Preloader />
        <Header phone={hotel.phone} email={hotel.email} />
        <main id="contenuto">{children}</main>
        <Footer hotel={footerHotel} demo={demoMode} />
        <BackToTop />
        <ChatWidget voice={transcriptionConfigured()} />
        <LegalDialog hotel={{ name: hotel.name, addressLine: hotel.addressVerified ? hotel.addressLine : undefined, phone: hotel.phone, vat: hotel.vat, postalCode: hotel.postalCode, city: hotel.city, province: hotel.province, email: hotel.email, cancel: { title: cancelTitle(locale), text: [cancelText(locale, payments), payments.cancellationPolicy].filter(Boolean).join(' ') } }} />
      </TransitionProvider>
    </SiteProviders>
  );
}

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}
