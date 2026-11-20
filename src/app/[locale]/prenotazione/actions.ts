'use server';
import { z } from 'zod';
import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { BookingError, confirmPayAtHotel, confirmPayment, createWebsiteHold, paymentFailed, findBookingByToken } from '@/server/bookings';
import { mutate, readDb } from '@/server/db/store';
import { queueEmail, smtpConfigured } from '@/server/events';
import { CASH_COOKIE, CASH_PER_DAY, codeFor, codeMatches, maskEmail, readCashCookie, recentCashBookings, writeCashCookie } from '@/server/email-code';
import { roomPayment } from '@/lib/cash';
import { cardPaymentsReady, createCheckoutSession, payoutDestination, publishableKey, simulationAllowed, stripeMode } from '@/server/payments/stripe';
import { startCardCheckout } from '@/server/payments/card';
import { clean, ipOf, rateLimit, requestOrigin } from '@/server/security';
import { isLocale, localePath } from '@/lib/i18n/config';
import { activeExtras, extrasForReception } from '@/lib/extras';
import { diffDays, todayISO } from '@/lib/dates';
import { cardDueNow, laterChargeDay } from '@/lib/charge-later';

const Input = z.object({
  roomId: z.string().min(1).max(64),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.number().int().min(1).max(8),
  children: z.number().int().min(0).max(6),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(6),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.email().max(120),
  phone: z.string().trim().min(5).max(30).regex(/^[+\d\s().-]+$/),
  specialRequests: z.string().max(1000),
  privacy: z.literal(true),
  terms: z.literal(true),
  marketing: z.boolean(),
  promoCode: z.string().max(30).nullable(),
  /** Supplementi the guest ticked (paid at the hotel): ids, prices are read from the settings */
  extras: z.array(z.string().max(40)).max(24).optional(),
  locale: z.enum(['it', 'en', 'pl', 'de', 'fr', 'es']).optional(),
});

export type ReservationResult =
  | { ok: true; bookingId: string; token: string; code: string; dueNow: number; total: number; holdExpiresAt: string; payment: 'stripe' | 'simulated'; chargeOn: string | null }
  | { ok: false; error: string; code?: string };

/** The guest's request plus the line of the ticked extras, priced here from the hotel's own list. */
function withExtras(text: string, ids: string[] | undefined, checkIn: string, checkOut: string, guests: number): string {
  if (!ids?.length) return text;
  const chosen = activeExtras(readDb().settings.pricing?.extras).filter((e) => ids.includes(e.id));
  const line = extrasForReception(chosen, diffDays(checkIn, checkOut), guests);
  return [text, line].filter(Boolean).join('\n\n');
}

/** Card payments really usable on the site now ("pay later" needs them to save the card). */
const cardsLive = (): boolean => stripeMode() !== 'off' && cardPaymentsReady(readDb());

/** What a card guest pays now and, with "pay later", the day the card is charged. */
function cardPlan(b: { total: number; checkIn: string }) {
  const p = readDb().settings.payments;
  const today = todayISO();
  return { dueNow: cardDueNow(b.total, p, b.checkIn, today, cardsLive()), chargeOn: laterChargeDay(p, b.checkIn, today, cardsLive()) };
}

async function ip(): Promise<string> {
  const h = await headers();
  return ipOf(h);
}

export async function createReservation(raw: unknown): Promise<ReservationResult> {
  if (!rateLimit(`book:${await ip()}`, 8, 10 * 60_000)) return { ok: false, error: 'Troppi tentativi. Riprova tra qualche minuto.' };
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Controlla i dati inseriti.' };
  const d = parsed.data;
  // the portals' calendars of this room, read again right now: a night sold there minutes ago is not sold twice
  await import('@/server/channels/ical').then((m) => m.refreshRoomCalendars(d.roomId)).catch(() => null);
  try {
    const { booking } = createWebsiteHold({
      roomId: d.roomId,
      checkIn: d.checkIn,
      checkOut: d.checkOut,
      adults: d.adults,
      children: d.children,
      childrenAges: d.childrenAges,
      guest: { firstName: clean(d.firstName, 60), lastName: clean(d.lastName, 60), email: d.email.toLowerCase(), phone: clean(d.phone, 30), ...(d.locale ? { lang: d.locale } : {}) },
      specialRequests: withExtras(clean(d.specialRequests, 1000), d.extras, d.checkIn, d.checkOut, d.adults + d.children),
      consents: { privacy: true, terms: true, marketing: d.marketing },
      promoCode: d.promoCode ? clean(d.promoCode, 30) : null,
    });
    revalidatePath('/admin', 'layout');
    const plan = cardPlan(booking);
    return { ok: true, bookingId: booking.id, token: booking.token, code: booking.code, dueNow: plan.dueNow, chargeOn: plan.chargeOn, total: booking.total, holdExpiresAt: booking.holdExpiresAt!, payment: stripeMode() === 'off' ? 'simulated' : 'stripe' };
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message, code: e.code };
    console.error(e);
    return { ok: false, error: 'Errore imprevisto. Riprova.' };
  }
}

/** What the booked room accepts (card / cash), within the hotel setting. */
function payOptions(roomId: string | null) {
  const db = readDb();
  const room = db.rooms.find((r) => r.id === roomId);
  return roomPayment(room ?? {}, db.settings.payments);
}

function pendingBooking(token: string) {
  const b = findBookingByToken(token);
  if (!b) throw new BookingError('Prenotazione non trovata.', 'not_found');
  if (b.status === 'cancelled') throw new BookingError('La prenotazione temporanea è scaduta.', 'expired');
  return b;
}

export async function startStripeCheckout(token: string, locale: string, embedded = false): Promise<{ ok: true; url: string | null; clientSecret: string | null } | { ok: false; error: string }> {
  try {
    if (stripeMode() === 'off') return { ok: false, error: 'Stripe non configurato.' };
    if (!cardPaymentsReady(readDb())) return { ok: false, error: 'Il pagamento online sarà attivo a breve: per ora puoi scegliere il pagamento in hotel.' };
    const b = pendingBooking(token);
    if (!payOptions(b.roomId).card) return { ok: false, error: 'Per questa camera il pagamento online non è attivo: si paga in hotel.' };
    const db = readDb();
    const room = db.rooms.find((r) => r.id === b.roomId);
    const l = isLocale(locale) ? locale : 'it';
    // the address the guest is using (also a public link to this computer), not a fixed APP_URL
    const base = await requestOrigin();
    const useEmbedded = embedded && Boolean(publishableKey());
    const photo = room?.photos[0]?.src;
    const plan = cardPlan(b);
    // "pay later": the card is saved on its own page (startCardLater), nothing is charged now
    if (plan.chargeOn) return { ok: false, error: 'later' };
    const session = await createCheckoutSession({
      bookingId: b.id,
      code: b.code,
      amount: plan.dueNow,
      description: `${room?.name ?? 'Camera'} · ${b.checkIn} → ${b.checkOut}`,
      email: b.guest.email,
      // Stripe fills in the session id: the confirmation page uses it to check the payment by itself
      successUrl: `${base}${localePath(l, `/prenotazione/conferma?t=${b.token}`)}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}${localePath(l, `/prenotazione?ripresa=${b.token}`)}`,
      expiresInMinutes: db.settings.payments.holdMinutes,
      locale: l,
      embedded: useEmbedded,
      destination: payoutDestination(db),
      // Stripe can only show images reachable from the internet
      image: photo && base.startsWith('https://') ? `${base}${photo}` : null,
    });
    if (useEmbedded) return session.client_secret ? { ok: true, url: null, clientSecret: session.client_secret } : { ok: false, error: 'Sessione Stripe non disponibile.' };
    if (!session.url) return { ok: false, error: 'Sessione Stripe non disponibile.' };
    return { ok: true, url: session.url, clientSecret: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** This device or this e-mail already confirmed enough "pay at the hotel" bookings today. */
async function tooManyCash(email: string): Promise<boolean> {
  const device = readCashCookie((await cookies()).get(CASH_COOKIE)?.value);
  return device.length >= CASH_PER_DAY || recentCashBookings(readDb(), email) >= CASH_PER_DAY;
}

const cashSubject = (b: { token: string; guest: { email: string } }) => `${b.token}|${b.guest.email}`;

export type CashCodeResult = { ok: true; skip?: boolean; sentTo?: string } | { ok: false; error: string };

/**
 * "Pay at the hotel", step 1: a 6-digit code to the e-mail of the booking, so nobody can block rooms
 * with a made-up address. Without an e-mail service connected nothing is sent (skip) and the
 * booking is confirmed as before.
 */
export async function sendCashCode(token: string, locale: string): Promise<CashCodeResult> {
  try {
    if (!rateLimit(`cash-code:${await ip()}`, 6, 15 * 60_000)) return { ok: false, error: 'too_many' };
    const b = pendingBooking(token);
    if (!payOptions(b.roomId).cash) return { ok: false, error: 'Per questa camera si paga solo con carta online.' };
    // the hotel wants a card as a guarantee: the card itself is the check
    if (guaranteeRequired()) return { ok: false, error: 'guarantee' };
    if (await tooManyCash(b.guest.email)) return { ok: false, error: 'already' };
    if (!smtpConfigured()) return { ok: true, skip: true };
    const code = codeFor('cash', cashSubject(b));
    const lang = isLocale(locale) ? locale : 'it';
    mutate((db) => {
      queueEmail(db, 'codice_accesso', b.guest.email, { booking: db.bookings.find((x) => x.id === b.id) ?? b, room: null, extra: { code, lang, purpose: 'cash' } });
    });
    return { ok: true, sentTo: maskEmail(b.guest.email) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** "Pay at the hotel", step 2: with the right code the cash price applies and the booking is confirmed. */
export async function payAtHotel(token: string, code = ''): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!rateLimit(`cash:${await ip()}`, 10, 10 * 60_000)) return { ok: false, error: 'too_many' };
    const b = pendingBooking(token);
    if (!payOptions(b.roomId).cash) return { ok: false, error: 'Per questa camera si paga solo con carta online.' };
    // the hotel wants a card as a guarantee: the booking is confirmed when the card is saved
    if (guaranteeRequired()) return { ok: false, error: 'guarantee' };
    if (await tooManyCash(b.guest.email)) return { ok: false, error: 'already' };
    if (smtpConfigured()) {
      if (!rateLimit(`cash-try:${token}`, 6, 30 * 60_000)) return { ok: false, error: 'too_many' };
      if (!codeMatches('cash', cashSubject(b), code)) return { ok: false, error: 'code' };
    }
    confirmPayAtHotel(b.id);
    // this device: one more "pay at the hotel" booking today
    const jar = await cookies();
    jar.set(CASH_COOKIE, writeCashCookie([...readCashCookie(jar.get(CASH_COOKIE)?.value), Date.now()]), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 24 * 3600 });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Cash at the hotel with a card as a guarantee (Pagamenti → "carta a garanzia"), when card payments are on. */
function guaranteeRequired(): boolean {
  return cardPaymentsReady(readDb()) && readDb().settings.payments.cardGuarantee === true;
}

/** Opens the secure page where the guest who pays cash leaves a card as a guarantee (nothing is charged). */
export async function startCashGuarantee(token: string, locale: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    if (!rateLimit(`cash:${await ip()}`, 10, 10 * 60_000)) return { ok: false, error: 'Troppi tentativi.' };
    const b = pendingBooking(token);
    if (!payOptions(b.roomId).cash) return { ok: false, error: 'Per questa camera si paga solo con carta online.' };
    const l = isLocale(locale) ? locale : 'it';
    const base = await requestOrigin();
    const url = await startCardCheckout(b, {
      purpose: 'guarantee',
      amount: 0,
      successUrl: `${base}${localePath(l, `/prenotazione/conferma?t=${b.token}`)}&g={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}${localePath(l, `/prenotazione?ripresa=${b.token}`)}`,
      locale: l,
    });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * "Pay later" (Pagamenti → Più tardi): the secure page where the guest saves the card. Nothing is
 * charged now; back on the confirmation page the booking is confirmed and the card is charged N days
 * before arrival (server/payments/charge-later.ts).
 */
export async function startCardLater(token: string, locale: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    if (!rateLimit(`later:${await ip()}`, 10, 10 * 60_000)) return { ok: false, error: 'Troppi tentativi.' };
    if (!cardsLive()) return { ok: false, error: 'Il pagamento online sarà attivo a breve: per ora puoi scegliere il pagamento in hotel.' };
    const b = pendingBooking(token);
    if (!payOptions(b.roomId).card) return { ok: false, error: 'Per questa camera il pagamento online non è attivo: si paga in hotel.' };
    // the arrival got closer meanwhile: the guest pays now, on the usual page
    if (!cardPlan(b).chargeOn) return { ok: false, error: 'now' };
    const l = isLocale(locale) ? locale : 'it';
    const base = await requestOrigin();
    const url = await startCardCheckout(b, {
      purpose: 'pay_later',
      amount: 0,
      successUrl: `${base}${localePath(l, `/prenotazione/conferma?t=${b.token}`)}&g={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}${localePath(l, `/prenotazione?ripresa=${b.token}`)}`,
      locale: l,
    });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Demo-only payment simulation (never available when Stripe is configured). */
export async function simulatePayment(token: string, outcome: 'success' | 'failure'): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (stripeMode() !== 'off') return { ok: false, error: 'Con Stripe configurato usa il pagamento di test.' };
    if (!simulationAllowed()) return { ok: false, error: 'Il pagamento con carta online non è ancora attivo: scegli il pagamento in hotel.' };
    if (readDb().settings.payments.allowOnline === false) return { ok: false, error: 'Il pagamento online non è attivo: si paga in hotel.' };
    if (!rateLimit(`sim:${await ip()}`, 20, 10 * 60_000)) return { ok: false, error: 'Troppi tentativi.' };
    const b = pendingBooking(token);
    if (outcome === 'failure') {
      paymentFailed(b.id, 'Pagamento simulato rifiutato');
      return { ok: false, error: 'failed' };
    }
    const db = readDb();
    confirmPayment(b.id, { amount: cardDueNow(b.total, db.settings.payments, b.checkIn, todayISO(), false), provider: 'simulazione', reference: `SIM-${b.code}` });
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function bookingStatus(token: string): Promise<{ status: string } | null> {
  const b = findBookingByToken(token);
  return b ? { status: b.status } : null;
}
