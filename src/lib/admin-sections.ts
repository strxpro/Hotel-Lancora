import type { AppNotification, NotificationType } from './types';

/** The panel's sections (the menu), most specific first when one is inside another. */
export const PANEL_SECTIONS = [
  '/admin/disponibilita',
  '/admin/prenotazioni',
  '/admin/camere',
  '/admin/prezzi',
  '/admin/clienti',
  '/admin/pagamenti',
  '/admin/messaggi',
  '/admin/posta',
  '/admin/statistiche',
  '/admin/marketing',
  '/admin/automazioni',
  '/admin/assistente',
  '/admin/impostazioni',
] as const;

/** Where a notification belongs when its link does not say it. */
const SECTION_OF_TYPE: Record<NotificationType, string> = {
  nuova_prenotazione: '/admin/prenotazioni',
  prenotazione_cancellata: '/admin/prenotazioni',
  pagamento_non_completato: '/admin/prenotazioni',
  nuovo_pagamento: '/admin/pagamenti',
  nuovo_arrivo: '/admin',
  partenza_oggi: '/admin',
  report_giornaliero: '/admin',
  camera_da_controllare: '/admin/camere',
  errore_sincronizzazione: '/admin/automazioni',
  messaggio_ospite: '/admin/messaggi',
};

/** The menu item a notification lights up: its link first ("/admin/prenotazioni?b=…"), then its kind. */
export function sectionOf(n: Pick<AppNotification, 'type' | 'href'>): string {
  const path = (n.href ?? '').split(/[?#]/)[0] ?? '';
  const hit = PANEL_SECTIONS.find((s) => path === s || path.startsWith(`${s}/`));
  return hit ?? SECTION_OF_TYPE[n.type] ?? '/admin';
}

/** Unread notifications per menu item: { '/admin/prenotazioni': 2, '/admin': 1 }. */
export function newBySection(list: Pick<AppNotification, 'type' | 'href' | 'read'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of list) {
    if (n.read) continue;
    const s = sectionOf(n);
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

export const isPanelSection = (s: string) => s === '/admin' || (PANEL_SECTIONS as readonly string[]).includes(s);
