import 'server-only';

/**
 * Channel integration architecture:
 *   Booking.com / Expedia / other OTAs → the hotel's PMS / channel manager → this system.
 * We never talk to OTAs directly. A real adapter for the hotel's provider (to be confirmed)
 * implements this interface; until then only the clearly-labelled simulator is available.
 */
export interface ExternalReservation {
  externalId: string;
  channel: 'booking' | 'expedia' | 'altro_ota';
  roomTypeCode: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  guest: { firstName: string; lastName: string; email: string; phone: string };
  total: number;
}

export interface ChannelAdapter {
  id: string;
  label: string;
  simulated: boolean;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  fetchReservations(since: string | null): Promise<ExternalReservation[]>;
  /** push availability/prices back to the channel manager (not implemented in the simulator) */
  pushAvailability?(payload: { roomTypeCode: string; date: string; available: number; price: number }[]): Promise<void>;
}

export function configuredAdapter(): ChannelAdapter | null {
  // e.g. CHANNEL_PROVIDER=octorate|smoobu|… with its credentials. Intentionally not faked.
  const provider = process.env.CHANNEL_PROVIDER;
  if (!provider) return null;
  return {
    id: provider,
    label: provider,
    simulated: false,
    async testConnection() {
      return { ok: false, message: `Adattatore “${provider}” non ancora implementato: servono API e credenziali del fornitore.` };
    },
    async fetchReservations() {
      return [];
    },
  };
}

const FIRST = ['Marta', 'Jonas', 'Claire', 'Pablo', 'Ewa', 'Lena', 'Hugo', 'Giorgia'];
const LAST = ['Schneider', 'Lefèvre', 'Ortega', 'Zielińska', 'Bauer', 'Moreau', 'Serra', 'Lindqvist'];

export const simulator: ChannelAdapter = {
  id: 'simulator',
  label: 'SIMULAZIONE (nessun collegamento reale)',
  simulated: true,
  async testConnection() {
    return { ok: true, message: 'SIMULAZIONE: connessione fittizia riuscita. Nessun dato reale scambiato con OTA.' };
  },
  async fetchReservations() {
    const r = () => Math.floor(Math.random() * 1e6);
    const i = r() % FIRST.length;
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 3 + (r() % 25));
    const nights = 2 + (r() % 3);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + nights);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const channel = r() % 3 === 0 ? 'expedia' : 'booking';
    const first = FIRST[i]!;
    const last = LAST[r() % LAST.length]!;
    return [
      {
        externalId: `SIM-${channel === 'booking' ? 'BDC' : 'EXP'}-${100000 + (r() % 899999)}`,
        channel,
        roomTypeCode: ['DBL', 'DBL', 'TWN', 'TRP', 'DBL-SEA'][r() % 5]!,
        checkIn: iso(start),
        checkOut: iso(end),
        adults: 2,
        children: 0,
        guest: { firstName: first, lastName: last, email: `${first.toLowerCase()}.sim@example.com`, phone: '+00 000 000 000' },
        total: 110 * nights,
      },
    ];
  },
};
