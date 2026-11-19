import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DB } from '../src/lib/types';
import { quietDay, templateReport, type DayFacts } from '../src/server/reports';
import { morningMessages, roomsToPrepare } from '../src/server/daily';

const facts = (over: Partial<DayFacts> = {}): DayFacts => ({
  date: '2026-11-12',
  dateLabel: 'giovedì 12 novembre',
  rooms: 10,
  site: { visitors: 0, pageViews: 0, bookingPageViews: 0, roomPageViews: 0 },
  newBookings: [],
  unfinishedCheckouts: [],
  cancellations: [],
  moneyIn: 0,
  tonight: { rooms: 2, guests: 4, occupancy: 20 },
  tomorrow: { arrivals: [{ guest: 'Anna Neri', room: '105', guests: 2, toPay: 120 }], departures: [] },
  nextNights: [{ date: '2026-11-13', label: 'ven 13 nov', free: 8 }],
  unreadMessages: 0,
  newReviews: [],
  openTasks: [],
  unassigned: 0,
  ...over,
});

test('a quiet day never says that nobody came: it talks about what comes next', () => {
  const f = facts();
  assert.equal(quietDay(f), true);
  const r = templateReport(f);
  assert.match(r.text, /Com’è andata/);
  assert.match(r.text, /Da migliorare/);
  assert.match(r.text, /Prossimi giorni/);
  assert.doesNotMatch(r.text, /nessun[oa]? (visit|prenot)|0 persone|zero/i);
  assert.match(r.text, /Anna Neri \(camera 105, da saldare 120,00 €\)/);
  assert.match(r.text, /ven 13 nov \(8 camere\)/); // empty nights become an idea
});

test('a busy day lists what happened and who left a booking half way', () => {
  const r = templateReport(
    facts({
      site: { visitors: 37, pageViews: 120, bookingPageViews: 9, roomPageViews: 30 },
      newBookings: [{ code: 'LA-1', guest: 'Mario Rossi', room: '101', from: '2026-12-01', nights: 3, total: 345, channel: 'sito' }],
      unfinishedCheckouts: [{ guest: 'Test Ospite', email: 'ospite@example.com', phone: '+39 1', from: '2026-12-05', nights: 2, total: 138 }],
      moneyIn: 103.5,
    }),
  );
  assert.match(r.text, /37 persone sul sito, 9 volte sulla pagina di prenotazione/);
  assert.match(r.text, /Una nuova prenotazione: Mario Rossi \(3 notti, 345,00 €, sito\)/);
  assert.match(r.text, /Incassati 103,50 €/);
  assert.match(r.text, /Test Ospite \(ospite@example\.com, \+39 1\)/);
});

const db = {
  settings: { hotel: { checkInFrom: '14:00', checkOutBy: '10:30' } },
  rooms: [
    { id: 'r1', number: '101', name: 'Maestrale' },
    { id: 'r2', number: '105', name: 'Ginepro' },
  ],
  bookings: [
    { id: 'b1', roomId: 'r1', status: 'confirmed', holdExpiresAt: null, checkIn: '2026-11-10', checkOut: '2026-11-12', total: 200, amountPaid: 200, adults: 2, children: 0, guest: { firstName: 'Luca', lastName: 'Bianchi' } },
    { id: 'b2', roomId: 'r2', status: 'confirmed', holdExpiresAt: null, checkIn: '2026-11-09', checkOut: '2026-11-12', total: 300, amountPaid: 90, adults: 1, children: 0, guest: { firstName: 'Eva', lastName: 'Verdi' } },
    { id: 'b3', roomId: 'r2', status: 'confirmed', holdExpiresAt: null, checkIn: '2026-11-12', checkOut: '2026-11-14', total: 260, amountPaid: 78, adults: 2, children: 1, guest: { firstName: 'Anna', lastName: 'Neri' } },
  ],
} as unknown as DB;

test('morning messages: arrivals with the balance, departures with what to collect', () => {
  const m = morningMessages(db, '2026-11-12');
  assert.equal(m.arrivals?.title, 'Arrivi di oggi · 1');
  assert.match(m.arrivals!.body, /Anna Neri · camera 105 · 3 ospiti · 2 notti · da saldare 182,00 €/);
  assert.equal(m.departures?.title, 'Partenze di oggi · 2');
  assert.match(m.departures!.body, /Eva Verdi · camera 105 · da incassare 210,00 €/);
  assert.equal(morningMessages(db, '2026-11-20').arrivals, null); // nothing to say → no message
});

test('rooms to prepare: the one with a guest arriving today comes first', () => {
  const r = roomsToPrepare(db, '2026-11-12');
  assert.equal(r?.title, 'Camere da preparare · 2');
  assert.match(r!.body.split('\n')[0]!, /^• 105 Ginepro — arriva un ospite oggi dalle 14:00/);
  assert.match(r!.body.split('\n')[1]!, /^• 101 Maestrale$/);
});
