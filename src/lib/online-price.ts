import type { RatePeriod, Room } from './types';

/**
 * "Aumento prezzi online" (Prezzi → Tariffe e sconti): the card prices the guests see on the site go
 * up by a few percent (e.g. to cover the cost of instant payouts), the owner keeps typing the usual
 * prices, and the cash price at the hotel stays exactly what it was.
 *
 * Italy forbids a surcharge for paying by card: this is never shown as a card fee, it is simply the
 * price on the site (the cash price remains a discount on it, as always).
 *
 * Done on the inputs of the price functions (room + periods), so every price the guest meets (cards,
 * search, room page, quote, booking, date change, chat) comes out of the same numbers.
 */
type Settings = {
  pricing?: { onlineMarkup?: { enabled: boolean; percent: number; round?: boolean } };
  payments: { allowCashAtHotel: boolean; cashDiscountPercent: number };
};

export const MARKUP_MAX = 20;

/** The increase in percent, 0 when it is off. */
export function onlineMarkup(s: Settings): number {
  const m = s.pricing?.onlineMarkup;
  if (!m?.enabled || !(m.percent > 0)) return 0;
  return Math.min(MARKUP_MAX, m.percent);
}

/** Whole euro for the raised prices (no cents): on unless the owner switched it off. */
export function onlineRounding(s: Settings): boolean {
  return onlineMarkup(s) > 0 && s.pricing?.onlineMarkup?.round !== false;
}

/** The price raised by `percent`, to the cent or, with `round`, to the nearest whole euro. */
export const withMarkup = (price: number, percent: number, round = false) => {
  if (!(percent > 0)) return price;
  const up = price * (1 + percent / 100);
  // to the cent first: 100 + 1,5% is 101,5 exactly (not 101,4999…), so it rounds to 102
  const cents = Math.round(up * 100) / 100;
  return round ? Math.round(cents) : cents;
};

/**
 * The room as the site shows it: card price + the increase. The cash price is pinned to what it was
 * (the room's own cash price, else the usual cash discount on the owner's price), so it does not move.
 */
export function onlineRoom<T extends Pick<Room, 'basePrice' | 'cashPrice'>>(room: T, s: Settings): T {
  const m = onlineMarkup(s);
  if (!m) return room;
  const own = typeof room.cashPrice === 'number' && room.cashPrice > 0 && room.cashPrice <= room.basePrice ? room.cashPrice : null;
  const cash = own ?? (s.payments.allowCashAtHotel ? Math.round(room.basePrice * (1 - Math.max(0, s.payments.cashDiscountPercent) / 100) * 100) / 100 : null);
  return { ...room, basePrice: withMarkup(room.basePrice, m, onlineRounding(s)), cashPrice: cash };
}

/**
 * Seasons and events as the site shows them: a fixed nightly price goes up like the base price (its
 * own cash price, when set, stays); a percent change already follows the base price.
 */
export function onlinePeriods(periods: RatePeriod[], s: Settings): RatePeriod[] {
  const m = onlineMarkup(s);
  if (!m) return periods;
  const round = onlineRounding(s);
  return periods.map((p) => (p.mode === 'fixed' ? { ...p, value: withMarkup(p.value, m, round) } : p));
}
