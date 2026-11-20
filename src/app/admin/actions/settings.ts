'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { mutate } from '@/server/db/store';
import { audit } from '@/server/events';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { issueSession } from '@/server/auth/login';
import { readDb } from '@/server/db/store';
import { rateLimit } from '@/server/security';
import { EXTRA_PRESETS } from '@/lib/extras';

/** Prezzi → Tariffe e sconti: uso singola, trattamento. */
export async function savePricingAction(raw: unknown) {
  return act('prices.edit', (u) => {
    const md = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
    const p = z
      .object({
        singleUsePercent: z.number().min(0).max(60),
        board: z.enum(['room_only', 'breakfast']),
        touristTax: z.object({ enabled: z.boolean(), amount: z.number().min(0).max(20), from: md, to: md, maxNights: z.number().int().min(0).max(60), cash: z.boolean().optional() }).optional(),
        onlineMarkup: z.object({ enabled: z.boolean(), percent: z.number().min(0).max(20) }).optional(),
      })
      .parse(raw);
    mutate((db) => {
      db.settings.pricing = { ...db.settings.pricing, ...p };
      const t = p.touristTax;
      const m = p.onlineMarkup;
      audit(db, u.name, 'settings', 'pricing', null, `Uso singola −${p.singleUsePercent}% · ${p.board === 'room_only' ? 'solo pernottamento' : 'con colazione'}${t ? ` · tassa di soggiorno ${t.enabled ? `€ ${t.amount} a persona a notte dal ${t.from} al ${t.to}${t.maxNights ? `, max ${t.maxNights} notti` : ''}` : 'spenta'}` : ''}${m ? ` · prezzi online ${m.enabled && m.percent > 0 ? `+${m.percent}%` : 'senza aumento'}` : ''}`);
    });
  }, 'Tariffe salvate: i prezzi del sito sono già aggiornati.');
}

const ExtraSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.partialRecord(z.enum(['it', 'en', 'pl', 'de', 'fr', 'es']), z.string().trim().max(80)),
  price: z.number().min(0).max(1000),
  unit: z.enum(['stay', 'night', 'person', 'person_night']),
  enabled: z.boolean(),
  preset: z.boolean().optional(),
});

/** Prezzi → Supplementi: the extras guests can add (paid at the hotel). Saved by itself as the owner changes them. */
export async function saveExtrasAction(raw: unknown) {
  return act('prices.edit', (u) => {
    const list = z.array(ExtraSchema).max(24).parse(raw);
    if (new Set(list.map((e) => e.id)).size !== list.length) throw new UserError('Due supplementi hanno lo stesso codice: ricarica la pagina e riprova.');
    if (list.some((e) => e.enabled && !(e.name.it ?? '').trim())) throw new UserError('Ogni supplemento acceso ha bisogno di un nome.');
    // a renamed suggestion keeps only the Italian name (the built-in translations were for the old name)
    const clean = list.map((e) => {
      const p = EXTRA_PRESETS.find((x) => x.id === e.id);
      return p && e.preset && p.name.it !== e.name.it ? { ...e, name: { it: e.name.it }, preset: false } : e;
    });
    mutate((db) => {
      db.settings.pricing = { singleUsePercent: 20, board: 'room_only', ...db.settings.pricing, extras: clean };
      const on = clean.filter((e) => e.enabled);
      audit(db, u.name, 'settings', 'pricing', null, on.length ? `Supplementi sul sito: ${on.map((e) => `${e.name.it} € ${e.price}`).join(', ')}` : 'Supplementi: nessuno sul sito');
    });
  }, 'Salvato.');
}

/** Prezzi → Cancellazione: the free days and what a late cancellation costs (saved by themselves). */
export async function saveCancellationAction(raw: unknown) {
  return act('prices.edit', (u) => {
    const c = z
      .object({
        freeCancellationDays: z.number().int().min(0).max(90),
        cancellationFee: z.object({ type: z.enum(['percent', 'first_night', 'fixed']), value: z.number().min(0).max(10000) }),
      })
      .refine((v) => v.cancellationFee.type !== 'percent' || v.cancellationFee.value <= 100, 'La penale in percentuale non può superare il 100%.')
      .parse(raw);
    mutate((db) => {
      db.settings.payments = { ...db.settings.payments, ...c };
      const f = c.cancellationFee;
      audit(db, u.name, 'settings', 'payments', null, `Cancellazione gratuita fino a ${c.freeCancellationDays} giorni prima · poi ${f.type === 'percent' ? `${f.value}% del soggiorno` : f.type === 'first_night' ? 'la prima notte' : `€ ${f.value}`}`);
    });
  }, 'Salvato.');
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

const PlacePhoto = z.object({ id: z.string().max(80), src: z.string().trim().min(1).max(800), alt: z.string().max(200), width: z.number().min(0).max(20000), height: z.number().min(0).max(20000), demo: z.boolean(), credit: z.string().max(160).optional() });
const LangText = (max: number) => z.partialRecord(z.enum(['it', 'en', 'pl', 'de', 'fr', 'es']), z.string().max(max));
const Place = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: z.string().trim().min(1, 'Ogni luogo ha bisogno di un nome.').max(80),
  kind: LangText(60),
  text: LangText(1500),
  time: LangText(80),
  distance: z.string().trim().max(30),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  beach: z.boolean(),
  photos: z.array(PlacePhoto).max(12),
  hidden: z.boolean().optional(),
  custom: z.boolean().optional(),
});

/** Impostazioni → Spiagge e dintorni: photos, names and texts of the places shown on the site. */
export async function savePlacesAction(raw: unknown) {
  return act('settings.edit', async (u) => {
    const list = z.array(Place).max(30).parse(raw);
    if (new Set(list.map((p) => p.id)).size !== list.length) throw new UserError('Due luoghi hanno lo stesso codice: ricarica la pagina e riprova.');
    const { placeList, translatePlacesLater } = await import('@/server/places');
    const before = new Map(placeList(readDb()).map((p) => [p.id, p]));
    const changed: string[] = [];
    for (const p of list) {
      const b = before.get(p.id);
      // the Italian changed: the old translations no longer match it (Italian shows until the new ones are ready)
      for (const f of ['kind', 'text', 'time'] as const) {
        if (!b || (b[f].it ?? '') !== (p[f].it ?? '')) {
          p[f] = { it: p[f].it ?? '' };
          if (!changed.includes(p.id)) changed.push(p.id);
        }
      }
    }
    mutate((db) => {
      db.settings.places = list;
      audit(db, u.name, 'update', 'settings', null, `Spiagge e dintorni: ${list.filter((p) => !p.hidden).length} luoghi sul sito`);
    });
    translatePlacesLater(changed);
  }, 'Salvato: il sito mostra già i luoghi aggiornati.');
}

/** Impostazioni → Spiagge e dintorni → the photos of the home section “A 300 metri dal mare” (saved by themselves). */
export async function saveIntroPhotosAction(raw: unknown) {
  return act('settings.edit', (u) => {
    const list = z.array(PlacePhoto).max(12).parse(raw);
    mutate((db) => {
      if (list.length) db.settings.hotel.introPhotos = list;
      else delete db.settings.hotel.introPhotos;
      audit(db, u.name, 'update', 'settings', null, list.length ? `Foto della sezione “300 metri dal mare”: ${list.length}` : 'Foto della sezione “300 metri dal mare”: tornata quella originale');
    });
  }, 'Salvato.');
}

/** Back to the site's original places (photos and texts). */
export async function resetPlacesAction() {
  return act('settings.edit', (u) => {
    mutate((db) => {
      delete db.settings.places;
      audit(db, u.name, 'update', 'settings', null, 'Spiagge e dintorni: tornati i luoghi originali');
    });
  }, 'Fatto: tornati i luoghi originali.');
}

/** Impostazioni → Arrivo e partenza: only the three hours (saved by themselves as the owner changes them). */
export async function saveStayTimesAction(raw: unknown) {
  return act('settings.edit', (u) => {
    const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Orario non valido');
    const t = z.object({ checkInFrom: hhmm, checkInTo: hhmm, checkOutBy: hhmm }).parse(raw);
    if (t.checkInTo <= t.checkInFrom) throw new UserError('L’orario di fine check-in deve venire dopo quello di inizio.');
    mutate((db) => {
      Object.assign(db.settings.hotel, t);
      audit(db, u.name, 'update', 'settings', null, `Check-in ${t.checkInFrom}–${t.checkInTo}, check-out entro ${t.checkOutBy}`);
    });
  });
}

/** Impostazioni → Arrivo e partenza → Da sapere: the house rules (saved by themselves). Pets also set the "Animali" service the chatbot reads. */
export async function saveHouseRulesAction(raw: unknown) {
  return act('settings.edit', (u) => {
    const r = z
      .object({
        pets: z.enum(['no', 'yes', 'request']),
        smoking: z.enum(['no', 'outside']),
        parties: z.enum(['no', 'yes']),
        children: z.enum(['yes', 'no']),
        quietFrom: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal('')]),
        note: z.string().trim().max(300),
      })
      .parse(raw);
    mutate((db) => {
      db.settings.hotel.rules = r;
      const svc = db.settings.services.find((x) => x.key === 'animali');
      if (svc) Object.assign(svc, { status: r.pets === 'no' ? 'non_disponibile' : 'confermato', note: r.pets === 'request' ? 'su richiesta' : '' });
      audit(db, u.name, 'update', 'settings', null, `Da sapere: animali ${r.pets === 'no' ? 'non ammessi' : r.pets === 'yes' ? 'ammessi' : 'su richiesta'}, fumo ${r.smoking === 'no' ? 'vietato ovunque' : 'solo fuori'}, feste ${r.parties === 'no' ? 'no' : 'su richiesta'}, bambini ${r.children === 'yes' ? 'sì' : 'no'}`);
    });
  });
}
