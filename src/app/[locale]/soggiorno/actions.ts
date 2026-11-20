'use server';
import { cancelFeeAmount, isFreeCancel } from '@/lib/cancellation';
import { round2 } from '@/lib/availability';
import { money } from '@/lib/utils';
import { CANCEL_T } from '@/lib/i18n/stay-dict';
import { cardPaymentsReady } from '@/server/payments/stripe';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { BookingError, findBookingByToken } from '@/server/bookings';
import { answerChange, askFreeCancel, cancelAndRefund, postMessage, proposeDates, withdrawChange } from '@/server/booking-care';
import { cardsAvailable, startCardCheckout } from '@/server/payments/card';
import { mutate, newId, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { clean, clientIp, rateLimit, requestOrigin } from '@/server/security';
import { diffDays, todayISO } from '@/lib/dates';
import { isLocale, localePath } from '@/lib/i18n/config';

async function limited(key: string, n: number): Promise<boolean> {
  const ip = await clientIp();
  return !rateLimit(`${key}:${ip}`, n, 15 * 60_000);
}

type Res = { ok: boolean; error?: string };
const fail = (e: unknown): Res => ({ ok: false, error: e instanceof BookingError ? (e.message === 'not_available' ? 'not_available' : e.message) : 'error' });
const done = (): Res => {
  revalidatePath('/', 'layout');
  return { ok: true };
};

/** A message to the hotel in the conversation of the booking (the owner is told on Telegram). */
export async function sendGuestMessage(token: string, text: string): Promise<Res> {
  if (await limited('guest-msg', 12)) return { ok: false, error: 'too_many' };
  const b = findBookingByToken(token);
  const body = clean(text, 3000);
  if (!b || body.length < 2) return { ok: false, error: 'invalid' };
  try {
    postMessage(b.id, 'guest', body, 'Ospite');
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Older pages: the free-text "change request" now goes into the same conversation. */
export async function requestChange(token: string, text: string): Promise<Res> {
  return sendGuestMessage(token, text);
}

export async function guestCancel(token: string): Promise<Res> {
  if (await limited('guest-cancel', 5)) return { ok: false, error: 'too_many' };
  const b = findBookingByToken(token);
  if (!b || b.status === 'cancelled') return { ok: false, error: 'not_found' };
  const db = readDb();
  if (!isFreeCancel(todayISO(), b.checkIn, db.settings.payments.freeCancellationDays)) return { ok: false, error: 'not_allowed' };
  try {
    // free: everything paid goes back, on the card for real
    await cancelAndRefund(b.id, 'Ospite (area ospite)', { refund: b.amountPaid, reason: 'Annullata dall’ospite online' });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export type LateCancel = { ok: true; url: string | null; requested?: boolean } | { ok: false; error: string };

/**
 * Cancelling after the free period: the fee is kept from what was paid (the rest goes back), or the
 * guest pays what is missing on Stripe's page and the booking is cancelled as soon as it is paid.
 * Without card payments on the site the reception gets the request (and the owner a Telegram message).
 */
export async function cancelWithFee(token: string, locale: string): Promise<LateCancel> {
  if (await limited('guest-cancel', 5)) return { ok: false, error: 'too_many' };
  const b = findBookingByToken(token);
  if (!b || b.status !== 'confirmed') return { ok: false, error: 'not_found' };
  const db = readDb();
  const today = todayISO();
  if (b.checkIn < today) return { ok: false, error: 'not_allowed' };
  if (isFreeCancel(today, b.checkIn, db.settings.payments.freeCancellationDays)) {
    const r = await guestCancel(token);
    return r.ok ? { ok: true, url: null } : { ok: false, error: r.error ?? 'error' };
  }
  const fee = cancelFeeAmount(db.settings.payments, b.total, diffDays(b.checkIn, b.checkOut));
  const due = round2(fee - b.amountPaid);
  const l = isLocale(locale) ? locale : 'it';
  try {
    if (due <= 0) {
      await cancelAndRefund(b.id, 'Ospite (area ospite)', { refund: round2(b.amountPaid - fee), reason: `dall’ospite online, trattenuta la penale di € ${fee.toFixed(2)}` });
      return { ...done(), url: null } as LateCancel;
    }
    if (cardsAvailable() && cardPaymentsReady(db)) {
      const base = await requestOrigin();
      const page = `${base}${localePath(l, `/soggiorno/${b.token}`)}`;
      const url = await startCardCheckout(b, { purpose: 'cancel_fee', amount: due, successUrl: `${page}?carta={CHECKOUT_SESSION_ID}`, cancelUrl: `${page}?carta=annullata`, locale: l });
      mutate((d) => audit(d, 'Ospite', 'card_page', 'booking', b.id, `${b.code} · aperta la pagina per pagare la penale di cancellazione (€ ${due.toFixed(2)})`));
      return { ok: true, url };
    }
    // no card payments on the site: the reception arranges the fee and the cancellation
    const fmt = money(fee, l, 2);
    const text = CANCEL_T[l].msg.replace('{fee}', fmt);
    postMessage(b.id, 'guest', l === 'it' ? text : `${text}
(${CANCEL_T.it.msg.replace('{fee}', money(fee, 'it', 2))})`, 'Ospite');
    revalidatePath('/', 'layout');
    return { ok: true, url: null, requested: true };
  } catch (e) {
    const f = fail(e);
    return { ok: false, error: f.error ?? 'error' };
  }
}

const Dates = z.object({ checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(800) });

/** The guest asks for other dates: the owner accepts or declines on the booking page. */
export async function askNewDates(token: string, raw: unknown): Promise<Res> {
  if (await limited('guest-dates', 6)) return { ok: false, error: 'too_many' };
  const b = findBookingByToken(token);
  const d = Dates.safeParse(raw);
  if (!b || !d.success) return { ok: false, error: 'invalid' };
  if (b.changeRequest?.status === 'pending') return { ok: false, error: 'pending' };
  try {
    proposeDates(b.id, 'guest', 'Ospite', { checkIn: d.data.checkIn, checkOut: d.data.checkOut, note: clean(d.data.note, 800) });
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** After the free days: the guest asks the hotel to cancel without the fee. */
export async function askFreeCancellation(token: string, note: string): Promise<Res> {
  if (await limited('guest-freecancel', 4)) return { ok: false, error: 'too_many' };
  const b = findBookingByToken(token);
  if (!b || b.status !== 'confirmed') return { ok: false, error: 'not_found' };
  if (b.changeRequest?.status === 'pending') return { ok: false, error: 'pending' };
  try {
    askFreeCancel(b.id, clean(note, 800));
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** The guest answers the hotel's proposal of new dates. */
export async function answerHotelProposal(token: string, accept: boolean, note = ''): Promise<Res> {
  if (await limited('guest-answer', 8)) return { ok: false, error: 'too_many' };
  const b = findBookingByToken(token);
  if (!b || b.changeRequest?.status !== 'pending' || b.changeRequest.by !== 'hotel') return { ok: false, error: 'not_found' };
  try {
    await answerChange(b.id, 'guest', accept, 'Ospite', clean(note, 800));
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function withdrawGuestRequest(token: string): Promise<Res> {
  const b = findBookingByToken(token);
  if (!b) return { ok: false, error: 'not_found' };
  try {
    withdrawChange(b.id, 'guest', 'Ospite');
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** The hotel asked for a new card: opens the secure payment page (card only, or card + amount). */
export async function startCardUpdate(token: string, locale: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (await limited('guest-card', 10)) return { ok: false, error: 'too_many' };
  const b = findBookingByToken(token);
  const req = b?.cardRequest;
  if (!b || !req || req.outcome) return { ok: false, error: 'not_found' };
  if (new Date(req.deadline) <= new Date()) return { ok: false, error: 'expired' };
  try {
    const l = isLocale(locale) ? locale : 'it';
    const base = await requestOrigin();
    const page = `${base}${localePath(l, `/soggiorno/${b.token}`)}`;
    const url = await startCardCheckout(b, { purpose: 'card_update', amount: req.amount, successUrl: `${page}?carta={CHECKOUT_SESSION_ID}`, cancelUrl: `${page}?carta=annullata`, locale: l });
    mutate((db) => audit(db, 'Ospite', 'card_page', 'booking', b.id, `${b.code} · aperta la pagina per la nuova carta`));
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof BookingError ? e.message : 'error' };
  }
}

const Feedback = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(3).max(1500), publish: z.boolean(), lang: z.string() });

export async function sendFeedback(token: string, raw: unknown): Promise<{ ok: boolean; error?: string }> {
  if (await limited('guest-fb', 3)) return { ok: false, error: 'Troppe richieste.' };
  const b = findBookingByToken(token);
  const p = Feedback.safeParse(raw);
  if (!b || !p.success) return { ok: false, error: 'Dati non validi.' };
  mutate((db) => {
    db.feedback.unshift({
      id: newId('fb-'),
      bookingId: b.id,
      name: `${b.guest.firstName} ${b.guest.lastName.charAt(0)}.`,
      rating: p.data.rating,
      comment: clean(p.data.comment, 1500),
      lang: isLocale(p.data.lang) ? p.data.lang : 'it',
      publishConsent: p.data.publish,
      showOnSite: false, // the owner decides; every review is visible in the panel regardless of rating
      demo: false,
      createdAt: new Date().toISOString(),
    });
    audit(db, 'Ospite', 'feedback', 'booking', b.id, `Valutazione ${p.data.rating}/5`);
  });
  return { ok: true };
}
