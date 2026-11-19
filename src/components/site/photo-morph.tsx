'use client';
import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLenis } from './providers';

export type MorphPhoto = { src: string; alt: string };

/**
 * Thumbnails that grow into a full-screen viewer (shared-layout "morph"): tap a photo and the
 * same picture expands to fill the screen; swipe or use the arrows; tap outside / Esc to close.
 */
export function PhotoMorph({ photos, className, thumbClassName, max = 99, rounded = 'rounded-2xl', showIcon = true, grid = false }: { photos: MorphPhoto[]; className?: string; thumbClassName?: string; max?: number; rounded?: string; showIcon?: boolean; /** thumbnails in a 3-column grid that fills the width (chat bubbles) */ grid?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const [open, setOpen] = useState<number | null>(null);
  // the photo that was tapped: the viewer morphs out of (and back into) that thumbnail
  const [origin, setOrigin] = useState(0);
  const [dir, setDir] = useState(0);
  const lenis = useLenis();
  // every photo stays reachable in the viewer; only the thumbnails are limited
  const list = photos;
  const shown = photos.slice(0, max);
  const extra = photos.length - shown.length;

  const go = useCallback(
    (d: number) => {
      setDir(d);
      setOpen((i) => (i === null ? i : (i + d + list.length) % list.length));
    },
    [list.length],
  );

  useEffect(() => {
    if (open === null) return;
    lenis.current?.stop();
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      lenis.current?.start();
      html.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, go, lenis]);

  if (!list.length) return null;
  return (
    <LayoutGroup id={uid}>
      <div className={cn(grid ? 'grid w-full max-w-[22rem] grid-cols-3 gap-1.5' : 'flex max-w-full flex-wrap gap-2', className)}>
        {shown.map((p, i) => (
          <motion.button key={p.src + i} type="button" layoutId={`${uid}-${i}`} onClick={(e) => { e.stopPropagation(); setDir(0); setOrigin(i); setOpen(i); }} className={cn('group relative shrink-0 overflow-hidden bg-sand', rounded, thumbClassName ?? 'h-20 w-20')} style={{ borderRadius: 16 }} aria-label={p.alt}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" draggable={false} />
            {extra > 0 && i === shown.length - 1 && <span className="absolute inset-0 flex items-center justify-center bg-navy-3/60 text-lg font-semibold text-white">+{extra}</span>}
            {showIcon && (
              <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/35 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                <Maximize2 className="h-3 w-3" />
              </span>
            )}
          </motion.button>
        ))}
      </div>
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open !== null && (
              <motion.div key="viewer" className="fixed inset-0 z-[150] flex items-center justify-center" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
                <motion.button type="button" aria-label="Chiudi" onClick={() => setOpen(null)} className="absolute inset-0 bg-navy-3/90 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
                <motion.div
                  layoutId={`${uid}-${origin}`}
                  drag={list.length > 1 ? 'x' : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.5}
                  onDragEnd={(_, info) => {
                    if (info.offset.x < -70 || info.velocity.x < -500) go(1);
                    else if (info.offset.x > 70 || info.velocity.x > 500) go(-1);
                  }}
                  className="relative z-[1] aspect-[4/3] max-h-[78svh] w-[min(94vw,1200px)] sm:aspect-auto sm:h-[min(80svh,820px)] cursor-grab overflow-hidden bg-navy active:cursor-grabbing"
                  style={{ borderRadius: 24 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                >
                  <AnimatePresence initial={false} custom={dir} mode="popLayout">
                    <motion.img
                      key={open}
                      src={list[open]!.src}
                      alt={list[open]!.alt}
                      custom={dir}
                      variants={{ enter: (d: number) => ({ x: d * 80, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: d * -80, opacity: 0 }) }}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ duration: 0.35, ease: [0.22, 0.61, 0.12, 1] }}
                      className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                      draggable={false}
                    />
                  </AnimatePresence>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.2 } }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[2] flex flex-col items-center gap-3 px-4 text-center text-ivory">
                  <p className="max-w-xl text-sm text-ivory/85">{list[open]!.alt}</p>
                  {list.length > 1 && (
                    <span className="flex gap-1.5">
                      {list.map((_, i) => (
                        <span key={i} className={cn('h-1.5 rounded-full transition-all', i === open ? 'w-6 bg-gold' : 'w-1.5 bg-ivory/40')} />
                      ))}
                    </span>
                  )}
                </motion.div>
                <motion.button type="button" onClick={() => setOpen(null)} aria-label="Chiudi" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1, transition: { delay: 0.15 } }} exit={{ opacity: 0 }} className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-[2] flex h-11 w-11 items-center justify-center rounded-full bg-ivory text-navy shadow-lg">
                  <X className="h-5 w-5" />
                </motion.button>
                {list.length > 1 && (
                  <>
                    <button type="button" onClick={() => go(-1)} aria-label="←" className="absolute left-3 z-[2] hidden h-12 w-12 items-center justify-center rounded-full bg-ivory/90 text-navy sm:flex">
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => go(1)} aria-label="→" className="absolute right-3 z-[2] hidden h-12 w-12 items-center justify-center rounded-full bg-ivory/90 text-navy sm:flex">
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </LayoutGroup>
  );
}
