'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { animate, AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, Footprints, Mail, MessageCircle, Phone } from 'lucide-react';
import { MEDIA } from '@/content/media';
import { cn } from '@/lib/utils';
import { INTRO_T } from '@/lib/i18n/reviews-dict';
import { useI18n } from '../providers';
import { ImageReveal, SplitHeading } from '../motion-kit';

const EASE = [0.16, 1, 0.3, 1] as const;

/** A number that counts up once, when it scrolls into view. */
function Count({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '-60px' });
  useEffect(() => {
    const el = ref.current;
    if (!el || !seen) return;
    const c = animate(0, to, { duration: 1.4, ease: EASE, onUpdate: (v) => void (el.textContent = `${Math.round(v)}${suffix}`) });
    return () => c.stop();
  }, [seen, to, suffix]);
  return <span ref={ref}>0{suffix}</span>;
}

/**
 * The hotel at a glance, with the real facts of www.hotellancora.it: where it is, how many
 * rooms, what is in the room and in the hotel, and the three ways to book directly.
 */
export function IntroSection({ hotel, photos }: { hotel: { phone: string; whatsapp?: string; email: string }; photos?: { src: string; alt: string }[] }) {
  const { t, locale } = useI18n();
  const x = INTRO_T[locale];
  const wa = hotel.whatsapp?.replace(/\D/g, '');
  const contacts = [
    { icon: Phone, label: x.call, value: hotel.phone, href: `tel:${hotel.phone.replace(/\s/g, '')}` },
    ...(wa ? [{ icon: MessageCircle, label: x.whatsapp, value: hotel.whatsapp!, href: `https://wa.me/${wa}` }] : []),
    { icon: Mail, label: x.email, value: hotel.email, href: `mailto:${hotel.email}` },
  ];
  const stats = [
    { n: 300, suffix: ' m', label: x.s1 },
    { n: 26, label: x.s2 },
    { n: 365, label: x.s3 },
  ];
  return (
    <section aria-labelledby="intro-title" className="relative bg-ivory-2 py-20 md:py-28">
      <div className="container-x grid gap-12 [&>*]:min-w-0 lg:grid-cols-12 lg:items-center lg:gap-16">
        <div className="lg:col-span-6">
          <p className="eyebrow text-gold-2">{t.sections.introEyebrow}</p>
          <SplitHeading as="h2" className="display mt-5 max-w-[15ch] text-[clamp(2.4rem,4.6vw,4.6rem)] text-navy">
            <span id="intro-title">{x.title}</span>
          </SplitHeading>
          <motion.p initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.8, ease: EASE }} className="mt-6 max-w-xl text-[1.04rem] leading-[1.75] text-charcoal/85">
            {x.text}
          </motion.p>
          <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-navy">
            {stats.map((st) => (
              <li key={st.label} className="flex items-baseline gap-1.5">
                <span className="serif text-[1.6rem] leading-none">
                  <Count to={st.n} suffix={st.suffix} />
                </span>
                <span className="text-mist">{st.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-9 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-gold-2">{x.direct}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {contacts.map((c, i) => (
              <motion.a
                key={c.label}
                href={c.href}
                target={c.href.startsWith('http') ? '_blank' : undefined}
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.07 }}
                className="group flex items-center gap-3 rounded-full bg-white py-2 pl-2 pr-5 ring-1 ring-line transition-[box-shadow,transform] duration-500 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-28px_rgba(16,40,61,0.6)]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-gold transition-colors group-hover:bg-gold group-hover:text-navy-3">
                  <c.icon className="h-4 w-4" />
                </span>
                <span className="leading-tight">
                  <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-mist">{c.label}</span>
                  <span className="block text-sm font-semibold text-navy">{c.value}</span>
                </span>
              </motion.a>
            ))}
          </div>
        </div>

        <div className="relative lg:col-span-6">
          <IntroPhotos photos={photos?.length ? photos : [{ src: MEDIA.renaBianca.src, alt: MEDIA.renaBianca.alt }]} />
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.96 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: EASE, delay: 0.35 }} className="absolute -bottom-6 left-4 flex items-center gap-3 rounded-[1.4rem] bg-white py-3 pl-3 pr-5 shadow-[0_24px_50px_-28px_rgba(16,40,61,0.6)] ring-1 ring-line sm:left-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gold/15 text-gold-2">
              <Footprints className="h-5 w-5" />
            </span>
            <span className="leading-tight">
              <span className="serif block text-2xl text-navy">300 m</span>
              <span className="block text-xs text-mist">{x.beach}</span>
            </span>
          </motion.div>
        </div>
      </div>

    </section>
  );
}

const SLIDE_MS = 5000;

/**
 * The photo of the section, or the owner's photos sliding by themselves (crossfade + slow zoom):
 * they wait while the hand is on them or the section is off screen; swipe, arrows and dots move them.
 */
function IntroPhotos({ photos }: { photos: { src: string; alt: string }[] }) {
  const n = photos.length;
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const seen = useInView(box, { margin: '-10% 0px' });
  const still = useReducedMotion();
  const go = (d: number) => setI((x) => (x + d + n) % n);
  useEffect(() => {
    if (n < 2 || hold || !seen || still) return;
    const id = window.setTimeout(() => setI((x) => (x + 1) % n), SLIDE_MS);
    return () => window.clearTimeout(id);
  }, [n, i, hold, seen, still]);
  const p = photos[i % n]!;
  return (
    <div ref={box} className="group relative" onPointerEnter={(e) => e.pointerType === 'mouse' && setHold(true)} onPointerLeave={() => setHold(false)}>
      <ImageReveal className="aspect-[4/3] w-full overflow-hidden rounded-[2rem]" parallax={6}>
        {n < 2 ? (
          <Image src={p.src} alt={p.alt} fill sizes="(min-width:1024px) 46vw, 92vw" className="object-cover" />
        ) : (
          <AnimatePresence initial={false}>
            <motion.div
              key={i}
              className="absolute inset-0 touch-pan-y"
              initial={{ opacity: 0, scale: 1.08 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 1.1, ease: EASE } }}
              transition={{ opacity: { duration: 1.1, ease: EASE }, scale: { duration: SLIDE_MS / 1000 + 1.5, ease: 'linear' } }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={(_, info) => Math.abs(info.offset.x) > 50 && go(info.offset.x < 0 ? 1 : -1)}
            >
              <Image src={p.src} alt={p.alt} fill sizes="(min-width:1024px) 46vw, 92vw" className="pointer-events-none object-cover" priority={i === 0} />
            </motion.div>
          </AnimatePresence>
        )}
      </ImageReveal>
      {n > 1 && (
        <>
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-[2rem] bg-gradient-to-t from-navy-3/45 to-transparent" />
          <div className="absolute bottom-4 right-5 flex items-center gap-1.5" role="tablist">
            {photos.map((x, k) => (
              <button key={x.src + k} type="button" role="tab" aria-selected={k === i} aria-label={`${k + 1} / ${n}`} onClick={() => setI(k)} className="relative h-1.5 overflow-hidden rounded-full bg-white/45 transition-[width] duration-500" style={{ width: k === i ? 28 : 8 }}>
                {k === i && !hold && !still && seen && <motion.span key={i} className="absolute inset-y-0 left-0 bg-white" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: SLIDE_MS / 1000, ease: 'linear' }} />}
                {k === i && (hold || still || !seen) && <span className="absolute inset-0 bg-white" />}
              </button>
            ))}
          </div>
          {[-1, 1].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => go(d)}
              aria-label={d < 0 ? '←' : '→'}
              className={cn('absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-navy opacity-0 shadow-[0_10px_30px_-12px_rgba(16,40,61,0.6)] backdrop-blur transition-[opacity,transform] duration-300 hover:scale-105 group-hover:opacity-100 md:flex', d < 0 ? 'left-4' : 'right-4')}
            >
              {d < 0 ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
