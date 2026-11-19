/**
 * Cash price at the hotel. Italy forbids card surcharges, so the cash price is a discount on the
 * card price: either the room's own cash price set by the owner, or the global cash discount.
 */
export function cashPercentFor(room: { basePrice: number; cashPrice?: number | null }, payments: { allowCashAtHotel: boolean; cashDiscountPercent: number }): number {
  if (!payments.allowCashAtHotel) return 0;
  if (typeof room.cashPrice === 'number' && room.cashPrice > 0) {
    if (room.cashPrice >= room.basePrice || room.basePrice <= 0) return 0;
    return Math.round((1 - room.cashPrice / room.basePrice) * 10000) / 100;
  }
  return Math.max(0, payments.cashDiscountPercent);
}

export const cashOf = (n: number, percent: number) => Math.round(n * (1 - percent / 100) * 100) / 100;

/**
 * The ways to pay for a room: the room's own choice (card only / cash only / both) within what the
 * hotel accepts in Pagamenti. If the two leave nothing in common, the hotel-wide setting wins, so a
 * room can never become impossible to book.
 */
export function roomPayment(room: { payment?: 'both' | 'card' | 'cash' | null }, payments: { allowOnline?: boolean; allowCashAtHotel: boolean }): { card: boolean; cash: boolean } {
  const hotel = { card: payments.allowOnline !== false, cash: payments.allowCashAtHotel };
  const p = room.payment ?? 'both';
  const res = { card: hotel.card && p !== 'cash', cash: hotel.cash && p !== 'card' };
  return res.card || res.cash ? res : hotel;
}
