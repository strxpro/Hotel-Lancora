'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star } from 'lucide-react';
import { useI18n } from './providers';
import { askFreeCancellation, guestCancel, sendFeedback } from '@/app/[locale]/soggiorno/actions';
import { CARE_T } from '@/lib/i18n/care-dict';

/**
 * Cancelling from the guest area: free until the deadline (everything paid goes back by itself);
 * afterwards the guest can ask the hotel for a free cancellation, and the hotel decides.
 */
export function GuestActions({ token, canCancel, cancelled, cancelRule, canAskFree, asked }: { token: string; canCancel: boolean; cancelled: boolean; cancelRule?: string; canAskFree?: boolean; asked?: boolean }) {
  const { t, locale } = useI18n();
  const c = CARE_T[locale];
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (cancelled) return null;
  const err = (e?: string) => (e === 'not_allowed' ? t.guest.cancelNotAllowed : e === 'too_many' ? c.tooMany : e === 'pending' ? c.pending : t.common.error);
  return (
    <div className="space-y-6">
      <section className="border-t border-line pt-10">
        <h2 className="serif text-[1.9rem] text-navy">{t.guest.cancel}</h2>
        {cancelRule && <p className="mt-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm leading-relaxed text-charcoal/85">{cancelRule}</p>}
        {!canCancel ? (
          canAskFree && !asked ? (
            <div className="mt-4">
              <p className="text-sm text-charcoal/80">{c.freeText}</p>
              {!askOpen ? (
                <button type="button" className="btn btn-line mt-4 text-navy" onClick={() => setAskOpen(true)}>
                  {c.freeAsk}
                </button>
              ) : (
                <form
                  className="mt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    start(async () => {
                      const r = await askFreeCancellation(token, note);
                      if (r.ok) {
                        setMsg({ ok: true, text: c.freeSent });
                        setAskOpen(false);
                        router.refresh();
                      } else setMsg({ ok: false, text: err(r.error) });
                    });
                  }}
                >
                  <label className="block">
                    <span className="label">{c.note}</span>
                    <textarea className="field" rows={3} maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} />
                  </label>
                  <button type="submit" disabled={pending} className="btn btn-navy mt-4">
                    {c.freeAsk}
                  </button>
                </form>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-mist">{asked ? c.waiting : t.guest.cancelNotAllowed}</p>
          )
        ) : confirm ? (
          <div className="mt-4 border border-terracotta/30 bg-terracotta/5 p-5">
            <p className="text-sm text-charcoal">{t.guest.cancelConfirm}</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                disabled={pending}
                className="btn h-11 min-h-0 bg-terracotta text-ivory hover:bg-terracotta/90"
                onClick={() =>
                  start(async () => {
                    const r = await guestCancel(token);
                    if (r.ok) router.refresh();
                    else setMsg({ ok: false, text: err(r.error) });
                  })
                }
              >
                {t.common.yes}
              </button>
              <button type="button" className="btn btn-line h-11 min-h-0 text-navy" onClick={() => setConfirm(false)}>
                {t.common.no}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-line mt-4 text-navy" onClick={() => setConfirm(true)}>
            {t.guest.cancel}
          </button>
        )}
      </section>
      {msg && <p className={msg.ok ? 'text-sm text-sage' : 'text-sm text-terracotta'} role="status">{msg.text}</p>}
    </div>
  );
}

export function FeedbackForm({ token, reviewUrl }: { token: string; reviewUrl: string }) {
  const { t, locale } = useI18n();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [publish, setPublish] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <section id="feedback" className="border border-line bg-white p-6 md:p-8">
      <h2 className="serif text-[1.9rem] text-navy">{t.guest.feedback}</h2>
      <p className="mt-2 text-sm text-mist">{t.guest.feedbackText}</p>
      {done ? (
        <p className="mt-6 text-sage" role="status">
          {t.guest.thanks}
        </p>
      ) : (
        <form
          className="mt-6 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!rating) return;
            start(async () => {
              const r = await sendFeedback(token, { rating, comment, publish, lang: locale });
              if (r.ok) setDone(true);
            });
          }}
        >
          <div className="flex gap-1" role="radiogroup" aria-label="Valutazione">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n}/5`} onClick={() => setRating(n)} className="p-1 text-gold">
                <Star className="h-7 w-7" fill={n <= rating ? 'currentColor' : 'none'} strokeWidth={1.2} />
              </button>
            ))}
          </div>
          <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} className="field" required minLength={3} maxLength={1500} aria-label={t.guest.feedback} />
          <label className="flex items-start gap-3 text-sm text-charcoal/80">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-navy)]" />
            {t.guest.publish}
          </label>
          <button type="submit" disabled={pending || !rating} className="btn btn-navy">
            {t.guest.sendRequest}
          </button>
        </form>
      )}
      {/* Google review link offered to every guest, independent of the rating given */}
      {reviewUrl && (
        <a href={reviewUrl} target="_blank" rel="noopener noreferrer" className="link-u mt-6 inline-block text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-navy">
          {t.guest.review}
        </a>
      )}
    </section>
  );
}
