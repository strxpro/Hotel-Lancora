import 'server-only';
import type { Booking, DB } from '@/lib/types';
import { addDays, diffDays, fmtDate, todayISO } from '@/lib/dates';
import { arrivalsOn, departuresOn, freeRoomsOn, inHouseOn } from './stats';
import { abandonedLeads } from './bookings';
import { visitsOn } from './visits';
import { getProvider, parseJsonLoose } from './ai/provider';
import { notti, ospiti } from '@/lib/utils';

/**
 * The owner's evening report on Telegram: how the day went, what to improve, what comes next.
 * Built from the hotel's own data; the AI only writes it in good Italian and must not invent.
 * On a quiet day it does not say "nobody came": it talks about the coming days instead.
 */
const romeDay = (iso: string) => todayISO(new Date(iso));
const abandoned = (b: Booking) => b.status === 'cancelled' && b.holdExpiresAt !== null && b.amountPaid === 0;
const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const name = (b: Booking) => `${b.guest.firstName} ${b.guest.lastName}`.trim();
const SOURCE: Record<Booking['source'], string> = { sito: 'sito', telefono: 'telefono', email: 'email', walkin: 'di persona', booking: 'Booking.com', expedia: 'Expedia', altro_ota: 'altro portale' };

export function dayFacts(db: DB, date: string) {
  const roomNo = (b: Booking) => db.rooms.find((r) => r.id === b.roomId)?.number ?? 'da assegnare';
  const sellable = db.rooms.filter((r) => r.status === 'available').length;
  const created = db.bookings.filter((b) => romeDay(b.createdAt) === date && !b.simulated);
  const fresh = created.filter((b) => !abandoned(b) && b.status !== 'pending_payment');
  // a guest who left a booking half way and then booked again is not a lost customer
  const left = abandonedLeads(db.bookings, created.filter(abandoned));
  const cancelled = db.bookings.filter((b) => b.cancelledAt && romeDay(b.cancelledAt) === date && !abandoned(b));
  const paid = db.payments.filter((p) => p.status === 'succeeded' && romeDay(p.createdAt) === date && p.kind !== 'refund').reduce((s, p) => s + p.amount, 0);
  const tonight = inHouseOn(db, date);
  const tomorrow = addDays(date, 1);
  const week = Array.from({ length: 7 }, (_, i) => addDays(date, i + 1)).map((d) => ({ date: d, label: fmtDate(d, 'it', { weekday: 'short', day: 'numeric', month: 'short' }), free: freeRoomsOn(db, d).length }));
  const visits = visitsOn(date);
  const feedback = db.feedback.filter((f) => romeDay(f.createdAt) === date && !f.demo);
  return {
    date,
    dateLabel: fmtDate(date, 'it', { weekday: 'long', day: 'numeric', month: 'long' }),
    rooms: sellable,
    site: { visitors: visits.visitors, pageViews: visits.views, bookingPageViews: visits.bookingViews, roomPageViews: visits.roomViews },
    newBookings: fresh.map((b) => ({ code: b.code, guest: name(b), room: roomNo(b), from: b.checkIn, nights: diffDays(b.checkIn, b.checkOut), total: b.total, channel: SOURCE[b.source] })),
    unfinishedCheckouts: left.map((b) => ({ guest: name(b), email: b.guest.email, phone: b.guest.phone, from: b.checkIn, nights: diffDays(b.checkIn, b.checkOut), total: b.total })),
    cancellations: cancelled.map((b) => ({ code: b.code, guest: name(b), from: b.checkIn })),
    moneyIn: Math.round(paid * 100) / 100,
    tonight: { rooms: new Set(tonight.map((b) => b.roomId)).size, guests: tonight.reduce((s, b) => s + b.adults + b.children, 0), occupancy: sellable ? Math.round((new Set(tonight.map((b) => b.roomId)).size / sellable) * 100) : 0 },
    tomorrow: {
      arrivals: arrivalsOn(db, tomorrow).map((b) => ({ guest: name(b), room: roomNo(b), guests: b.adults + b.children, toPay: Math.max(0, Math.round((b.total - b.amountPaid) * 100) / 100) })),
      departures: departuresOn(db, tomorrow).map((b) => ({ guest: name(b), room: roomNo(b) })),
      toCollect: Math.round(arrivalsOn(db, tomorrow).reduce((s, b) => s + Math.max(0, b.total - b.amountPaid), 0) * 100) / 100,
    },
    nextNights: week,
    unreadMessages: db.messages.filter((m) => !m.read).length,
    newReviews: feedback.map((f) => ({ rating: f.rating, comment: f.comment.slice(0, 140) })),
    openTasks: db.tasks.filter((t) => !t.done).slice(0, 5).map((t) => t.label),
    unassigned: db.bookings.filter((b) => !b.roomId && b.status === 'confirmed' && b.checkOut > date).length,
  };
}
export type DayFacts = ReturnType<typeof dayFacts>;

/** True when nothing happened that is worth a line (no visits, no bookings, no money, no messages). */
export const quietDay = (f: DayFacts) => !f.site.visitors && !f.newBookings.length && !f.unfinishedCheckouts.length && !f.cancellations.length && !f.moneyIn && !f.newReviews.length;

/** The true lines of the report, in three parts (also what the AI has to mention). */
export function reportLines(f: DayFacts): { how: string[]; fix: string[]; next: string[] } {
  const how: string[] = [];
  if (f.site.visitors) how.push(`• ${f.site.visitors} persone sul sito${f.site.bookingPageViews ? `, ${f.site.bookingPageViews} volte sulla pagina di prenotazione` : ''}.`);
  if (f.newBookings.length) how.push(`• ${f.newBookings.length === 1 ? 'Una nuova prenotazione' : `${f.newBookings.length} nuove prenotazioni`}: ${f.newBookings.map((b) => `${b.guest} (${notti(b.nights)}, ${eur(b.total)}, ${b.channel})`).join('; ')}.`);
  if (f.moneyIn) how.push(`• Incassati ${eur(f.moneyIn)}.`);
  if (f.cancellations.length) how.push(`• Cancellazioni: ${f.cancellations.map((c) => c.guest).join(', ')}.`);
  if (f.newReviews.length) how.push(`• Nuove opinioni: ${f.newReviews.map((r) => `${r.rating}★`).join(', ')}.`);
  how.push(f.tonight.rooms ? `• Stasera ${f.tonight.rooms} camere occupate su ${f.rooms} (${f.tonight.occupancy}%), ${ospiti(f.tonight.guests)}.` : `• Stasera l’hotel è libero: buon momento per sistemare camere e foto.`);

  const fix: string[] = [];
  if (f.unfinishedCheckouts.length) fix.push(`• ${f.unfinishedCheckouts.length === 1 ? 'Una prenotazione lasciata' : `${f.unfinishedCheckouts.length} prenotazioni lasciate`} a metà: ${f.unfinishedCheckouts.map((u) => `${u.guest} (${u.email}${u.phone ? `, ${u.phone}` : ''})`).join('; ')}. Una telefonata spesso la recupera.`);
  if (f.unreadMessages) fix.push(`• ${f.unreadMessages} messaggi di ospiti da leggere.`);
  if (f.unassigned) fix.push(`• ${f.unassigned} prenotazioni senza camera assegnata.`);
  const empty = f.nextNights.filter((n) => n.free >= Math.max(2, Math.ceil(f.rooms / 2)));
  if (empty.length) fix.push(`• Notti ancora molto libere: ${empty.slice(0, 3).map((n) => `${n.label} (${n.free} camere)`).join(', ')}. Un piccolo sconto diretto può riempirle.`);
  if (!fix.length) fix.push('• Tutto in ordine: nessuna urgenza.');

  const next: string[] = [];
  if (f.tomorrow.arrivals.length) next.push(`• Domani arrivano: ${f.tomorrow.arrivals.map((a) => `${a.guest} (camera ${a.room}${a.toPay ? `, da saldare ${eur(a.toPay)}` : ''})`).join('; ')}${f.tomorrow.arrivals.length > 1 && f.tomorrow.toCollect ? `; in tutto ${eur(f.tomorrow.toCollect)} da incassare` : ''}.`);
  if (f.tomorrow.departures.length) next.push(`• Domani partono: ${f.tomorrow.departures.map((d) => `${d.guest} (camera ${d.room})`).join('; ')}.`);
  if (f.openTasks.length) next.push(`• Da fare: ${f.openTasks.join('; ')}.`);
  if (!next.length) next.push('• Nessun arrivo né partenza domani.');
  return { how, fix, next };
}

/** Plain version, used when no AI is connected (or it fails): same three parts, only true lines. */
export function templateReport(f: DayFacts): { title: string; text: string } {
  const { how, fix, next } = reportLines(f);
  return { title: `Report di oggi · ${fmtDate(f.date, 'it', { weekday: 'short', day: 'numeric', month: 'short' })}`, text: [`Com’è andata\n${how.join('\n')}`, `Da migliorare\n${fix.join('\n')}`, `Prossimi giorni\n${next.join('\n')}`].join('\n\n') };
}

export async function composeReport(f: DayFacts): Promise<{ title: string; text: string; ai: boolean }> {
  const fallback = templateReport(f);
  const lines = reportLines(f);
  const provider = getProvider();
  if (!provider) return { ...fallback, ai: false };
  try {
    const raw = await provider.complete(
      [
        {
          role: 'system',
          content: [
            'Sei l’assistente del proprietario di Hotel L’Ancora, piccolo hotel 3 stelle a Santa Teresa Gallura (Sardegna).',
            'Scrivi il report serale della giornata che il proprietario legge su Telegram: italiano semplice, caldo ma concreto, al massimo 14 righe brevi.',
            'Tre parti con queste intestazioni esatte, ognuna su una riga da sola: "Com’è andata", "Da migliorare", "Prossimi giorni". Sotto ogni intestazione righe che iniziano con "• ".',
            'Ricevi "mustMention": le righe del report già vere e già calcolate. OGNUNA deve comparire nella sua parte (puoi riscriverla in modo più naturale, ma senza cambiare nomi, numeri e importi, senza togliere persone e senza fare nuovi calcoli). "facts" serve solo come contesto. Non inventare nulla. Le cifre in euro con la virgola (es. 138,00 €).',
            'Se nella giornata non è successo quasi nulla (nessuna visita, nessuna prenotazione, nessun incasso), NON dirlo e non scrivere frasi tipo "nessuno ha visitato il sito" o "zero prenotazioni": in "Com’è andata" parla di com’è l’hotel stasera e dei giorni che arrivano, con un’idea utile.',
            '"Da migliorare": 1-3 consigli pratici legati ai dati (prenotazioni lasciate a metà da ricontattare con i loro recapiti, messaggi non letti, notti vuote da riempire con un’offerta diretta, prenotazioni senza camera). Se non c’è nulla, una sola riga rassicurante.',
            '"Prossimi giorni": arrivi e partenze di domani con le camere, saldo da incassare se c’è, cose da fare.',
            'Niente markdown, niente asterischi o grassetti. Rispondi solo JSON {"title": "...", "text": "..."}; il titolo massimo 60 caratteri, del tipo "Report di oggi · gio 12 nov".',
          ].join(' '),
        },
        { role: 'user', content: JSON.stringify({ mustMention: { 'Com’è andata': lines.how, 'Da migliorare': lines.fix, 'Prossimi giorni': lines.next }, facts: f }) },
      ],
      { json: true, temperature: 0.4, maxTokens: 900 },
    );
    const j = parseJsonLoose<{ title?: unknown; text?: unknown }>(raw);
    const text = typeof j?.text === 'string' ? j.text.replace(/\*\*?|__/g, '').trim() : '';
    const title = typeof j?.title === 'string' ? j.title.trim().slice(0, 70) : '';
    if (text.length > 40 && /Com.è andata/i.test(text)) return { title: title || fallback.title, text: text.slice(0, 3500), ai: true };
  } catch (e) {
    console.error('[report]', (e as Error).message);
  }
  return { ...fallback, ai: false };
}
