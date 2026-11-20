'use server';
import { z } from 'zod';
import { requireUser, can } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { fmtDate } from '@/lib/dates';
import { ospiti } from '@/lib/utils';

export type SearchHit = { group: 'Prenotazioni' | 'Ospiti' | 'Camere' | 'Messaggi' | 'Pagine'; title: string; sub: string; href: string };

/** Panel sections, found also by the words the owner would use. */
const PAGES: { title: string; href: string; words: string; perm?: Parameters<typeof can>[1] }[] = [
  { title: 'Oggi', href: '/admin', words: 'oggi panoramica dashboard giornata arrivi partenze home' },
  { title: 'Planning camere', href: '/admin/disponibilita', words: 'planning calendario disponibilità occupazione blocca camera' },
  { title: 'Prenotazioni', href: '/admin/prenotazioni', words: 'prenotazioni nuova prenotazione no-show cancellazione' },
  { title: 'Nuova prenotazione', href: '/admin/prenotazioni?nuova=1', words: 'nuova prenotazione telefono walk-in aggiungi' },
  { title: 'Camere', href: '/admin/camere', words: 'camere stanze foto letti' },
  { title: 'Aggiungi camera', href: '/admin/camere/nuova', words: 'aggiungi nuova camera' },
  { title: 'Prezzi', href: '/admin/prezzi', words: 'prezzi tariffe stagione offerte uso singola', perm: 'prices.edit' },
  { title: 'Tassa di soggiorno', href: '/admin/prezzi?tab=tassa', words: 'tassa soggiorno imposta comune turisti contanti', perm: 'prices.edit' },
  { title: 'Supplementi', href: '/admin/prezzi?tab=supplementi', words: 'supplementi extra teli asciugamani colazione culla parcheggio ombrellone', perm: 'prices.edit' },
  { title: 'Clienti', href: '/admin/clienti', words: 'clienti ospiti rubrica email telefono' },
  { title: 'Pagamenti', href: '/admin/pagamenti', words: 'pagamenti incassi stripe carta contanti rimborsi bonifico penale cancellazione', perm: 'payments.manage' },
  { title: 'Messaggi', href: '/admin/messaggi', words: 'messaggi email outbox modelli' },
  { title: 'Posta', href: '/admin/posta', words: 'posta email casella gmail inbox arrivate inviate rispondi' },
  { title: 'Statistiche', href: '/admin/statistiche', words: 'statistiche report grafici occupazione ricavi stampa', perm: 'stats.view' },
  { title: 'Recensioni e marketing', href: '/admin/marketing', words: 'recensioni marketing campagne promozioni codici sconto', perm: 'marketing.manage' },
  { title: 'Automazioni', href: '/admin/automazioni', words: 'automazioni telegram booking airbnb expedia portali calendario report orari', perm: 'automations.manage' },
  { title: 'Assistente', href: '/admin/assistente', words: 'assistente ai intelligenza artificiale chat voce' },
  { title: 'Impostazioni', href: '/admin/impostazioni', words: 'impostazioni dati hotel password accessi utenti faq servizi', perm: 'settings.edit' },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** One box for everything: bookings, guests, rooms, messages and the panel's pages. Reads only. */
export async function panelSearchAction(query: string): Promise<SearchHit[]> {
  const u = await requireUser().catch(() => null);
  if (!u) return [];
  const q = norm(z.string().max(80).parse(query).trim());
  if (q.length < 2) return [];
  const db = readDb();
  const hits: SearchHit[] = [];
  const has = (...xs: (string | null | undefined)[]) => xs.some((x) => x && norm(x).includes(q));

  hits.push(...PAGES.filter((p) => (!p.perm || can(u.role, p.perm)) && has(p.title, p.words)).slice(0, 4).map((p) => ({ group: 'Pagine' as const, title: p.title, sub: 'Vai alla sezione', href: p.href })));

  const bookings = [...db.bookings]
    .filter((b) => has(b.code, b.otaRef, `${b.guest.firstName} ${b.guest.lastName}`, b.guest.email, b.guest.phone))
    .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
    .slice(0, 6);
  for (const b of bookings) {
    const room = db.rooms.find((r) => r.id === b.roomId);
    hits.push({ group: 'Prenotazioni', title: `${b.guest.firstName} ${b.guest.lastName}`.trim() || b.code, sub: `${b.code} · ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)}${room ? ` · camera ${room.number}` : ''}${b.status === 'cancelled' ? ' · annullata' : ''}`, href: `/admin/prenotazioni?id=${b.id}` });
  }

  const seen = new Set<string>();
  // a guest opens on their latest booking (the guest card is one click from there)
  for (const b of [...db.bookings].sort((x, y) => y.createdAt.localeCompare(x.createdAt))) {
    const e = b.guest.email.trim().toLowerCase();
    if (!e || seen.has(e) || !has(b.guest.email, `${b.guest.firstName} ${b.guest.lastName}`, b.guest.phone)) continue;
    seen.add(e);
    const visits = db.bookings.filter((x) => x.guest.email.trim().toLowerCase() === e).length;
    hits.push({ group: 'Ospiti', title: `${b.guest.firstName} ${b.guest.lastName}`.trim(), sub: [b.guest.email, b.guest.phone, `${visits} ${visits === 1 ? 'prenotazione' : 'prenotazioni'}`].filter(Boolean).join(' · '), href: `/admin/prenotazioni?id=${b.id}` });
    if (seen.size >= 4) break;
  }

  for (const r of db.rooms.filter((r) => has(r.number, r.name, r.text.title)).slice(0, 4)) {
    hits.push({ group: 'Camere', title: `${r.number} · ${r.name}`, sub: `${ospiti(r.maxGuests)} · € ${r.basePrice} a notte${r.hidden ? ' · nascosta' : ''}`, href: `/admin/camere/${r.id}` });
  }

  for (const m of db.messages.filter((m) => (m.sender ?? 'guest') === 'guest' && has(m.name, m.email, m.subject, m.body)).slice(0, 4)) {
    hits.push({ group: 'Messaggi', title: m.subject, sub: `${m.name} · ${m.body.slice(0, 70)}`, href: m.bookingId ? `/admin/prenotazioni?id=${m.bookingId}` : '/admin/messaggi' });
  }
  return hits.slice(0, 18);
}
