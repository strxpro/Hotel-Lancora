import type { FloorKey, Photo, RoomType } from './types';

/** Minimal room data sent to client components (no internal fields). */
export interface RoomCardData {
  id: string;
  slug: string;
  number: string;
  name: string;
  type: RoomType;
  maxGuests: number;
  beds: string;
  size: number | null;
  floor: FloorKey;
  basePrice: number;
  /** the owner's own cash price per night (null = global cash discount) */
  cashPrice: number | null;
  /** ways to pay this room on the site, already combined with the hotel setting */
  pay?: { card: boolean; cash: boolean };
  /** effective cash discount for this room, 0 when cash at the hotel is off */
  cashPercent: number;
  amenities: string[];
  photo: Photo | null;
  photos: Photo[];
  short: string;
  /** bookings in the last 12 months — drives the price histogram and "most popular" sort */
  popularity: number;
  /** what a night includes (Prezzi → Tariffe e sconti) */
  board?: 'room_only' | 'breakfast';
  /** average of the published guest reviews of this room */
  rating: { avg: number; count: number } | null;
}

export interface RoomResult {
  room: RoomCardData;
  available: boolean;
  nights: number;
  total: number;
  averageNight: number;
  /** percent of the "uso singola" discount already inside the price (0 = none) */
  singleUse?: number;
  /** cash discount of exactly these nights (season cash prices included) */
  cashPercent?: number;
}

/** what a night includes (settings → Prezzi) */
export type Board = 'room_only' | 'breakfast';

export interface AvailabilityResponse {
  query: { checkIn: string; checkOut: string; adults: number; children: number };
  results: RoomResult[];
  count: number;
  alternatives: { checkIn: string; checkOut: string; count: number; from: number }[];
}
