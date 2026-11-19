'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ImagePlus, Loader2, Plus, Star, Trash2, UploadCloud } from 'lucide-react';
import type { LibraryPhoto } from '@/server/library';
import { addToLibraryAction, libraryAction } from '@/app/admin/actions/library';
import type { Photo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { shrinkPhoto } from '@/lib/shrink-photo';

type Upload = { id: string; name: string; progress: number; error: string | null; preview: string };

/** Resize + compress in the browser before upload (keeps uploads fast on hotel Wi-Fi / 4G). */
async function compress(file: File): Promise<Blob> {
  const out = await shrinkPhoto(file);
  if (out === file) throw new Error('Formato immagine non leggibile');
  return out;
}

function upload(blob: Blob, onProgress: (p: number) => void): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', new File([blob], 'foto.webp', { type: 'image/webp' }));
    xhr.open('POST', '/api/admin/upload');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const j = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(j);
        else reject(new Error(j.error || `Errore ${xhr.status}`));
      } catch {
        reject(new Error('Risposta non valida dal server'));
      }
    };
    xhr.onerror = () => reject(new Error('Connessione interrotta: riprova'));
    xhr.send(fd);
  });
}

export function PhotoManager({ photos, onChange, roomLabel }: { photos: Photo[]; onChange: (p: Photo[]) => void; roomLabel: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [drag, setDrag] = useState<number | null>(null);
  const latest = useRef(photos);
  latest.current = photos;

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 20);
    for (const f of list) {
      const id = crypto.randomUUID();
      setUploads((u) => [...u, { id, name: f.name, progress: 0, error: null, preview: URL.createObjectURL(f) }]);
      try {
        if (f.size > 25 * 1024 * 1024) throw new Error('File oltre 25 MB');
        const blob = await compress(f);
        const res = await upload(blob, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
        const photo: Photo = { id: `ph-${id.slice(0, 8)}`, src: res.src, width: res.width, height: res.height, alt: `${roomLabel}`, demo: false };
        onChange([...latest.current, photo]);
        setUploads((u) => u.filter((x) => x.id !== id));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
      }
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p!);
    onChange(next);
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn('flex flex-col items-center justify-center border border-dashed px-6 py-10 text-center transition-colors', over ? 'border-navy bg-navy/[0.04]' : 'border-sand bg-white')}
      >
        <UploadCloud className="h-9 w-9 text-gold-2" strokeWidth={1.2} />
        <p className="mt-3 text-sm text-navy">Trascina qui le foto oppure</p>
        <button type="button" onClick={() => input.current?.click()} className="mt-3 inline-flex items-center gap-2 bg-navy px-4 py-2.5 text-xs font-semibold text-ivory">
          <ImagePlus className="h-4 w-4" /> Scegli dal dispositivo
        </button>
        <p className="mt-3 text-xs text-mist">JPG, PNG o WebP · ridimensionate e compresse automaticamente · anche dal telefono</p>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
      </div>

      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 space-y-2">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center gap-3 border border-line bg-white p-2 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u.preview} alt="" className="h-10 w-14 object-cover" />
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                {u.error ? (
                  <span className="flex items-center gap-2 text-xs text-terracotta">
                    {u.error}
                    <button type="button" className="underline" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>
                      chiudi
                    </button>
                  </span>
                ) : (
                  <span className="h-1 w-28 overflow-hidden bg-sand">
                    <span className="block h-full bg-navy transition-[width]" style={{ width: `${u.progress}%` }} />
                  </span>
                )}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      <PhotoLibrary inRoom={photos.map((p) => p.src)} onAdd={(list) => onChange([...latest.current, ...list.map((x, k) => ({ id: `ph-${Date.now().toString(36)}${k}`, src: x.src, width: x.width, height: x.height, alt: roomLabel, demo: false }))])} />

      {photos.length > 0 && (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <motion.li
              layout
              key={p.id}
              draggable
              // the others make room while the photo is dragged (live order + layout animation)
              // native drag events (motion keeps onDragStart/onDragEnd for its own gestures)
              onDragStartCapture={(e) => {
                setDrag(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnter={() => {
                if (drag !== null && drag !== i) {
                  move(drag, i);
                  setDrag(i);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              onDragEndCapture={() => setDrag(null)}
              transition={{ layout: { type: 'spring', stiffness: 420, damping: 34 } }}
              animate={{ scale: drag === i ? 0.94 : 1, rotate: drag === i ? -1.5 : 0 }}
              className={cn('group relative cursor-grab overflow-hidden rounded-2xl border bg-white active:cursor-grabbing', i === 0 ? 'border-navy' : 'border-line', drag === i && 'opacity-40 ring-2 ring-gold')}
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-sand">
                <Image src={p.src} alt={p.alt} fill sizes="240px" className="object-cover" />
                {i === 0 && <span className="absolute left-2 top-2 bg-navy px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-ivory">Principale</span>}
                {p.demo && <span className="absolute right-2 top-2 bg-gold/90 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase text-navy-3">demo</span>}
              </div>
              <label className="sr-only" htmlFor={`alt-${p.id}`}>
                Descrizione foto
              </label>
              <input id={`alt-${p.id}`} value={p.alt} onChange={(e) => onChange(photos.map((x) => (x.id === p.id ? { ...x, alt: e.target.value } : x)))} className="w-full border-t border-line px-2 py-1.5 text-xs outline-none focus:bg-ivory" placeholder="Descrizione (accessibilità)" />
              <div className="flex items-center justify-between border-t border-line px-1 py-1">
                <div className="flex">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Sposta a sinistra" className="flex h-8 w-8 items-center justify-center text-navy disabled:opacity-25">
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === photos.length - 1} aria-label="Sposta a destra" className="flex h-8 w-8 items-center justify-center text-navy disabled:opacity-25">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex">
                  {i !== 0 && (
                    <button type="button" onClick={() => move(i, 0)} aria-label="Imposta come principale" title="Imposta come principale" className="flex h-8 w-8 items-center justify-center text-gold-2">
                      <Star className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button type="button" onClick={() => onChange(photos.filter((x) => x.id !== p.id))} aria-label="Elimina foto" className="flex h-8 w-8 items-center justify-center text-terracotta">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- the hotel's photo library ---------------- */

/**
 * All the hotel's photos in one place: a strip of thumbnails that fades out with "Vedi tutte"; open,
 * it shows them all in a box where you tick the ones you want and press "Aggiungi".
 * "Carica nella libreria" puts many photos in at once without adding them to this room.
 */
function PhotoLibrary({ inRoom, onAdd }: { inRoom: string[]; onAdd: (p: LibraryPhoto[]) => void }) {
  const [items, setItems] = useState<LibraryPhoto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = () => void libraryAction().then(setItems).catch(() => setItems([]));
  useEffect(load, []);
  const here = new Set(inRoom);
  const free = (items ?? []).filter((p) => !here.has(p.src));
  const toggle = (src: string) => setSel((s) => (s.includes(src) ? s.filter((x) => x !== src) : [...s, src]));

  const uploadMany = async (files: FileList) => {
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 80);
    setBusy({ done: 0, total: list.length });
    const added: { src: string; width: number; height: number }[] = [];
    for (const f of list) {
      try {
        const res = await upload(await compress(f), () => {});
        added.push(res);
      } catch {
        /* one bad file does not stop the others */
      }
      setBusy((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    if (added.length) await addToLibraryAction(added);
    setBusy(null);
    setOpen(true);
    load();
  };

  if (!items) return <div className="mt-5 h-24 animate-pulse rounded-2xl bg-sand/40" />;
  return (
    <section className="mt-6 rounded-[1.6rem] border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-navy">Libreria dell’hotel</p>
          <p className="text-xs text-mist">{items.length ? `${items.length} foto · scegli quelle per questa camera` : 'Carica qui tutte le foto dell’hotel: poi le scegli camera per camera.'}</p>
        </div>
        <span className="flex items-center gap-2">
          <button type="button" onClick={() => input.current?.click()} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-xs font-semibold text-navy hover:border-navy disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
            {busy ? `Carico ${busy.done}/${busy.total}…` : 'Carica nella libreria'}
          </button>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void uploadMany(e.target.files)} />
        </span>
      </div>

      {!open && free.length > 0 && (
        <div className="relative mt-4">
          <div className="flex gap-2 overflow-hidden">
            {free.slice(0, 9).map((p, k) => (
              <motion.button key={p.src} type="button" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.04 }} onClick={() => { setSel([p.src]); setOpen(true); }} className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-sand ring-1 ring-line">
                <Image src={p.src} alt="" fill sizes="112px" className="object-cover" />
              </motion.button>
            ))}
          </div>
          {/* the strip fades out into "see all" */}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-56 bg-gradient-to-l from-white via-white/90 to-transparent" />
          <button type="button" onClick={() => setOpen(true)} className="absolute right-0 top-1/2 inline-flex h-10 -translate-y-1/2 items-center gap-2 rounded-full bg-navy px-4 text-xs font-semibold text-ivory shadow-[0_10px_30px_-12px_rgba(16,40,61,0.8)]">
            Vedi tutte ({free.length}) <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="thin-scroll mt-4 max-h-[26rem] overflow-y-auto rounded-2xl bg-ivory/70 p-3">
              {items.length === 0 ? (
                <p className="py-8 text-center text-sm text-mist">La libreria è vuota: premi “Carica nella libreria”.</p>
              ) : (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {items.map((p, k) => {
                    const already = here.has(p.src);
                    const on = sel.includes(p.src);
                    return (
                      <motion.li key={p.src} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(k, 24) * 0.015 }}>
                        <button type="button" disabled={already} onClick={() => toggle(p.src)} aria-pressed={on} className={cn('relative block aspect-[4/3] w-full overflow-hidden rounded-xl bg-sand transition', on ? 'ring-[3px] ring-gold' : 'ring-1 ring-line hover:ring-navy/40', already && 'opacity-45')}>
                          <Image src={p.src} alt="" fill sizes="180px" className="object-cover" />
                          <AnimatePresence>
                            {on && (
                              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-gold text-navy-3 shadow">
                                <Check className="h-3.5 w-3.5" />
                              </motion.span>
                            )}
                          </AnimatePresence>
                          {already && <span className="absolute inset-x-0 bottom-0 bg-navy-3/70 py-0.5 text-center text-[0.6rem] font-semibold text-ivory">già in questa camera</span>}
                          {!already && p.rooms.length > 0 && <span className="absolute inset-x-0 bottom-0 bg-navy-3/55 py-0.5 text-center text-[0.6rem] text-ivory">in {p.rooms.slice(0, 3).join(', ')}</span>}
                        </button>
                      </motion.li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="flex gap-2">
                <button type="button" onClick={() => setSel(free.map((p) => p.src))} className="h-9 rounded-full px-3 text-xs font-semibold text-navy hover:bg-navy/5">Seleziona tutte</button>
                <button type="button" onClick={() => { setSel([]); setOpen(false); }} className="h-9 rounded-full px-3 text-xs font-semibold text-mist hover:text-navy">Chiudi</button>
              </span>
              <motion.button
                type="button"
                disabled={!sel.length}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  onAdd(items.filter((p) => sel.includes(p.src) && !here.has(p.src)));
                  setSel([]);
                  setOpen(false);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-navy px-5 text-xs font-semibold text-ivory disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Aggiungi {sel.length ? `${sel.length} ${sel.length === 1 ? 'foto' : 'foto'}` : ''} alla camera
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
