'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { AuthError, requireUser } from '@/server/auth/guard';
import { mutate, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { readIntegrations, writeIntegrations } from '@/server/integrations';
import { PROVIDERS } from '@/lib/mail-providers';
import { MailError, listMail, mailAttachment, mailboxConfig, readMail, sendMail, setMailUnread, testMailbox, type Folder, type MailboxConfig } from '@/server/mail/mailbox';

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

/** Reads only: no page refresh, the mailbox is the only place where mail lives. */
async function read<T>(fn: () => Promise<T>): Promise<Res<T>> {
  try {
    await requireUser('bookings.manage');
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AuthError || e instanceof MailError) return { ok: false, error: e.message };
    console.error('[posta]', e);
    return { ok: false, error: 'La casella non risponde ora. Riprova tra poco.' };
  }
}

const Server = z.object({ host: z.string().trim().min(3).max(120), port: z.number().int().min(1).max(65535), secure: z.boolean() });
const Connect = z.object({
  provider: z.enum(['gmail', 'libero', 'aruba', 'yahoo', 'icloud', 'altro']),
  email: z.email('Indirizzo email non valido'),
  pass: z.string().min(4, 'Scrivi la password').max(200),
  name: z.string().trim().max(80).optional(),
  user: z.string().trim().max(200).optional(),
  sendGuests: z.boolean(),
  imap: Server.optional(),
  smtp: Server.optional(),
});

/** "Collega la posta": checks that the mailbox opens (reading and sending) before saving anything. */
export async function connectMailboxAction(raw: unknown) {
  return act('settings.edit', async (u) => {
    const p = Connect.parse(raw);
    const preset = p.provider === 'altro' ? null : PROVIDERS[p.provider];
    const imap = preset?.imap ?? p.imap;
    const smtp = preset?.smtp ?? p.smtp;
    if (!imap || !smtp) throw new UserError('Per questa casella servono i dati dei server (posta in arrivo e in uscita).');
    const cfg: MailboxConfig = {
      provider: p.provider,
      email: p.email.toLowerCase(),
      name: p.name || readDb().settings.hotel.name,
      user: p.user || p.email,
      // Google shows the app password in four groups of letters: the spaces are not part of it
      pass: p.provider === 'gmail' ? p.pass.replace(/\s+/g, '') : p.pass,
      imap,
      smtp,
      sendGuests: p.sendGuests,
      connectedAt: new Date().toISOString(),
    };
    try {
      await testMailbox(cfg);
    } catch (e) {
      throw new UserError((e as Error).message);
    }
    writeIntegrations({ mailbox: cfg });
    mutate((db) => audit(db, u.name, 'integration', 'mailbox', null, `Posta collegata (${cfg.email})${cfg.sendGuests ? ' · invia anche le email agli ospiti' : ''}`));
    return { email: cfg.email };
  }, 'Posta collegata.');
}

export async function disconnectMailboxAction() {
  return act('settings.edit', (u) => {
    const prev = readIntegrations().mailbox?.email ?? '—';
    writeIntegrations({ mailbox: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'mailbox', null, `Posta scollegata (${prev})`));
  }, 'Posta scollegata dal pannello. La casella resta com’è.');
}

export async function setMailSendGuestsAction(on: boolean) {
  return act('settings.edit', (u) => {
    const mb = readIntegrations().mailbox;
    if (!mb) throw new UserError('Collega prima la posta.');
    writeIntegrations({ mailbox: { ...mb, sendGuests: Boolean(on) } });
    mutate((db) => audit(db, u.name, 'integration', 'mailbox', null, on ? `Le email agli ospiti partono da ${mb.email}` : `Le email agli ospiti non partono più da ${mb.email}`));
  }, on ? 'Da ora le email agli ospiti partono dalla tua casella.' : 'Le email agli ospiti non partono più dalla tua casella.');
}

const folder = z.enum(['inbox', 'sent']);

export async function mailListAction(f: Folder) {
  return read(async () => {
    const r = await listMail(folder.parse(f));
    setMailUnread(r.unread);
    return r;
  });
}

/** A message, plus who the sender is for the hotel (guest, booking) when the address is known. */
export async function mailReadAction(f: Folder, uid: number) {
  return read(async () => {
    const m = await readMail(folder.parse(f), z.number().int().positive().parse(uid));
    const who = f === 'inbox' ? m.from.address : (m.to[0]?.address ?? '');
    const db = readDb();
    const b = who
      ? db.bookings
          .filter((x) => x.guest.email?.toLowerCase() === who)
          .sort((a, c) => c.checkIn.localeCompare(a.checkIn))[0]
      : undefined;
    const guest = b ? { name: `${b.guest.firstName} ${b.guest.lastName}`.trim(), code: b.code, bookingId: b.id, checkIn: b.checkIn, checkOut: b.checkOut, status: b.status } : null;
    return { ...m, guest };
  });
}

export async function mailAttachmentAction(f: Folder, uid: number, i: number) {
  return read(() => mailAttachment(folder.parse(f), z.number().int().positive().parse(uid), z.number().int().min(0).parse(i)));
}

const Send = z.object({
  to: z.email('Indirizzo del destinatario non valido'),
  subject: z.string().trim().min(1, 'Scrivi l’oggetto').max(200),
  text: z.string().trim().min(1, 'Scrivi il messaggio').max(20000),
  replyUid: z.number().int().positive().optional(),
});

export async function mailSendAction(raw: unknown) {
  return act('bookings.manage', async (u) => {
    const m = Send.parse(raw);
    if (!mailboxConfig()) throw new UserError('Collega prima la posta.');
    try {
      const r = await sendMail(m);
      mutate((db) => audit(db, u.name, 'mail_sent', 'mailbox', null, `Email a ${r.to}: ${r.subject.slice(0, 80)}`));
      return r;
    } catch (e) {
      if (e instanceof MailError) throw new UserError(e.message);
      throw e;
    }
  }, 'Email inviata.');
}
