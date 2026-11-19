'use server';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { act, UserError } from '@/server/action';
import { mutate, readDb } from '@/server/db/store';
import { audit, notify } from '@/server/events';
import { getMe, sendMessage, setWebhook, telegramConfigured } from '@/server/telegram/api';
import { configuredAdapter, simulator } from '@/server/channels/adapter';
import { createManualBooking } from '@/server/bookings';
import { stablePublicUrl } from '@/server/telegram/poller';

export async function generateLinkCode() {
  return act('automations.manage', async (u) => {
    if (!telegramConfigured()) throw new UserError('Token Telegram non configurato.');
    const me = await getMe();
    // a webhook only on a lasting public address; on this computer the site listens to the bot by itself
    const base = stablePublicUrl();
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    if (base && secret.length >= 16) await setWebhook(`${base}/api/telegram/webhook`, secret);
    const code = String(randomInt(100000, 999999));
    mutate((db) => {
      db.telegram.linkCode = { code, userId: u.id, expiresAt: new Date(Date.now() + 15 * 60000).toISOString() };
      audit(db, u.name, 'telegram_code', 'telegram', null, 'Codice di collegamento generato');
    });
    return { code, url: `https://t.me/${me.username}?start=${code}` };
  });
}

export async function unlinkChat(chatId: string) {
  return act('automations.manage', (u) =>
    mutate((db) => {
      db.telegram.linkedChats = db.telegram.linkedChats.filter((c) => c.chatId !== chatId);
      audit(db, u.name, 'telegram_unlink', 'telegram', chatId, 'Chat scollegata');
    }),
  'Chat scollegata.');
}

export async function testTelegram() {
  return act('automations.manage', async (u) => {
    if (!telegramConfigured()) throw new UserError('Token Telegram non configurato (TELEGRAM_BOT_TOKEN nel file .env).');
    const me = await getMe().catch((e: Error) => {
      throw new UserError(`Token non valido: ${e.message}`);
    });
    const chats = readDb().telegram.linkedChats;
    if (!chats.length) return { message: `Bot @${me.username} raggiungibile. Collega ora la tua chat con il codice.` };
    for (const c of chats) await sendMessage(c.chatId, `🔔 <b>Notifica di prova</b>\nHotel L’Ancora è collegato correttamente. (${u.name})`);
    mutate((db) => {
      db.telegram.lastTestAt = new Date().toISOString();
      audit(db, u.name, 'telegram_test', 'telegram', null, `Test inviato a ${chats.length} chat`);
    });
    return { message: `Notifica di prova inviata a ${chats.length} chat tramite @${me.username}.` };
  });
}

const NOTIFICATION_TYPE = z.enum(['nuova_prenotazione', 'nuovo_pagamento', 'prenotazione_cancellata', 'nuovo_arrivo', 'partenza_oggi', 'pagamento_non_completato', 'camera_da_controllare', 'errore_sincronizzazione', 'messaggio_ospite', 'report_giornaliero']);

export async function previewNotification(type: string) {
  return act('automations.manage', (u) =>
    mutate((db) => {
      notify(db, NOTIFICATION_TYPE.parse(type), 'Notifica di prova', `Generata da ${u.name} per verificare il canale.`, '/admin/automazioni');
    }),
  'Notifica di prova creata.');
}

/** One switch, saved at once (no separate "Salva"). */
export async function setNotificationAction(type: string, on: boolean) {
  return act('automations.manage', (u) => {
    const k = NOTIFICATION_TYPE.parse(type);
    mutate((db) => {
      db.settings.notifications[k] = Boolean(on);
      audit(db, u.name, 'settings', 'notifications', null, `Avviso “${k}” ${on ? 'attivato' : 'disattivato'}`);
    });
    return { on: Boolean(on) };
  });
}

/** The evening report right now (to see what it looks like, or after a busy day). */
export async function sendReportNow() {
  return act('automations.manage', async () => {
    const { sendDailyReport } = await import('@/server/daily');
    const r = await sendDailyReport();
    const chats = readDb().telegram.linkedChats.length;
    return { message: chats ? `Report inviato su Telegram (${chats} ${chats === 1 ? 'persona' : 'persone'}).` : 'Report pronto nelle notifiche del pannello: collega Telegram per riceverlo sul telefono.', ai: r.ai };
  });
}

/** Who is linked right now: the panel asks every few seconds after "Collega Telegram". */
export async function linkedChatsAction(): Promise<{ chatId: string; name: string; linkedAt: string }[]> {
  // read only, asked often: no page revalidation (unlike act)
  const { requireUser } = await import('@/server/auth/guard');
  await requireUser('automations.manage');
  return readDb().telegram.linkedChats.map((c) => ({ chatId: c.chatId, name: c.name, linkedAt: c.linkedAt }));
}

export async function setWebhookAction() {
  return act('automations.manage', async (u) => {
    if (!telegramConfigured()) throw new UserError('Token Telegram non configurato.');
    const base = stablePublicUrl();
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    if (!base) throw new UserError('Non serve: su questo computer il sito ascolta Telegram da solo. Il webhook si usa solo quando il sito ha un indirizzo pubblico stabile (APP_URL).');
    if (secret.length < 16) throw new UserError('Imposta TELEGRAM_WEBHOOK_SECRET (almeno 16 caratteri).');
    await setWebhook(`${base}/api/telegram/webhook`, secret);
    mutate((db) => audit(db, u.name, 'telegram_webhook', 'telegram', null, 'Webhook impostato'));
  }, 'Webhook Telegram impostato.');
}

/* ---------------- channel manager ---------------- */

export async function saveChannelSettings(raw: unknown) {
  return act('automations.manage', (u) => {
    const p = z.object({ providerName: z.string().trim().min(2).max(120), mapping: z.array(z.object({ externalCode: z.string().max(20), externalName: z.string().max(60), roomIds: z.array(z.string()) })).max(40) }).parse(raw);
    mutate((db) => {
      db.channel.providerName = p.providerName;
      db.channel.mapping = p.mapping;
      audit(db, u.name, 'channel_settings', 'channel', null, 'Configurazione canali aggiornata');
    });
  }, 'Configurazione salvata.');
}

export async function testChannel(useSimulator: boolean) {
  return act('automations.manage', async (u) => {
    const adapter = useSimulator ? simulator : configuredAdapter();
    const res = adapter ? await adapter.testConnection() : { ok: false, message: 'Nessun fornitore configurato (CHANNEL_PROVIDER). Il nome e le API del sistema in uso vanno confermati con la struttura.' };
    mutate((db) => {
      db.channel.log.unshift({ at: new Date().toISOString(), level: res.ok ? 'info' : 'error', message: res.message });
      db.channel.log = db.channel.log.slice(0, 60);
      if (useSimulator && res.ok) db.channel.status = 'simulazione';
      audit(db, u.name, 'channel_test', 'channel', null, res.message);
    });
    if (!res.ok) throw new UserError(res.message);
    return { message: res.message };
  });
}

/** SIMULAZIONE: an OTA reservation arrives unassigned; the owner assigns the room. */
export async function simulateOtaReservation() {
  return act('automations.manage', async (u) => {
    const [r] = await simulator.fetchReservations(null);
    if (!r) throw new UserError('Simulatore non disponibile');
    const b = createManualBooking(
      {
        roomId: null,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        adults: r.adults,
        children: r.children,
        guest: r.guest,
        source: r.channel,
        status: 'confirmed',
        total: r.total,
        amountPaid: 0,
        notes: `SIMULAZIONE · tipologia OTA ${r.roomTypeCode} · da assegnare`,
        sendEmail: false,
        otaRef: r.externalId,
        simulated: true,
      },
      'Simulatore OTA',
    );
    mutate((db) => {
      db.channel.lastSync = new Date().toISOString();
      db.channel.importedCount += 1;
      db.channel.log.unshift({ at: db.channel.lastSync, level: 'info', message: `SIMULAZIONE: importata ${r.externalId} (${r.channel}) ${r.checkIn} → ${r.checkOut}, tipologia ${r.roomTypeCode}` });
      if (db.channel.status === 'non_collegato') db.channel.status = 'simulazione';
      audit(db, u.name, 'channel_simulate', 'booking', b.id, r.externalId);
    });
    return { id: b.id, code: b.code };
  }, 'SIMULAZIONE: nuova prenotazione OTA ricevuta. Assegna la camera.');
}

export async function simulateSyncError() {
  return act('automations.manage', () =>
    mutate((db) => {
      const msg = 'SIMULAZIONE: timeout dal channel manager durante la sincronizzazione.';
      db.channel.log.unshift({ at: new Date().toISOString(), level: 'error', message: msg });
      notify(db, 'errore_sincronizzazione', 'Errore sincronizzazione canali', msg, '/admin/automazioni');
    }),
  'Errore simulato registrato.');
}

/* ---------------- portal calendars (iCal): Booking.com, Expedia, Airbnb ---------------- */

/** The panel's view of the calendars: links, last sync, and our own links to paste into the portals. */
export async function calendarsOverview() {
  return act('automations.manage', async () => {
    const { ensureCalendarKey, lastCalendarRead } = await import('@/server/channels/ical');
    const key = ensureCalendarKey();
    const db = readDb();
    const base = (process.env.APP_URL || 'http://localhost:3005').replace(/\/$/, '');
    return {
      publicSite: Boolean(stablePublicUrl()),
      // readAt: the last time the portal read the site's calendar of that room (the way back works)
      calendars: (db.channel.calendars ?? []).map((c) => ({ ...c, readAt: lastCalendarRead(c.roomId, c.source) })),
      rooms: db.rooms
        .filter((r) => r.status !== 'draft')
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((r) => ({ id: r.id, number: r.number, name: r.name, exportUrl: `${base}/api/ical/${encodeURIComponent(r.number)}.ics?k=${key}` })),
    };
  });
}

/** Paste a portal's "export calendar" link for a room: checked right away, then read every 15 minutes. */
export async function connectCalendarAction(raw: unknown) {
  return act('automations.manage', async (u) => {
    const { calendarId, forgetCalendar, safeCalendarUrl, sourceOfUrl, syncCalendar, SOURCE_LABEL } = await import('@/server/channels/ical');
    const p = z.object({ roomId: z.string().min(1), url: z.string().trim().min(10).max(800), source: z.enum(['booking', 'expedia', 'airbnb', 'altro']).optional() }).parse(raw);
    const url = safeCalendarUrl(p.url);
    if (!url) throw new UserError('Serve il link completo che inizia con https:// (quello di “Esporta calendario” del portale).');
    const db = readDb();
    const room = db.rooms.find((r) => r.id === p.roomId);
    if (!room) throw new UserError('Camera non trovata.');
    const detected = sourceOfUrl(url);
    const source = p.source ?? detected;
    const label = SOURCE_LABEL[source];
    // the usual mistakes, said plainly before anything is saved
    if (db.channel.icalKey && url.includes(db.channel.icalKey)) throw new UserError(`Questo è il link del sito, quello da incollare su ${label}. Qui serve il link che dà ${label} in “Esporta calendario”.`);
    if (p.source && detected !== 'altro' && detected !== p.source) throw new UserError(`Questo link è di ${SOURCE_LABEL[detected]}, non di ${label}: copia quello di ${label} (oppure collegalo nella finestra di ${SOURCE_LABEL[detected]}).`);
    const twin = (db.channel.calendars ?? []).find((c) => c.url === url && c.roomId !== p.roomId);
    if (twin) throw new UserError(`Questo link è già collegato alla camera ${db.rooms.find((r) => r.id === twin.roomId)?.number ?? '?'}: su ${label} ogni camera ha il suo link. Copia quello della camera ${room.number}.`);
    const replaced = (db.channel.calendars ?? []).find((c) => c.roomId === p.roomId && c.source === source);
    const id = calendarId();
    mutate((d) => {
      d.channel.calendars = [...(d.channel.calendars ?? []).filter((c) => c.id !== replaced?.id), { id, roomId: p.roomId, source, url, lastSync: null, lastError: null, nights: 0, returnAt: replaced?.returnAt ?? null }];
      // a link pasted again for the same room takes the place of the old one, with its nights
      if (replaced) d.blocks = d.blocks.filter((k) => !k.extUid?.startsWith(`${replaced.id}:`));
      if (d.channel.status === 'non_collegato') d.channel.status = 'collegato';
      audit(d, u.name, 'calendar_link', 'channel', p.roomId, `${label} collegato alla camera ${room.number}`);
    });
    if (replaced) forgetCalendar(replaced.id);
    const res = await syncCalendar(id);
    if (!res.ok) {
      mutate((d) => {
        d.channel.calendars = (d.channel.calendars ?? []).filter((c) => c.id !== id);
      });
      forgetCalendar(id);
      throw new UserError(res.error ?? 'Calendario non leggibile.');
    }
    return { id, message: `${label} collegato alla camera ${room.number}: ${res.nights === 1 ? '1 notte occupata' : `${res.nights} notti occupate`} già chiuse nel planning.` };
  });
}

/** The owner pasted the site's link in the portal ("Importa calendario"): from now on we wait for its first read. */
export async function markReturnLinkAction(id: string, done = true) {
  return act('automations.manage', () => {
    mutate((d) => {
      const c = (d.channel.calendars ?? []).find((x) => x.id === id);
      if (c) c.returnAt = done ? new Date().toISOString() : null;
    });
  });
}

export async function removeCalendarAction(id: string) {
  return act('automations.manage', async (u) => {
    const { forgetCalendar } = await import('@/server/channels/ical');
    mutate((d) => {
      const c = (d.channel.calendars ?? []).find((x) => x.id === id);
      if (!c) return;
      d.channel.calendars = (d.channel.calendars ?? []).filter((x) => x.id !== id);
      d.blocks = d.blocks.filter((k) => !k.extUid?.startsWith(`${id}:`));
      audit(d, u.name, 'calendar_unlink', 'channel', c.roomId, 'Calendario scollegato (notti importate rimosse)');
    });
    forgetCalendar(id);
  }, 'Calendario scollegato: le notti importate da quel portale sono state tolte dal planning.');
}

export async function syncCalendarsAction() {
  return act('automations.manage', async () => {
    const { syncAllCalendars } = await import('@/server/channels/ical');
    await syncAllCalendars();
    const cals = readDb().channel.calendars ?? [];
    const bad = cals.filter((c) => c.lastError).length;
    return { message: cals.length ? `Calendari aggiornati: ${cals.length - bad} ok${bad ? `, ${bad} con errore` : ''}.` : 'Nessun calendario collegato.' };
  });
}

const Slot = z.object({ time: z.string().regex(/^([01]\d|2[0-3]):(00|30)$/), days: z.array(z.number().int().min(1).max(7)).min(1).max(7) });

/** When the morning (arrivals, departures) and evening (report) messages arrive, and on which days. */
export async function saveReportScheduleAction(raw: unknown) {
  return act('automations.manage', (u) => {
    const d = z.object({ morning: Slot, evening: Slot }).parse(raw);
    const days = (x: number[]) => [...new Set(x)].sort();
    mutate((db) => {
      const panel = (db.settings.panel ??= {});
      panel.reports = { morning: { time: d.morning.time, days: days(d.morning.days) }, evening: { time: d.evening.time, days: days(d.evening.days) } };
      audit(db, u.name, 'settings', 'notifications', null, `Orari dei messaggi: mattino ${d.morning.time}, sera ${d.evening.time}`);
    });
  });
}
