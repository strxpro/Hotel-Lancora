'use client';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Car, Footprints, MapPin, Map as MapIcon, Navigation, Ship, X } from 'lucide-react';
import { EXPERIENCES, PLACE_GALLERY } from '@/content/experiences';
import { COAST } from '@/content/coast';
import { MEDIA } from '@/content/media';
import { EXTRA_T, MAP_T } from '@/lib/i18n/reviews-dict';
import { cn } from '@/lib/utils';
import { useI18n, useIsDesktop, useLenis } from '../providers';
import { SplitHeading } from '../motion-kit';
import { PhotoMorph } from '../photo-morph';
import { PlaceMap, directionsUrl, fmtKm, km, useRoutes, useTown } from '../place-map';

const EASE = [0.22, 0.61, 0.12, 1] as const;
const MORPH = { type: 'spring', stiffness: 210, damping: 30, mass: 0.9 } as const;
type Hotel = { lat: number; lng: number; name: string };

/**
 * "What to see" — photos first. Every place is a big photo card; "Show on the map" morphs that
 * very card into a full map (the photo dissolves into the map, the real road draws itself from
 * the hotel) and then offers "Take me there". Closing morphs the map back into the card.
 */
export function ExploreSection({ lat, lng, name, verified }: { lat: number; lng: number; name: string; verified: boolean }) {
  const { t, locale } = useI18n();
  const x = EXTRA_T[locale];
  const places = EXPERIENCES;
  const hotel = { lat, lng, name };
  // origin = the card the map grew from (it shrinks back into it); current = the place shown
  const [origin, setOrigin] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const openPlace = (i: number) => {
    setCurrent(i);
    setOrigin(places[i]!.id);
  };
  const openAll = () => {
    setCurrent(null);
    setOrigin('all');
  };
  const close = useCallback(() => setOrigin(null), []);

  return (
    <section id="posizione" aria-labelledby="place-title" className="relative bg-navy py-20 text-ivory md:py-28">
      <div className="container-x grid gap-6 md:grid-cols-12 md:items-end">
        <div className="md:col-span-7">
          <p className="eyebrow text-gold">{t.sections.placeEyebrow}</p>
          <SplitHeading as="h2" className="display mt-5 text-[clamp(2.4rem,4.6vw,4.8rem)] text-ivory">
            <span id="place-title">{t.sections.placeTitle}</span>
          </SplitHeading>
        </div>
        <div className="md:col-span-5">
          <p className="max-w-md text-[0.98rem] leading-relaxed text-ivory/70">{t.sections.placeText}</p>
          {!verified && <p className="mt-3 text-xs text-ivory/45">{t.sections.addressPending} · {t.sections.approx}</p>}
        </div>
      </div>

      <ul className="container-x no-scrollbar mt-10 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto pb-2 sm:scroll-px-8 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:pb-0 lg:auto-rows-[300px] xl:auto-rows-[330px]">
        {places.map((p, i) => (
          <li key={p.id} className={cn('relative aspect-[4/5] w-[84%] shrink-0 snap-start sm:w-[58%] md:aspect-auto md:w-auto', i === 0 ? 'md:col-span-2 md:min-h-[300px] lg:min-h-0' : 'md:min-h-[300px] lg:min-h-0')}>
            {origin !== p.id && <PlaceCard i={i} big={i === 0} onOpen={() => openPlace(i)} />}
          </li>
        ))}
        <li className="relative aspect-[4/5] w-[84%] shrink-0 snap-start sm:w-[58%] md:col-span-2 md:aspect-auto md:min-h-[300px] md:w-auto lg:min-h-0">
          {origin !== 'all' && <MapTeaser hotel={hotel} onOpen={openAll} title={x.wholeMap} sub={x.wholeMapSub} />}
        </li>
      </ul>

      <AnimatePresence>{origin && <PlaceOverlay key="overlay" layoutKey={origin} hotel={hotel} current={current} setCurrent={setCurrent} onClose={close} />}</AnimatePresence>
    </section>
  );
}

function PlaceCard({ i, big, onOpen }: { i: number; big: boolean; onOpen: () => void }) {
  const { t, locale } = useI18n();
  const x = EXTRA_T[locale];
  const p = EXPERIENCES[i]!;
  const m = MEDIA[p.image];
  return (
    <motion.article
      layoutId={`place-${p.id}`}
      transition={MORPH}
      style={{ borderRadius: 28 }}
      className="group absolute inset-0 overflow-hidden bg-navy-2"
    >
      <motion.div layout transition={MORPH} className="absolute inset-0">
        <Image src={m.src} alt={m.alt} fill sizes={big ? '(min-width:768px) 62vw, 84vw' : '(min-width:768px) 31vw, 84vw'} className="object-cover transition-transform duration-[1.4s] ease-[var(--ease-lux)] group-hover:scale-[1.06]" draggable={false} />
      </motion.div>
      <span className="absolute inset-0 bg-gradient-to-t from-navy-3/90 via-navy-3/15 to-transparent" />
      <span className="absolute left-4 top-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold text-xs font-semibold text-navy-3">{i + 1}</span>
        <span className="rounded-full bg-navy-3/60 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ivory">{p.kind[locale]}</span>
      </span>
      <button type="button" onClick={onOpen} className="absolute inset-0 z-[1]" aria-label={`${x.onMap} · ${p.name}`} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] p-5 md:p-6">
        <p className={cn('serif leading-tight text-ivory', big ? 'text-[clamp(2rem,3.4vw,3.2rem)]' : 'text-[1.75rem]')}>{p.name}</p>
        <p className="mt-1 text-[0.66rem] uppercase tracking-[0.2em] text-ivory/65">
          {p.time[locale]}
        </p>
        {big && <p className="mt-3 hidden max-w-md text-sm leading-relaxed text-ivory/80 md:block">{p.text[locale]}</p>}
        <span className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-ivory pl-2 pr-4 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-navy shadow-[0_14px_30px_-14px_rgba(0,0,0,0.6)] transition-transform duration-500 group-hover:-translate-y-0.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-gold">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          {x.onMap}
        </span>
      </div>
    </motion.article>
  );
}

/** A small drawing of the coast with all the pins: opens the whole map. */
function MapTeaser({ hotel, onOpen, title, sub }: { hotel: Hotel; onOpen: () => void; title: string; sub: string }) {
  const COS = Math.cos((COAST.lat0 * Math.PI) / 180);
  const K = COAST.width / ((COAST.bounds.maxLon - COAST.bounds.minLon) * COS);
  const pr = (la: number, ln: number) => ({ x: (ln - COAST.bounds.minLon) * COS * K, y: (COAST.bounds.maxLat - la) * K });
  const h = pr(hotel.lat, hotel.lng);
  const town = useTown();
  return (
    <motion.article layoutId="place-all" transition={MORPH} style={{ borderRadius: 28 }} className="group absolute inset-0 overflow-hidden bg-[#dfeaee] text-navy">
      <motion.svg layout transition={MORPH} viewBox={`${h.x - 50} ${h.y - 46} 150 64`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full transition-transform duration-[1.4s] ease-[var(--ease-lux)] group-hover:scale-[1.04]" aria-hidden="true">
        <path d={COAST.land} fill="#f1e8d6" />
        {town && (
          <g>
            <path d={town.land} fill="#f1e8d6" />
            <path d={town.green} fill="#dfe5cc" />
            <path d={town.beaches} fill="#f4e2b8" />
            <path d={town.major} fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={town.minor} fill="none" stroke="#ffffff" strokeWidth={1.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={town.buildings} fill="#e2cfae" />
          </g>
        )}
        {EXPERIENCES.map((p, i) => {
          const q = pr(p.lat, p.lng);
          return (
            <g key={p.id}>
              <line x1={h.x} y1={h.y} x2={q.x} y2={q.y} stroke="#B69562" strokeWidth={1.6} strokeDasharray="4 5" vectorEffect="non-scaling-stroke" opacity={0.8} />
              <circle cx={q.x} cy={q.y} r={2.2} fill="#fff" stroke="#10283D" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
              <text x={q.x} y={q.y + 0.85} textAnchor="middle" fontSize={2.4} fontWeight={700} fill="#10283D">
                {i + 1}
              </text>
            </g>
          );
        })}
        <circle cx={h.x} cy={h.y} r={2.6} fill="#10283D" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </motion.svg>
      <span className="absolute inset-0 bg-gradient-to-r from-[#dfeaee] via-[#dfeaee]/60 to-transparent md:via-[#dfeaee]/40" />
      <button type="button" onClick={onOpen} className="absolute inset-0 z-[1]" aria-label={title} />
      <div className="pointer-events-none relative z-[2] flex h-full flex-col justify-end p-5 md:justify-center md:p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy text-gold">
          <MapIcon className="h-5 w-5" />
        </span>
        <p className="serif mt-4 max-w-sm text-[clamp(1.7rem,2.6vw,2.4rem)] leading-tight">{title}</p>
        <p className="mt-1 text-sm text-navy/65">{sub}</p>
      </div>
    </motion.article>
  );
}

/** The card, grown into a map. */
function PlaceOverlay({ layoutKey, hotel, current, setCurrent, onClose }: { layoutKey: string; hotel: Hotel; current: number | null; setCurrent: (i: number | null) => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const x = EXTRA_T[locale];
  const mt = MAP_T[locale];
  const lenis = useLenis();
  const desktop = useIsDesktop();
  const routes = useRoutes();
  const [ready, setReady] = useState(false);
  const places = EXPERIENCES;
  const cur = current !== null ? places[current]! : null;
  const coverKey = layoutKey === 'all' ? null : (places.find((p) => p.id === layoutKey)?.image ?? null);

  useEffect(() => {
    lenis.current?.stop();
    const html = document.documentElement;
    html.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && current !== null) setCurrent((current + 1) % places.length);
      if (e.key === 'ArrowLeft' && current !== null) setCurrent((current - 1 + places.length) % places.length);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      lenis.current?.start();
      html.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [lenis, onClose, current, setCurrent, places.length]);

  // the map is mounted once the morph has (almost) finished: the animation stays light
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 420);
    return () => window.clearTimeout(id);
  }, []);

  const route = cur ? (routes?.[cur.id] ?? null) : null;
  const dist = cur ? km(hotel, cur) : 0;
  const mode = route?.mode ?? (dist < 1.6 ? 'foot' : 'car');
  const ferry = cur?.id === 'bonifacio';
  const gallery = cur ? (PLACE_GALLERY[cur.id] ?? [cur.image]).map((k) => ({ src: MEDIA[k].src, alt: MEDIA[k].alt })) : [];

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[96]" role="dialog" aria-modal="true" aria-label={cur?.name ?? x.wholeMap}>
      <motion.button type="button" aria-label={x.backPhotos} onClick={onClose} className="absolute inset-0 cursor-default bg-navy-3/75" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />
      <motion.div layoutId={`place-${layoutKey}`} transition={MORPH} style={{ borderRadius: 28 }} className="absolute inset-2 overflow-hidden bg-[#dfeaee] sm:inset-4 lg:inset-6">
        {/* the map, under the dissolving photo */}
        {ready && (
          <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
            <PlaceMap hotel={hotel} active={current} onSelect={(i) => setCurrent(i)} card={false} expandable={false} className="h-full" padLeft={desktop ? 440 : 0} padBottom={desktop ? 0 : 330} />
          </motion.div>
        )}
        {coverKey && (
          <motion.div layout className="pointer-events-none absolute inset-0" initial={{ opacity: 1 }} animate={{ opacity: ready ? 0 : 1 }} exit={{ opacity: 1 }} transition={{ ...MORPH, opacity: { duration: 0.6, ease: EASE } }}>
            <Image src={MEDIA[coverKey].src} alt="" fill sizes="100vw" className="object-cover" />
          </motion.div>
        )}

        <motion.button type="button" onClick={onClose} aria-label={x.backPhotos} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ delay: 0.25, type: 'spring', stiffness: 380, damping: 26 }} className="absolute right-3 top-3 z-[8] flex h-11 items-center gap-2 rounded-full bg-navy pl-3 pr-4 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ivory shadow-[0_12px_30px_-12px_rgba(10,28,43,0.8)] sm:right-4 sm:top-4">
          <X className="h-4 w-4" /> <span className="hidden sm:inline">{x.backPhotos}</span>
        </motion.button>

        {/* the panel: details, photos, real route, "take me there" */}
        <motion.aside
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20, transition: { duration: 0.18 } }}
          transition={{ delay: 0.32, duration: 0.6, ease: EASE }}
          data-lenis-prevent
          className="thin-scroll absolute inset-x-2 bottom-2 z-[7] max-h-[min(330px,52%)] overflow-y-auto overscroll-contain rounded-[1.6rem] bg-white p-4 text-navy shadow-[0_30px_70px_-30px_rgba(10,28,43,0.7)] md:inset-x-auto md:bottom-4 md:left-4 md:top-4 md:max-h-none md:w-[400px] md:p-6"
        >
          <AnimatePresence mode="wait" initial={false}>
            {cur ? (
              <motion.div key={cur.id} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.35, ease: EASE }} className="flex h-full flex-col">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold text-[0.7rem] font-bold text-navy-3">{(current ?? 0) + 1}</span>
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold-2">{cur.kind[locale]}</p>
                  <span className="ml-auto flex gap-1">
                    <button type="button" aria-label="←" onClick={() => setCurrent(((current ?? 0) - 1 + places.length) % places.length)} className="flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-line hover:bg-ivory">
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="→" onClick={() => setCurrent(((current ?? 0) + 1) % places.length)} className="flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-line hover:bg-ivory">
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </span>
                </div>
                <h3 className="serif mt-2 text-[clamp(1.8rem,2.4vw,2.4rem)] leading-tight">{cur.name}</h3>
                <p className="mt-2 hidden text-sm leading-relaxed text-charcoal/75 md:block">{cur.text[locale]}</p>
                <PhotoMorph photos={gallery} className="no-scrollbar mt-3 overflow-x-auto" thumbClassName="h-[4.4rem] w-[5.8rem] md:h-[5.4rem] md:w-[7.2rem]" />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-2 rounded-full bg-ivory px-3 py-2 text-sm">
                    {ferry ? <Ship className="h-4 w-4 text-gold-2" /> : mode === 'foot' ? <Footprints className="h-4 w-4 text-sage" /> : <Car className="h-4 w-4 text-gold-2" />}
                    {route ? (
                      <span>
                        <b>{route.km.toLocaleString(locale, { maximumFractionDigits: 1 })} km</b> · {route.min} min {ferry ? mt.ferry : route.mode === 'foot' ? t.sections.walk : t.sections.drive}
                      </span>
                    ) : (
                      <span>
                        {fmtKm(dist, locale)} {t.sections.fromHotel}
                      </span>
                    )}
                  </span>
                  {route && <span className="text-[0.68rem] text-mist">{x.route} · {mt.road}</span>}
                </div>
                <motion.a
                  key={`go-${cur.id}`}
                  href={directionsUrl(cur.lat, cur.lng, mode)}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 14, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.75, type: 'spring', stiffness: 300, damping: 22 }}
                  whileTap={{ scale: 0.97 }}
                  className="group relative mt-4 flex h-14 shrink-0 items-center justify-center gap-2.5 overflow-hidden rounded-full bg-gold text-[0.74rem] font-semibold uppercase tracking-[0.16em] text-navy-3 shadow-[0_18px_40px_-16px_rgba(182,149,98,0.9)] md:mt-auto"
                >
                  <span aria-hidden="true" className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 animate-[shine_3.2s_ease-in-out_1.4s_infinite] bg-white/40" />
                  <Navigation className="relative h-4 w-4" />
                  <span className="relative">{t.sections.goThere}</span>
                </motion.a>
              </motion.div>
            ) : (
              <motion.div key="all" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-gold-2">{x.wholeMapSub}</p>
                <h3 className="serif mt-1 text-[1.9rem] leading-tight">{x.wholeMap}</h3>
                <ul className="mt-3 grid gap-1.5">
                  {places.map((p, i) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setCurrent(i)} className="group flex w-full items-center gap-3 rounded-2xl p-1.5 pr-3 text-left transition-colors hover:bg-ivory">
                        <span className="relative h-12 w-14 shrink-0 overflow-hidden rounded-xl bg-sand">
                          <Image src={MEDIA[p.image].src} alt="" fill sizes="56px" className="object-cover" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {i + 1}. {p.name}
                          </span>
                          <span className="block truncate text-xs text-mist">{routes?.[p.id] ? `${routes[p.id]!.km.toLocaleString(locale, { maximumFractionDigits: 1 })} km · ${routes[p.id]!.min} min` : `${fmtKm(km(hotel, p), locale)} ${t.sections.fromHotel}`}</span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-mist transition-transform group-hover:translate-x-0.5" />
                      </button>
                    </li>
                  ))}
                </ul>
                <a href={directionsUrl(hotel.lat, hotel.lng)} target="_blank" rel="noopener noreferrer" className="btn btn-navy mt-3 h-12 min-h-0 w-full">
                  <Navigation className="h-4 w-4" /> {t.sections.directions} · {hotel.name}
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.aside>
      </motion.div>
    </div>,
    document.body,
  );
}
