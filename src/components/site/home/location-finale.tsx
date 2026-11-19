'use client';
import Image from 'next/image';
import { motion } from 'motion/react';
import { Footprints, MapPin, Navigation, Plane, Ship } from 'lucide-react';
import { MEDIA } from '@/content/media';
import { FINALE_T } from '@/lib/i18n/reviews-dict';
import { useI18n } from '../providers';
import { SplitHeading } from '../motion-kit';
import { TLink } from '../transition';
import { directionsUrl } from '../place-map';
import { Town3D } from './town-3d';

const EASE = [0.22, 0.61, 0.12, 1] as const;

/**
 * Last section before the footer: where the hotel is (photo, address, how to get here) and an
 * interactive 3D "skeleton" of the coast that builds itself on screen.
 */
export function LocationFinale({ hotel }: { hotel: { name: string; lat: number; lng: number; addressLine: string; postalCode: string; city: string; province: string; verified: boolean } }) {
  const { href, locale } = useI18n();
  const f = FINALE_T[locale];
  const items = [
    { icon: Footprints, title: f.beach, sub: f.beachTime },
    { icon: Ship, title: f.ferry, sub: f.ferryTime },
    { icon: Plane, title: f.airport, sub: f.airportTime },
  ];
  return (
    <section id="dove-siamo" aria-labelledby="finale-title" className="relative overflow-hidden bg-navy-3 py-20 text-ivory md:py-28">
      <span aria-hidden="true" className="pointer-events-none absolute -left-40 top-10 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(182,149,98,0.14),transparent)]" />
      <div className="container-x relative grid gap-10 [&>*]:min-w-0 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-5">
          <p className="eyebrow text-gold">{f.eyebrow}</p>
          <SplitHeading as="h2" className="display mt-5 text-[clamp(2.3rem,4.2vw,4.2rem)] text-ivory">
            <span id="finale-title">{f.title}</span>
          </SplitHeading>
          <p className="mt-5 max-w-md text-[0.98rem] leading-relaxed text-ivory/70">{f.text}</p>
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.8, ease: EASE }} className="mt-8 flex gap-4 rounded-[1.75rem] bg-white/[0.06] p-3 ring-1 ring-white/10">
            <span className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[1.3rem] sm:h-32 sm:w-36">
              <Image src={MEDIA.paese.src} alt={MEDIA.paese.alt} fill sizes="150px" className="object-cover" />
            </span>
            <span className="flex min-w-0 flex-col justify-center gap-1 pr-2">
              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold">{f.address}</span>
              <span className="serif text-[1.4rem] leading-tight">{hotel.name}</span>
              <span className="flex items-start gap-1.5 text-sm text-ivory/70">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                {hotel.verified ? `${hotel.addressLine}, ${hotel.postalCode} ${hotel.city} (${hotel.province})` : `${hotel.postalCode} ${hotel.city} (${hotel.province}) · ${f.pending}`}
              </span>
            </span>
          </motion.div>
          <ul className="mt-5 space-y-2">
            {items.map((it, i) => (
              <motion.li key={it.title} initial={{ opacity: 0, x: -14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.08, duration: 0.6, ease: EASE }} className="flex items-center gap-3 rounded-2xl px-2 py-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
                  <it.icon className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <span className="block text-sm text-ivory">{it.title}</span>
                  <span className="block text-xs text-ivory/55">{it.sub}</span>
                </span>
              </motion.li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href={directionsUrl(hotel.lat, hotel.lng)} target="_blank" rel="noopener noreferrer" className="btn btn-gold h-12 min-h-0 px-6">
              <Navigation className="h-4 w-4" /> Google Maps
            </a>
            <TLink href={href('/contatti')} className="btn h-12 min-h-0 border border-ivory/25 px-6 text-ivory hover:bg-ivory hover:text-navy">
              {f.write}
            </TLink>
          </div>
        </div>
        <div className="relative lg:col-span-7">
          <div className="relative aspect-square w-full overflow-hidden rounded-[2rem] bg-[radial-gradient(ellipse_at_50%_40%,rgba(23,52,77,0.9),rgba(10,28,43,1)_70%)] ring-1 ring-white/10 sm:aspect-[5/4] lg:aspect-[6/5]">
            <Town3D hotel={hotel} hint={f.drag} className="absolute inset-0" />
            <span className="pointer-events-none absolute bottom-3 right-4 text-[0.55rem] text-ivory/35">© OpenStreetMap</span>
          </div>
        </div>
      </div>
    </section>
  );
}
