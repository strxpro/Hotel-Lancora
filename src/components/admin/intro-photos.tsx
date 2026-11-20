'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { Footprints, Images } from 'lucide-react';
import type { Photo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Card } from './ui';
import { PhotoManager } from './photo-manager';
import { saveIntroPhotosAction } from '@/app/admin/actions/settings';

/**
 * The photo of the home section “Nel centro del paese, a 300 metri dal mare”: the owner changes
 * it or adds more (they then slide by themselves on the site). Saved by itself.
 */
export function IntroPhotosCard({ initial }: { initial: Photo[] }) {
  const [photos, setPhotos] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timer = useRef<number | null>(null);
  const change = (next: Photo[]) => {
    setPhotos(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setState('saving');
      const res = await saveIntroPhotosAction(next).catch(() => null);
      setState(res?.ok ? 'saved' : 'error');
    }, 400);
  };
  return (
    <Card
      className="mb-6"
      title="Foto della pagina principale · “A 300 metri dal mare”"
      action={<span className={cn('text-xs font-semibold', state === 'error' ? 'text-terracotta' : 'text-mist')}>{state === 'saving' ? 'Salvo…' : state === 'saved' ? '✓ Salvato' : state === 'error' ? 'Non salvato: riprova' : 'Si salva da solo'}</span>}
    >
      <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <p className="mb-4 text-sm leading-relaxed text-charcoal/80">
            La foto grande accanto a “Nel centro del paese, a 300 metri dal mare”. Cambiala o aggiungine altre: con più foto sul sito scorrono da sole, una dopo l’altra. La prima è quella che si vede per prima.
          </p>
          <PhotoManager photos={photos} onChange={change} roomLabel="Santa Teresa Gallura" />
        </div>
        <Preview photos={photos} />
      </div>
    </Card>
  );
}

/** How the section looks on the site: the photos crossfading under the “300 m” badge. */
function Preview({ photos }: { photos: Photo[] }) {
  const [i, setI] = useState(0);
  const n = photos.length;
  useEffect(() => {
    if (n < 2) return;
    const id = window.setInterval(() => setI((x) => (x + 1) % n), 3200);
    return () => window.clearInterval(id);
  }, [n]);
  const p = n ? photos[i % n]! : null;
  return (
    <div>
      <p className="mb-2 text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-mist">Anteprima sul sito</p>
      <div className="relative aspect-[4/3] overflow-hidden rounded-[1.4rem] bg-sand">
        <AnimatePresence initial={false}>
          {p && (
            <motion.div key={p.id + p.src} className="absolute inset-0" initial={{ opacity: 0, scale: 1.08 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ opacity: { duration: 0.8 }, scale: { duration: 3.6, ease: 'linear' } }}>
              <Image src={p.src} alt={p.alt} fill sizes="300px" className="object-cover" />
            </motion.div>
          )}
        </AnimatePresence>
        {!p && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-mist">
            <Images className="h-6 w-6" /> Nessuna foto: il sito mostra quella originale
          </span>
        )}
        <span className="absolute bottom-3 left-3 flex items-center gap-2 rounded-xl bg-white py-1.5 pl-1.5 pr-3 shadow">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/15 text-gold-2">
            <Footprints className="h-3.5 w-3.5" />
          </span>
          <span className="serif text-base text-navy">300 m</span>
        </span>
        {n > 1 && (
          <span className="absolute bottom-3 right-3 flex gap-1">
            {photos.map((x, k) => (
              <span key={x.id + k} className={cn('h-1.5 rounded-full bg-white transition-all duration-500', k === i % n ? 'w-4' : 'w-1.5 opacity-60')} />
            ))}
          </span>
        )}
      </div>
      <p className="mt-2 text-[0.75rem] text-mist">{n > 1 ? `${n} foto · cambiano ogni 5 secondi` : n === 1 ? '1 foto' : ''}</p>
    </div>
  );
}
