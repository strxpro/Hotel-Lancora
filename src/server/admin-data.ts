import 'server-only';
import type { Booking, DB } from '@/lib/types';
import { isBookingActive } from '@/lib/availability';
import { addDays, diffDays } from '@/lib/dates';
import { sourceLabel } from './bookings';

/** Flattened booking row for admin tables (only what the UI needs). */
export interface BookingRow {
  id: string;
  code: string;
  guest: string;
  email: string;
  phone: string;
  roomId: string | null;
  roomNumber: string | null;
  roomName: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  total: number;
  amountPaid: number;
  status: Booking['status'];
  active: boolean;
  source: Booking['source'];
  sourceLabel: string;
  otaRef: string | null;
  specialRequests: string;
  notes: string;
  createdAt: string;
  simulated: boolean;
  demo: boolean;
  token: string;
  holdExpiresAt: string | null;
  /** the guest did not arrive */
  noShow: boolean;
  /** messages from the guest not read yet */
  unread: number;
  /** something waits for the hotel's answer (new dates / free cancellation asked by the guest) */
  waiting: 'dates' | 'free_cancel' | null;
  /** a new card was asked and the deadline is running */
  cardDue: string | null;
  paymentMethod: Booking['paymentMethod'] | null;
}

export function bookingRow(db: DB, b: Booking, now = new Date()): BookingRow {
  const r = db.rooms.find((x) => x.id === b.roomId);
  return {
    id: b.id,
    code: b.code,
    guest: `${b.guest.firstName} ${b.guest.lastName}`,
    email: b.guest.email,
    phone: b.guest.phone,
    roomId: b.roomId,
    roomNumber: r?.number ?? null,
    roomName: r?.name ?? null,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: diffDays(b.checkIn, b.checkOut),
    adults: b.adults,
    children: b.children,
    total: b.total,
    amountPaid: b.amountPaid,
    status: b.status,
    active: isBookingActive(b, now),
    source: b.source,
    sourceLabel: sourceLabel(b.source),
    otaRef: b.otaRef,
    specialRequests: b.specialRequests,
    notes: b.notes,
    createdAt: b.createdAt,
    simulated: b.simulated,
    demo: b.demo,
    token: b.token,
    holdExpiresAt: b.holdExpiresAt,
    noShow: Boolean(b.noShow),
    unread: db.messages.filter((m) => m.bookingId === b.id && (m.sender ?? 'guest') === 'guest' && !m.read).length,
    waiting: b.changeRequest?.status === 'pending' && b.changeRequest.by === 'guest' ? b.changeRequest.kind : null,
    cardDue: b.cardRequest && !b.cardRequest.outcome ? b.cardRequest.deadline : null,
    paymentMethod: b.paymentMethod ?? null,
  };
}

export interface RoomOption {
  id: string;
  number: string;
  name: string;
  maxGuests: number;
  basePrice: number;
  cashPrice: number | null;
  status: string;
  hidden: boolean;
  floor: string;
}

export function roomOptions(db: DB): RoomOption[] {
  return [...db.rooms].sort((a, b) => a.number.localeCompare(b.number, 'it', { numeric: true })).map((r) => ({ id: r.id, number: r.number, name: r.name, maxGuests: r.maxGuests, basePrice: r.basePrice, cashPrice: typeof r.cashPrice === 'number' ? r.cashPrice : null, status: r.status, hidden: r.hidden, floor: r.floor }));
}

/** Occupied rooms per night for the next N days (dashboard strip). */
export function occupancyStrip(db: DB, from: string, days: number, now = new Date()) {
  const total = db.rooms.filter((r) => r.status === 'available').length || 1;
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(from, i);
    const occ = new Set(db.bookings.filter((b) => b.roomId && isBookingActive(b, now) && b.checkIn <= d && b.checkOut > d).map((b) => b.roomId)).size;
    const blocked = new Set(db.blocks.filter((k) => k.from <= d && k.to > d).map((k) => k.roomId)).size;
    return { date: d, occupied: occ, blocked, total, rate: Math.round((occ / total) * 100) };
  });
}
