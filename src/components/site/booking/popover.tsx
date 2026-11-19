'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { useIsDesktop, useLenis } from '../providers';

const EASE = [0.22, 0.61, 0.12, 1] as const;

/**
 * Anchored popover rendered in a portal (never clipped by overflow or sticky containers).
 * Follows its anchor while the page scrolls (the hero search bar moves!) and flips above
 * when there is not enough room below. On phones it becomes a bottom sheet.
 */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  label,
  width = 760,
  align = 'start',
  closeLabel = 'Chiudi',
}: {
  open: boolean;
  onClose: () => void;
  anchor: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  label: string;
  width?: number;
  align?: 'start' | 'end' | 'center';
  closeLabel?: string;
}) {
  const desktop = useIsDesktop();
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number; above: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);
  const lenis = useLenis();
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !desktop) return;
    let raf = 0;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current;
      if (a && p) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const h = p.scrollHeight;
        const below = vh - a.bottom - 16;
        const above = a.top - 16;
        const placeAbove = below < h && above > below;
        const w = Math.min(width, vw - 32);
        let left = align === 'end' ? a.right - w : align === 'center' ? a.left + a.width / 2 - w / 2 : a.left;
        left = Math.max(16, Math.min(left, vw - w - 16));
        const maxH = Math.max(240, placeAbove ? above - 8 : below - 8);
        const top = placeAbove ? a.top - 10 - Math.min(h, maxH) : a.bottom + 10;
        setPos((prev) => (prev && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.left - left) < 0.5 && prev.above === placeAbove && prev.maxH === maxH ? prev : { top, left, maxH, above: placeAbove }));
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [open, desktop, anchor, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        anchor.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    if (!desktop) {
      lenis.current?.stop();
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      if (!desktop) {
        lenis.current?.start();
        document.body.style.overflow = '';
      }
    };
  }, [open, onClose, anchor, desktop, lenis]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open &&
        (desktop ? (
          <motion.div
            ref={panel}
            role="dialog"
            aria-label={label}
            data-lenis-prevent
            initial={{ opacity: 0, y: pos?.above ? 10 : -10, scale: 0.985 }}
            animate={{ opacity: pos ? 1 : 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: pos?.above ? 8 : -8, scale: 0.985, transition: { duration: 0.2 } }}
            transition={{ duration: 0.36, ease: EASE }}
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? 0, width: Math.min(width, typeof window !== 'undefined' ? window.innerWidth - 32 : width), maxHeight: pos?.maxH, transformOrigin: pos?.above ? 'bottom center' : 'top center' }}
            className="thin-scroll z-[70] overflow-y-auto rounded-[1.75rem] border border-line bg-ivory p-5 text-charcoal shadow-[0_40px_90px_-30px_rgba(16,40,61,0.45)]"
          >
            {children}
          </motion.div>
        ) : (
          <motion.div key="sheet" className="fixed inset-0 z-[70] flex flex-col justify-end" initial={{ opacity: 1 }} exit={{ opacity: 1 }}>
            <motion.button type="button" aria-label={closeLabel} onClick={onClose} className="absolute inset-0 bg-navy-3/55 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              data-lenis-prevent
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.5, ease: EASE }}
              className="relative max-h-[90svh] overflow-y-auto rounded-t-[1.75rem] bg-ivory px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 text-charcoal"
            >
              <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-center justify-between bg-ivory px-4 pb-2 pt-1">
                <span className="mx-auto h-1 w-10 rounded-full bg-sand" aria-hidden="true" />
                <button type="button" onClick={onClose} aria-label={closeLabel} className="absolute right-2 top-0 flex h-11 w-11 items-center justify-center text-navy">
                  <X className="h-5 w-5" />
                </button>
              </div>
              {children}
            </motion.div>
          </motion.div>
        ))}
    </AnimatePresence>,
    document.body,
  );
}
