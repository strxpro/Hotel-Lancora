import type { Metadata } from 'next';
import Image from 'next/image';
import { isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/types';
import { readDb } from '@/server/db/store';
import { alternates } from '@/server/seo';
import { MEDIA } from '@/content/media';
import { EXPERIENCES } from '@/content/experiences';
import { ImageReveal, Reveal, SplitHeading } from '@/components/site/motion-kit';
import { AreaMap } from '@/components/site/place-map';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const l = (isLocale(locale) ? locale : 'it') as Locale;
  const t = getDictionary(l);
  return { title: t.experiences.title, description: t.experiences.intro, alternates: alternates(l, '/esperienze') };
}

export default async function ExperiencesPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = (isLocale(raw) ? raw : 'it') as Locale;
  const t = getDictionary(locale);
  const { hotel } = readDb().settings;
  return (
    <>
      <section className="bg-ivory p-2 sm:p-3">
        <div className="relative flex min-h-[88svh] items-end overflow-hidden rounded-[1.6rem] bg-navy pb-16 text-ivory sm:rounded-[2.2rem] md:pb-24">
          <Image src={MEDIA.capoTestaGraniti.src} alt={MEDIA.capoTestaGraniti.alt} fill preload sizes="100vw" quality={85} className="object-cover" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,28,43,0.45),rgba(10,28,43,0.1)_40%,rgba(10,28,43,0.65))]" />
          <div className="relative w-full px-5 sm:px-8 md:px-12 lg:px-16">
            <p className="eyebrow text-gold">{t.experiences.eyebrow}</p>
            <SplitHeading as="h1" immediate className="display mt-6 max-w-[14ch] text-display">
              {t.experiences.title}
            </SplitHeading>
            <p className="mt-8 max-w-lg text-[1.05rem] leading-relaxed text-ivory/85">{t.experiences.intro}</p>
          </div>
        </div>
      </section>

      <div className="bg-ivory py-24 md:py-36">
        <div className="container-x space-y-28 md:space-y-44">
          {EXPERIENCES.map((x, i) => {
            const m = MEDIA[x.image];
            const flip = i % 2 === 1;
            return (
              <article key={x.id} id={x.id} className="grid items-center gap-10 md:grid-cols-12">
                <div className={cn('md:col-span-7', flip && 'md:order-2 md:col-start-6')}>
                  <ImageReveal className={cn('bg-sand', i % 3 === 0 ? 'aspect-[16/11]' : 'aspect-[4/3]')} direction={flip ? 'right' : 'left'} parallax={5}>
                    <Image src={m.src} alt={m.alt} fill sizes="(min-width:768px) 58vw, 100vw" className="object-cover" />
                  </ImageReveal>
                  <p className="mt-3 text-[0.68rem] text-mist">
                    Foto: {m.credit} · {m.license}
                  </p>
                </div>
                <Reveal className={cn('md:col-span-4', flip ? 'md:order-1 md:col-start-1' : 'md:col-start-9')}>
                  <p className="eyebrow text-gold-2">
                    0{i + 1} · {x.kind[locale]}
                  </p>
                  <h2 className="display mt-5 text-[clamp(2.4rem,4vw,4rem)] text-navy">{x.name}</h2>
                  <p className="mt-6 text-[1.02rem] leading-[1.8] text-charcoal/85">{x.text[locale]}</p>
                  <dl className="mt-8 flex gap-10 border-t border-line pt-5 text-sm">
                    <div>
                      <dt className="label">{t.experiences.distance}</dt>
                      <dd className="text-navy">{x.distance}</dd>
                    </div>
                    <div>
                      <dt className="label flex items-center gap-1.5"><Clock className="h-3 w-3" aria-label="tempo" /></dt>
                      <dd className="text-navy">{x.time[locale]}</dd>
                    </div>
                  </dl>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${x.lat},${x.lng}`} target="_blank" rel="noopener noreferrer" className="link-u mt-6 inline-block text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-navy">
                    {t.experiences.open}
                  </a>
                </Reveal>
              </article>
            );
          })}
        </div>
      </div>

      <section id="mappa" className="bg-ivory-2 py-24 md:py-32">
        <div className="container-x">
          <h2 className="display text-[clamp(2.4rem,4vw,4rem)] text-navy">{t.sections.mapTitle}</h2>
          <div className="mt-10">
            <AreaMap hotel={{ lat: hotel.lat, lng: hotel.lng, name: hotel.name, verified: hotel.addressVerified }} />
          </div>
        </div>
      </section>
    </>
  );
}
