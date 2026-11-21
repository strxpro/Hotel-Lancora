'use server';
import { z } from 'zod';
import type { Campaign } from '@/lib/types';
import { DEFAULT_THEME } from '@/lib/email-themes';
import { act, UserError } from '@/server/action';
import { can } from '@/server/auth/guard';
import { mutate, readDb } from '@/server/db/store';
import { audit, isTestAddress, queueEmail, smtpConfigured } from '@/server/events';
import { queueCampaign } from '@/server/email/campaign';
import { guestCard } from '@/server/guest-card';
import { guestLang, guestTokens } from '@/server/guests';
import { refundGuestPayment } from '@/server/payments/refund';
import { clean } from '@/server/security';
import { translateForGuest } from '@/server/ai/content';

const Ref = z.object({ email: z.string().max(200).nullish(), bookingId: z.string().max(80).nullish() });

/** The guest card: contact, bookings, payments, messages, notes and history of one person. */
export async function guestCardAction(raw: unknown) {
  return act('bookings.manage', (u) => {
    const ref = Ref.parse(raw);
    const data = guestCard(readDb(), ref);
    if (!data) throw new UserError('Ospite non trovato.');
    return { ...data, canRefund: can(u.role, 'payments.manage'), canGdpr: can(u.role, 'guests.gdpr'), canDelete: can(u.role, 'bookings.delete') };
  });
}

const Send = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['conferma', 'promemoria', 'modifica']), bookingId: z.string().min(1).max(80) }),
  z.object({ kind: z.literal('messaggio'), email: z.email(), bookingId: z.string().max(80).nullish(), subject: z.string().trim().min(2).max(140), body: z.string().trim().min(2).max(5000) }),
]);

/**
 * Writes to the guest with the site's own e-mail machinery: a booking template (conferma,
 * promemoria, modifica) or a personal message in the hotel's e-mail style. Always stored in the
 * Outbox; really delivered only when an e-mail service is connected and the address is not a
 * reserved test address (demo guests @example.com never receive anything).
 */
export async function sendGuestEmailAction(raw: unknown) {
  return act('bookings.manage', async (u) => {
    const d = Send.parse(raw);
    // a personal message reaches the guest in their own language (translated before saving)
    let byLang: Parameters<typeof queueCampaign>[3] = {};
    let translated: string | null = null;
    if (d.kind === 'messaggio') {
      const email = d.email.trim().toLowerCase();
      const db0 = readDb();
      const who = [...db0.bookings].filter((x) => x.guest.email.trim().toLowerCase() === email).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
      const lang = who ? guestLang(who.guest) : 'it';
      const tr = await translateForGuest({ subject: d.subject, body: d.body }, lang);
      if (tr.translated) {
        byLang = { [lang]: { subject: clean(tr.fields.subject, 140), headline: clean(tr.fields.subject, 140), body: tr.fields.body.replace(/\r/g, '').slice(0, 5000), ctaLabel: '' } };
        translated = lang;
      }
    }
    const out = mutate((db) => {
      if (d.kind !== 'messaggio') {
        const b = db.bookings.find((x) => x.id === d.bookingId);
        if (!b) throw new UserError('Prenotazione non trovata.');
        if (!b.guest.email) throw new UserError('Questa prenotazione non ha un indirizzo email.');
        const e = queueEmail(db, d.kind, b.guest.email, { booking: b, room: db.rooms.find((r) => r.id === b.roomId) ?? null });
        audit(db, u.name, 'guest_email', 'booking', b.id, `${b.code} · email «${e.subject}» a ${b.guest.email}`);
        return { to: b.guest.email, delivered: smtpConfigured() && !isTestAddress(b.guest.email) };
      }
      const email = d.email.trim().toLowerCase();
      const booked = [...db.bookings].filter((x) => x.guest.email.trim().toLowerCase() === email).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
      const wrote = db.messages.find((m) => m.email.trim().toLowerCase() === email);
      if (!booked && !wrote) throw new UserError('Nessun ospite con questo indirizzo.');
      const b = booked ?? { guest: { firstName: wrote!.name.split(' ')[0] ?? wrote!.name, lastName: wrote!.name.split(' ').slice(1).join(' '), email: wrote!.email, phone: '' } };
      if (db.unsubscribed.some((x) => x.toLowerCase() === email)) throw new UserError('L’ospite si è disiscritto dalle email dell’hotel: usa i modelli della prenotazione (conferma, promemoria) oppure scrivigli dalla tua casella.');
      const now = new Date().toISOString();
      const c: Campaign = { id: `msg-${Date.now()}`, name: `Messaggio a ${b.guest.firstName} ${b.guest.lastName}`, subject: clean(d.subject, 140), headline: clean(d.subject, 140), body: d.body.replace(/\r/g, '').slice(0, 5000), ctaLabel: '', ctaUrl: '', image: '', audience: 'past_guests', personal: true, theme: DEFAULT_THEME, status: 'draft', sentAt: null, recipients: 1, createdAt: now };
      const [e] = queueCampaign(db, c, [{ email: b.guest.email, firstName: b.guest.firstName, lang: guestLang(b.guest), tokens: guestTokens(db, email) }], byLang);
      if (e && d.bookingId && db.bookings.some((x) => x.id === d.bookingId)) e.bookingId = d.bookingId;
      audit(db, u.name, 'guest_email', 'guest', email, `Messaggio «${c.subject}» a ${b.guest.email}${translated ? ` (tradotto in ${translated.toUpperCase()})` : ''}`);
      return { to: b.guest.email, delivered: smtpConfigured() && !isTestAddress(email) };
    });
    return { ...out, translated };
  });
}

/**
 * Refund of one payment, after the owner confirmed amount, payment and full/partial in the card.
 * Card payments go back through Stripe (test payments only with the test key); cash, POS and
 * transfers are recorded for the owner to give back by hand. Always written in the history.
 */
export async function refundGuestPaymentAction(raw: unknown) {
  return act('payments.manage', async (u) => {
    const d = z.object({ paymentId: z.string().min(1).max(80), amount: z.number().positive().max(50000), notifyGuest: z.boolean() }).parse(raw);
    const r = await refundGuestPayment(d.paymentId, d.amount, u.name, d.notifyGuest);
    return { amount: -r.refund.amount, full: r.full, via: r.via, code: r.booking.code };
  });
}
