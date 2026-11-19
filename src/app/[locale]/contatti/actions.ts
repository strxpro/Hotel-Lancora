'use server';
import { z } from 'zod';
import { headers } from 'next/headers';
import { mutate, newId } from '@/server/db/store';
import { notify, queueEmail } from '@/server/events';
import { clean, ipOf, rateLimit } from '@/server/security';

const Contact = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(120),
  subject: z.string().trim().max(120),
  message: z.string().trim().min(5).max(2000),
  website: z.string().max(0), // honeypot
});

export async function sendContact(raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const h = await headers();
  const ip = ipOf(h);
  if (!rateLimit(`contact:${ip}`, 4, 15 * 60_000)) return { ok: false, error: 'Troppi messaggi. Riprova più tardi.' };
  const p = Contact.safeParse(raw);
  if (!p.success) return { ok: false, error: 'Controlla i campi del modulo.' };
  mutate((db) => {
    const m = { id: newId('m-'), bookingId: null, name: clean(p.data.name, 80), email: p.data.email.toLowerCase(), subject: clean(p.data.subject, 120) || 'Richiesta dal sito', body: clean(p.data.message, 2000), source: 'contatti' as const, read: false, createdAt: new Date().toISOString() };
    db.messages.unshift(m);
    notify(db, 'messaggio_ospite', `Nuovo messaggio da ${m.name}`, `${m.subject}: ${m.body.slice(0, 140)}`, '/admin/messaggi');
    queueEmail(db, 'richiesta_ospite', db.settings.hotel.email, { booking: null, room: null, extra: { message: `${m.name} <${m.email}>\n${m.subject}\n\n${m.body}` } });
  });
  return { ok: true };
}
