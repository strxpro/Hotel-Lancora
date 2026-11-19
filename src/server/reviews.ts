import 'server-only';
import type { DB, Feedback, Locale, ReviewReply } from '@/lib/types';
import { LOCALES } from '@/lib/types';
import { addDays, todayISO } from '@/lib/dates';
import { localePath } from '@/lib/i18n/config';
import { mutate, newId, readDb } from './db/store';
import { audit, notify, queueEmail } from './events';
import { translateFields } from './ai/content';
import { guestLang } from './guests';
import { appUrl } from './email/templates';

export interface ReviewDTO {
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
}

export const isPublic = (f: Feedback) => f.showOnSite && f.publishConsent && !f.pending;

export function reviewDTO(f: Feedback, db: DB, locale: Locale): ReviewDTO {
  const r = f.roomId ? db.rooms.find((x) => x.id === f.roomId) : null;
  const tr = f.lang !== locale ? f.translations?.[locale] : undefined;
  return {
    id: f.id,
    name: f.name,
    rating: f.rating,
    text: tr ?? f.comment,
    original: f.comment,
    lang: f.lang,
    translated: Boolean(tr),
    photos: f.photos ?? [],
    room: r ? { id: r.id, number: r.numberAuto ? '' : r.number, name: r.text.title || r.name, slug: r.slug } : null,
    replies: (f.replies ?? []).map((x) => {
      const t = x.lang !== locale ? x.translations?.[locale] : undefined;
      return { id: x.id, author: x.author, name: x.name, text: t ?? x.text, original: x.text, translated: Boolean(t), createdAt: x.createdAt };
    }),
    verified: Boolean(f.verified),
    demo: f.demo,
    createdAt: f.createdAt,
  };
}

export function publicReviews(db: DB, locale: Locale, roomId?: string): ReviewDTO[] {
  return db.feedback
    .filter((f) => isPublic(f) && (roomId === undefined || f.roomId === roomId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((f) => reviewDTO(f, db, locale));
}

export function roomRatings(db: DB): Map<string, { avg: number; count: number }> {
  const acc = new Map<string, { sum: number; count: number }>();
  for (const f of db.feedback) {
    if (!f.roomId || !isPublic(f)) continue;
    const a = acc.get(f.roomId) ?? { sum: 0, count: 0 };
    a.sum += f.rating;
    a.count += 1;
    acc.set(f.roomId, a);
  }
  return new Map([...acc].map(([k, v]) => [k, { avg: Math.round((v.sum / v.count) * 10) / 10, count: v.count }]));
}

/** Translates a review (and its replies) into every language of the site, in the background. */
export function translateReviewLater(id: string): void {
  void (async () => {
    const f = readDb().feedback.find((x) => x.id === id);
    if (!f) return;
    const done: Partial<Record<Locale, string>> = { ...(f.translations ?? {}) };
    const replies = new Map<string, Partial<Record<Locale, string>>>();
    for (const l of LOCALES) {
      if (l === f.lang || done[l]) continue;
      try {
        const t = await translateFields({ text: f.comment }, l, f.lang);
        if (!t) return; // no translator connected: originals stay
        done[l] = t.text;
      } catch {
        break;
      }
    }
    for (const r of f.replies ?? []) {
      const tr: Partial<Record<Locale, string>> = { ...(r.translations ?? {}) };
      for (const l of LOCALES) {
        if (l === r.lang || tr[l]) continue;
        try {
          const t = await translateFields({ text: r.text }, l, r.lang);
          if (t) tr[l] = t.text;
        } catch {
          break;
        }
      }
      replies.set(r.id, tr);
    }
    mutate((db) => {
      const x = db.feedback.find((y) => y.id === id);
      if (!x) return;
      if (x.comment === f.comment) x.translations = done;
      for (const r of x.replies ?? []) {
        const tr = replies.get(r.id);
        if (tr) r.translations = tr;
      }
    });
  })();
}

export interface NewReview {
  name: string;
  rating: number;
  comment: string;
  lang: Locale;
  photos: string[];
  roomId: string | null;
  publish: boolean;
  bookingId?: string | null;
  verified?: boolean;
  /** private: the guest's e-mail (required for reviews written on the website) */
  email?: string | null;
}

export function createReview(input: NewReview): Feedback {
  const f = mutate((db) => {
    const verified = Boolean(input.verified);
    const fb: Feedback = {
      id: newId('fb-'),
      bookingId: input.bookingId ?? null,
      roomId: input.roomId && db.rooms.some((r) => r.id === input.roomId) ? input.roomId : null,
      ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
      name: input.name,
      rating: input.rating,
      comment: input.comment,
      lang: input.lang,
      photos: input.photos.slice(0, 3),
      translations: {},
      replies: [],
      verified,
      // a guest who really stayed is published at once (if he agreed); others wait for the owner
      pending: !verified,
      publishConsent: input.publish,
      showOnSite: input.publish,
      demo: false,
      editedAt: null,
      createdAt: new Date().toISOString(),
    };
    db.feedback.unshift(fb);
    const room = db.rooms.find((r) => r.id === fb.roomId);
    notify(db, 'messaggio_ospite', `${'★'.repeat(fb.rating)} Nuova recensione${room ? ` · camera ${room.number}` : ''}`, `${fb.name}: ${fb.comment.slice(0, 140)}${verified ? '' : ' · da approvare'}`, '/admin/marketing?tab=recensioni');
    audit(db, verified ? 'Ospite' : 'Sito web', 'review', 'feedback', fb.id, `${fb.rating}/5${room ? ` camera ${room.number}` : ''}${verified ? ' (verificata)' : ' (da approvare)'}`);
    return fb;
  });
  translateReviewLater(f.id);
  return f;
}

export function addReply(reviewId: string, reply: Omit<ReviewReply, 'id' | 'createdAt' | 'translations'>, actor: string): ReviewReply {
  const r = mutate((db) => {
    const f = db.feedback.find((x) => x.id === reviewId);
    if (!f) throw new Error('Recensione non trovata.');
    const rep: ReviewReply = { ...reply, id: newId('rp-'), createdAt: new Date().toISOString(), translations: {} };
    f.replies = [...(f.replies ?? []), rep];
    audit(db, actor, 'review_reply', 'feedback', f.id, `${reply.author === 'hotel' ? 'Risposta struttura' : 'Risposta ospite'}: ${reply.text.slice(0, 80)}`);
    if (reply.author === 'guest') notify(db, 'messaggio_ospite', 'Nuova risposta a una recensione', `${reply.name}: ${reply.text.slice(0, 140)}`, '/admin/marketing?tab=recensioni');
    return rep;
  });
  translateReviewLater(reviewId);
  return r;
}

/** Review page for a stay: /recensione/<booking token>, in the guest's language. */
export function reviewLink(db: DB, bookingId: string): string | null {
  const b = db.bookings.find((x) => x.id === bookingId);
  if (!b) return null;
  return `${appUrl()}${localePath(guestLang(b.guest), `/recensione/${b.token}`)}`;
}

const g = globalThis as unknown as { __lancoraReviewJob?: number };

/**
 * "Rate your room": the day after check-out, every guest who booked on the website gets one
 * email in their language with a link to rate the room (stars, text, up to 3 photos).
 * Runs at most every 10 minutes, piggy-backing on page loads (no cron needed).
 */
export function sendReviewRequests(force = false): number {
  const now = Date.now();
  if (!force && g.__lancoraReviewJob && now - g.__lancoraReviewJob < 10 * 60_000) return 0;
  g.__lancoraReviewJob = now;
  const db = readDb();
  const cfg = db.settings.reviews;
  if (!cfg?.autoRequest && !force) return 0;
  const today = todayISO();
  const due = db.bookings.filter(
    (b) =>
      b.source === 'sito' &&
      b.status === 'confirmed' &&
      !b.reviewRequestedAt &&
      b.roomId &&
      addDays(b.checkOut, cfg?.delayDays ?? 1) <= today &&
      b.checkOut >= addDays(today, -7) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.guest.email) &&
      !b.guest.email.endsWith('@invalid') &&
      !db.feedback.some((f) => f.bookingId === b.id),
  );
  if (!due.length) return 0;
  mutate((d) => {
    for (const x of due) {
      const b = d.bookings.find((y) => y.id === x.id);
      if (!b) continue;
      b.reviewRequestedAt = new Date().toISOString();
      queueEmail(d, 'richiesta_recensione', b.guest.email, { booking: b, room: d.rooms.find((r) => r.id === b.roomId) ?? null, extra: { lang: guestLang(b.guest), reviewUrl: reviewLink(d, b.id) ?? undefined } });
    }
    audit(d, 'Sistema', 'review_requests', 'feedback', null, `${due.length} richieste di recensione inviate`);
  });
  return due.length;
}
