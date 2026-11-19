'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { readDb } from '@/server/db/store';
import { addReply, createReview, isPublic } from '@/server/reviews';
import { findBookingByToken } from '@/server/bookings';
import { clean, clientIp, rateLimit } from '@/server/security';
import { LOCALES, type Locale } from '@/lib/types';

const PHOTO = z.string().regex(/^\/api\/media\/[a-z0-9-]{8,64}\.webp$/);
const Input = z.object({
  token: z.string().max(80).optional(),
  roomId: z.string().max(64).nullable().optional(),
  name: z.string().max(60).optional(),
  email: z.union([z.email(), z.literal('')]).optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(3).max(1500),
  lang: z.enum(LOCALES),
  photos: z.array(PHOTO).max(3),
  publish: z.boolean(),
});

const noLinks = (s: string) => !/(https?:\/\/|www\.|\.com\b|\.ru\b|<a\s)/i.test(s);

/** A review from the website: verified when it comes from the post-stay link, else moderated. */
export async function submitReview(raw: unknown): Promise<{ ok: boolean; verified?: boolean; error?: string }> {
  if (!rateLimit(`review:${await clientIp()}`, 4, 30 * 60_000)) return { ok: false, error: 'rate' };
  const p = Input.safeParse(raw);
  if (!p.success) return { ok: false, error: 'invalid' };
  const d = p.data;
  const comment = clean(d.comment, 1500);
  if (!noLinks(comment)) return { ok: false, error: 'links' };
  if (d.token) {
    const b = findBookingByToken(d.token);
    if (!b || b.status === 'cancelled') return { ok: false, error: 'invalid' };
    if (readDb().feedback.some((f) => f.bookingId === b.id && f.verified)) return { ok: false, error: 'already' };
    createReview({ name: `${b.guest.firstName} ${b.guest.lastName.charAt(0)}.`, rating: d.rating, comment, lang: d.lang, photos: d.photos, roomId: b.roomId, publish: d.publish, bookingId: b.id, verified: true });
    revalidatePath('/', 'layout');
    return { ok: true, verified: true };
  }
  const name = clean(d.name ?? '', 60);
  if (name.length < 2) return { ok: false, error: 'name' };
  // written without a stay: the e-mail is required (private, only for the hotel)
  const email = (d.email ?? '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'email' };
  createReview({ name, email, rating: d.rating, comment, lang: d.lang, photos: d.photos, roomId: d.roomId ?? null, publish: true });
  return { ok: true, verified: false };
}

const ReplyInput = z.object({ name: z.string().trim().min(2).max(60), email: z.email(), text: z.string().trim().min(2).max(600), lang: z.enum(LOCALES) });

/** Guests can answer a review (no links; the owner can delete replies from the panel). */
export async function submitReply(reviewId: string, raw: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!rateLimit(`reply:${await clientIp()}`, 6, 30 * 60_000)) return { ok: false, error: 'rate' };
  const p = ReplyInput.safeParse(raw);
  if (!p.success) return { ok: false, error: 'invalid' };
  const f = readDb().feedback.find((x) => x.id === reviewId);
  if (!f || !isPublic(f) || (f.replies?.length ?? 0) >= 30) return { ok: false, error: 'invalid' };
  const text = clean(p.data.text, 600);
  if (!noLinks(text)) return { ok: false, error: 'links' };
  addReply(reviewId, { author: 'guest', name: clean(p.data.name, 60), email: p.data.email.toLowerCase(), text, lang: p.data.lang as Locale }, 'Sito web');
  revalidatePath('/', 'layout');
  return { ok: true };
}
