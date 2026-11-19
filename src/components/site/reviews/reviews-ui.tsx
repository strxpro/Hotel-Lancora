'use client';
import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, Camera, Check, Languages, Loader2, MessageCircle, Send, Star, X } from 'lucide-react';
import type { Locale } from '@/lib/types';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/dates';
import { EXTRA_T, REVIEWS_T, WALL_T } from '@/lib/i18n/reviews-dict';
import { useI18n } from '../providers';
import { PhotoMorph } from '../photo-morph';
import { submitReply, submitReview } from '@/app/[locale]/recensione/actions';
import { HINTS, RoomPicker, RotatingHint } from './review-inputs';

export type ReviewView = {
  id: string;
  name: string;
  rating: number;
  text: string;
  original: string;
  lang: Locale;
  translated: boolean;
  photos: string[];
  room: { id: string; number: string; name: string; slug: string } | null;
  replies: { id: string; author: 'hotel' | 'guest'; name: string; text: string; original: string; translated: boolean; createdAt: string }[];
  verified: boolean;
  demo: boolean;
  createdAt: string;
};

export const useReviewsT = () => {
  const { locale } = useI18n();
  return REVIEWS_T[locale];
};

export function Stars({ value, size = 'h-4 w-4', className }: { value: number; size?: string; className?: string }) {
  return (
    <span className={cn('relative inline-flex text-gold', className)} aria-label={`${value.toFixed(1)}/5`}>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="relative">
            <Star className={size} strokeWidth={1.3} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className={size} fill="currentColor" strokeWidth={1.3} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useReviewsT();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const words = t.words.split('|');
  return (
    <div className="flex flex-wrap items-center gap-1" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label={t.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <motion.button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}/5`} whileTap={{ scale: 0.75 }} whileHover={{ scale: 1.15, rotate: -8 }} onMouseEnter={() => setHover(n)} onClick={() => onChange(n)} className="p-0.5 text-gold">
          <Star className="h-9 w-9" fill={n <= shown ? 'currentColor' : 'none'} strokeWidth={1.2} />
        </motion.button>
      ))}
      <AnimatePresence mode="popLayout">
        {shown > 0 && (
          <motion.span key={shown} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="ml-2 text-sm font-semibold text-navy">
            {words[shown - 1]}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A soft, stable colour per author (the initial sits on it). */
const TINTS = ['bg-[#e3ecf2] text-[#1d3d57]', 'bg-[#f3e6d6] text-[#7a5326]', 'bg-[#e4ece1] text-[#3f5a35]', 'bg-[#f2e1dc] text-[#8a4433]', 'bg-[#e8e4f0] text-[#4a3f6b]'];
const tintOf = (name: string) => TINTS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % TINTS.length];

/**
 * One review, built for reading: who and when on one line, the score as a small gold pill, the words
 * in a comfortable size (long ones fold, one tap unfolds), photos, the hotel's answer set apart with a
 * gold rule, and "Rispondi" right there — the reply form opens in place, no extra window.
 */
export function ReviewItem({ r, showRoom = true, compact = false, flat = false }: { r: ReviewView; showRoom?: boolean; compact?: boolean; flat?: boolean }) {
  const t = useReviewsT();
  const { locale } = useI18n();
  const w = WALL_T[locale];
  const x = EXTRA_T[locale];
  const [orig, setOrig] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replies, setReplies] = useState(r.replies);
  const long = r.text.length > 340;
  const [more, setMore] = useState(false);
  return (
    <article className={cn('relative bg-white', flat ? 'rounded-[1.5rem] p-5 shadow-[0_1px_0_rgba(16,40,61,0.04),0_18px_40px_-34px_rgba(16,40,61,0.6)] ring-1 ring-line/80 sm:p-6' : 'rounded-[1.75rem] p-5 ring-1 ring-line md:p-7')}>
      <header className="flex items-start gap-3">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-serif text-[1.25rem] leading-none', tintOf(r.name))}>{r.name.charAt(0).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[0.98rem] font-semibold leading-tight text-navy">
            <span className="truncate">{r.name}</span>
            {r.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-sage" aria-label={t.verified} />}
          </p>
          <p className="mt-1 text-[0.75rem] text-mist">{fmtDate(r.createdAt.slice(0, 10), locale, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          {showRoom && r.room && (
            <p className="mt-1.5 w-fit rounded-full bg-ivory px-2 py-0.5 text-[0.7rem] font-medium text-navy">
              {t.room} {r.room.number} · {r.room.name}
            </p>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-gold/12 px-2.5 py-1 text-[0.8rem] font-semibold text-[#7a5a1f]" aria-label={`${r.rating}/5`}>
          <Star className="h-3.5 w-3.5 text-gold" fill="currentColor" strokeWidth={0} />
          {r.rating.toFixed(1).replace('.', ',')}
        </span>
      </header>

      <div className="mt-4">
        <p
          className={cn('whitespace-pre-line text-charcoal [text-wrap:pretty]', compact ? 'line-clamp-4 text-[0.98rem] leading-relaxed' : 'text-[1.04rem] leading-[1.72]', !compact && long && !more && 'line-clamp-6')}
          lang={orig || !r.translated ? r.lang : locale}
        >
          {orig ? r.original : r.text}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {!compact && long && (
            <button type="button" onClick={() => setMore((m) => !m)} className="text-[0.8rem] font-semibold text-navy underline decoration-gold/70 underline-offset-4">
              {more ? w.less : x.read}
            </button>
          )}
          {r.translated && (
            <button type="button" onClick={() => setOrig((o) => !o)} className="flex items-center gap-1.5 text-[0.72rem] text-mist hover:text-navy">
              <Languages className="h-3.5 w-3.5" /> {orig ? t.showTranslation : `${t.translated} · ${t.showOriginal}`}
            </button>
          )}
        </div>
      </div>

      {r.photos.length > 0 && <PhotoMorph className="mt-4" photos={r.photos.map((src, i) => ({ src, alt: `${r.name} · ${i + 1}` }))} thumbClassName="h-24 w-24 sm:h-28 sm:w-36" />}

      {!compact && (
        <div className="mt-5">
          {replies.length > 0 && (
            <ul className="space-y-2.5">
              {replies.map((rep) =>
                rep.author === 'hotel' ? (
                  <motion.li key={rep.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl bg-ivory py-3.5 pl-5 pr-4">
                    <span className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-gold" aria-hidden="true" />
                    <p className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-gold-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[0.7rem] text-gold">⚓</span>
                      {t.hotelReply} · <span className="normal-case tracking-normal text-navy">{w.hotel}</span>
                    </p>
                    <p className="mt-2 text-[0.95rem] leading-relaxed text-charcoal/90">{rep.text}</p>
                  </motion.li>
                ) : (
                  <motion.li key={rep.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-5 flex gap-2.5 border-l border-line pl-4 sm:ml-7">
                    <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-serif text-[0.9rem]', tintOf(rep.name))}>{rep.name.charAt(0).toUpperCase()}</span>
                    <div className="min-w-0">
                      <p className="text-[0.8rem] font-semibold text-navy">{rep.name}</p>
                      <p className="mt-0.5 text-[0.93rem] leading-relaxed text-charcoal/85">{rep.text}</p>
                    </div>
                  </motion.li>
                ),
              )}
            </ul>
          )}
          <AnimatePresence initial={false} mode="popLayout">
            {replying ? (
              <ReplyForm
                key="form"
                reviewId={r.id}
                to={r.name}
                onDone={(rep) => {
                  setReplies((v) => [...v, rep]);
                  setReplying(false);
                }}
                onCancel={() => setReplying(false)}
              />
            ) : (
              <motion.div key="bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cn('flex items-center gap-3 border-t border-line pt-3.5', replies.length > 0 && 'mt-4')}>
                <button type="button" onClick={() => setReplying(true)} className="group flex h-9 items-center gap-2 rounded-full bg-navy/[0.05] px-3.5 text-[0.78rem] font-semibold text-navy transition-colors hover:bg-navy hover:text-ivory">
                  <MessageCircle className="h-4 w-4 transition-transform group-hover:-rotate-12" /> {t.reply}
                </button>
                {replies.length > 0 && <span className="text-[0.75rem] text-mist">{replies.length === 1 ? w.oneReply : t.replies.replace('{n}', String(replies.length))}</span>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </article>
  );
}

/** The reply, written where you are reading: message first, then who you are (the email stays private). */
function ReplyForm({ reviewId, to, onDone, onCancel }: { reviewId: string; to: string; onDone: (r: ReviewView['replies'][number]) => void; onCancel: () => void }) {
  const t = useReviewsT();
  const { locale } = useI18n();
  const x = EXTRA_T[locale];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const field = 'w-full rounded-xl bg-white px-3.5 py-2.5 text-[0.9rem] outline-none ring-1 ring-line transition-shadow placeholder:text-mist/80 focus:ring-2 focus:ring-navy';
  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      onAnimationComplete={() => area.current?.focus({ preventScroll: true })}
      className="overflow-hidden"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const res = await submitReply(reviewId, { name, email: email.trim(), text, lang: locale }).catch(() => ({ ok: false, error: 'error' }));
        setBusy(false);
        if (res.ok) onDone({ id: `new-${Date.now()}`, author: 'guest', name, text, original: text, translated: false, createdAt: new Date().toISOString() });
        else setErr(res.error === 'links' ? t.links : res.error === 'rate' ? t.rate : t.error);
      }}
    >
      <div className="mt-4 rounded-2xl bg-ivory p-3 ring-1 ring-line/70">
        <p className="mb-2 flex items-center gap-1.5 px-1 text-[0.72rem] font-semibold text-navy">
          <MessageCircle className="h-3.5 w-3.5 text-gold-2" /> {t.reply} · <span className="font-normal text-mist">@{to}</span>
        </p>
        <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} maxLength={600} rows={3} placeholder={t.replyPh} className={cn(field, 'resize-none')} aria-label={t.replyPh} />
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t.yourName} autoComplete="name" className={field} aria-label={t.yourName} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" maxLength={120} placeholder={x.email} autoComplete="email" className={field} aria-label={x.email} />
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <p className="px-1 text-[0.68rem] text-mist">{x.emailNote}</p>
          <div className="ml-auto flex gap-1.5">
            <button type="button" onClick={onCancel} className="h-9 rounded-full px-3.5 text-[0.78rem] text-mist hover:text-navy">
              {t.close}
            </button>
            <button type="submit" disabled={busy || name.trim().length < 2 || !okEmail || text.trim().length < 2} className="flex h-9 items-center gap-1.5 rounded-full bg-navy px-4 text-[0.78rem] font-semibold text-ivory transition-opacity disabled:opacity-35">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t.send}
            </button>
          </div>
        </div>
        {err && <p className="mt-2 px-1 text-xs text-terracotta">{err}</p>}
      </div>
    </motion.form>
  );
}

/** Stars, words, up to 3 photos, consent. With a stay token the review is verified and goes online at once. */
export function ReviewForm({ token, rooms, roomId: fixedRoom, onDone, title }: { token?: string; rooms?: { id: string; number: string; name: string }[]; roomId?: string | null; onDone?: () => void; title?: string }) {
  const t = useReviewsT();
  const { locale } = useI18n();
  const [rating, setRating] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [roomId, setRoomId] = useState<string | null>(fixedRoom ?? null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<'verified' | 'pending' | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    for (const f of [...files].slice(0, 3 - photos.length)) {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/review-photo', { method: 'POST', body: fd }).catch(() => null);
      const j = r ? ((await r.json().catch(() => ({}))) as { src?: string }) : {};
      if (j.src) setPhotos((p) => [...p, j.src!].slice(0, 3));
      else setErr(t.error);
    }
    setUploading(false);
  };

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center rounded-[1.6rem] bg-white px-6 py-10 text-center ring-1 ring-line">
        <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="flex h-16 w-16 items-center justify-center rounded-full bg-gold text-navy-3">
          <Check className="h-8 w-8" />
        </motion.span>
        <p className="serif mt-5 text-[2rem] leading-tight text-navy">{t.thanks}</p>
        <p className="mt-2 max-w-sm text-sm text-mist">{done === 'verified' ? t.thanksVerified : t.thanksPending}</p>
        {onDone && (
          <button type="button" onClick={onDone} className="btn btn-navy mt-6 h-11 min-h-0 px-6">
            {t.close}
          </button>
        )}
      </motion.div>
    );
  }

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!rating) return setErr(t.stars);
        if (!token && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setErr(EXTRA_T[locale].email);
        setBusy(true);
        setErr(null);
        const res = await submitReview({ token, roomId, name, email: token ? undefined : email.trim(), rating, comment, lang: locale, photos, publish }).catch(() => ({ ok: false, error: 'error' }) as { ok: boolean; verified?: boolean; error?: string });
        setBusy(false);
        if (res.ok) setDone(res.verified ? 'verified' : 'pending');
        else setErr(res.error === 'links' ? t.links : res.error === 'already' ? t.already : res.error === 'rate' ? t.rate : res.error === 'email' ? EXTRA_T[locale].email : t.error);
      }}
    >
      {title && <p className="serif text-[1.8rem] leading-tight text-navy">{title}</p>}
      <div>
        <p className="label">{t.stars}</p>
        <StarInput value={rating} onChange={setRating} />
      </div>
      {!token && rooms && rooms.length > 0 && fixedRoom === undefined && (
        <div>
          <p className="label">{t.chooseRoom}</p>
          <RoomPicker value={roomId} onChange={setRoomId} rooms={rooms} general={t.general} label={t.chooseRoom} />
        </div>
      )}
      {!token && (
        <label className="block">
          <span className="label">{t.yourName}</span>
          <span className="relative block">
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required minLength={2} autoComplete="name" />
            <RotatingHint hints={HINTS[locale].name} show={!name} />
          </span>
        </label>
      )}
      {!token && (
        <label className="block">
          <span className="label">{EXTRA_T[locale].email}</span>
          <span className="relative block">
            <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} required autoComplete="email" inputMode="email" />
            <RotatingHint hints={HINTS[locale].email} show={!email} />
          </span>
          <span className="mt-1.5 block text-[0.72rem] text-mist">{EXTRA_T[locale].emailNote}</span>
        </label>
      )}
      <label className="block">
        <span className="label">{t.yourReview}</span>
        <span className="relative block">
          <textarea className="field min-h-[7rem] resize-none" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1500} required minLength={3} aria-describedby="review-ph" />
          <span id="review-ph" className="sr-only">{t.reviewPh}</span>
          <RotatingHint hints={HINTS[locale].review} show={!comment} multiline />
        </span>
      </label>
      <div>
        <p className="label">{t.photos}</p>
        <div className="flex flex-wrap gap-2">
          <AnimatePresence initial={false}>
            {photos.map((p) => (
              <motion.span key={p} layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} className="relative h-20 w-20 overflow-hidden rounded-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p} alt="" className="h-full w-full object-cover" />
                <button type="button" aria-label="×" onClick={() => setPhotos((x) => x.filter((y) => y !== p))} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-navy/80 text-ivory">
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          {photos.length < 3 && (
            <button type="button" onClick={() => file.current?.click()} disabled={uploading} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-navy/30 text-[0.66rem] text-navy transition-colors hover:bg-navy/[0.03]">
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              {t.addPhoto}
            </button>
          )}
          <input ref={file} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        </div>
      </div>
      {token && (
        <label className="flex items-start gap-3 text-sm text-charcoal/85">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-navy)]" />
          {t.publish}
        </label>
      )}
      {err && <p className="text-sm text-terracotta">{err}</p>}
      <motion.button type="submit" whileTap={{ scale: 0.97 }} disabled={busy || uploading} className="btn btn-navy h-12 min-h-0 w-full sm:w-auto sm:px-8">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t.send}
      </motion.button>
    </form>
  );
}
