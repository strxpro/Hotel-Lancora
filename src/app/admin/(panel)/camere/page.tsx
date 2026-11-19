import { requirePageUser, can } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { PageHeader } from '@/components/admin/ui';
import { RoomsList, type RoomStats } from '@/components/admin/rooms-list';
import { isBookingActive } from '@/lib/availability';
import { addDays, eachNight, startOfMonth, addMonths, todayISO } from '@/lib/dates';

export const metadata = { title: 'Camere' };

export default async function RoomsAdminPage() {
  const user = await requirePageUser('rooms.edit');
  const db = readDb();
  const rooms = [...db.rooms].sort((a, b) => a.number.localeCompare(b.number, 'it', { numeric: true }));
  // what each room is doing: the next 30 nights, the next guest, the nights sold this month
  const today = todayISO();
  const now = new Date();
  const in30 = new Set(eachNight(today, addDays(today, 30)));
  const monthFrom = startOfMonth(today);
  const monthTo = addMonths(monthFrom, 1);
  const stats: Record<string, RoomStats> = {};
  for (const r of rooms) {
    const mine = db.bookings.filter((b) => b.roomId === r.id && isBookingActive(b, now));
    const nights = mine.flatMap((b) => eachNight(b.checkIn, b.checkOut));
    const here = mine.find((b) => b.checkIn <= today && b.checkOut > today);
    const next = mine.filter((b) => b.checkIn >= today && b !== here).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
    stats[r.id] = {
      occ30: Math.round((nights.filter((n) => in30.has(n)).length / 30) * 100),
      month: nights.filter((n) => n >= monthFrom && n < monthTo).length,
      next: next ? { date: next.checkIn, guest: next.guest.lastName } : null,
      now: here ? here.guest.lastName : null,
    };
  }
  return (
    <div>
      <PageHeader eyebrow="Struttura" title="Camere" description={`${rooms.length} camere · prezzo, stato, visibilità e carta o contanti si cambiano qui con un clic e valgono subito sul sito.`} />
      <RoomsList rooms={rooms} canPrice={can(user.role, 'prices.edit')} feedback={db.feedback.filter((f) => f.roomId)} canReviews={can(user.role, 'marketing.manage')} canDelete={can(user.role, 'rooms.delete')} stats={stats} hotelPay={{ online: db.settings.payments.allowOnline !== false, cash: db.settings.payments.allowCashAtHotel }} />
    </div>
  );
}
