'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Clock, Footprints, MapPin } from 'lucide-react';
import { gsap, ScrollTrigger, useGSAP, prefersReducedMotion } from '@/lib/gsap';
import { MEDIA } from '@/content/media';
import { INTRO_T } from '@/lib/i18n/reviews-dict';
import { onOpening } from '@/lib/intro';
import { useI18n } from '../providers';
import { Stars } from '../brand';

/** Local time in Santa Teresa (a guest abroad sees what time it is at the hotel). */
function useRomeTime() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const f = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
    const tick = () => setNow(f.format(new Date()));
    tick();
    const id = window.setInterval(tick, 20000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const WORDS = ['Hotel', 'L’Ancora'];

/**
 * Hero — "approdo".
 * The name of the hotel is the headline: big, in the first screen, readable on any photo and visible
 * even before (or without) any animation. The sea breathes with a slow drift and follows the mouse a
 * little; after the preloader the picture opens from the horizon line and the letters rise.
 * Only transforms and opacity move (no WebGL, no canvas, no per-frame paint), so it stays fluid.
 */
export function Hero({ slotRef, stageRef }: { slotRef: React.RefObject<HTMLDivElement | null>; stageRef: React.RefObject<HTMLDivElement | null> }) {
  const { t, locale } = useI18n();
  const it = INTRO_T[locale];
  const time = useRomeTime();
  const section = useRef<HTMLElement>(null);
  const reveal = useRef<HTMLDivElement>(null);
  const zoom = useRef<HTMLDivElement>(null);
  const drift = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLSpanElement>(null);
  const side = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      let t1 = 0;
      const refresh = () => {
        window.clearTimeout(t1);
        t1 = window.setTimeout(() => ScrollTrigger.refresh(), 120);
      };
      document.fonts?.ready.then(refresh).catch(() => undefined);
      const ro = new ResizeObserver(refresh);
      if (copy.current) ro.observe(copy.current);
      if (prefersReducedMotion()) return () => ro.disconnect();

      const sec = section.current!;
      const letters = name.current!.querySelectorAll('[data-l]');
      const fades = copy.current!.querySelectorAll('[data-hero-fade]');

      // One opening, played once: right as the preloader lifts (or at once after a client-side
      // navigation). On a full load without the preloader the hero is already on screen as painted,
      // so it stays still instead of hiding and replaying (see lib/intro.ts).
      const play = () =>
        gsap
          .timeline({ defaults: { overwrite: 'auto' } })
          .fromTo(reveal.current, { clipPath: 'inset(46% 8% 46% 8% round 24px)' }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', duration: 1.45, ease: 'expo.inOut', clearProps: 'clipPath' }, 0)
          .fromTo(zoom.current, { scale: 1.25 }, { scale: 1, duration: 2.2, ease: 'expo.out' }, 0)
          .fromTo(letters, { yPercent: 110 }, { yPercent: 0, duration: 1.2, stagger: 0.035, ease: 'expo.out' }, 0.45)
          .fromTo(fades, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.95, stagger: 0.08, ease: 'power3.out' }, 0.75)
          .fromTo(side.current, { x: 18, opacity: 0 }, { x: 0, opacity: 1, duration: 1, ease: 'power3.out' }, 1);
      const stopOpening = onOpening(play);

      // scroll: the photo sinks and darkens, the words leave first, the name last
      const st = { trigger: sec, start: 'top top', end: 'bottom top', scrub: true };
      gsap.to(zoom.current, { yPercent: 9, scale: 1.07, ease: 'none', scrollTrigger: st });
      gsap.fromTo(shade.current, { opacity: 0 }, { opacity: 0.45, ease: 'none', scrollTrigger: st });
      gsap.to([...fades, side.current], { y: -40, opacity: 0, ease: 'none', stagger: 0.02, scrollTrigger: { trigger: sec, start: 'top top', end: () => `+=${window.innerHeight * 0.42}`, scrub: 0.4 } });
      gsap.to(name.current, { yPercent: -22, opacity: 0, ease: 'none', scrollTrigger: { trigger: sec, start: () => `top+=${window.innerHeight * 0.12} top`, end: () => `+=${window.innerHeight * 0.55}`, scrub: 0.5 } });

      // the sea follows the mouse a little (desktop only)
      let off = () => undefined as void;
      if (window.matchMedia('(pointer: fine)').matches) {
        const qx = gsap.quickTo(drift.current, 'x', { duration: 1.4, ease: 'power3' });
        const qy = gsap.quickTo(drift.current, 'y', { duration: 1.4, ease: 'power3' });
        const nx = gsap.quickTo(name.current, 'x', { duration: 1.6, ease: 'power3' });
        const onMove = (e: PointerEvent) => {
          const dx = e.clientX / window.innerWidth - 0.5;
          const dy = e.clientY / window.innerHeight - 0.5;
          qx(dx * -22);
          qy(dy * -14);
          nx(dx * 10);
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        off = () => window.removeEventListener('pointermove', onMove);
      }
      return () => {
        ro.disconnect();
        off();
        stopOpening();
      };
    },
    { scope: section },
  );

  return (
    <section ref={section} id="hero" aria-label="Hotel L’Ancora" className="relative h-[140svh] bg-navy-3 md:h-[160vh]">
      <div ref={stageRef} className="sticky top-0 h-[100svh] min-h-[620px] overflow-hidden rounded-b-[2rem] bg-navy-3 md:rounded-b-[3rem]">
        <div ref={reveal} className="absolute inset-0 overflow-hidden">
          <div ref={zoom} className="absolute inset-0 will-change-transform">
            <div ref={drift} className="absolute -inset-[3%] will-change-transform">
              <div className="hero-drift absolute inset-0">
                <Image src={MEDIA.hero.src} alt={MEDIA.hero.alt} fill preload sizes="100vw" quality={85} className="object-cover object-[50%_58%]" />
              </div>
            </div>
          </div>
          {/* legibility: a calm top for the header, a soft dark heart behind the name, a deep bottom for the search */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(10,28,43,0.5)_0%,rgba(10,28,43,0.1)_26%,rgba(10,28,43,0.12)_62%,rgba(10,28,43,0.7)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_62%_46%_at_50%_47%,rgba(10,28,43,0.5)_0%,rgba(10,28,43,0.22)_52%,transparent_100%)]" />
          <div ref={shade} className="pointer-events-none absolute inset-0 bg-navy-3 opacity-0" />
        </div>

        {/* the hotel's place in the world */}
        <div ref={side} className="absolute right-5 top-24 hidden flex-col gap-2 rounded-2xl bg-navy-3/30 px-4 py-3 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-ivory/90 ring-1 ring-white/15 backdrop-blur-md lg:right-10 lg:top-28 lg:flex">
          <span className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-gold" /> 41°14′N · 9°11′E
          </span>
          {time && (
            <span className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-gold" /> Santa Teresa · {time}
            </span>
          )}
          <span className="flex items-center gap-2 normal-case tracking-normal text-ivory/80">
            <Footprints className="h-3.5 w-3.5 text-gold" /> {it.beach}
          </span>
        </div>

        {/* centre stage: the town above, the hotel's name in the middle */}
        <div ref={copy} className="relative z-[2] flex h-full flex-col items-center px-5 pb-5 pt-24 text-center text-ivory sm:px-8 md:pb-8 md:pt-28">
          <div className="flex flex-1 flex-col items-center justify-center">
            <p data-hero-fade className="flex items-center gap-3 whitespace-nowrap text-[0.6rem] font-semibold uppercase tracking-[0.24em] text-ivory/95 sm:text-[0.74rem] sm:tracking-[0.34em] md:gap-4">
              <span className="hidden h-px w-7 bg-gold/80 sm:block md:w-12" aria-hidden="true" />
              <span>{t.hero.eyebrow}</span>
              <span className="hidden h-px w-7 bg-gold/80 sm:block md:w-12" aria-hidden="true" />
            </p>
            {/* the whole name on one line: "Hotel" in italic beside "L’Ancora", same size */}
            <h1 className="mt-3 md:mt-5">
              <span className="sr-only">Hotel L’Ancora</span>
              <span ref={name} aria-hidden="true" className="block overflow-hidden whitespace-nowrap px-[0.08em] pb-[0.12em] font-serif text-[clamp(3rem,17vw,13rem)] leading-[0.92] tracking-[-0.025em] text-ivory [text-shadow:0_6px_60px_rgba(10,28,43,0.45)]">
                {WORDS.map((w, wi) => (
                  <span key={w} className={wi === 0 ? 'italic text-ivory/90' : undefined}>
                    {wi > 0 && <span data-l className="inline-block w-[0.24em]" />}
                    {w.split('').map((c, i) => (
                      <span key={i} data-l className="inline-block will-change-transform">
                        {c}
                      </span>
                    ))}
                  </span>
                ))}
              </span>
            </h1>
            <p data-hero-fade className="mt-3 flex items-center gap-3 text-gold" aria-label={t.hero.stars}>
              <span className="h-px w-8 bg-gold/60" aria-hidden="true" />
              <Stars />
              <span className="h-px w-8 bg-gold/60" aria-hidden="true" />
            </p>
            <p data-hero-fade className="mt-4 max-w-[26ch] font-serif text-[clamp(1.2rem,2.1vw,1.9rem)] leading-[1.15] text-ivory [text-wrap:balance] md:mt-5">
              {t.hero.title}
            </p>
          </div>
          {/* where the search bar rests before the visitor scrolls */}
          <div ref={slotRef} className="mt-4 h-[4.25rem] w-full shrink-0 md:h-[4.5rem]" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
