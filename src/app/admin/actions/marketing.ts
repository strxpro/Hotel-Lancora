'use server';
import { generateImage } from '@/server/ai/images';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { mutate, newId, readDb } from '@/server/db/store';
import { audit, queueEmail, smtpConfigured } from '@/server/events';
import { campaignRecipients, queueCampaign, renderCampaign } from '@/server/email/campaign';
import { draftFromWords, sendCampaign, themesFromWords } from '@/server/email/compose';
import { addReply, sendReviewRequests, translateReviewLater } from '@/server/reviews';
import type { Campaign } from '@/lib/types';
import { isValidISODate } from '@/lib/dates';

export async function savePromotion(raw: unknown) {
  return act('marketing.manage', (u) => {
    const p = z
      .object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/), description: z.string().trim().max(120), percent: z.number().min(1).max(60), validFrom: z.string(), validTo: z.string(), minNights: z.number().int().min(1).max(30), active: z.boolean() })
      .parse(raw);
    // a code with an empty or impossible date would never apply (and is saved without dates in the database)
    if (!isValidISODate(p.validFrom) || !isValidISODate(p.validTo)) throw new UserError('Scegli le date di inizio e di fine del codice.');
    if (p.validTo < p.validFrom) throw new UserError('La data di fine deve venire dopo quella di inizio.');
    mutate((db) => {
      if (db.promotions.some((x) => x.code === p.code)) throw new UserError('Codice già esistente.');
      db.promotions.unshift({ id: newId('pr-'), ...p });
      audit(db, u.name, 'promo_create', 'marketing', null, `${p.code} −${p.percent}%`);
    });
  }, 'Codice promozionale creato: utilizzabile subito nella prenotazione diretta.');
}

export async function togglePromotion(id: string) {
  return act('marketing.manage', () =>
    mutate((db) => {
      const p = db.promotions.find((x) => x.id === id);
      if (p) p.active = !p.active;
    }),
  );
}

export async function deletePromotion(id: string) {
  return act('marketing.manage', () => mutate((db) => void (db.promotions = db.promotions.filter((x) => x.id !== id))));
}

export async function toggleFeedbackOnSite(id: string) {
  return act('marketing.manage', (u) =>
    mutate((db) => {
      const f = db.feedback.find((x) => x.id === id);
      if (!f) throw new UserError('Recensione non trovata.');
      if (!f.publishConsent && !f.showOnSite) throw new UserError('L’ospite non ha dato il consenso alla pubblicazione.');
      f.showOnSite = !f.showOnSite;
      audit(db, u.name, 'feedback_publish', 'marketing', id, f.showOnSite ? 'pubblicata' : 'ritirata');
    }),
  );
}

/** Thank-you + private feedback link + public Google review link for EVERY guest (no rating gate). */
export async function sendThankYou(bookingId: string) {
  return act('marketing.manage', (u) =>
    mutate((db) => {
      const b = db.bookings.find((x) => x.id === bookingId);
      if (!b) throw new UserError('Prenotazione non trovata.');
      queueEmail(db, 'ringraziamento', b.guest.email, { booking: b, room: db.rooms.find((r) => r.id === b.roomId) ?? null, extra: { reviewUrl: db.settings.hotel.googleReviewUrl || undefined } });
      audit(db, u.name, 'thank_you', 'booking', b.id, 'Ringraziamento inviato');
    }),
  'Ringraziamento creato in Outbox.');
}

export async function sendReturnOffer(bookingId: string, promoCode: string) {
  return act('marketing.manage', (u) =>
    mutate((db) => {
      const b = db.bookings.find((x) => x.id === bookingId);
      if (!b) throw new UserError('Prenotazione non trovata.');
      if (!b.consents.marketing) throw new UserError('Questo ospite non ha dato il consenso alle comunicazioni promozionali.');
      queueEmail(db, 'offerta_ritorno', b.guest.email, { booking: b, room: null, extra: { promoCode } });
      audit(db, u.name, 'return_offer', 'booking', b.id, promoCode);
    }),
  'Offerta di ritorno creata in Outbox.');
}


/* ---------------- email campaigns ---------------- */
const ThemeSchema = z
  .object({
    id: z.string().max(60),
    name: z.string().max(40),
    layout: z.enum(['classic', 'hero', 'minimal', 'postcard']),
    bg: z.string().regex(/^#[0-9a-f]{6}$/i),
    card: z.string().regex(/^#[0-9a-f]{6}$/i),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    ink: z.string().regex(/^#[0-9a-f]{6}$/i),
    headerBg: z.string().regex(/^#[0-9a-f]{6}$/i),
    headerInk: z.string().regex(/^#[0-9a-f]{6}$/i),
    font: z.enum(['serif', 'sans']),
    radius: z.number().min(0).max(36),
  })
  .optional();

const CampaignSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(80),
  subject: z.string().trim().min(3).max(120),
  headline: z.string().trim().min(3).max(140),
  body: z.string().trim().min(10).max(4000),
  ctaLabel: z.string().trim().max(40),
  ctaUrl: z.union([z.literal(''), z.string().trim().regex(/^(https:\/\/|\/)[^\s]*$/, 'Link: inizia con https:// oppure /')]),
  image: z.union([z.literal(''), z.string().trim().regex(/^(https:\/\/|\/)[^\s]*$/)]),
  audience: z.enum(['consent_all', 'past_guests', 'future_guests']),
  selected: z.array(z.email()).max(2000).optional(),
  langs: z.array(z.enum(['it', 'en', 'pl', 'de', 'fr', 'es'])).max(6).optional(),
  translate: z.boolean().optional(),
  personal: z.boolean().optional(),
  theme: ThemeSchema,
});

export async function saveCampaignAction(raw: unknown) {
  return act('marketing.manage', (u) => {
    const c = CampaignSchema.parse(raw);
    return mutate((db) => {
      const prev = c.id ? db.campaigns.find((x) => x.id === c.id) : undefined;
      if (prev && prev.status === 'sent') throw new UserError('Campagna già inviata: duplicala per modificarla.');
      if (prev) {
        Object.assign(prev, c);
        return { id: prev.id };
      }
      const created: Campaign = { ...c, id: newId('cmp-'), status: 'draft', sentAt: null, recipients: 0, createdAt: new Date().toISOString() };
      db.campaigns.unshift(created);
      audit(db, u.name, 'campaign_draft', 'marketing', created.id, c.name);
      return { id: created.id };
    });
  }, 'Bozza salvata.');
}

/** Live preview + who receives it (nothing is sent). */
export async function previewCampaignAction(raw: unknown) {
  return act('marketing.manage', () => {
    const c = CampaignSchema.partial().parse(raw);
    const db = readDb();
    const recipients = campaignRecipients(db, { audience: c.audience ?? 'consent_all', selected: c.selected, langs: c.langs, personal: c.personal });
    const byLang: Record<string, number> = {};
    for (const r of recipients) byLang[r.lang ?? 'it'] = (byLang[r.lang ?? 'it'] ?? 0) + 1;
    const sample = recipients[0] ?? { email: 'ospite@example.com', firstName: 'Giulia', lang: 'it' as const };
    const r = renderCampaign({ subject: c.subject ?? '', headline: c.headline ?? '', body: c.body ?? '', ctaLabel: c.ctaLabel ?? '', ctaUrl: c.ctaUrl ?? '', image: c.image ?? '', theme: c.theme ?? null, personal: c.personal }, db.settings, { ...sample, lang: 'it' });
    return { html: r.html, subject: r.subject, count: recipients.length, byLang, unsubscribed: db.unsubscribed.length, smtp: smtpConfigured() };
  });
}

/** Sends one copy to the owner's own address, to check how it looks in a real inbox. */
export async function sendCampaignTestAction(raw: unknown, to: string) {
  return act('marketing.manage', (u) => {
    const c = CampaignSchema.parse(raw);
    const email = z.email().parse(to.trim().toLowerCase());
    mutate((db) => {
      queueCampaign(db, { ...c, id: c.id ?? 'test', status: 'draft', sentAt: null, recipients: 1, createdAt: new Date().toISOString(), subject: `[PROVA] ${c.subject}` }, [{ email, firstName: u.name.split(' ')[0] ?? '', lang: 'it' }]);
      audit(db, u.name, 'campaign_test', 'marketing', c.id ?? null, email);
    });
    return { smtp: smtpConfigured() };
  }, smtpConfigured() ? 'Email di prova inviata.' : 'Email di prova creata nella Outbox (email non ancora collegate).');
}

/** Saves the latest version and sends it: translated into each guest's language, one email each. */
export async function sendCampaignAction(raw: unknown) {
  return act('marketing.manage', async (u) => {
    const c = CampaignSchema.parse(raw);
    const { id } = mutate((db) => {
      const prev = c.id ? db.campaigns.find((x) => x.id === c.id) : undefined;
      if (prev && prev.status === 'sent') throw new UserError('Campagna già inviata: duplicala per inviarla di nuovo.');
      if (prev) {
        Object.assign(prev, c);
        return { id: prev.id };
      }
      const created: Campaign = { ...c, id: newId('cmp-'), status: 'draft', sentAt: null, recipients: 0, createdAt: new Date().toISOString() };
      db.campaigns.unshift(created);
      return { id: created.id };
    });
    try {
      return await sendCampaign(id, u.name);
    } catch (e) {
      throw new UserError((e as Error).message);
    }
  });
}

export async function duplicateCampaignAction(id: string) {
  return act('marketing.manage', () =>
    mutate((db) => {
      const c = db.campaigns.find((x) => x.id === id);
      if (!c) throw new UserError('Campagna non trovata.');
      const copy: Campaign = { ...c, id: newId('cmp-'), name: `${c.name} (copia)`, status: 'draft', sentAt: null, recipients: 0, createdAt: new Date().toISOString() };
      db.campaigns.unshift(copy);
      return { id: copy.id };
    }),
  'Campagna duplicata.');
}

export async function deleteCampaignAction(id: string) {
  return act('marketing.manage', () => mutate((db) => void (db.campaigns = db.campaigns.filter((x) => x.id !== id))), 'Campagna eliminata.');
}

/** "Write it in your own words" → a complete email (AI when connected). */
export async function draftEmailAction(words: string) {
  return act('marketing.manage', async () => draftFromWords(z.string().trim().min(3, 'Scrivi qualche parola').max(1200).parse(words)));
}

/** Four email looks from a short description. */
export async function emailThemesAction(prompt: string) {
  return act('marketing.manage', async () => themesFromWords(z.string().trim().max(400).parse(prompt)));
}

/**
 * Free AI image for the email (Pollinations, no key needed). The picture is downloaded, checked
 * and stored with the other uploads, so the email never depends on the external service.
 */
export async function generateEmailImageAction(prompt: string) {
  return act('marketing.manage', async () => {
    const p = z.string().trim().min(3).max(300).parse(prompt);
    // free generator, saved on our server (see server/ai/images.ts)
    const src = await generateImage(p).catch((e: Error) => {
      throw new UserError(e.message);
    });
    return { src };
  });
}

/* ---------------- reviews added by hand ---------------- */

export async function addFeedbackAction(raw: unknown) {
  return act('marketing.manage', (u) => {
    const f = z
      .object({
        name: z.string().trim().min(2).max(60),
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().min(3).max(1200),
        lang: z.enum(['it', 'en', 'pl', 'de', 'fr', 'es']),
        showOnSite: z.boolean(),
        roomId: z.string().nullable().optional(),
      })
      .parse(raw);
    const id = newId('fb-');
    mutate((db) => {
      db.feedback.unshift({ id, bookingId: null, roomId: f.roomId && db.rooms.some((r) => r.id === f.roomId) ? f.roomId : null, name: f.name, rating: f.rating, comment: f.comment, lang: f.lang, translations: {}, replies: [], photos: [], pending: false, publishConsent: true, showOnSite: f.showOnSite, demo: false, createdAt: new Date().toISOString() });
      audit(db, u.name, 'feedback_add', 'marketing', null, `${f.name} · ${f.rating}/5`);
    });
    translateReviewLater(id);
  }, 'Recensione aggiunta: viene tradotta da sola nelle altre lingue.');
}

export async function deleteFeedbackAction(id: string) {
  return act('marketing.manage', (u) =>
    mutate((db) => {
      const f = db.feedback.find((x) => x.id === id);
      db.feedback = db.feedback.filter((x) => x.id !== id);
      audit(db, u.name, 'feedback_delete', 'marketing', id, f ? `${f.name} · ${f.rating}/5` : id);
    }),
  'Recensione eliminata.');
}

/* ---------------- room reviews: moderation, edits, replies ---------------- */

export async function approveReviewAction(id: string) {
  return act('marketing.manage', (u) =>
    mutate((db) => {
      const f = db.feedback.find((x) => x.id === id);
      if (!f) throw new UserError('Recensione non trovata.');
      f.pending = false;
      f.publishConsent = true;
      f.showOnSite = true;
      audit(db, u.name, 'review_approve', 'feedback', id, `${f.name} · ${f.rating}/5`);
    }),
  'Recensione pubblicata sul sito.');
}

export async function setReviewVisibleAction(id: string, visible: boolean) {
  return act('marketing.manage', (u) =>
    mutate((db) => {
      const f = db.feedback.find((x) => x.id === id);
      if (!f) throw new UserError('Recensione non trovata.');
      if (visible && !f.publishConsent) throw new UserError('L’ospite non ha dato il consenso alla pubblicazione.');
      f.showOnSite = visible;
      if (visible) f.pending = false;
      audit(db, u.name, 'feedback_publish', 'marketing', id, visible ? 'pubblicata' : 'nascosta');
    }),
  );
}

export async function updateReviewAction(id: string, raw: unknown) {
  return act('marketing.manage', (u) => {
    const p = z.object({ name: z.string().trim().min(2).max(60), rating: z.number().int().min(1).max(5), comment: z.string().trim().min(3).max(1500), roomId: z.string().nullable() }).parse(raw);
    mutate((db) => {
      const f = db.feedback.find((x) => x.id === id);
      if (!f) throw new UserError('Recensione non trovata.');
      const textChanged = f.comment !== p.comment;
      Object.assign(f, { name: p.name, rating: p.rating, comment: p.comment, roomId: p.roomId && db.rooms.some((r) => r.id === p.roomId) ? p.roomId : null, editedAt: new Date().toISOString() });
      if (textChanged) f.translations = {};
      audit(db, u.name, 'review_edit', 'feedback', id, `${p.name} · ${p.rating}/5`);
    });
    translateReviewLater(id);
  }, 'Recensione aggiornata.');
}

export async function replyReviewAction(id: string, text: string) {
  return act('marketing.manage', (u) => {
    const t = z.string().trim().min(2).max(800).parse(text);
    addReply(id, { author: 'hotel', name: 'Hotel L’Ancora', text: t, lang: 'it' }, u.name);
  }, 'Risposta pubblicata: viene tradotta da sola nelle altre lingue.');
}

export async function deleteReplyAction(id: string, replyId: string) {
  return act('marketing.manage', (u) =>
    mutate((db) => {
      const f = db.feedback.find((x) => x.id === id);
      if (!f) throw new UserError('Recensione non trovata.');
      f.replies = (f.replies ?? []).filter((r) => r.id !== replyId);
      audit(db, u.name, 'review_reply_delete', 'feedback', id, replyId);
    }),
  'Risposta eliminata.');
}

export async function removeReviewPhotoAction(id: string, src: string) {
  return act('marketing.manage', (u) =>
    mutate((db) => {
      const f = db.feedback.find((x) => x.id === id);
      if (!f) throw new UserError('Recensione non trovata.');
      f.photos = (f.photos ?? []).filter((p) => p !== src);
      audit(db, u.name, 'review_photo_delete', 'feedback', id, src);
    }),
  'Foto rimossa.');
}

export async function saveReviewSettingsAction(raw: unknown) {
  return act('marketing.manage', (u) => {
    const p = z.object({ autoRequest: z.boolean(), delayDays: z.number().int().min(0).max(7) }).parse(raw);
    mutate((db) => {
      db.settings.reviews = p;
      audit(db, u.name, 'settings', 'reviews', null, p.autoRequest ? `Richiesta recensione automatica dopo ${p.delayDays} giorni` : 'Richiesta automatica spenta');
    });
  }, 'Impostazioni salvate.');
}

export async function sendReviewRequestsNowAction() {
  return act('marketing.manage', () => ({ sent: sendReviewRequests(true) }));
}
