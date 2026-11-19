'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { assignRoom, cancelBooking, createManualBooking, markPaid, updateBookingNotes } from '@/server/bookings';
import { mutate, readDb } from '@/server/db/store';
import { queueEmail } from '@/server/events';
import { clean } from '@/server/security';

const Manual = z.object({
  roomId: z.string().nullable(),
  checkIn: z.string(),
  checkOut: z.string(),
  adults: z.number().int().min(1).max(8),
  children: z.number().int().min(0).max(6),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.union([z.email(), z.literal('')]),
  phone: z.string().trim().max(30),
  source: z.enum(['sito', 'telefono', 'email', 'walkin', 'booking', 'expedia', 'altro_ota']),
  status: z.enum(['confirmed', 'pending_payment']),
  total: z.number().min(0).max(50000).nullable(),
  amountPaid: z.number().min(0).max(50000),
  notes: z.string().max(1000),
  sendEmail: z.boolean(),
});

export async function createBookingAction(raw: unknown) {
  return act('bookings.manage', (u) => {
    const d = Manual.parse(raw);
    const b = createManualBooking(
      {
        roomId: d.roomId,
        checkIn: d.checkIn,
        checkOut: d.checkOut,
        adults: d.adults,
        children: d.children,
        guest: { firstName: clean(d.firstName, 60), lastName: clean(d.lastName, 60), email: d.email.toLowerCase(), phone: clean(d.phone, 30) },
        source: d.source,
        status: d.status,
        total: d.total,
        amountPaid: d.amountPaid,
        notes: clean(d.notes, 1000),
        sendEmail: d.sendEmail && Boolean(d.email),
      },
      u.name,
    );
    return { id: b.id, code: b.code };
  }, 'Prenotazione registrata: il planning è aggiornato.');
}

export async function assignRoomAction(bookingId: string, roomId: string | null) {
  return act('bookings.manage', (u) => void assignRoom(bookingId, roomId, u.name), roomId ? 'Camera assegnata: le notti sono segnate nel planning.' : 'Assegnazione rimossa.');
}

export async function cancelBookingAction(bookingId: string, refundAmount: number, reason: string, notifyGuest: boolean) {
  return act('bookings.manage', (u) => {
    // refunds above zero require the payments permission
    const db = readDb();
    const role = db.users.find((x) => x.id === u.id)?.role;
    const refund = role === 'admin' ? Math.max(0, refundAmount) : 0;
    cancelBooking(bookingId, u.name, { refundAmount: refund, reason: clean(reason, 200), notifyGuest });
  }, 'Prenotazione annullata: le notti sono di nuovo disponibili.');
}

export async function markPaidAction(bookingId: string, amount: number, provider: 'contanti' | 'bonifico' | 'simulazione' | 'pos') {
  return act('bookings.manage', (u) => void markPaid(bookingId, z.number().positive().parse(amount), z.enum(['contanti', 'bonifico', 'simulazione', 'pos']).parse(provider), u.name), 'Pagamento registrato.');
}

/** Gives back what a cancelled booking still holds: on the card for real when it was paid on the site. */
export async function refundAction(bookingId: string, amount: number) {
  return act('payments.manage', async (u) => {
    const { refundBooking } = await import('@/server/booking-care');
    const r = await refundBooking(bookingId, z.number().positive().parse(amount), u.name, true);
    if (!r.refunded) throw new UserError(r.problems.join(' ') || 'Nessun importo rimborsabile.');
    return r;
  }, 'Rimborso fatto: l’ospite riceve l’email con l’importo.');
}

export async function notesAction(bookingId: string, notes: string) {
  return act('bookings.manage', (u) => updateBookingNotes(bookingId, clean(notes, 1000), u.name), 'Note salvate.');
}

export async function sendBookingEmailAction(bookingId: string, template: 'conferma' | 'promemoria' | 'modifica') {
  return act('bookings.manage', () =>
    mutate((db) => {
      const b = db.bookings.find((x) => x.id === bookingId);
      if (!b) throw new Error('Prenotazione non trovata');
      queueEmail(db, z.enum(['conferma', 'promemoria', 'modifica']).parse(template), b.guest.email, { booking: b, room: db.rooms.find((r) => r.id === b.roomId) ?? null });
    }),
  'Email creata nella Demo Outbox.');
}

/** GDPR: anonymise a guest across all bookings (admin only). */
export async function anonymizeGuestAction(email: string) {
  return act('guests.gdpr', (u) =>
    mutate((db) => {
      const target = z.email().parse(email).toLowerCase();
      let n = 0;
      for (const b of db.bookings) {
        if (b.guest.email.toLowerCase() !== target) continue;
        b.guest = { firstName: 'Ospite', lastName: 'anonimizzato', email: `anonimo-${b.id}@invalid`, phone: '' };
        b.specialRequests = '';
        b.notes = '';
        n++;
      }
      db.messages = db.messages.filter((m) => m.email.toLowerCase() !== target);
      db.audit.unshift({ id: `a-${Date.now()}`, at: new Date().toISOString(), actor: u.name, action: 'gdpr_anonymize', entity: 'guest', entityId: null, details: `${n} prenotazioni anonimizzate` });
    }),
  'Dati dell’ospite anonimizzati.');
}
