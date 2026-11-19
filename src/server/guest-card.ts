import 'server-only';
import type { Booking, DB, Locale } from '@/lib/types';
import { cancelRefund, isFreeCancel } from '@/lib/cancellation';
import { isBookingActive } from '@/lib/availability';
import { diffDays, todayISO } from '@/lib/dates';
import { paymentRefundable, providerLabel, refundedFor, refundedPaymentId, sourceLabel } from './bookings';
import { guestLang, guestProfiles, type GuestProfile } from './guests';
import { emailTransport } from './integrations';
import { isTestAddress } from './events';
import { stripeMode } from './payments/stripe';
import { TEMPLATE_LABELS } from './email/templates';

/** Everything the guest card shows about one person (one e-mail address, or one booking without e-mail). */
export interface GuestCardData {
  key: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  lang: Locale;
  consent: boolean;
  unsubscribed: boolean;
  demo: boolean;
  /** reserved test domain (example.com…): e-mails stay in the Outbox */
  testAddress: boolean;
  /** an e-mail service is connected (SMTP / Cloudflare / Make) */
  mailer: string | null;
  stripe: 'test' | 'live' | 'off';
  stats: Pick<GuestProfile, 'stays' | 'nights' | 'spent' | 'paid' | 'cancellations' | 'next' | 'inHouse' | 'favoriteRoom' | 'mainSource' | 'avgNights' | 'avgLeadDays' | 'first'>;
  bookings: {
    id: string;
    code: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    guests: number;
    total: number;
    amountPaid: number;
    status: Booking['status'];
    active: boolean;
    room: string | null;
    source: string;
    method: string | null;
    notes: string;
    specialRequests: string;
    createdAt: string;
    /** what the cancellation rule would give back if cancelled today */
    refundIfCancelled: number;
    freeCancel: boolean;
  }[];
  payments: {
    id: string;
    bookingId: string;
    code: string;
    at: string;
    amount: number;
    kind: 'deposit' | 'full' | 'balance' | 'refund';
    provider: string;
    providerKey: string;
    status: 'succeeded' | 'failed' | 'pending';
    reference: string | null;
    /** refunds: the payment they give money back for */
    refundOf: string | null;
    refunded: number;
    refundable: number;
    /** how a refund of this payment is made */
    refundVia: 'stripe' | 'manual' | 'simulation' | 'portal' | 'unavailable';
  }[];
  messages: { id: string; at: string; dir: 'in' | 'out'; subject: string; preview: string; label: string; status: string; read?: boolean }[];
  history: { id: string; at: string; actor: string; action: string; details: string }[];
  reviews: { rating: number; comment: string; createdAt: string }[];
}

const ACTION_LABEL: Record<string, string> = {
  create: 'Prenotazione creata',
  hold: 'Prenotazione dal sito',
  payment: 'Pagamento',
  pay_at_hotel: 'Paga in hotel',
  payment_failed: 'Pagamento non riuscito',
  cancel: 'Annullata',
  refund: 'Rimborso',
  assign_room: 'Camera',
  notes: 'Note',
  hold_expired: 'Scaduta',
  guest_email: 'Email',
  gdpr_anonymize: 'Privacy',
};

/** Finds the person behind an e-mail or a booking and gathers bookings, payments, messages, notes and history. */
export function guestCard(db: DB, ref: { email?: string | null; bookingId?: string | null }): GuestCardData | null {
  const now = new Date();
  const today = todayISO();
  const byBooking = ref.bookingId ? db.bookings.find((b) => b.id === ref.bookingId) : undefined;
  const email = (ref.email || byBooking?.guest.email || '').trim().toLowerCase();
  const list = email ? db.bookings.filter((b) => b.guest.email.trim().toLowerCase() === email) : byBooking ? [byBooking] : [];
  // someone who only wrote from the contact form: the card still shows the message and lets the owner reply
  const wrote = email ? [...db.messages].filter((m) => m.email.trim().toLowerCase() === email).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
  if (!list.length && !wrote) return null;
  const latest: Pick<Booking, 'id' | 'guest' | 'source' | 'checkIn'> = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? {
    id: '',
    guest: { firstName: wrote!.name.split(' ')[0] ?? wrote!.name, lastName: wrote!.name.split(' ').slice(1).join(' '), email: wrote!.email, phone: '' },
    source: 'email',
    checkIn: wrote!.createdAt.slice(0, 10),
  };
  const profile = email ? guestProfiles(db, now).find((g) => g.key === email) : undefined;
  const ids = new Set(list.map((b) => b.id));
  const code = new Map(list.map((b) => [b.id, b.code]));
  const valid = list.filter((b) => b.status !== 'cancelled');
  const nights = valid.reduce((s, b) => s + diffDays(b.checkIn, b.checkOut), 0);
  const mode = stripeMode();
  const transport = emailTransport();

  const payments = db.payments
    .filter((p) => ids.has(p.bookingId) && (p.status === 'succeeded' || p.amount !== 0))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => {
      const refundable = paymentRefundable(db, p);
      const card = p.provider === 'stripe' || p.provider === 'stripe_test';
      const via: GuestCardData['payments'][number]['refundVia'] =
        p.kind === 'refund' || p.amount <= 0 || p.status !== 'succeeded'
          ? 'unavailable'
          : p.provider === 'ota'
            ? 'portal'
            : card
              ? mode === (p.provider === 'stripe' ? 'live' : 'test') && p.reference?.startsWith('pi_')
                ? 'stripe'
                : 'unavailable'
              : p.provider === 'simulazione'
                ? 'simulation'
                : 'manual';
      return {
        id: p.id,
        bookingId: p.bookingId,
        code: code.get(p.bookingId) ?? '',
        at: p.createdAt,
        amount: p.amount,
        kind: p.kind,
        provider: providerLabel(p.provider),
        providerKey: p.provider,
        status: p.status,
        reference: p.reference,
        refundOf: refundedPaymentId(p.reference),
        refunded: p.kind === 'refund' ? 0 : refundedFor(db, p.id),
        refundable: via === 'unavailable' || via === 'portal' ? 0 : refundable,
        refundVia: via,
      };
    });

  const messagesIn = email
    ? db.messages
        // the hotel's replies are listed as the e-mails they were sent with
        .filter((m) => m.email.trim().toLowerCase() === email && m.sender !== 'hotel')
        .map((m) => ({ id: m.id, at: m.createdAt, dir: 'in' as const, subject: m.subject, preview: m.body.slice(0, 400), label: m.source === 'area_ospite' ? 'Dall’area ospite' : 'Dal modulo contatti', status: m.read ? 'letto' : 'da leggere', read: m.read }))
    : [];
  const messagesOut = db.outbox
    .filter((e) => (email ? e.to.trim().toLowerCase() === email : false) || (e.bookingId ? ids.has(e.bookingId) : false))
    .map((e) => ({ id: e.id, at: e.createdAt, dir: 'out' as const, subject: e.subject, preview: e.text.replace(/\s+/g, ' ').slice(0, 260), label: e.template === 'campagna' ? 'Messaggio o campagna' : (TEMPLATE_LABELS[e.template] ?? e.template), status: e.status === 'sent' ? 'inviata' : e.status === 'failed' ? `non inviata${e.error ? `: ${e.error}` : ''}` : 'nella Outbox' }));

  const history = db.audit
    .filter((a) => (a.entityId && ids.has(a.entityId)) || (email && a.entity === 'guest' && a.entityId === email))
    .slice(0, 60)
    .map((a) => ({ id: a.id, at: a.at, actor: a.actor, action: ACTION_LABEL[a.action] ?? a.action, details: a.details }));

  return {
    key: email || `bk:${latest.id}`,
    name: `${latest.guest.firstName} ${latest.guest.lastName}`.trim(),
    firstName: latest.guest.firstName,
    lastName: latest.guest.lastName,
    email: latest.guest.email,
    phone: latest.guest.phone,
    country: latest.guest.country ?? '',
    lang: guestLang(latest.guest),
    consent: list.some((b) => b.consents.marketing),
    unsubscribed: email ? db.unsubscribed.some((e) => e.toLowerCase() === email) : false,
    demo: list.length > 0 && list.every((b) => b.demo),
    testAddress: !email || isTestAddress(email),
    mailer: transport ? transport.kind : null,
    stripe: mode,
    stats: {
      stays: profile?.stays ?? valid.length,
      nights: profile?.nights ?? nights,
      spent: profile?.spent ?? valid.reduce((s, b) => s + b.total, 0),
      paid: profile?.paid ?? valid.reduce((s, b) => s + b.amountPaid, 0),
      cancellations: profile?.cancellations ?? list.length - valid.length,
      next: profile?.next ?? null,
      inHouse: profile?.inHouse ?? valid.some((b) => isBookingActive(b, now) && b.checkIn <= today && b.checkOut > today),
      favoriteRoom: profile?.favoriteRoom ?? null,
      mainSource: profile?.mainSource ?? (list.length ? sourceLabel(latest.source) : '—'),
      avgNights: profile?.avgNights ?? 0,
      avgLeadDays: profile?.avgLeadDays ?? 0,
      first: profile?.first ?? (list.length ? latest.checkIn : ''),
    },
    bookings: [...list]
      .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
      .map((b) => {
        const n = diffDays(b.checkIn, b.checkOut);
        return {
          id: b.id,
          code: b.code,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          nights: n,
          guests: b.adults + b.children,
          total: b.total,
          amountPaid: b.amountPaid,
          status: b.status,
          active: isBookingActive(b, now),
          room: db.rooms.find((r) => r.id === b.roomId)?.number ?? null,
          source: sourceLabel(b.source),
          method: b.paymentMethod ?? null,
          notes: b.notes,
          specialRequests: b.specialRequests,
          createdAt: b.createdAt,
          refundIfCancelled: cancelRefund(db.settings.payments, today, { checkIn: b.checkIn, total: b.total, amountPaid: b.amountPaid, nights: n }),
          freeCancel: isFreeCancel(today, b.checkIn, db.settings.payments.freeCancellationDays),
        };
      }),
    payments,
    messages: [...messagesIn, ...messagesOut].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60),
    history,
    reviews: db.feedback.filter((f) => f.bookingId && ids.has(f.bookingId)).map((f) => ({ rating: f.rating, comment: f.comment, createdAt: f.createdAt })),
  };
}
