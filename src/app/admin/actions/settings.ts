'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { mutate } from '@/server/db/store';
import { audit } from '@/server/events';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { issueSession } from '@/server/auth/login';
import { readDb } from '@/server/db/store';
import { rateLimit } from '@/server/security';

/** Prezzi → Tariffe e sconti: uso singola, trattamento. */
export async function savePricingAction(raw: unknown) {
  return act('prices.edit', (u) => {
    const md = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
    const p = z
      .object({
        singleUsePercent: z.number().min(0).max(60),
        board: z.enum(['room_only', 'breakfast']),
        touristTax: z.object({ enabled: z.boolean(), amount: z.number().min(0).max(20), from: md, to: md, maxNights: z.number().int().min(0).max(60) }).optional(),
      })
      .parse(raw);
    mutate((db) => {
      db.settings.pricing = { ...db.settings.pricing, ...p };
      const t = p.touristTax;
      audit(db, u.name, 'settings', 'pricing', null, `Uso singola −${p.singleUsePercent}% · ${p.board === 'room_only' ? 'solo pernottamento' : 'con colazione'}${t ? ` · tassa di soggiorno ${t.enabled ? `€ ${t.amount} a persona a notte dal ${t.from} al ${t.to}${t.maxNights ? `, max ${t.maxNights} notti` : ''}` : 'spenta'}` : ''}`);
    });
  }, 'Tariffe salvate: i prezzi del sito sono già aggiornati.');
}

export async function savePaymentsAction(raw: unknown) {
  return act('payments.manage', (u) => {
    const p = z
      .object({
        mode: z.enum(['full', 'deposit_percent', 'deposit_fixed']),
        depositPercent: z.number().min(1).max(100),
        depositFixed: z.number().min(1).max(10000),
        freeCancellationDays: z.number().int().min(0).max(90),
        cancellationPolicy: z.string().trim().max(800),
        cancellationFee: z.object({ type: z.enum(['percent', 'first_night', 'fixed']), value: z.number().min(0).max(10000) }).default({ type: 'percent', value: 100 }),
        refundPolicy: z.string().trim().min(10).max(800),
        holdMinutes: z.number().int().min(5).max(60),
        cashDiscountPercent: z.number().min(0).max(30),
        allowCashAtHotel: z.boolean(),
        allowOnline: z.boolean().default(true),
        cardGuarantee: z.boolean().default(false),
      })
      .refine((v) => v.allowOnline || v.allowCashAtHotel, 'Scegli almeno un modo di pagare.')
      .refine((v) => v.cancellationFee.type !== 'percent' || v.cancellationFee.value <= 100, 'La penale in percentuale non può superare il 100%.')
      .parse(raw);
    mutate((db) => {
      db.settings.payments = p;
      audit(db, u.name, 'settings', 'payments', null, `Modalità ${p.mode}`);
    });
  }, 'Condizioni di pagamento salvate.');
}

export async function saveHotelAction(raw: unknown) {
  return act('settings.edit', (u) => {
    const h = z
      .object({
        name: z.string().trim().min(2).max(80),
        addressLine: z.string().trim().max(120),
        postalCode: z.string().trim().max(10),
        city: z.string().trim().max(60),
        province: z.string().trim().max(4),
        addressVerified: z.boolean(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        phone: z.string().trim().max(30),
        whatsapp: z.string().trim().max(30).optional(),
        email: z.email(),
        vat: z.string().trim().max(20).optional(),
        cin: z.string().trim().max(40),
        checkInFrom: z.string().regex(/^\d{2}:\d{2}$/),
        checkInTo: z.string().regex(/^\d{2}:\d{2}$/),
        checkOutBy: z.string().regex(/^\d{2}:\d{2}$/),
        factsVerified: z.boolean(),
        googleReviewUrl: z.union([z.url().startsWith('https://'), z.literal('')]),
      })
      .parse(raw);
    mutate((db) => {
      db.settings.hotel = { ...db.settings.hotel, ...h };
      audit(db, u.name, 'settings', 'hotel', null, 'Dati struttura aggiornati');
    });
  }, 'Dati della struttura salvati: il sito è aggiornato.');
}

export async function saveFloorsAction(enableLower: boolean) {
  return act('settings.edit', (u) =>
    mutate((db) => {
      if (!enableLower && db.rooms.some((r) => r.floor === 'inferiore')) throw new UserError('Alcune camere sono al piano inferiore: spostale prima di disattivarlo.');
      db.settings.floors.enableLower = enableLower;
      audit(db, u.name, 'settings', 'floors', null, `Piano inferiore ${enableLower ? 'attivato' : 'disattivato'}`);
    }),
  'Impostazione piani salvata.');
}

export async function saveServicesAction(raw: unknown) {
  return act('settings.edit', (u) => {
    const s = z.array(z.object({ key: z.string().max(30), label: z.string().max(60), status: z.enum(['confermato', 'non_disponibile', 'da_confermare']), note: z.string().max(200) })).max(30).parse(raw);
    mutate((db) => {
      db.settings.services = s;
      audit(db, u.name, 'settings', 'services', null, 'Servizi aggiornati (usati anche dal chatbot)');
    });
  }, 'Servizi salvati: il chatbot userà queste informazioni.');
}

export async function saveFaqAction(raw: unknown) {
  return act('settings.edit', (u) => {
    const f = z.array(z.object({ id: z.string().max(40), question: z.string().trim().min(3).max(200), answer: z.string().trim().min(3).max(800), keywords: z.array(z.string().trim().min(2).max(40)).max(20) })).max(40).parse(raw);
    mutate((db) => {
      db.settings.faq = f;
      audit(db, u.name, 'settings', 'faq', null, `${f.length} FAQ`);
    });
  }, 'FAQ salvate.');
}

export async function saveNotificationTogglesAction(raw: unknown) {
  return act('automations.manage', (u) => {
    const t = z.record(z.string(), z.boolean()).parse(raw);
    mutate((db) => {
      for (const [k, v] of Object.entries(t)) if (k in db.settings.notifications) (db.settings.notifications as Record<string, boolean>)[k] = v;
      audit(db, u.name, 'settings', 'notifications', null, 'Preferenze notifiche aggiornate');
    });
  }, 'Preferenze notifiche salvate.');
}

export async function changePasswordAction(current: string, next: string) {
  return act('assistant.use', async (u) => {
    if (typeof next !== 'string' || next.length < 10) throw new UserError('La nuova password deve avere almeno 10 caratteri.');
    if (next.length > 200) throw new UserError('La nuova password è troppo lunga (massimo 200 caratteri).');
    if (!rateLimit(`password:${u.id}`, 6, 15 * 60_000)) throw new UserError('Troppi tentativi. Riprova tra 15 minuti.');
    const user = readDb().users.find((x) => x.id === u.id);
    if (!user || typeof current !== 'string' || !verifyPassword(current, user.passwordHash)) throw new UserError('Password attuale non corretta.');
    mutate((db) => {
      const x = db.users.find((y) => y.id === u.id)!;
      x.passwordHash = hashPassword(next);
      audit(db, u.name, 'password', 'user', u.id, 'Password cambiata (gli altri dispositivi sono stati disconnessi)');
    });
    // this browser stays logged in, every other one has to log in again
    const me = readDb().users.find((x) => x.id === u.id);
    if (me) await issueSession(me);
  }, 'Password aggiornata: gli altri dispositivi dovranno accedere di nuovo.');
}
