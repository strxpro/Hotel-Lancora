import type { Booking, BookingSource, DB, Locale, Payment, Room, RoomTranslation, Settings } from '@/lib/types';
import { LOCALES } from '@/lib/types';
import { addDays, rangesOverlap as rangesOverlapSafe, todayISO } from '@/lib/dates';
import { quoteStay } from '@/lib/availability';
import { hashPassword } from '../auth/password';
import { renderEmail } from '../email/templates';
import { SEED_ROOMS, seedText } from './seed-rooms';
import { demoRoomReviews } from './demo-reviews';

/** Deterministic PRNG so a reset produces the same story relative to "today". */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Giulia', 'Marco', 'Francesca', 'Luca', 'Chiara', 'Andrea', 'Sara', 'Matteo', 'Anna', 'Paolo', 'Elena', 'Stefano', 'Martina', 'Davide', 'Laura', 'Thomas', 'Katrin', 'Lukas', 'Sophie', 'Camille', 'Julien', 'Anna', 'Piotr', 'Agnieszka', 'Tomasz', 'Lucía', 'Javier', 'Emma', 'Oliver', 'Hannah'];
const LAST = ['Rossi', 'Bianchi', 'Esposito', 'Ferrari', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'Sanna', 'Piras', 'Pinna', 'Müller', 'Schmidt', 'Weber', 'Dubois', 'Martin', 'Bernard', 'Kowalska', 'Nowak', 'Wiśniewski', 'García', 'Fernández', 'Smith', 'Taylor', 'Brown', 'Mura'];
const COUNTRY = ['IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'IT', 'DE', 'DE', 'DE', 'FR', 'FR', 'FR', 'PL', 'PL', 'PL', 'PL', 'ES', 'ES', 'GB', 'GB', 'GB'];

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

export function defaultSettings(): Settings {
  return {
    hotel: {
      name: 'Hotel L’Ancora',
      stars: 3,
      tagline: 'Il tuo soggiorno, nel cuore della Sardegna.',
      addressLine: 'Via Calabria s/n',
      postalCode: '07028',
      city: 'Santa Teresa Gallura',
      province: 'SS',
      country: 'Italia',
      addressVerified: true,
      lat: 41.240715,
      lng: 9.18701,
      phone: '+39 0789 754564',
      whatsapp: '+39 329 834 8189',
      email: 'lancorahotel@gmail.com',
      vat: '01410810905',
      cin: 'Da inserire',
      checkInFrom: '14:00',
      checkInTo: '20:00',
      checkOutBy: '10:30',
      factsVerified: false,
      googleReviewUrl: '',
    },
    floors: { enableLower: false },
    payments: {
      mode: 'deposit_percent',
      depositPercent: 30,
      depositFixed: 100,
      freeCancellationDays: 7,
      cancellationPolicy: 'Cancellazione gratuita fino a 7 giorni prima dell’arrivo. Dopo tale termine l’acconto non è rimborsabile.',
      refundPolicy: 'Gli importi rimborsabili vengono restituiti sullo stesso metodo di pagamento entro 10 giorni lavorativi.',
      holdMinutes: 20,
      cashDiscountPercent: 5,
      allowCashAtHotel: true,
    },
    stripeConnect: { accountId: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, payoutInterval: 'weekly', weeklyAnchor: 'monday', monthlyAnchor: 1, updatedAt: null, simulated: false, businessName: null, bankLast4: null, requirements: [] },
    notifications: {
      nuova_prenotazione: true,
      nuovo_pagamento: true,
      prenotazione_cancellata: true,
      nuovo_arrivo: true,
      partenza_oggi: true,
      pagamento_non_completato: true,
      camera_da_controllare: true,
      errore_sincronizzazione: true,
      messaggio_ospite: true,
      report_giornaliero: true,
    },
    customAmenities: [],
    reviews: { autoRequest: true, delayDays: 1 },
    services: [
      { key: 'wifi', label: 'Wi-Fi', status: 'confermato', note: 'gratuito, in tutte le camere' },
      { key: 'aria', label: 'Aria condizionata e riscaldamento', status: 'confermato', note: 'in tutte le camere' },
      { key: 'ascensore', label: 'Ascensore', status: 'confermato', note: '' },
      { key: 'cassaforte', label: 'Cassaforte', status: 'confermato', note: '' },
      { key: 'salatv', label: 'Sala TV con satellite', status: 'confermato', note: '' },
      { key: 'lettura', label: 'Sala lettura con internet point', status: 'confermato', note: '' },
      { key: 'parcheggio', label: 'Parcheggio', status: 'confermato', note: 'ampio parcheggio pubblico gratuito vicino all’hotel' },
      { key: 'diving', label: 'Diving', status: 'confermato', note: 'possibili immersioni con un diving center della zona' },
      { key: 'colazione', label: 'Colazione', status: 'da_confermare', note: 'diversi bar per la colazione a pochi passi' },
      { key: 'ristorante', label: 'Ristorante', status: 'da_confermare', note: 'ristoranti e pizzerie con menu turistici nelle vicinanze' },
      { key: 'animali', label: 'Animali ammessi', status: 'da_confermare', note: '' },
      { key: 'reception', label: 'Reception 24 ore', status: 'da_confermare', note: '' },
      { key: 'transfer', label: 'Transfer da/per aeroporto', status: 'da_confermare', note: '' },
    ],
    faq: [
      { id: 'faq-aeroporti', question: 'Come si raggiunge Santa Teresa Gallura?', answer: 'L’aeroporto più vicino è Olbia Costa Smeralda, a circa un’ora d’auto. Da Santa Teresa partono anche i traghetti per Bonifacio, in Corsica.', keywords: ['aeroporto', 'arrivare', 'raggiungere', 'olbia', 'airport', 'flughafen', 'lotnisko', 'aéroport', 'aeropuerto'] },
      { id: 'faq-corsica', question: 'Si può andare in Corsica?', answer: 'Sì: dal porto di Santa Teresa Gallura partono i traghetti per Bonifacio. Gli orari variano con la stagione, consigliamo di verificarli con le compagnie di navigazione.', keywords: ['corsica', 'bonifacio', 'traghetto', 'ferry', 'fähre', 'prom', 'ferri', 'corse', 'córcega', 'korsyka', 'korsika'] },
    ],
    demoMode: true,
  };
}

export function buildSeed(now: Date = new Date()): DB {
  const today = todayISO(now);
  const nowIso = now.toISOString();
  const rng = mulberry32(Number(today.replace(/-/g, '')));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rng() * arr.length)]!;
  const year = Number(today.slice(0, 4));

  const settings = defaultSettings();

  // ---------- rooms ----------
  const rooms: Room[] = SEED_ROOMS.map((r, i) => {
    const translations: Room['translations'] = {};
    for (const l of LOCALES) {
      if (l === 'it') continue;
      const t = seedText(r, l as Locale);
      translations[l as Exclude<Locale, 'it'>] = { ...t, status: 'tradotto', manual: false, updatedAt: nowIso, published: t } satisfies RoomTranslation;
    }
    return {
      id: `room-${r.number}`,
      number: r.number,
      slug: `${r.number}-${r.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-+$/, '')}`,
      name: r.name,
      type: r.type,
      maxGuests: r.maxGuests,
      beds: r.beds,
      bedsCount: r.bedsCount,
      size: r.size,
      floor: r.floor,
      basePrice: r.basePrice,
      status: 'available',
      hidden: false,
      photos: r.photos.map((p, j) => ({ id: `ph-${r.number}-${j}`, src: `/media/demo/${p.file}.jpg`, alt: p.alt, width: p.width, height: p.height, demo: true, credit: 'Unsplash (foto dimostrativa)' })),
      amenities: r.amenities,
      text: seedText(r, 'it'),
      translations,
      sortOrder: i,
      createdAt: nowIso,
      updatedAt: nowIso,
      demo: true,
    };
  });
  const roomById = (id: string) => rooms.find((r) => r.id === id)!;

  // ---------- price periods ----------
  const ratePeriods: DB['ratePeriods'] = [
    { id: 'rp-alta-1', label: 'Alta stagione', from: `${year}-06-15`, to: `${year}-09-16`, roomIds: 'all', mode: 'percent', value: 35, createdAt: nowIso },
    { id: 'rp-alta-2', label: 'Alta stagione', from: `${year + 1}-06-15`, to: `${year + 1}-09-16`, roomIds: 'all', mode: 'percent', value: 35, createdAt: nowIso },
    { id: 'rp-capodanno', label: 'Capodanno', from: `${year}-12-29`, to: `${year + 1}-01-03`, roomIds: 'all', mode: 'percent', value: 20, createdAt: nowIso },
  ];

  // ---------- blocks ----------
  const blocks: DB['blocks'] = [
    { id: 'blk-1', roomId: 'room-104', from: addDays(today, 5), to: addDays(today, 8), reason: 'Manutenzione impianto clima', createdBy: 'Demo', createdAt: nowIso },
    { id: 'blk-2', roomId: 'room-112', from: addDays(today, 12), to: addDays(today, 15), reason: 'Uso proprietario', createdBy: 'Demo', createdAt: nowIso },
  ];

  // ---------- bookings ----------
  const bookings: Booking[] = [];
  const payments: Payment[] = [];
  const usedCodes = new Set<string>();
  const code = () => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    do c = 'LA-' + Array.from({ length: 5 }, () => A[Math.floor(rng() * A.length)]).join('');
    while (usedCodes.has(c));
    usedCodes.add(c);
    return c;
  };
  const sourcePick = (): BookingSource => {
    const x = rng();
    return x < 0.36 ? 'sito' : x < 0.62 ? 'booking' : x < 0.72 ? 'expedia' : x < 0.9 ? 'telefono' : x < 0.96 ? 'email' : 'walkin';
  };
  const stays: Record<string, { from: string; to: string }[]> = {};
  const occupied = (roomId: string, from: string, to: string) =>
    (stays[roomId] ?? []).some((s) => rangesOverlapSafe(from, to, s.from, s.to)) || blocks.some((b) => b.roomId === roomId && rangesOverlapSafe(from, to, b.from, b.to));

  const addBooking = (roomId: string | null, checkIn: string, checkOut: string, opts: Partial<Booking> = {}) => {
    const fi = Math.floor(rng() * FIRST.length);
    const first = FIRST[fi]!;
    const last = pick(LAST);
    const room = roomId ? roomById(roomId) : rooms[2]!;
    const guestsMax = room.maxGuests;
    const adults = Math.max(1, Math.min(guestsMax, guestsMax >= 3 ? 2 : guestsMax));
    const children = guestsMax >= 3 && rng() < 0.6 ? Math.min(guestsMax - adults, 1 + Math.floor(rng() * (guestsMax - adults))) : 0;
    const source = opts.source ?? sourcePick();
    const q = quoteStay(room, checkIn, checkOut, ratePeriods);
    const past = checkOut <= today;
    const inHouse = checkIn <= today && checkOut > today;
    const leadDays = 4 + Math.floor(rng() * 55);
    let createdDay = addDays(checkIn, -leadDays);
    if (createdDay >= today) createdDay = addDays(today, -1 - Math.floor(rng() * 25));
    const createdAt = new Date(`${createdDay}T${String(8 + Math.floor(rng() * 12)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')}:00+01:00`).toISOString();
    const ota = source === 'booking' || source === 'expedia';
    const deposit = Math.round(q.total * 0.3 * 100) / 100;
    let amountPaid = past ? q.total : ota ? 0 : deposit;
    if (inHouse && !ota) amountPaid = deposit;
    const b: Booking = {
      id: `bk-${bookings.length + 1}`,
      code: code(),
      token: Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url'),
      roomId,
      guest: { firstName: first, lastName: last, email: `${ascii(first)}.${ascii(last)}@example.com`, phone: `+39 3${Math.floor(10 + rng() * 89)} 000 ${String(Math.floor(rng() * 9999)).padStart(4, '0')}`, country: COUNTRY[fi] },
      adults,
      children,
      childrenAges: Array.from({ length: children }, () => 2 + Math.floor(rng() * 10)),
      checkIn,
      checkOut,
      total: q.total,
      discount: 0,
      promoCode: null,
      amountPaid,
      status: 'confirmed',
      holdExpiresAt: null,
      source,
      otaRef: ota ? `${source === 'booking' ? 'BDC' : 'EXP'}-${Math.floor(1e8 + rng() * 9e8)}` : null,
      specialRequests: rng() < 0.2 ? pick(['Arrivo previsto dopo le 21', 'Culla per neonato', 'Camera tranquilla se possibile', 'Anniversario di matrimonio']) : '',
      notes: '',
      consents: { privacy: true, terms: true, marketing: rng() < 0.4 },
      createdAt,
      updatedAt: createdAt,
      cancelledAt: null,
      simulated: false,
      demo: true,
      ...opts,
    };
    bookings.push(b);
    if (roomId) (stays[roomId] ??= []).push({ from: checkIn, to: checkOut });
    if (b.status !== 'cancelled' && b.amountPaid > 0) {
      if (past && !ota) {
        payments.push({ id: `pay-${payments.length + 1}`, bookingId: b.id, amount: deposit, kind: 'deposit', provider: source === 'sito' ? 'simulazione' : 'bonifico', status: 'succeeded', reference: null, createdAt });
        payments.push({ id: `pay-${payments.length + 1}`, bookingId: b.id, amount: Math.round((q.total - deposit) * 100) / 100, kind: 'balance', provider: 'contanti', status: 'succeeded', reference: null, createdAt: `${checkOut}T09:30:00.000Z` });
      } else if (past && ota) {
        payments.push({ id: `pay-${payments.length + 1}`, bookingId: b.id, amount: q.total, kind: 'full', provider: 'ota', status: 'succeeded', reference: b.otaRef, createdAt: `${checkOut}T09:30:00.000Z` });
      } else {
        payments.push({ id: `pay-${payments.length + 1}`, bookingId: b.id, amount: b.amountPaid, kind: 'deposit', provider: source === 'sito' ? 'simulazione' : 'bonifico', status: 'succeeded', reference: null, createdAt });
      }
    }
    return b;
  };

  // A guaranteed "today" story for the demo
  addBooking('room-103', addDays(today, -3), today, { source: 'sito' });
  addBooking('room-110', addDays(today, -4), today, { source: 'booking' });
  addBooking('room-107', today, addDays(today, 4), { source: 'sito' });
  addBooking('room-105', today, addDays(today, 3), { source: 'telefono' });
  addBooking('room-111', addDays(today, -1), addDays(today, 3), { source: 'expedia' });

  // Random history and future occupancy (≈ 65% past, ≈ 45% future)
  const horizonStart = addDays(today, -95);
  const horizonEnd = addDays(today, 80);
  for (const room of rooms) {
    let d = addDays(horizonStart, Math.floor(rng() * 4));
    while (d < horizonEnd) {
      const past = d < today;
      d = addDays(d, Math.floor(rng() * (past ? 4 : 8)));
      const nights = 2 + Math.floor(rng() * 5);
      const end = addDays(d, nights);
      if (end > horizonEnd) break;
      if (!occupied(room.id, d, end)) {
        const cancelled = rng() < 0.06;
        addBooking(room.id, d, end, cancelled ? { status: 'cancelled', cancelledAt: nowIso, amountPaid: 0 } : {});
      }
      d = end;
    }
  }

  // Bookings that arrived "today" (dashboard: prenotazioni di oggi)
  const future = bookings.filter((b) => b.checkIn > addDays(today, 2) && b.status === 'confirmed').slice(0, 3);
  future.forEach((b, i) => {
    b.createdAt = new Date(now.getTime() - (i + 1) * 47 * 60000).toISOString();
    b.updatedAt = b.createdAt;
  });

  // Two pending payments (bank transfer awaited) — shown in gold in the planning
  bookings
    .filter((b) => b.checkIn > addDays(today, 9) && b.source === 'telefono' && b.status === 'confirmed')
    .slice(0, 2)
    .forEach((b) => {
      b.status = 'pending_payment';
      b.amountPaid = 0;
      b.notes = 'In attesa di bonifico';
      for (let i = payments.length - 1; i >= 0; i--) if (payments[i]!.bookingId === b.id) payments.splice(i, 1);
    });

  // One unassigned OTA booking ("Da assegnare")
  addBooking(null, addDays(today, 6), addDays(today, 9), { source: 'booking', adults: 2, children: 0, notes: 'Camera da assegnare' });

  bookings.sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  // ---------- users ----------
  const users: DB['users'] = [
    { id: 'u-admin', email: (process.env.DEMO_ADMIN_EMAIL || 'admin@lancora.demo').toLowerCase(), name: 'Proprietario', role: 'admin', passwordHash: hashPassword(process.env.DEMO_ADMIN_PASSWORD || 'Ancora-Demo-2026!'), createdAt: nowIso },
    { id: 'u-staff', email: (process.env.DEMO_STAFF_EMAIL || 'staff@lancora.demo').toLowerCase(), name: 'Reception', role: 'staff', passwordHash: hashPassword(process.env.DEMO_STAFF_PASSWORD || 'Reception-Demo-2026!'), createdAt: nowIso },
  ];

  // ---------- outbox: confirmation emails of the most recent bookings ----------
  const recent = [...bookings].filter((b) => b.status !== 'cancelled' && b.checkIn >= today).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
  const outbox: DB['outbox'] = recent.map((b, i) => {
    const r = renderEmail('conferma', { booking: b, room: b.roomId ? roomById(b.roomId) : null, settings });
    return { id: `em-${i + 1}`, to: b.guest.email, subject: r.subject, template: 'conferma', html: r.html, text: r.text, bookingId: b.id, status: 'demo_outbox', error: null, createdAt: b.createdAt, sentAt: null };
  });

  const arrivalsToday = bookings.filter((b) => b.checkIn === today && b.status !== 'cancelled').length;

  return {
    schemaVersion: 1,
    version: 1,
    seededAt: nowIso,
    updatedAt: nowIso,
    settings,
    users,
    rooms,
    bookings,
    blocks,
    ratePeriods,
    payments,
    outbox,
    notifications: [
      { id: 'n-1', type: 'nuovo_arrivo', title: `Arrivi di oggi: ${arrivalsToday}`, body: 'Controlla le camere prima delle 14:00.', href: '/admin/prenotazioni?filtro=arrivi', read: false, telegram: 'non_configurato', createdAt: nowIso },
      { id: 'n-2', type: 'nuova_prenotazione', title: 'Nuova prenotazione Booking.com da assegnare', body: 'Prenotazione OTA (dati demo) senza camera assegnata.', href: '/admin/prenotazioni?filtro=da_assegnare', read: false, telegram: 'non_configurato', createdAt: nowIso },
    ],
    audit: [{ id: 'a-1', at: nowIso, actor: 'Sistema', action: 'seed', entity: 'database', entityId: null, details: 'Dati dimostrativi generati' }],
    channel: {
      providerName: 'Da confermare con la struttura (PMS / channel manager in uso)',
      status: 'non_collegato',
      lastSync: null,
      importedCount: 0,
      log: [{ at: nowIso, level: 'info', message: 'Nessuna connessione reale configurata. Disponibile solo il simulatore.' }],
      mapping: [
        { externalCode: 'SGL', externalName: 'Single Room', roomIds: ['room-101'] },
        { externalCode: 'TWN', externalName: 'Twin Room', roomIds: ['room-102'] },
        { externalCode: 'DBL', externalName: 'Double Room', roomIds: ['room-103', 'room-104', 'room-109', 'room-112'] },
        { externalCode: 'DBL-SUP', externalName: 'Superior Double', roomIds: ['room-108'] },
        { externalCode: 'DBL-SEA', externalName: 'Double Room Sea View', roomIds: ['room-107'] },
        { externalCode: 'TRP', externalName: 'Triple Room', roomIds: ['room-105', 'room-110'] },
        { externalCode: 'FAM', externalName: 'Family Room', roomIds: ['room-106'] },
        { externalCode: 'JSU', externalName: 'Junior Suite', roomIds: ['room-111'] },
      ],
    },
    telegram: { linkedChats: [], linkCode: null, lastTestAt: null, lastError: null },
    pendingActions: [],
    promotions: [
      { id: 'pr-1', code: 'DIRETTO10', description: 'Vantaggio prenotazione diretta', percent: 10, validFrom: addDays(today, -30), validTo: addDays(today, 365), active: true, minNights: 2 },
      { id: 'pr-2', code: 'PRIMAVERA15', description: 'Promozione di primavera', percent: 15, validFrom: `${year + 1}-03-01`, validTo: `${year + 1}-05-31`, active: false, minNights: 3 },
    ],
    feedback: [
      { id: 'fb-1', bookingId: null, name: 'Giulia R.', rating: 5, comment: 'Camera luminosa e silenziosa, a due passi da Rena Bianca. Ci siamo sentiti a casa dal primo giorno.', lang: 'it', publishConsent: true, showOnSite: true, demo: true, createdAt: addDays(today, -20) },
      { id: 'fb-2', bookingId: null, name: 'Thomas M.', rating: 5, comment: 'Sehr freundliche Gastgeber, sauberes Zimmer und der perfekte Ausgangspunkt für Capo Testa.', lang: 'de', publishConsent: true, showOnSite: true, demo: true, createdAt: addDays(today, -34) },
      { id: 'fb-3', bookingId: null, name: 'Agnieszka K.', rating: 4, comment: 'Świetna lokalizacja i pomocna recepcja. Wieczorem cisza, rano kawa z widokiem na morze.', lang: 'pl', publishConsent: true, showOnSite: true, demo: true, createdAt: addDays(today, -41) },
      { id: 'fb-4', bookingId: null, name: 'Oliver T.', rating: 5, comment: 'Simple, spotless and genuinely warm hospitality. The ferry to Bonifacio was an easy day trip.', lang: 'en', publishConsent: true, showOnSite: true, demo: true, createdAt: addDays(today, -55) },
      { id: 'fb-5', bookingId: null, name: 'Paolo B.', rating: 3, comment: 'Posizione ottima, il condizionatore della camera faceva un po’ di rumore. Personale gentile.', lang: 'it', publishConsent: false, showOnSite: false, demo: true, createdAt: addDays(today, -12) },
      ...demoRoomReviews(rooms, today),
    ],
    messages: [
      { id: 'm-1', bookingId: null, name: 'Laura Conti', email: 'laura.conti@example.com', subject: 'Arrivo in traghetto', body: 'Buongiorno, arriveremo con il traghetto da Bonifacio verso le 19: è possibile fare il check-in? Grazie!', source: 'contatti', read: false, createdAt: nowIso },
    ],
    tasks: [
      { id: 't-1', label: 'Verificare climatizzatore camera 104', done: false, createdAt: nowIso },
      { id: 't-2', label: 'Ordinare nuovi teli mare', done: false, createdAt: nowIso },
    ],
    campaigns: [],
    unsubscribed: [],
    assistantLog: [],
  };
}
