import 'server-only';
import type { Campaign, DB, EmailTheme, Locale } from '@/lib/types';
import { EMAIL_THEMES, sanitizeTheme, themesForPrompt } from '@/lib/email-themes';
import { getProvider, parseJsonLoose } from '../ai/provider';
import { translateFields } from '../ai/content';
import { mutate, readDb } from '../db/store';
import { audit, smtpConfigured } from '../events';
import { guestProfiles, type GuestProfile } from '../guests';
import { campaignRecipients, queueCampaign } from './campaign';

export interface Draft {
  subject: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

/** Simple, honest drafts when no AI is connected: the owner's words become a clean email. */
function templateDraft(instruction: string, hotel: string): Draft {
  const t = instruction.toLowerCase();
  const own = instruction.trim().replace(/^(scrivi|manda|invia|prepara)\s+(un[a']?\s+)?(email|mail|messaggio)\s+(a|ai|agli|alle|per)?\s*/i, '');
  const body = own ? own.charAt(0).toUpperCase() + own.slice(1) : 'Volevamo salutarti da Santa Teresa Gallura.';
  if (/(offert|scont|promo|prezz|-\s?\d+%|ofert|rabat)/.test(t)) {
    return { subject: 'Un’offerta pensata per te, {nome}', headline: 'Torna a trovarci in Gallura', body: `Ciao {nome},\n\n${body}\n\nTi aspettiamo con il mare di Santa Teresa a pochi passi.\n\nA presto,\n${hotel}`, ctaLabel: 'Prenota ora', ctaUrl: '/prenotazione' };
  }
  if (/(grazie|ringraz|dzięk|thank)/.test(t)) {
    return { subject: 'Grazie per il tuo soggiorno, {nome}', headline: 'È stato un piacere averti con noi', body: `Ciao {nome},\n\n${body}\n\nSperiamo di rivederti presto.\n\nUn caro saluto,\n${hotel}`, ctaLabel: '', ctaUrl: '' };
  }
  if (/(arriv|benvenut|check-?in|przyjazd|welcome)/.test(t)) {
    return { subject: 'Ti aspettiamo il {arrivo}, {nome}', headline: 'Tutto pronto per il tuo arrivo', body: `Ciao {nome},\n\n${body}\n\nLa tua camera {camera} ti aspetta. Per qualsiasi necessità rispondi pure a questa email.\n\nA presto,\n${hotel}`, ctaLabel: '', ctaUrl: '' };
  }
  return { subject: '{nome}, un messaggio da Hotel L’Ancora', headline: 'Un saluto da Santa Teresa Gallura', body: `Ciao {nome},\n\n${body}\n\nUn caro saluto,\n${hotel}`, ctaLabel: '', ctaUrl: '' };
}

/**
 * "Write it in your own words": the AI turns a short note (any language) into a warm Italian
 * email with placeholders. Without AI the note is wrapped in a tidy template.
 */
export async function draftFromWords(instruction: string, db: DB = readDb()): Promise<{ draft: Draft; mode: 'ai' | 'template' }> {
  const hotel = db.settings.hotel.name;
  const provider = getProvider();
  if (provider) {
    try {
      const raw = await provider.complete(
        [
          {
            role: 'system',
            content: `Sei il proprietario di ${hotel}, piccolo hotel 3 stelle a Santa Teresa Gallura (Sardegna). Scrivi un'email in italiano, calda, breve ed elegante, partendo dalle parole del proprietario (possono essere in qualsiasi lingua). Usa i segnaposto {nome} (nome dell'ospite) e, solo se servono, {camera}, {arrivo}, {partenza}, {codice}. Non inventare servizi, prezzi o sconti che il proprietario non ha scritto. Paragrafi separati da \\n\\n. Firma con "${hotel}". Rispondi solo JSON {"subject","headline","body","ctaLabel","ctaUrl"}; ctaUrl è "/prenotazione" se l'email invita a prenotare, altrimenti "".`,
          },
          { role: 'user', content: instruction.slice(0, 1200) },
        ],
        { json: true, temperature: 0.6, maxTokens: 900 },
      );
      const j = parseJsonLoose<Record<string, unknown>>(raw);
      if (j && clip(j.subject, 120) && clip(j.body, 4000)) {
        const url = clip(j.ctaUrl, 200);
        return {
          mode: 'ai',
          draft: { subject: clip(j.subject, 120), headline: clip(j.headline, 140) || clip(j.subject, 120), body: clip(j.body, 4000), ctaLabel: clip(j.ctaLabel, 40), ctaUrl: /^(https:\/\/|\/)/.test(url) ? url : '' },
        };
      }
    } catch (e) {
      console.error('[compose]', (e as Error).message);
    }
  }
  return { mode: 'template', draft: templateDraft(instruction, hotel) };
}

/** Four email looks from a description ("più scuro ed elegante", "estivo, tanto blu"). */
export async function themesFromWords(prompt: string): Promise<{ themes: EmailTheme[]; mode: 'ai' | 'preset' }> {
  const provider = getProvider();
  if (provider && prompt.trim()) {
    try {
      const raw = await provider.complete(
        [
          {
            role: 'system',
            content: `Crea 4 stili grafici diversi per l'email di un hotel sul mare in Sardegna, seguendo la richiesta. Rispondi solo JSON {"themes":[{"name","layout","bg","card","accent","ink","headerBg","headerInk","font","radius"}]}. layout ∈ classic|hero|minimal|postcard; colori esadecimali #RRGGBB con buon contrasto tra ink e card e tra headerInk e headerBg; font ∈ serif|sans; radius 0-32. Nome breve in italiano.`,
          },
          { role: 'user', content: prompt.slice(0, 400) },
        ],
        { json: true, temperature: 0.9, maxTokens: 900 },
      );
      const j = parseJsonLoose<{ themes?: Partial<EmailTheme>[] }>(raw);
      const list = (j?.themes ?? []).slice(0, 4).map((t, i) => sanitizeTheme({ ...t, id: `ai-${Date.now().toString(36)}-${i}` }, EMAIL_THEMES[i]!));
      if (list.length === 4) return { themes: list, mode: 'ai' };
    } catch (e) {
      console.error('[themes]', (e as Error).message);
    }
  }
  return { themes: themesForPrompt(prompt), mode: 'preset' };
}

export interface PeopleFilter {
  names?: string[];
  countries?: string[];
  langs?: Locale[];
  when?: 'all' | 'past' | 'future' | 'in_house';
}

/** Find guests from words like "ai clienti tedeschi", "a Giulia Rossi", "a chi arriva a dicembre". */
export function findPeople(db: DB, f: PeopleFilter): GuestProfile[] {
  let list = guestProfiles(db).filter((g) => !g.unsubscribed);
  if (f.names?.length) {
    const ns = f.names.map((n) => n.toLowerCase().trim()).filter(Boolean);
    list = list.filter((g) => ns.some((n) => g.name.toLowerCase().includes(n) || g.lastName.toLowerCase() === n || g.email.toLowerCase() === n));
  }
  if (f.countries?.length) list = list.filter((g) => f.countries!.includes(g.country.toUpperCase()));
  if (f.langs?.length) list = list.filter((g) => f.langs!.includes(g.lang));
  if (f.when === 'past') list = list.filter((g) => g.stays > 0 && !g.next);
  if (f.when === 'future') list = list.filter((g) => Boolean(g.next));
  if (f.when === 'in_house') list = list.filter((g) => g.inHouse);
  return list;
}

/**
 * Sends a campaign: recipients → grouped by language → text translated once per language
 * (when asked and a translator is connected) → one personalised email each.
 */
export async function sendCampaign(id: string, actor: string): Promise<{ recipients: number; smtp: boolean; languages: string[]; untranslated: string[] }> {
  const db = readDb();
  const c = db.campaigns.find((x) => x.id === id);
  if (!c) throw new Error('Campagna non trovata.');
  if (c.status === 'sent') throw new Error('Campagna già inviata.');
  const recipients = campaignRecipients(db, c);
  if (!recipients.length) throw new Error(c.selected?.length ? 'Nessuna delle persone scelte può ricevere l’email (consenso mancante o disiscritta).' : 'Nessun destinatario con consenso al marketing per questo pubblico.');
  const langs = [...new Set(recipients.map((r) => r.lang ?? 'it'))];
  const byLang: Partial<Record<Locale, Pick<Campaign, 'subject' | 'headline' | 'body' | 'ctaLabel'>>> = {};
  const untranslated: string[] = [];
  if (c.translate !== false) {
    for (const l of langs) {
      if (l === 'it') continue;
      try {
        const tr = await translateFields({ subject: c.subject, headline: c.headline, body: c.body, ctaLabel: c.ctaLabel }, l, 'it');
        if (tr) byLang[l] = tr;
        else untranslated.push(l);
      } catch {
        untranslated.push(l);
      }
    }
  }
  return mutate((d) => {
    const cc = d.campaigns.find((x) => x.id === id);
    if (!cc || cc.status === 'sent') throw new Error('Campagna già inviata.');
    queueCampaign(d, cc, recipients, byLang);
    cc.status = 'sent';
    cc.sentAt = new Date().toISOString();
    cc.recipients = recipients.length;
    audit(d, actor, 'campaign_send', 'marketing', cc.id, `${cc.name} · ${recipients.length} destinatari · lingue ${langs.join(', ').toUpperCase()}${smtpConfigured() ? '' : ' (Outbox demo)'}`);
    return { recipients: recipients.length, smtp: smtpConfigured(), languages: langs, untranslated };
  });
}
