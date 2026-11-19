'use client';
import { useRef } from 'react';
import Link from 'next/link';
import { ArrowUp, MapPin } from 'lucide-react';
import { gsap, useGSAP, prefersReducedMotion } from '@/lib/gsap';
import { useI18n, useLenis } from './providers';
import { AnchorMark, Stars } from './brand';
import { Magnetic, SplitHeading } from './motion-kit';
import { TLink } from './transition';
import { openLegal } from './legal-dialog';
import { ACCOUNT_T } from '@/lib/i18n/account-dict';

export interface FooterHotel {
  name: string;
  stars: number;
  addressLine: string;
  postalCode: string;
  city: string;
  province: string;
  addressVerified: boolean;
  phone: string;
  email: string;
  cin: string;
  lat: number;
  lng: number;
  checkInFrom: string;
  checkOutBy: string;
}

export function Footer({ hotel, onCookies, demo = true }: { hotel: FooterHotel; onCookies?: () => void; /** the "demo website" line, gone once the hotel works with real data */ demo?: boolean }) {
  const { t, href, locale } = useI18n();
  const lenis = useLenis();
  const root = useRef<HTMLElement>(null);
  const word = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion() || !word.current) return;
      gsap.fromTo(word.current, { yPercent: 40 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom bottom', scrub: true } });
    },
    { scope: root },
  );

  const toTop = () => (lenis.current ? lenis.current.scrollTo(0, { duration: 1.6 }) : window.scrollTo({ top: 0, behavior: 'smooth' }));
  const maps = `https://www.google.com/maps/search/?api=1&query=${hotel.lat},${hotel.lng}`;

  return (
    <footer ref={root} className="relative overflow-hidden bg-navy text-ivory">
      <div className="container-x pb-10 pt-28 md:pt-40">
        <div className="grid gap-12 md:grid-cols-12 md:items-end">
          <SplitHeading as="h2" className="display text-[clamp(2.8rem,6.8vw,7.6rem)] md:col-span-9">
            {t.footer.headline}
          </SplitHeading>
          <div className="md:col-span-3 md:justify-self-end">
            <Magnetic>
              <TLink href={href('/prenotazione')} className="btn btn-gold h-14 px-9">
                {t.nav.book}
              </TLink>
            </Magnetic>
          </div>
        </div>

        <div className="mt-24 grid gap-12 border-t border-white/12 pt-14 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <AnchorMark className="h-10 w-9 text-gold" />
            <p className="mt-5 flex items-center gap-3 text-ivory/80">
              {hotel.name} <Stars n={hotel.stars} className="text-gold" />
            </p>
            {/* the national code only once the owner has written it (never "Da inserire" on the site) */}
            {hotel.cin && !/inserire|confermare/i.test(hotel.cin) && <p className="mt-2 text-ivory/55">CIN: {hotel.cin}</p>}
          </div>
          <div>
            <p className="eyebrow text-gold">{t.footer.contact}</p>
            <ul className="mt-5 space-y-2 text-ivory/80">
              <li>
                <a className="link-u" href={`tel:${hotel.phone.replace(/\s/g, '')}`}>
                  {hotel.phone}
                </a>
              </li>
              <li>
                <a className="link-u" href={`mailto:${hotel.email}`}>
                  {hotel.email}
                </a>
              </li>
              <li className="pt-2 text-ivory/60">
                {hotel.addressVerified ? `${hotel.addressLine}, ${hotel.postalCode} ${hotel.city} (${hotel.province})` : `${hotel.postalCode} ${hotel.city} (${hotel.province}) — ${t.sections.addressPending}`}
              </li>
              <li>
                <a className="link-u inline-flex items-center gap-2" href={maps} target="_blank" rel="noopener noreferrer">
                  <MapPin className="h-3.5 w-3.5" /> {t.footer.map}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="eyebrow text-gold">{t.footer.explore}</p>
            <ul className="mt-5 space-y-2 text-ivory/80">
              <li><TLink className="link-u" href={href('/camere')}>{t.nav.rooms}</TLink></li>
              <li><TLink className="link-u" href={href('/esperienze')}>{t.nav.experiences}</TLink></li>
              <li><Link className="link-u" href={href('/#posizione')}>{t.nav.location}</Link></li>
              <li><TLink className="link-u" href={href('/contatti')}>{t.nav.contact}</TLink></li>
              <li><TLink className="link-u" href={href('/area-ospite')}>{ACCOUNT_T[locale].nav}</TLink></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow text-gold">{t.footer.info}</p>
            <ul className="mt-5 space-y-2 text-ivory/80">
              <li>{t.room.checkIn}: {hotel.checkInFrom} · {t.room.checkOut}: {hotel.checkOutBy}</li>
              <li>
                <button type="button" className="link-u" onClick={(e) => openLegal('privacy', e.currentTarget)}>
                  {t.footer.privacy}
                </button>
              </li>
              <li>
                <button type="button" className="link-u" onClick={(e) => (onCookies ? onCookies() : openLegal('cookie', e.currentTarget))}>
                  {t.footer.cookies}
                </button>
              </li>
              <li>
                <button type="button" className="link-u" onClick={(e) => openLegal('crediti', e.currentTarget)}>
                  {t.footer.credits}
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-16 flex flex-col-reverse items-start justify-between gap-6 text-xs text-ivory/45 md:flex-row md:items-center">
          <p>
            © {new Date().getFullYear()} {hotel.name}. {t.footer.rights}
            {demo ? ` ${t.footer.demo}` : ''}
          </p>
          <button type="button" onClick={toTop} className="group flex items-center gap-3 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-ivory/80">
            {t.footer.top}
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 transition-colors group-hover:bg-ivory group-hover:text-navy">
              <ArrowUp className="h-4 w-4" />
            </span>
          </button>
        </div>
      </div>
      <div ref={word} aria-hidden="true" className="serif pointer-events-none select-none whitespace-nowrap px-2 text-center text-[17.5vw] leading-[0.78] tracking-[-0.02em] text-ivory/[0.06]">
        HOTEL L’ANCORA
      </div>
    </footer>
  );
}
