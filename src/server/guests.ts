import 'server-only';
import type { Booking, DB, Locale } from '@/lib/types';
import { isBookingActive } from '@/lib/availability';
import { diffDays, todayISO } from '@/lib/dates';
import { sourceLabel } from './bookings';

export { guestLang } from '@/lib/guest-lang';
import { guestLang } from '@/lib/guest-lang';

export interface GuestBookingLine {
  id: string;
  code: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  total: number;
  amountPaid: number;
  status: Booking['status'];
  room: string | null;
  source: string;
  method: string | null;
  guests: number;
  createdAt: string;
}

export interface GuestProfile {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  country: string;
  lang: Locale;
  consent: boolean;
  unsubscribed: boolean;
  stays: number;
  nights: number;
  spent: number;
  paid: number;
  cancellations: number;
  first: string;
  last: string;
  next: string | null;
  inHouse: boolean;
  favoriteRoom: string | null;
  avgNights: number;
  avgLeadDays: number;
  mainSource: string;
  methods: { card: number; cash: number; other: number };
  bookings: GuestBookingLine[];
  reviews: { rating: number; comment: string; createdAt: string }[];
  messages: number;
  demo: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One profile per email address, aggregated from every booking, review and message. */
export function guestProfiles(db: DB, now = new Date()): GuestProfile[] {
  const today = todayISO();
  const unsub = new Set(db.unsubscribed.map((e) => e.toLowerCase()));
  const groups = new Map<string, Booking[]>();
  for (const b of db.bookings) {
    const k = b.guest.email.trim().toLowerCase();
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const out: GuestProfile[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const latest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
    const valid = sorted.filter((b) => b.status !== 'cancelled');
    const rooms = new Map<string, number>();
    const sources = new Map<string, number>();
    const methods = { card: 0, cash: 0, other: 0 };
    let lead = 0;
    for (const b of valid) {
      const r = db.rooms.find((x) => x.id === b.roomId);
      if (r) rooms.set(`${r.number} ${r.name}`, (rooms.get(`${r.number} ${r.name}`) ?? 0) + 1);
      sources.set(b.source, (sources.get(b.source) ?? 0) + 1);
      if (b.paymentMethod === 'card') methods.card++;
      else if (b.paymentMethod === 'cash') methods.cash++;
      else methods.other++;
      lead += Math.max(0, diffDays(b.createdAt.slice(0, 10), b.checkIn));
    }
    const nights = valid.reduce((s, b) => s + diffDays(b.checkIn, b.checkOut), 0);
    const spent = r2(valid.reduce((s, b) => s + b.total, 0));
    const fav = [...rooms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const main = [...sources.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const upcoming = valid.filter((b) => b.checkIn >= today && isBookingActive(b, now)).map((b) => b.checkIn).sort()[0] ?? null;
    out.push({
      key,
      email: latest.guest.email,
      firstName: latest.guest.firstName,
      lastName: latest.guest.lastName,
      name: `${latest.guest.firstName} ${latest.guest.lastName}`.trim(),
      phone: latest.guest.phone,
      country: latest.guest.country ?? '',
      lang: guestLang(latest.guest),
      consent: list.some((b) => b.consents.marketing),
      unsubscribed: unsub.has(key),
      stays: valid.length,
      nights,
      spent,
      paid: r2(valid.reduce((s, b) => s + b.amountPaid, 0)),
      cancellations: list.length - valid.length,
      first: sorted[0]!.checkIn,
      last: sorted.at(-1)!.checkIn,
      next: upcoming,
      inHouse: valid.some((b) => isBookingActive(b, now) && b.checkIn <= today && b.checkOut > today),
      favoriteRoom: fav,
      avgNights: valid.length ? r2(nights / valid.length) : 0,
      avgLeadDays: valid.length ? Math.round(lead / valid.length) : 0,
      mainSource: main ? sourceLabel(main as Booking['source']) : '—',
      methods,
      bookings: [...list]
        .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
        .map((b) => ({
          id: b.id,
          code: b.code,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          nights: diffDays(b.checkIn, b.checkOut),
          total: b.total,
          amountPaid: b.amountPaid,
          status: b.status,
          room: db.rooms.find((x) => x.id === b.roomId)?.number ?? null,
          source: sourceLabel(b.source),
          method: b.paymentMethod ?? null,
          guests: b.adults + b.children,
          createdAt: b.createdAt,
        })),
      reviews: db.feedback.filter((f) => f.bookingId && list.some((b) => b.id === f.bookingId)).map((f) => ({ rating: f.rating, comment: f.comment, createdAt: f.createdAt })),
      messages: db.messages.filter((m) => m.email.toLowerCase() === key).length,
      demo: list.every((b) => b.demo),
    });
  }
  return out.sort((a, b) => (b.next ?? b.last).localeCompare(a.next ?? a.last));
}

/** Fields that can be placed in a message with the "pills" (Nome, Camera, Arrivo…). */
export function guestTokens(db: DB, email: string): Record<string, string> {
  const key = email.trim().toLowerCase();
  const list = db.bookings.filter((b) => b.guest.email.trim().toLowerCase() === key && b.status !== 'cancelled');
  const today = todayISO();
  const b = list.filter((x) => x.checkOut >= today).sort((x, y) => x.checkIn.localeCompare(y.checkIn))[0] ?? list.sort((x, y) => y.checkIn.localeCompare(x.checkIn))[0];
  if (!b) return {};
  const room = db.rooms.find((r) => r.id === b.roomId);
  const lang = guestLang(b.guest);
  const d = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(lang === 'en' ? 'en-GB' : lang, { day: 'numeric', month: 'long' });
  return { nome: b.guest.firstName, cognome: b.guest.lastName, camera: room ? `${room.number} ${room.name}` : '', arrivo: d(b.checkIn), partenza: d(b.checkOut), codice: b.code };
}
