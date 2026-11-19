'use client';
import { useMemo, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, MapPin, Plus, RotateCcw, Save, Trash2, Umbrella } from 'lucide-react';
import type { PlaceEdit } from '@/lib/places';
import { parseLatLng } from '@/lib/places';
import { cn } from '@/lib/utils';
import { Button, Field, Toggle, useAction } from './ui';
import { PhotoManager } from './photo-manager';
import { resetPlacesAction, savePlacesAction } from '@/app/admin/actions/settings';

const EASE = [0.22, 0.61, 0.12, 1] as const;

/**
 * Spiagge e dintorni: the places guests see under "Dintorni" and on the "Esperienze" page. The
 * owner changes photos (upload, order, cover = first), name and texts in Italian (the other
 * languages follow by themselves), hides a place or adds a new one from a Google Maps link.
 */
export function PlacesEditor({ initial, custom }: { initial: PlaceEdit[]; custom: boolean }) {
  const { run, pending } = useAction();
  const [list, setList] = useState<PlaceEdit[]>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [open, setOpen] = useState<string | null>(null);
  const dirty = useMemo(() => JSON.stringify(list) !== saved, [list, saved]);
  const set = (id: string, patch: Partial<PlaceEdit>) => setList((l) => l.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const move = (i: number, d: -1 | 1) =>
    setList((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const add = () => {
    const id = `luogo-${Math.random().toString(36).slice(2, 8)}`;
    const ref = list[0];
    setList((l) => [...l, { id, name: '', kind: { it: 'Spiaggia' }, text: { it: '' }, time: { it: '' }, distance: '', lat: ref?.lat ?? 41.24, lng: ref?.lng ?? 9.19, beach: true, photos: [], custom: true }]);
    setOpen(id);
  };
  const save = () =>
    run(() => savePlacesAction(list), {
      success: 'Salvato: il sito mostra già i luoghi aggiornati.',
      onOk: () => setSaved(JSON.stringify(list)),
    });

  return (
    <section className="relative">
      <div className="mb-5 flex flex-wrap items-start gap-4 rounded-3xl bg-navy p-5 text-ivory md:p-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold/20 text-gold">
          <Umbrella className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="serif text-[1.5rem] leading-tight">Spiagge e dintorni</p>
          <p className="mt-1 max-w-2xl text-[0.85rem] leading-relaxed text-ivory/70">Le foto e i testi che gli ospiti vedono nella sezione “Dintorni” della pagina principale, sulla mappa e nella pagina “Esperienze”. Scrivi in italiano: le altre lingue si traducono da sole. La prima foto è la copertina.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="gold" onClick={add}>
            <Plus className="h-4 w-4" /> Aggiungi un luogo
          </Button>
          {custom && (
            <Button variant="ghost" className="text-ivory hover:bg-white/10" disabled={pending} onClick={() => window.confirm('Tornare ai luoghi originali? Le tue foto e i tuoi testi di questa sezione verranno tolti dal sito.') && run(() => resetPlacesAction(), { onOk: () => window.location.reload() })}>
              <RotateCcw className="h-4 w-4" /> Originali
            </Button>
          )}
        </div>
      </div>

      <ul className="space-y-3">
        {list.map((p, i) => {
          const isOpen = open === p.id;
          const cover = p.photos[0]?.src;
          return (
            <motion.li key={p.id} layout transition={{ layout: { type: 'spring', stiffness: 380, damping: 34 } }} className={cn('overflow-hidden rounded-3xl border bg-white transition-colors', isOpen ? 'border-navy/40' : 'border-line', p.hidden && 'opacity-60')}>
              <div className="flex items-center gap-3 p-3 pr-4">
                <button type="button" onClick={() => setOpen(isOpen ? null : p.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={isOpen}>
                  <span className="relative h-16 w-20 shrink-0 overflow-hidden rounded-2xl bg-sand">
                    {cover ? <Image src={cover} alt="" fill sizes="80px" className="object-cover" /> : <span className="flex h-full items-center justify-center text-mist"><Umbrella className="h-5 w-5" /></span>}
                    <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[0.6rem] font-bold text-navy-3">{i + 1}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[1.02rem] font-semibold text-navy">{p.name || 'Nuovo luogo'}</span>
                    <span className="block truncate text-xs text-mist">
                      {[p.kind.it, p.distance, `${p.photos.length} ${p.photos.length === 1 ? 'foto' : 'foto'}`].filter(Boolean).join(' · ')}
                      {p.hidden ? ' · nascosto' : ''}
                    </span>
                  </span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-mist transition-transform duration-300', isOpen && 'rotate-180')} />
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Sposta su" title="Sposta su" className="flex h-9 w-9 items-center justify-center rounded-full text-navy hover:bg-sand-2 disabled:opacity-30">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="Sposta giù" title="Sposta giù" className="flex h-9 w-9 items-center justify-center rounded-full text-navy hover:bg-sand-2 disabled:opacity-30">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => set(p.id, { hidden: !p.hidden })} aria-label={p.hidden ? 'Mostra sul sito' : 'Nascondi dal sito'} title={p.hidden ? 'Mostra sul sito' : 'Nascondi dal sito'} className={cn('flex h-9 w-9 items-center justify-center rounded-full hover:bg-sand-2', p.hidden ? 'text-terracotta' : 'text-navy')}>
                    {p.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
                    <PlaceForm p={p} onChange={(patch) => set(p.id, patch)} onRemove={p.custom ? () => setList((l) => l.filter((x) => x.id !== p.id)) : undefined} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ul>

      {/* the save bar rises only when something changed */}
      <AnimatePresence>
        {dirty && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="sticky bottom-4 z-20 mt-5 flex items-center justify-between gap-3 rounded-full border border-line bg-white/95 py-2 pl-5 pr-2 shadow-[0_24px_60px_-28px_rgba(16,40,61,0.6)] backdrop-blur">
            <span className="text-sm text-navy">Modifiche non ancora sul sito</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setList(JSON.parse(saved) as PlaceEdit[])}>
                Annulla
              </Button>
              <Button disabled={pending || list.some((p) => !p.name.trim())} onClick={save}>
                <Save className="h-4 w-4" /> {pending ? 'Salvo…' : 'Salva'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function PlaceForm({ p, onChange, onRemove }: { p: PlaceEdit; onChange: (patch: Partial<PlaceEdit>) => void; onRemove?: () => void }) {
  const [where, setWhere] = useState('');
  const point = where.trim() ? parseLatLng(where) : null;
  return (
    <div className="border-t border-line p-4 md:p-6">
      <p className="label">Foto (la prima è la copertina)</p>
      <PhotoManager photos={p.photos} onChange={(photos) => onChange({ photos })} roomLabel={p.name || 'Luogo'} />
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Nome">
          <input className="field" value={p.name} maxLength={80} onChange={(e) => onChange({ name: e.target.value })} placeholder="Es. Rena Bianca" />
        </Field>
        <Field label="Tipo" hint="Es. Spiaggia, Belvedere, Paese">
          <input className="field" value={p.kind.it ?? ''} maxLength={60} onChange={(e) => onChange({ kind: { ...p.kind, it: e.target.value } })} />
        </Field>
        <Field label="Descrizione" className="sm:col-span-2">
          <textarea className="field min-h-[110px]" value={p.text.it ?? ''} maxLength={1500} onChange={(e) => onChange({ text: { ...p.text, it: e.target.value } })} placeholder="Due o tre frasi: cosa si trova, perché andarci." />
        </Field>
        <Field label="Distanza" hint="Es. ≈ 0,6 km">
          <input className="field" value={p.distance} maxLength={30} onChange={(e) => onChange({ distance: e.target.value })} />
        </Field>
        <Field label="Come arrivare" hint="Es. circa 10 min a piedi">
          <input className="field" value={p.time.it ?? ''} maxLength={80} onChange={(e) => onChange({ time: { ...p.time, it: e.target.value } })} />
        </Field>
        <label className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3 text-sm sm:col-span-2">
          <span>
            È una spiaggia <span className="block text-xs text-mist">Il chatbot la propone a chi chiede del mare.</span>
          </span>
          <Toggle checked={p.beach} onChange={(beach) => onChange({ beach })} label="È una spiaggia" />
        </label>
        <Field label="Posizione sulla mappa" className="sm:col-span-2" hint={point ? `Trovata: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : `Ora: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} · incolla il link di Google Maps del luogo per cambiarla`}>
          <div className="flex gap-2">
            <input className="field flex-1" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="https://maps.google.com/… oppure 41.2453, 9.1897" />
            <Button variant="line" disabled={!point} onClick={() => point && (onChange(point), setWhere(''))}>
              <MapPin className="h-4 w-4" /> Usa
            </Button>
          </div>
        </Field>
      </div>
      {onRemove && (
        <button type="button" onClick={() => window.confirm('Eliminare questo luogo?') && onRemove()} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-terracotta hover:underline">
          <Trash2 className="h-3.5 w-3.5" /> Elimina luogo
        </button>
      )}
    </div>
  );
}
