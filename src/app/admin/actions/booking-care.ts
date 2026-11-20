'use server';
import { z, ZodError } from 'zod';
import { revalidatePath } from 'next/cache';
import { act, UserError, type ActionResult } from '@/server/action';
import { AuthError, can, requireUser, type SafeUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { BookingError } from '@/server/bookings';
import {
  answerChange,
  cancelAndRefund,
  cancelPreview,
  chargeBooking,
  markNoShow,
  markThreadRead,
  noShowPreview,
  postMessage,
  proposeDates,
  quoteChange,
  requestNewCard,
  threadOf,
  withdrawCardRequest,
  withdrawChange,
} from '@/server/booking-care';
import { cardLabel, cardsAvailable } from '@/server/payments/card';
import { stripeMode } from '@/server/payments/stripe';
import { clean } from '@/server/security';
import { translateForGuest } from '@/server/ai/content';
import { guestLang } from '@/server/guests';
import { chargeDay, chargeLaterRule, plannedCharge } from '@/lib/charge-later';

const Id = z.string().min(1).max(80);

/** Reading only (opening the booking, the price of other dates): no refresh of every page. */
async function look<T>(fn: (u: SafeUser) => T): Promise<ActionResult<T>> {
  try {
    const u = await requireUser('bookings.manage');
    return { ok: true, data: fn(u) };
  } catch (e) {
    if (e instanceof AuthError || e instanceof UserError || e instanceof BookingError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: 'Dati non validi.' };
    console.error('[admin action]', e);
    return { ok: false, error: 'Operazione non riuscita. Riprova.' };
  }
}
const euro = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;

/** Everything the booking page shows beyond the row: conversation, card, requests, what cancelling / no-show would do. */
export async function bookingCareAction(bookingId: string) {
  return look((u) => {
    const id = Id.parse(bookingId);
    // the guest's messages are read now: the badges of the list go away
    if (markThreadRead(id)) revalidatePath('/admin', 'layout');
    const db = readDb();
    const b = db.bookings.find((x) => x.id === id);
    if (!b) throw new UserError('Prenotazione non trovata.');
    const mode = stripeMode() === 'live' ? 'live' : 'test';
    return {
      thread: threadOf(db, id),
      card: b.card ? { label: cardLabel(b.card), brand: b.card.brand, last4: b.card.last4, exp: b.card.exp, usable: cardsAvailable() && b.card.mode === mode, test: b.card.mode === 'test' } : null,
      cardRequest: b.cardRequest ?? null,
      // "paga dopo": what the card will be charged before arrival, and when
      later: plannedCharge(b) > 0 ? ((r) => ({ amount: plannedCharge(b), on: chargeDay(b.checkIn, r), auto: r.auto, failed: b.chargePlan?.outcome === 'failed' ? (b.chargePlan.reason ?? 'la carta non ha pagato') : null }))(chargeLaterRule(db.settings.payments)) : null,
      noShow: b.noShow ?? null,
      changeRequest: b.changeRequest ? { ...b.changeRequest, roomNumber: db.rooms.find((r) => r.id === b.changeRequest!.roomId)?.number ?? null } : null,
      cancel: cancelPreview(db, b),
      noShowPlan: noShowPreview(db, b),
      cardsOn: cardsAvailable(),
      canMoney: can(u.role, 'payments.manage'),
      paymentMethod: b.paymentMethod ?? null,
      bookedAt: b.createdAt,
    };
  });
}

export async function sendHotelMessageAction(bookingId: string, text: string) {
  return act('bookings.manage', async (u) => {
    const body = z.string().trim().min(1).max(3000).parse(text);
    const b = readDb().bookings.find((x) => x.id === bookingId);
    if (!b) throw new UserError('Prenotazione non trovata.');
    // the e-mail goes out in the guest's language; the conversation keeps the owner's own words
    const lang = guestLang(b.guest);
    const tr = b.guest.email ? await translateForGuest({ body }, lang) : null;
    postMessage(Id.parse(bookingId), 'hotel', body, u.name, tr?.translated ? tr.fields.body : undefined);
    return { emailed: Boolean(b.guest.email), translated: tr?.translated ? lang : null };
  }, 'Messaggio inviato: l’ospite lo riceve anche per email, nella sua lingua.');
}

const Cancel = z.object({ waive: z.boolean(), refund: z.number().min(0).max(50000), reason: z.string().max(200), notifyGuest: z.boolean() });

/** Cancels and gives the money back for real (card on the card, cash recorded to give back by hand). */
export async function cancelAndRefundAction(bookingId: string, raw: unknown) {
  return act('bookings.manage', async (u) => {
    const d = Cancel.parse(raw);
    // money back needs the payments permission; staff can only cancel
    const money = can(u.role, 'payments.manage');
    const r = await cancelAndRefund(Id.parse(bookingId), u.name, { waive: money && d.waive, refund: money ? d.refund : 0, reason: clean(d.reason, 200) || 'Annullata dal pannello', notifyGuest: d.notifyGuest });
    const parts = ['Prenotazione annullata: le notti sono di nuovo libere.'];
    if (r.onCard) parts.push(`${euro(r.onCard)} restituiti sulla carta dell’ospite.`);
    if (r.byHand) parts.push(`${euro(r.byHand)} da restituire a mano (contanti / bonifico).`);
    if (r.problems.length) parts.push(`Attenzione: ${r.problems.join(' ')}`);
    return { ...r, message: parts.join(' ') };
  });
}

export async function noShowAction(bookingId: string, raw: unknown) {
  return act('payments.manage', async (u) => {
    const d = z.object({ waive: z.boolean(), fee: z.number().min(0).max(50000).nullable() }).parse(raw);
    return markNoShow(Id.parse(bookingId), u.name, { waive: d.waive, fee: d.fee ?? undefined });
  });
}

export async function chargeCardAction(bookingId: string, amount: number, why: string) {
  return act('payments.manage', async (u) => {
    const r = await chargeBooking(Id.parse(bookingId), z.number().positive().max(50000).parse(amount), u.name, clean(why, 80));
    return r;
  });
}

const CardReq = z.object({ hours: z.number().int().min(1).max(168), amount: z.number().min(0).max(50000), cancelOnExpiry: z.boolean(), declined: z.boolean() });

export async function requestCardAction(bookingId: string, raw: unknown) {
  return act('bookings.manage', (u) => {
    const d = CardReq.parse(raw);
    if (!cardsAvailable()) throw new UserError('I pagamenti con carta non sono attivi: l’ospite non avrebbe dove inserire la carta.');
    return requestNewCard(Id.parse(bookingId), u.name, d);
  }, 'Richiesta inviata: l’ospite ha ricevuto l’email con il link per la nuova carta.');
}

export async function withdrawCardRequestAction(bookingId: string) {
  return act('bookings.manage', (u) => withdrawCardRequest(Id.parse(bookingId), u.name), 'Richiesta ritirata: la prenotazione resta valida.');
}

const Dates = z.object({ checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), roomId: z.string().max(80).nullable() });

export async function quoteChangeAction(bookingId: string, raw: unknown) {
  return look(() => {
    const d = Dates.parse(raw);
    const db = readDb();
    const b = db.bookings.find((x) => x.id === bookingId);
    if (!b) throw new UserError('Prenotazione non trovata.');
    try {
      return quoteChange(db, b, d.checkIn, d.checkOut, d.roomId);
    } catch (e) {
      if (e instanceof BookingError) throw new UserError(e.message);
      throw e;
    }
  });
}

export async function proposeDatesAction(bookingId: string, raw: unknown) {
  return act('bookings.manage', (u) => {
    const d = Dates.extend({ total: z.number().min(0).max(50000).nullable(), note: z.string().max(800) }).parse(raw);
    proposeDates(Id.parse(bookingId), 'hotel', u.name, { checkIn: d.checkIn, checkOut: d.checkOut, roomId: d.roomId, total: d.total, note: clean(d.note, 800) });
  }, 'Proposta inviata: l’ospite accetta o rifiuta dalla sua area, ti arriva un avviso.');
}

export async function answerChangeAction(bookingId: string, accept: boolean, answer: string) {
  return act('bookings.manage', async (u) => {
    const db = readDb();
    const b = db.bookings.find((x) => x.id === bookingId);
    if (accept && b?.changeRequest?.kind === 'free_cancel' && !can(u.role, 'payments.manage')) throw new UserError('Solo l’amministratore può concedere la cancellazione gratuita (restituisce i soldi).');
    const r = await answerChange(Id.parse(bookingId), 'hotel', accept, u.name, clean(answer, 800));
    const message = !r.accepted
      ? 'Risposta inviata: l’ospite sa che la richiesta non è stata accettata.'
      : r.kind === 'free_cancel'
        ? `Cancellata senza penale${r.refunded ? `: ${euro(r.refunded)} restituiti` : ''}.${r.problems.length ? ` Attenzione: ${r.problems.join(' ')}` : ''}`
        : 'Date cambiate: l’ospite ha ricevuto il riepilogo aggiornato.';
    return { ...r, message };
  });
}

export async function withdrawChangeAction(bookingId: string) {
  return act('bookings.manage', (u) => withdrawChange(Id.parse(bookingId), 'hotel', u.name), 'Proposta ritirata.');
}
