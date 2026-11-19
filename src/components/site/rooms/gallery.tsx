'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { LayoutGroup, motion } from 'motion/react';
import { Expand } from 'lucide-react';
import type { Photo } from '@/lib/types';
import { plural } from '@/lib/i18n/config';
import { cn } from '@/lib/utils';
import { useI18n } from '../providers';
import { GALLERY_IMG, Lightbox } from './lightbox';

const SWAP = { type: 'spring' as const, stiffness: 240, damping: 30, mass: 0.9 };
const RADIUS = { big: 24, side: 24, thumb: 16 };

/**
 * The room's photos:
 *  · one big photo, two beside it, the rest in a row below — all with soft rounded corners;
 *  · tap a small photo and it changes place with the big one (the two photos fly to each other's
 *    place);
 *  · tap the big photo and it grows into the full-screen viewer (same photo, morphing), with the
 *    close button always on the photo's corner; closing shrinks it back.
 * `mainRef` is the big photo's frame: the photo of the room card lands there when arriving from the
 * list (shared-element morph).
 */
export function RoomGallery({ photos, mainRef }: { photos: Photo[]; mainRef: React.RefObject<HTMLDivElement | null> }) {
  const { t, locale } = useI18n();
  const [order, setOrder] = useState<number[]>(() => photos.map((_, i) => i));
  const [open, setOpen] = useState<number | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [flying, setFlying] = useState<string[]>([]);
  useEffect(() => setOrder(photos.map((_, i) => i)), [photos]);

  const at = (pos: number) => photos[order[pos] ?? -1];
  const promote = (pos: number) => {
    const a = at(0);
    const b = at(pos);
    if (!a || !b) return;
    setFlying([a.id, b.id]);
    setOrder((o) => {
      const n = [...o];
      [n[0], n[pos]] = [n[pos]!, n[0]!];
      return n;
    });
  };
  const zoom = (photoIndex: number) => {
    setOpened(photos[photoIndex]?.id ?? null);
    setOpen(photoIndex);
  };
  const main = at(0);
  const side = [at(1), at(2)].filter(Boolean) as Photo[];
  const rest = order.slice(3).map((i) => photos[i]!).filter(Boolean);

  const tile = (p: Photo, kind: keyof typeof RADIUS, onClick: () => void, label: string) => (
    <motion.button
      key={p.id}
      type="button"
      layoutId={`room-photo-${p.id}`}
      onClick={onClick}
      aria-label={label}
      transition={{ layout: SWAP }}
      onLayoutAnimationComplete={() => setFlying((f) => f.filter((x) => x !== p.id))}
      style={{ borderRadius: RADIUS[kind], zIndex: flying.includes(p.id) ? 6 : kind === 'big' ? 2 : 1 }}
      className={cn('group absolute inset-0 overflow-hidden bg-sand outline-none focus-visible:ring-2 focus-visible:ring-gold', kind !== 'big' && 'cursor-pointer')}
    >
      <Image src={p.src} alt={p.alt} fill preload={kind === 'big'} loading={kind === 'big' ? undefined : 'eager'} decoding="sync" sizes={GALLERY_IMG.sizes} quality={GALLERY_IMG.quality} className="object-cover transition-transform duration-[1.2s] ease-[var(--ease-lux)] group-hover:scale-[1.035]" draggable={false} />
      {kind === 'big' ? (
        <span className="pointer-events-none absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-navy-3/55 text-ivory opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100">
          <Expand className="h-4 w-4" />
        </span>
      ) : (
        <span className="pointer-events-none absolute inset-0 bg-navy-3/0 transition-colors duration-300 group-hover:bg-navy-3/15" />
      )}
    </motion.button>
  );

  return (
    <LayoutGroup id="room-gallery">
      <div className="mt-10 grid gap-3 md:grid-cols-12" data-testid="room-gallery">
        {/* one photo alone takes the whole width (no empty column beside it), wide like a window */}
        <div ref={mainRef} className={cn('relative aspect-[4/3] rounded-[1.5rem]', side.length ? 'md:col-span-8 md:aspect-[16/11]' : 'md:col-span-12 md:aspect-[21/9]')}>
          {main && tile(main, 'big', () => zoom(order[0]!), t.room.allPhotos)}
        </div>
        {side.length > 0 && (
          <div className={cn('grid gap-3 md:col-span-4 md:grid-cols-1', side.length === 1 ? 'grid-cols-1 md:grid-rows-1' : 'grid-cols-2 md:grid-rows-2')}>
            {side.map((p, k) => (
              <div key={`slot-${k}`} className="relative aspect-[4/3] md:aspect-auto md:h-full">
                {tile(p, 'side', () => promote(k + 1), p.alt)}
              </div>
            ))}
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <ul className="no-scrollbar -mx-4 mt-3 flex gap-2.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0" aria-label={t.room.allPhotos}>
          {rest.map((p, k) => (
            <li key={`thumb-${k}`} className="relative h-[4.5rem] w-24 shrink-0 md:h-24 md:w-32">
              {tile(p, 'thumb', () => promote(k + 3), p.alt)}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-mist">
        <span>{photos.some((p) => p.demo) ? t.room.demoPhotos : ''}</span>
        {main && photos.length > 1 && (
          <button type="button" onClick={() => zoom(order[0]!)} className="inline-flex items-center gap-2 font-semibold uppercase tracking-[0.2em] text-navy">
            <Expand className="h-4 w-4" /> {t.room.allPhotos} · {plural(locale, photos.length, t.room.photos)}
          </button>
        )}
      </div>
      <Lightbox photos={photos} index={open} onClose={() => setOpen(null)} onIndex={setOpen} morphId={opened} />
    </LayoutGroup>
  );
}
