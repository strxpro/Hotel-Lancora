'use client';
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, Check, Eye, EyeOff, Languages, MailCheck, MessageSquareReply, Pencil, Send, Star, Trash2, X } from 'lucide-react';
import type { Feedback } from '@/lib/types';
import { fmtDate } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Flag } from '@/components/site/flags';
import { PhotoMorph } from '@/components/site/photo-morph';
import { Badge, Button, Toggle, useAction, useToast } from './ui';
import { NiceSelect } from './nice-select';
import { approveReviewAction, deleteFeedbackAction, deleteReplyAction, removeReviewPhotoAction, replyReviewAction, saveReviewSettingsAction, sendReviewRequestsNowAction, setReviewVisibleAction, updateReviewAction } from '@/app/admin/actions/marketing';

export type AdminRoom = { id: string; number: string; name: string };

function StarsEdit({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="flex text-gold">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n}`} className={cn('p-px', onChange && 'transition-transform hover:scale-125')}>
          <Star className={onChange ? 'h-6 w-6' : 'h-4 w-4'} fill={n <= value ? 'currentColor' : 'none'} strokeWidth={1.3} />
        </button>
      ))}
    </span>
  );
}

function ReviewRow({ f, rooms, showRoom }: { f: Feedback; rooms: AdminRoom[]; showRoom: boolean }) {
  const { run, pending } = useAction();
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState({ name: f.name, rating: f.rating, comment: f.comment, roomId: f.roomId ?? null });
  const [reply, setReply] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const room = rooms.find((r) => r.id === f.roomId);
  const tr = Object.keys(f.translations ?? {}).length;
  return (
    <motion.li layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30, transition: { duration: 0.25 } }} className={cn('rounded-[1.4rem] border bg-white p-4 md:p-5', f.pending ? 'border-gold/60 bg-gold/[0.04]' : 'border-line')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {edit ? <StarsEdit value={draft.rating} onChange={(rating) => setDraft({ ...draft, rating })} /> : <StarsEdit value={f.rating} />}
            <span className="text-sm font-semibold text-navy">{f.name}</span>
            {f.email && (
              <a href={`mailto:${f.email}`} className="text-xs text-navy underline decoration-gold underline-offset-2" title="Email privata dell’ospite (non pubblicata)">
                {f.email}
              </a>
            )}
            <Flag locale={f.lang} className="h-3 w-4 rounded-[2px]" />
            <span className="text-xs text-mist">{fmtDate(f.createdAt.slice(0, 10))}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {showRoom && <Badge tone="navy">{room ? `Camera ${room.number}` : 'Hotel in generale'}</Badge>}
            {f.pending && <Badge tone="gold">da approvare</Badge>}
            {f.verified && (
              <Badge tone="green">
                <BadgeCheck className="mr-1 inline h-3 w-3" />
                soggiorno verificato
              </Badge>
            )}
            {!f.publishConsent && <Badge tone="gray">solo privata</Badge>}
            {tr > 0 && (
              <Badge tone="gray">
                <Languages className="mr-1 inline h-3 w-3" />
                tradotta in {tr} lingue
              </Badge>
            )}
            {f.demo && <Badge tone="gray">demo</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {f.pending ? (
            <Button size="sm" disabled={pending} onClick={() => run(() => approveReviewAction(f.id))}>
              <Check className="h-4 w-4" /> Approva
            </Button>
          ) : (
            <label className="flex items-center gap-2 rounded-full px-2 text-xs text-mist" title={f.publishConsent ? '' : 'Senza consenso dell’ospite resta privata'}>
              {f.showOnSite ? <Eye className="h-4 w-4 text-sage" /> : <EyeOff className="h-4 w-4" />}
              <Toggle size="sm" checked={f.showOnSite} disabled={!f.publishConsent || pending} onChange={(v) => run(() => setReviewVisibleAction(f.id, v))} label="Mostra sul sito" />
            </label>
          )}
          <button type="button" onClick={() => setEdit((e) => !e)} aria-label="Modifica" title="Modifica" className="flex h-9 w-9 items-center justify-center rounded-full text-navy hover:bg-ivory">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setConfirmDel(true)} aria-label="Elimina" title="Elimina" className="flex h-9 w-9 items-center justify-center rounded-full text-terracotta hover:bg-terracotta/10">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {edit ? (
          <motion.div key="edit" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input className="field text-sm" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Nome" />
              <NiceSelect className="w-full" label="Camera" value={draft.roomId ?? ''} onChange={(v) => setDraft({ ...draft, roomId: v || null })} options={[{ value: '', label: 'Hotel in generale' }, ...rooms.map((x) => ({ value: x.id, label: `${x.number} · ${x.name}` }))]} />
              <textarea className="field text-sm sm:col-span-2" rows={4} value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} aria-label="Testo" />
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={pending} onClick={() => run(() => updateReviewAction(f.id, draft), { onOk: () => setEdit(false) })}>
                Salva
              </Button>
              <Button size="sm" variant="line" onClick={() => setEdit(false)}>
                Annulla
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.p key="text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-[0.95rem] leading-relaxed text-charcoal/90">
            {f.comment}
          </motion.p>
        )}
      </AnimatePresence>

      {(f.photos?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {f.photos!.map((p) => (
            <span key={p} className="group relative">
              <PhotoMorph photos={[{ src: p, alt: f.name }]} thumbClassName="h-20 w-20" />
              <button type="button" onClick={() => run(() => removeReviewPhotoAction(f.id, p))} aria-label="Rimuovi foto" className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-terracotta text-white opacity-100 shadow md:opacity-0 md:group-hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {(f.replies?.length ?? 0) > 0 && (
        <ul className="mt-3 space-y-2">
          <AnimatePresence initial={false}>
            {f.replies!.map((r) => (
              <motion.li key={r.id} layout exit={{ opacity: 0, x: -20 }} className={cn('group flex items-start justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-sm', r.author === 'hotel' ? 'border-l-2 border-gold bg-ivory' : 'bg-ivory/60')}>
                <span>
                  <span className="block text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-gold-2">{r.author === 'hotel' ? 'Risposta della struttura' : `${r.name} · risposta pubblica`}{r.email ? <a href={`mailto:${r.email}`} className="ml-2 normal-case tracking-normal text-navy underline decoration-gold underline-offset-2">{r.email}</a> : null}</span>
                  <span className="text-charcoal/85">{r.text}</span>
                </span>
                <button type="button" onClick={() => run(() => deleteReplyAction(f.id, r.id))} aria-label="Elimina risposta" className="shrink-0 text-mist hover:text-terracotta">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => replyReviewAction(f.id, reply), { onOk: () => setReply('') });
        }}
      >
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={1} maxLength={800} placeholder="Rispondi come hotel (in italiano: viene tradotta da sola)…" className="field min-h-11 flex-1 resize-none py-2.5 text-sm" aria-label="Risposta" />
        <Button size="sm" disabled={pending || reply.trim().length < 2} className="h-11">
          <MessageSquareReply className="h-4 w-4" /> Rispondi
        </Button>
      </form>

      <AnimatePresence>
        {confirmDel && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-terracotta/[0.08] p-3 text-sm text-charcoal">
              Eliminare definitivamente questa recensione (con foto e risposte)?
              <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => deleteFeedbackAction(f.id))}>
                Elimina
              </Button>
              <Button size="sm" variant="line" onClick={() => setConfirmDel(false)}>
                No
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** Every review in one place: approve, hide/show, edit, reply as the hotel, delete. */
export function ReviewsManager({ feedback, rooms, roomId, settings }: { feedback: Feedback[]; rooms: AdminRoom[]; roomId?: string; settings?: { autoRequest: boolean; delayDays: number } }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'pending' | 'room'>(feedback.some((f) => f.pending) && !roomId ? 'pending' : 'all');
  const [room, setRoom] = useState(roomId ?? '');
  const [auto, setAuto] = useState(settings ?? { autoRequest: true, delayDays: 1 });
  const base = roomId ? feedback.filter((f) => f.roomId === roomId) : feedback;
  const list = useMemo(() => base.filter((f) => (filter === 'pending' ? f.pending : filter === 'room' ? f.roomId === room : true)).sort((a, b) => Number(Boolean(b.pending)) - Number(Boolean(a.pending)) || b.createdAt.localeCompare(a.createdAt)), [base, filter, room]);
  const avg = base.length ? base.reduce((s, f) => s + f.rating, 0) / base.length : 0;
  const pendingCount = base.filter((f) => f.pending).length;

  return (
    <div className="space-y-4">
      {settings && (
        <div className="flex flex-col gap-3 rounded-[1.4rem] bg-navy p-4 text-ivory md:flex-row md:items-center">
          <MailCheck className="h-6 w-6 shrink-0 text-gold" />
          <p className="flex-1 text-sm">
            <b>Chiedi un voto in automatico.</b> {auto.delayDays === 0 ? 'Il giorno della partenza' : `${auto.delayDays === 1 ? 'Il giorno dopo' : `${auto.delayDays} giorni dopo`} la partenza`}, chi ha prenotato dal sito riceve un’email nella sua lingua per votare la camera (stelle, testo, fino a 3 foto).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <NiceSelect
              size="sm"
              tone="dark"
              label="Quando"
              value={String(auto.delayDays)}
              onChange={(s) => {
                const v = { ...auto, delayDays: Number(s) };
                setAuto(v);
                run(() => saveReviewSettingsAction(v));
              }}
              options={[0, 1, 2, 3].map((d) => ({ value: String(d), label: d === 0 ? 'giorno della partenza' : d === 1 ? 'giorno dopo' : `${d} giorni dopo` }))}
            />
            <Toggle checked={auto.autoRequest} onChange={(v) => { const n = { ...auto, autoRequest: v }; setAuto(n); run(() => saveReviewSettingsAction(n)); }} label="Richiesta automatica" />
            <Button size="sm" variant="gold" disabled={pending} onClick={() => run(() => sendReviewRequestsNowAction(), { onOk: (d) => toast('ok', (d as { sent: number }).sent ? ((d as { sent: number }).sent === 1 ? 'Email inviata a 1 ospite partito.' : `Email inviate a ${(d as { sent: number }).sent} ospiti partiti.`) : 'Nessun ospite partito da poco a cui scrivere.') })}>
              <Send className="h-3.5 w-3.5" /> Invia ora
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 flex items-center gap-2">
          <span className="serif text-[2rem] leading-none text-navy">{avg ? avg.toFixed(1).replace('.', ',') : '—'}</span>
          <span className="text-xs text-mist">
            media · {base.length} recensioni
          </span>
        </span>
        {(
          [
            ['all', 'Tutte'],
            ['pending', `Da approvare · ${pendingCount}`],
            ...(roomId ? [] : [['room', 'Per camera']]),
          ] as [typeof filter, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cn('relative h-9 rounded-full px-4 text-xs font-semibold transition-colors', filter === k ? 'text-ivory' : 'border border-line bg-white text-navy')}>
            {filter === k && <motion.span layoutId={`rv-f-${roomId ?? 'all'}`} className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative">{l}</span>
          </button>
        ))}
        {filter === 'room' && (
          <NiceSelect size="sm" label="Camera" value={room} onChange={setRoom} options={[{ value: '', label: 'Scegli la camera', disabled: true }, ...rooms.map((x) => ({ value: x.id, label: `${x.number} · ${x.name}` }))]} />
        )}
      </div>
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {list.map((f) => (
            <ReviewRow key={f.id} f={f} rooms={rooms} showRoom={!roomId} />
          ))}
        </AnimatePresence>
      </ul>
      {list.length === 0 && <p className="rounded-2xl bg-ivory p-6 text-center text-sm text-mist">Nessuna recensione qui.</p>}
    </div>
  );
}
