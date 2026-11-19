'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { Photo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useI18n, useLenis } from '../providers';

const EASE = [0.22, 0.61, 0.12, 1] as const;
const MORPH = { type: 'spring' as const, stiffness: 210, damping: 30, mass: 0.95 };

/**
 * One version of each photo for the whole gallery (big, side and small tiles, and the first layer of
 * the viewer): when a photo changes place it is already loaded, so it never flashes empty mid-flight.
 * A tile that changes place is a new <img> (new parent): `decoding="sync"` paints the cached photo in
 * the very first frame instead of leaving one empty frame.
 */
export const GALLERY_IMG = { sizes: '(min-width:768px) 66vw, 100vw', quality: 85 } as const;

/** Size of the photo shown whole inside the stage (like object-contain, but as a real box). */
function fit(stage: { w: number; h: number }, p: Photo): { w: number; h: number } {
  const ratio = p.width > 0 && p.height > 0 ? p.width / p.height : 4 / 3;
  let w = stage.w;
  let h = w / ratio;
  if (h > stage.h) {
    h = stage.h;
    w = h * ratio;
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/**
 * Fullscreen gallery: keyboard (← → Esc), swipe on touch, counter, thumbnails, focus trap.
 * The photo is a real box the size of the picture, so the close button always sits on the photo's
 * corner. `morphId` = the photo that was tapped: it grows out of its place in the page (shared
 * layout) and shrinks back there on close, as long as the visitor did not move to another photo.
 */
export function Lightbox({ photos, index, onClose, onIndex, morphId = null }: { photos: Photo[]; index: number | null; onClose: () => void; onIndex: (i: number) => void; morphId?: string | null }) {
  const { t } = useI18n();
  const lenis = useLenis();
  const [dir, setDir] = useState(1);
  const [moved, setMoved] = useState(false);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const open = index !== null;
  const n = photos.length;

  const go = (d: number) => {
    if (index === null) return;
    setDir(d);
    setMoved(true);
    onIndex((index + d + n) % n);
  };

  useEffect(() => {
    if (open) setMoved(false);
  }, [open]);

  // the stage size decides the photo's box (resizes with the window)
  useLayoutEffect(() => {
    if (!open) return;
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    lenis.current?.stop();
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => root.current?.querySelector<HTMLButtonElement>('[data-close]')?.focus({ preventScroll: true }), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Tab' && root.current) {
        const items = [...root.current.querySelectorAll<HTMLElement>('button')];
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items.at(-1)?.focus();
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      lenis.current?.start();
      document.body.style.overflow = '';
      prevFocus?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (typeof document === 'undefined') return null;
  const p = index !== null ? photos[index] : null;
  const box = p && stage ? fit(stage, p) : null;
  const shared = p && !moved && morphId === p.id ? `room-photo-${p.id}` : undefined;

  return createPortal(
    <AnimatePresence>
      {open && p && (
        <div key="lightbox" ref={root} role="dialog" aria-modal="true" aria-label={t.room.lightbox} className="fixed inset-0 z-[95] flex flex-col text-ivory" data-testid="lightbox">
          <motion.div aria-hidden="true" className="absolute inset-0 bg-navy-3" initial={{ opacity: 0 }} animate={{ opacity: 0.97 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: EASE }} onClick={onClose} />
          <motion.div className="relative flex items-center justify-between px-4 py-3 sm:px-8 sm:py-5" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, delay: 0.1 }}>
            <p className="text-[0.7rem] font-semibold tracking-[0.3em] tabular-nums" aria-live="polite">
              {String(index! + 1).padStart(2, '0')} <span className="text-ivory/40">/ {String(n).padStart(2, '0')}</span>
            </p>
          </motion.div>
          <div
            ref={stageRef}
            className="relative mx-2 flex-1 touch-pan-y select-none sm:mx-24"
            onClick={(e) => {
              // a tap on the dark area around the photo closes (not the end of a swipe)
              if (e.target === e.currentTarget && !swiped.current) onClose();
              swiped.current = false;
            }}
            onPointerDown={(e) => {
              drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
              swiped.current = false;
            }}
            onPointerUp={(e) => {
              const d = drag.current;
              drag.current = null;
              if (!d || d.id !== e.pointerId) return;
              const dx = e.clientX - d.x;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - d.y)) {
                swiped.current = true;
                go(dx < 0 ? 1 : -1);
              }
            }}
          >
            <AnimatePresence initial={false} custom={dir} mode="popLayout">
              {box && (
                <motion.div key={p.id} custom={dir} className="pointer-events-none absolute inset-0 flex items-center justify-center" variants={{ enter: (d: number) => ({ x: `${d * 14}%`, opacity: 0 }), center: { x: 0, opacity: 1 }, exit: (d: number) => ({ x: `${d * -14}%`, opacity: 0 }) }} initial={shared ? false : 'enter'} animate="center" exit={shared ? undefined : 'exit'} transition={{ duration: 0.55, ease: EASE }}>
                  <motion.div layoutId={shared} transition={{ layout: MORPH }} className="pointer-events-auto relative overflow-hidden bg-navy-3 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)]" style={{ width: box.w, height: box.h, borderRadius: 20 }}>
                    {/* the gallery's version first (already loaded: no empty frame while it grows), the sharper one on top as soon as it is ready */}
                    <Image src={p.src} alt="" aria-hidden fill decoding="sync" sizes={GALLERY_IMG.sizes} quality={GALLERY_IMG.quality} className="object-cover" draggable={false} />
                    <Image src={p.src} alt={p.alt} fill sizes="100vw" quality={85} className="object-cover" draggable={false} />
                    {/* the close button lives on the photo's corner, wherever the photo is */}
                    <motion.button data-close type="button" onClick={onClose} aria-label={t.common.close} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: shared ? 0.35 : 0.1, type: 'spring', stiffness: 420, damping: 24 }} className="absolute right-3 top-3 z-[2] flex h-11 w-11 items-center justify-center rounded-full bg-navy-3/60 text-ivory ring-1 ring-white/25 backdrop-blur-md transition-colors hover:bg-ivory hover:text-navy">
                      <X className="h-5 w-5" />
                    </motion.button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            {n > 1 && (
              <>
                <motion.button type="button" onClick={() => go(-1)} aria-label={t.room.prevPhoto} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute -left-20 top-1/2 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-navy-3/40 backdrop-blur transition-colors hover:bg-ivory hover:text-navy sm:flex">
                  <ArrowLeft className="h-5 w-5" />
                </motion.button>
                <motion.button type="button" onClick={() => go(1)} aria-label={t.room.nextPhoto} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute -right-20 top-1/2 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-navy-3/40 backdrop-blur transition-colors hover:bg-ivory hover:text-navy sm:flex">
                  <ArrowRight className="h-5 w-5" />
                </motion.button>
              </>
            )}
          </div>
          <motion.div className="relative px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-8" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, delay: 0.12 }}>
            <p className="mb-3 text-center text-xs text-ivory/60">
              {p.alt}
            </p>
            <div className="no-scrollbar flex justify-center gap-2 overflow-x-auto">
              {photos.map((ph, i) => (
                <button
                  key={ph.id}
                  type="button"
                  onClick={() => {
                    if (i === index) return;
                    setDir(i > index! ? 1 : -1);
                    setMoved(true);
                    onIndex(i);
                  }}
                  aria-label={`${i + 1}`}
                  aria-current={i === index}
                  className={cn('relative h-14 w-20 shrink-0 overflow-hidden rounded-xl transition-opacity', i === index ? 'opacity-100 ring-2 ring-gold' : 'opacity-45 hover:opacity-80')}
                >
                  <Image src={ph.src} alt="" fill sizes="80px" className="object-cover" />
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
