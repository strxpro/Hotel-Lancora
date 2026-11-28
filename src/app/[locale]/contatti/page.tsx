import type { Metadata } from 'next';
import { Mail, MapPin, Phone } from 'lucide-react';
import { isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/types';
import { readDb } from '@/server/db/store';
import { alternates } from '@/server/seo';
import { ContactForm } from '@/components/site/contact-form';
import { AreaMap } from '@/components/site/place-map';
import { SplitHeading } from '@/components/site/motion-kit';
import { CONTACT_T } from '@/lib/i18n/reviews-dict';
import { WhatsAppContact } from '@/components/site/whatsapp-contact';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const l = (isLocale(locale) ? locale : 'it') as Locale;
  return { title: getDictionary(l).contact.title, alternates: alternates(l, '/contatti') };
}

export default async function ContactPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const t = getDictionary(locale);
  const { hotel: h, demoMode } = readDb().settings;
  return (
    <div className="bg-ivory pb-28 pt-36 md:pt-48">
      <div className="container-x grid gap-16 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="eyebrow text-gold-2">{t.contact.reception}</p>
          <SplitHeading as="h1" immediate className="display mt-5 text-headline text-navy">
            {t.contact.title}
          </SplitHeading>
          <p className="mt-8 max-w-md text-[1.05rem] leading-relaxed text-charcoal/80">{t.contact.text}</p>
          <ul className="mt-12 space-y-6 text-[0.98rem]">
            <li className="flex gap-4">
              <Phone className="mt-1 h-4 w-4 text-gold-2" />
              <span>
                <span className="label mb-1">{t.contact.phone}</span>
                <a href={`tel:${h.phone.replace(/\s/g, '')}`} className="link-u text-navy">
                  {h.phone}
                </a>
              </span>
            </li>
            {/* shown when the hotel has a WhatsApp number (Impostazioni → Hotel) */}
            {h.whatsapp && h.whatsapp.replace(/\D/g, '').length >= 8 && <WhatsAppContact number={h.whatsapp} hotel={h.name} />}
            <li className="flex gap-4">
              <Mail className="mt-1 h-4 w-4 text-gold-2" />
              <span>
                <span className="label mb-1">{t.contact.email}</span>
                <a href={`mailto:${h.email}`} className="link-u text-navy">
                  {h.email}
                </a>
              </span>
            </li>
            <li className="flex gap-4">
              <MapPin className="mt-1 h-4 w-4 text-gold-2" />
              <span>
                <span className="label mb-1">{t.contact.address}</span>
                <span className="text-navy">{h.addressVerified ? `${h.addressLine}, ${h.postalCode} ${h.city} (${h.province})` : `${h.postalCode} ${h.city} (${h.province})`}</span>
                {!h.addressVerified && <span className="block text-sm text-mist">{t.sections.addressPending}</span>}
              </span>
            </li>
          </ul>
          {demoMode && !h.factsVerified && <p className="mt-10 border-l border-gold pl-4 text-xs leading-relaxed text-mist">{t.footer.demo}</p>}
        </div>
        <div id="scrivici" className="scroll-mt-28 rounded-[1.75rem] border border-line bg-white p-6 shadow-[0_40px_90px_-50px_rgba(16,40,61,0.45)] sm:p-9 lg:col-span-6 lg:col-start-7">
          <p className="eyebrow mb-6 text-gold-2">{CONTACT_T[locale].title}</p>
          <ContactForm />
        </div>
      </div>
      <div className="container-x mt-24">
        <AreaMap hotel={{ lat: h.lat, lng: h.lng, name: h.name, verified: h.addressVerified }} />
      </div>
    </div>
  );
}
