import 'server-only';
import type { DB, NotificationType } from '@/lib/types';
import { reportSchedule } from '../daily';
import { mutate } from '../db/store';
import { audit } from '../events';

/**
 * The messages of the day on Telegram (Automazioni): switched off, on again or moved to another
 * time from the assistant — typed or by voice, in any language the rules or the AI understand.
 * The assistant always asks for a confirmation before setReports() runs.
 */
export type ReportsArgs = { which: 'sera' | 'mattina' | 'camere' | 'tutti'; on?: boolean; time?: string };

export const REPORT_TYPES: Record<ReportsArgs['which'], NotificationType[]> = {
  sera: ['report_giornaliero'],
  mattina: ['nuovo_arrivo', 'partenza_oggi'],
  camere: ['camera_da_controllare'],
  tutti: ['report_giornaliero', 'nuovo_arrivo', 'partenza_oggi', 'camera_da_controllare'],
};

const NAME: Record<ReportsArgs['which'], string> = {
  sera: 'il report della sera',
  mattina: 'i messaggi del mattino (arrivi e partenze)',
  camere: 'l’elenco delle camere da preparare',
  tutti: 'tutti i messaggi automatici della giornata (mattino, camere da preparare, report della sera)',
};

const AGAIN: Record<ReportsArgs['which'], string> = {
  sera: 'riaccendi il report della sera',
  mattina: 'riaccendi i messaggi del mattino',
  camere: 'riaccendi le camere da preparare',
  tutti: 'riaccendi i report',
};

/**
 * "spegni il report", "wyłącz raporty", "turn off the morning report"… → what to switch (text already
 * lower-cased without accents by normIt; the Polish ł is kept by it, so both spellings are matched).
 */
export function reportsIntent(t: string): ReportsArgs | null {
  if (!/(report|rapport|raport|riepilog|messaggi (automatic|del mattino|della sera)|powiadomien|wiadomosci (poranne|wieczorne))/.test(t)) return null;
  // "włącz" (on) is checked first: "wyłącz" (off) contains "łącz" but never "włącz"
  const on = /(riaccend|\baccend|riattiv|\battiva|\bw[lł]acz|turn on|switch on|enable)/.test(t);
  const off = !on && /(spegn|disattiv|togli|non (mandar|inviar)|basta|\bstop\b|wy[lł]acz|przesta|nie (wysy|przysy)|turn off|switch off|disable|stop sending)/.test(t);
  if (!on && !off) return null;
  const which: ReportsArgs['which'] = /(mattin|rano|porann|morning|arriv)/.test(t)
    ? 'mattina'
    : /(da prepar|do przygot|pulizi|sprzatan)/.test(t)
      ? 'camere'
      : /(tutt|wszystk|\ball\b|\braporty\b|\breports\b|\brapporti\b)/.test(t)
        ? 'tutti'
        : 'sera';
  return { which, on };
}

export function reportsSummary(a: ReportsArgs, db: DB): string {
  const plan = reportSchedule(db);
  const at = a.time ?? (a.which === 'sera' ? plan.evening.time : a.which === 'mattina' ? plan.morning.time : null);
  if (a.on === false) return `Spegnere ${NAME[a.which]}? Non arriverà più su Telegram finché non lo riaccendi (anche da Automazioni).`;
  if (a.on === true) return `Riaccendere ${NAME[a.which]}${at ? ` (alle ${at})` : ''}?`;
  return `Spostare ${NAME[a.which]} alle ${a.time}?`;
}

export function setReports(a: ReportsArgs, actor: string): string {
  mutate((db) => {
    if (a.on !== undefined) for (const k of REPORT_TYPES[a.which]) db.settings.notifications[k] = a.on;
    if (a.time && (a.which === 'sera' || a.which === 'mattina')) {
      const plan = reportSchedule(db);
      const key = a.which === 'sera' ? 'evening' : 'morning';
      (db.settings.panel ??= {}).reports = { ...plan, [key]: { ...plan[key], time: a.time } };
    }
    audit(db, actor, 'settings', 'notifications', null, `Assistente: ${NAME[a.which]}${a.on === undefined ? '' : a.on ? ' acceso' : ' spento'}${a.time ? ` alle ${a.time}` : ''}`);
  });
  if (a.on === false) return `Fatto: ${NAME[a.which]} spento. Per riaccenderlo scrivimi “${AGAIN[a.which]}”.`;
  return `Fatto: ${NAME[a.which]}${a.on ? ' acceso' : ''}${a.time ? ` alle ${a.time}` : ''}.`;
}
