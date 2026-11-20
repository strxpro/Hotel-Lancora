'use server';
import { z } from 'zod';
import { act } from '@/server/action';
import { mutate, newId, readDb, resetDb } from '@/server/db/store';
import { GoLiveError, startRealData } from '@/server/go-live';
import { audit } from '@/server/events';
import { deliverEmail } from '@/server/events';
import { clean } from '@/server/security';
import { UserError } from '@/server/action';
import { isPanelSection, sectionOf } from '@/lib/admin-sections';

/** The owner opened a section of the menu: its notifications are seen (the red number next to it goes away). */
export async function markSectionRead(section: string) {
  return act('bookings.manage', () => {
    if (!isPanelSection(section)) throw new UserError('Sezione sconosciuta.');
    mutate((db) => db.notifications.forEach((n) => {
      if (!n.read && sectionOf(n) === section) n.read = true;
    }));
  });
}

export async function markNotificationsRead() {
  return act('bookings.manage', () => mutate((db) => db.notifications.forEach((n) => (n.read = true))));
}

export async function addTask(label: string) {
  return act('bookings.manage', () => {
    const l = clean(label, 140);
    if (l.length < 2) throw new UserError('Scrivi il compito.');
    mutate((db) => db.tasks.unshift({ id: newId('t-'), label: l, done: false, createdAt: new Date().toISOString() }));
  });
}

export async function toggleTask(id: string) {
  return act('bookings.manage', () =>
    mutate((db) => {
      const t = db.tasks.find((x) => x.id === id);
      if (t) t.done = !t.done;
    }),
  );
}

export async function removeTask(id: string) {
  return act('bookings.manage', () => mutate((db) => void (db.tasks = db.tasks.filter((x) => x.id !== id))));
}

export async function markMessageRead(id: string, read: boolean) {
  return act('bookings.manage', () =>
    mutate((db) => {
      const m = db.messages.find((x) => x.id === z.string().parse(id));
      if (m) m.read = read;
    }),
  );
}

export async function resendEmail(id: string) {
  return act('bookings.manage', async () => {
    const r = await deliverEmail(id);
    if (!r.ok) throw new UserError(r.error ?? 'Invio non riuscito');
  }, 'Email inviata tramite SMTP.');
}

/** Restores the demonstration dataset (admin only). Never once the hotel works with real data. */
export async function resetDemo() {
  return act('settings.edit', (u) => {
    if (process.env.DEMO_MODE !== 'true') throw new UserError('Disponibile solo in modalità demo.');
    if (!readDb().settings.demoMode) throw new UserError('Il sito usa già i dati veri: i dati di esempio non si possono più ripristinare.');
    resetDb();
    mutate((db) => audit(db, u.name, 'reset', 'database', null, 'Dati demo ripristinati'));
  }, 'Dati dimostrativi ripristinati.');
}

/**
 * "Passa ai dati veri": removes everything created during the demo and keeps rooms, photos, prices
 * and settings (src/server/go-live.ts). The owner types the confirmation word in the panel.
 */
export async function startRealDataAction(confirm: string) {
  return act('settings.edit', (u) => {
    if (confirm.trim().toUpperCase() !== 'CANCELLA') throw new UserError('Scrivi CANCELLA per confermare.');
    try {
      const r = startRealData(u.name);
      return { bookings: r.removed.bookings };
    } catch (e) {
      if (e instanceof GoLiveError) throw new UserError(e.message);
      throw e;
    }
  }, 'Fatto: i dati di esempio sono stati cancellati. Da ora il pannello mostra solo il lavoro vero dell’hotel.');
}
