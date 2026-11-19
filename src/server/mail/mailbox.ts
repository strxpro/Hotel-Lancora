import 'server-only';
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { readIntegrations, type StoredIntegrations } from '../integrations';

/**
 * The "Posta" tab: the hotel's own mailbox inside the panel. Reading over IMAP, sending over SMTP
 * with the same e-mail and "app password" (Gmail, Yahoo, iCloud) or the normal password (Libero,
 * Aruba, others). Nothing is copied into the site's data: every list and message is read from the
 * mailbox when the page asks, so the mailbox stays the only place where mail lives.
 */
export type MailboxConfig = NonNullable<StoredIntegrations['mailbox']>;
export type Folder = 'inbox' | 'sent';
export { PROVIDERS, guessProvider, type MailProvider } from '@/lib/mail-providers';
import type { MailProvider } from '@/lib/mail-providers';

export const fakeMode = () => process.env.HOTEL_MAIL_FAKE === '1';

export function mailboxConfig(): MailboxConfig | null {
  return readIntegrations().mailbox ?? null;
}

/** What the page may know: never the password. */
export function mailboxPublic() {
  const c = mailboxConfig();
  return c ? { provider: c.provider, email: c.email, name: c.name, sendGuests: c.sendGuests, connectedAt: c.connectedAt } : null;
}

export class MailError extends Error {}

/** The mail servers' refusals, in the owner's words. */
export function mailErrorText(e: unknown, provider?: MailProvider): string {
  const x = e as { code?: string; authenticationFailed?: boolean; responseText?: string; message?: string; responseCode?: number } | null;
  const msg = `${x?.code ?? ''} ${x?.responseText ?? ''} ${x?.message ?? ''}`;
  if (x?.authenticationFailed || x?.code === 'EAUTH' || x?.responseCode === 535 || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|Username and Password not accepted|LOGIN failed/i.test(msg)) {
    if (provider === 'gmail') return 'Gmail non accetta questa password. Serve la “password per le app” (16 lettere), non quella con cui entri in Gmail.';
    if (provider === 'yahoo' || provider === 'icloud') return 'La casella non accetta questa password: serve una “password per le app” creata nelle impostazioni dell’account.';
    return 'Email o password non corretti.';
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return 'Server della posta non trovato: controlla l’indirizzo del server.';
  if (/ETIMEDOUT|ECONNREFUSED|ECONNRESET|timeout|Timed out/i.test(msg)) return 'Il server della posta non risponde. Riprova tra qualche minuto.';
  if (/IMAP.*disabled|not enabled for IMAP|Web login required|ALERT/i.test(msg)) return 'La lettura della posta da altri programmi è spenta: attivala nelle impostazioni della casella (IMAP) e riprova.';
  return 'La casella non risponde come previsto. Riprova tra qualche minuto.';
}

/* ------------------------------------------------------------------ */
/* connection                                                          */
/* ------------------------------------------------------------------ */

async function withImap<T>(c: MailboxConfig, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({ host: c.imap.host, port: c.imap.port, secure: c.imap.secure, auth: { user: c.user, pass: c.pass }, logger: false, connectionTimeout: 15000, greetingTimeout: 12000, socketTimeout: 60000 });
  // a dropped connection must not crash the server
  client.on('error', () => undefined);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function folderPath(client: ImapFlow, f: Folder): Promise<string | null> {
  if (f === 'inbox') return 'INBOX';
  const list = await client.list();
  return list.find((x) => x.specialUse === '\\Sent')?.path ?? null;
}

/** Logs in to both servers; throws in plain words. */
export async function testMailbox(c: MailboxConfig): Promise<void> {
  if (fakeMode()) {
    if (c.pass === 'sbagliata') throw new MailError(mailErrorText({ authenticationFailed: true }, c.provider));
    return;
  }
  try {
    await withImap(c, async (client) => {
      await client.status('INBOX', { messages: true });
    });
  } catch (e) {
    throw new MailError(mailErrorText(e, c.provider));
  }
  try {
    const nodemailer = await import('nodemailer');
    await nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.port, secure: c.smtp.secure, auth: { user: c.user, pass: c.pass }, connectionTimeout: 12000 }).verify();
  } catch (e) {
    throw new MailError(`La posta si legge, ma non riesco a inviare: ${mailErrorText(e, c.provider)}`);
  }
}

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

export interface MailPerson {
  name: string;
  address: string;
}
export interface MailItem {
  uid: number;
  from: MailPerson;
  to: MailPerson[];
  subject: string;
  date: string;
  unread: boolean;
  snippet: string;
}
export interface MailFull extends MailItem {
  cc: MailPerson[];
  html: string | null;
  text: string;
  attachments: { i: number; name: string; size: number; type: string }[];
  messageId: string | null;
  references: string[];
}

const person = (a?: { name?: string; address?: string }): MailPerson => ({ name: (a?.name ?? '').trim(), address: (a?.address ?? '').trim().toLowerCase() });
const people = (a: AddressObject | AddressObject[] | undefined): MailPerson[] => (Array.isArray(a) ? a : a ? [a] : []).flatMap((x) => x.value.map(person));

/** A short preview line: plain words only (no leftover encoded blocks of a cut message). */
export function snippetOf(text: string): string {
  return text
    .replace(/^>.*$/gm, '')
    .replace(/\S{60,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export async function listMail(f: Folder, limit = 40): Promise<{ items: MailItem[]; unread: number; missing?: boolean }> {
  if (fakeMode()) return fakeList(f);
  const c = mailboxConfig();
  if (!c) throw new MailError('Nessuna casella collegata.');
  try {
    return await withImap(c, async (client) => {
      const path = await folderPath(client, f);
      if (!path) return { items: [], unread: 0, missing: true };
      const st = await client.status('INBOX', { unseen: true }).catch(() => null);
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const box = client.mailbox;
        const exists = box ? box.exists : 0;
        if (!exists) return { items: [], unread: st ? (st.unseen ?? 0) : 0 };
        const msgs = await client.fetchAll(`${Math.max(1, exists - limit + 1)}:*`, { uid: true, envelope: true, flags: true, internalDate: true, source: { maxLength: 6000 } });
        const items: MailItem[] = [];
        for (const m of msgs) {
          let snippet = '';
          if (m.source) {
            const p = await simpleParser(m.source).catch(() => null);
            snippet = snippetOf(p?.text ?? '');
          }
          const env = m.envelope;
          const date = env?.date ?? m.internalDate ?? new Date();
          items.push({ uid: m.uid, from: person(env?.from?.[0]), to: (env?.to ?? []).map(person), subject: env?.subject?.trim() || '(senza oggetto)', date: new Date(date).toISOString(), unread: !m.flags?.has('\\Seen'), snippet });
        }
        return { items: items.sort((a, b) => b.uid - a.uid), unread: st ? (st.unseen ?? 0) : items.filter((x) => x.unread).length };
      } finally {
        lock.release();
      }
    });
  } catch (e) {
    if (e instanceof MailError) throw e;
    throw new MailError(mailErrorText(e, c.provider));
  }
}

function toFull(uid: number, p: ParsedMail, unread: boolean): MailFull {
  const text = p.text ?? '';
  return {
    uid,
    from: person(p.from?.value[0]),
    to: people(p.to),
    cc: people(p.cc),
    subject: p.subject?.trim() || '(senza oggetto)',
    date: (p.date ?? new Date()).toISOString(),
    unread,
    snippet: snippetOf(text),
    html: typeof p.html === 'string' ? p.html : null,
    text,
    attachments: p.attachments.map((a, i) => ({ i, name: a.filename ?? `allegato-${i + 1}`, size: a.size, type: a.contentType })).filter((a) => !p.attachments[a.i].related),
    messageId: p.messageId ?? null,
    references: Array.isArray(p.references) ? p.references : p.references ? [p.references] : [],
  };
}

async function parsedMessage(f: Folder, uid: number, markRead: boolean): Promise<{ p: ParsedMail; unread: boolean }> {
  if (fakeMode()) {
    const raw = fakeRaw(f, uid);
    if (!raw) throw new MailError('Messaggio non trovato: forse è stato spostato o cancellato.');
    if (markRead) fakeSeen(f, uid);
    return { p: await simpleParser(raw), unread: false };
  }
  const c = mailboxConfig();
  if (!c) throw new MailError('Nessuna casella collegata.');
  try {
    return await withImap(c, async (client) => {
      const path = await folderPath(client, f);
      if (!path) throw new MailError('Cartella non trovata.');
      const lock = await client.getMailboxLock(path);
      try {
        const m = await client.fetchOne(String(uid), { uid: true, flags: true, source: true }, { uid: true });
        if (!m || !m.source) throw new MailError('Messaggio non trovato: forse è stato spostato o cancellato.');
        const unread = !m.flags?.has('\\Seen');
        if (markRead && unread) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => false);
        return { p: await simpleParser(m.source), unread };
      } finally {
        lock.release();
      }
    });
  } catch (e) {
    if (e instanceof MailError) throw e;
    throw new MailError(mailErrorText(e, c.provider));
  }
}

/** One message, whole; opening it in the inbox marks it as read (as in Gmail). */
export async function readMail(f: Folder, uid: number): Promise<MailFull> {
  const { p, unread } = await parsedMessage(f, uid, f === 'inbox');
  return toFull(uid, p, unread);
}

export async function mailAttachment(f: Folder, uid: number, i: number): Promise<{ name: string; type: string; base64: string }> {
  const { p } = await parsedMessage(f, uid, false);
  const a = p.attachments[i];
  if (!a) throw new MailError('Allegato non trovato.');
  if (a.size > 20 * 1024 * 1024) throw new MailError('Allegato troppo grande da scaricare qui: aprilo dalla casella.');
  return { name: a.filename ?? `allegato-${i + 1}`, type: a.contentType, base64: a.content.toString('base64') };
}

/* ------------------------------------------------------------------ */
/* sending                                                             */
/* ------------------------------------------------------------------ */

export interface OutMail {
  to: string;
  subject: string;
  text: string;
  /** answering this message of the inbox: the reply stays in the same conversation */
  replyUid?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const textToHtml = (t: string) => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2a33">${esc(t).replace(/\n/g, '<br>')}</div>`;

export async function sendMail(m: OutMail): Promise<{ to: string; subject: string }> {
  const c = mailboxConfig();
  if (!c) throw new MailError('Nessuna casella collegata.');
  let thread: { inReplyTo?: string; references?: string[] } = {};
  let quoted = '';
  if (m.replyUid) {
    const orig = await parsedMessage('inbox', m.replyUid, false).catch(() => null);
    if (orig) {
      const id = orig.p.messageId;
      const refs = Array.isArray(orig.p.references) ? orig.p.references : orig.p.references ? [orig.p.references] : [];
      thread = id ? { inReplyTo: id, references: [...refs, id] } : {};
      const who = orig.p.from?.text ?? '';
      const when = (orig.p.date ?? new Date()).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' });
      quoted = `\n\n${when}, ${who} ha scritto:\n${(orig.p.text ?? '').split('\n').slice(0, 60).map((l) => `> ${l}`).join('\n')}`;
    }
  }
  const text = `${m.text.trim()}${quoted}`;
  const mail = { from: `${c.name.replace(/[<>"]/g, '')} <${c.email}>`, to: m.to, subject: m.subject, text, html: textToHtml(text), ...thread };
  if (fakeMode()) {
    fakeSend(c, mail);
    return { to: m.to, subject: m.subject };
  }
  try {
    const nodemailer = await import('nodemailer');
    await nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.port, secure: c.smtp.secure, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15000 }).sendMail(mail);
  } catch (e) {
    throw new MailError(`Non inviata: ${mailErrorText(e, c.provider)}`);
  }
  // Gmail, Yahoo and iCloud keep what is sent by themselves; the others get a copy in "Inviati"
  if (c.provider === 'libero' || c.provider === 'aruba' || c.provider === 'altro') {
    try {
      const MailComposer = (await import('nodemailer/lib/mail-composer')).default;
      const raw = await new MailComposer(mail).compile().build();
      await withImap(c, async (client) => {
        const path = await folderPath(client, 'sent');
        if (path) await client.append(path, raw, ['\\Seen']);
      });
    } catch {
      // sent anyway: only the copy in "Inviati" is missing
    }
  }
  return { to: m.to, subject: m.subject };
}

/* ------------------------------------------------------------------ */
/* unread count for the side menu (never slows a page down)            */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __lancoraMailUnread?: { key: string; at: number; n: number; busy: boolean } };

/** The last known number of unread e-mails; refreshed in the background every 2 minutes at most. */
export function mailUnreadCached(): number | null {
  const c = mailboxConfig();
  if (!c) return null;
  const key = `${c.email}:${c.imap.host}`;
  const cur = g.__lancoraMailUnread?.key === key ? g.__lancoraMailUnread : (g.__lancoraMailUnread = { key, at: 0, n: 0, busy: false });
  if (!cur.busy && Date.now() - cur.at > 120_000) {
    cur.busy = true;
    const done = (n: number | null) => {
      if (n !== null) cur.n = n;
      cur.at = Date.now();
      cur.busy = false;
    };
    if (fakeMode()) done(fakeUnread());
    else
      withImap(c, async (client) => { const st = await client.status('INBOX', { unseen: true }); return st ? (st.unseen ?? 0) : 0; })
        .then(done)
        .catch(() => done(null));
  }
  return cur.n;
}

export function setMailUnread(n: number): void {
  if (g.__lancoraMailUnread) Object.assign(g.__lancoraMailUnread, { n, at: Date.now() });
}

/* ------------------------------------------------------------------ */
/* test mailbox (HOTEL_MAIL_FAKE=1, only for the checks on a copy)     */
/* ------------------------------------------------------------------ */

type FakeMsg = { uid: number; raw: string; seen: boolean };
const fg = globalThis as unknown as { __lancoraFakeMail?: { inbox: FakeMsg[]; sent: FakeMsg[] } };

function rawMail(p: { from: string; to: string; subject: string; date: Date; text: string; html?: string; id: string; attach?: { name: string; body: string } }): string {
  const head = [`From: ${p.from}`, `To: ${p.to}`, `Subject: ${p.subject}`, `Date: ${p.date.toUTCString()}`, `Message-ID: <${p.id}@prova.local>`, 'MIME-Version: 1.0'];
  if (!p.html && !p.attach) return [...head, 'Content-Type: text/plain; charset=utf-8', '', p.text].join('\r\n');
  const b = 'b0undary';
  const parts = [`--${b}`, 'Content-Type: text/plain; charset=utf-8', '', p.text];
  if (p.html) parts.push(`--${b}`, 'Content-Type: text/html; charset=utf-8', '', p.html);
  if (p.attach) parts.push(`--${b}`, `Content-Type: application/pdf; name="${p.attach.name}"`, `Content-Disposition: attachment; filename="${p.attach.name}"`, 'Content-Transfer-Encoding: base64', '', Buffer.from(p.attach.body).toString('base64'));
  parts.push(`--${b}--`);
  return [...head, `Content-Type: multipart/${p.attach ? 'mixed' : 'alternative'}; boundary="${b}"`, '', ...parts].join('\r\n');
}

function fakeStore() {
  if (fg.__lancoraFakeMail) return fg.__lancoraFakeMail;
  const h = (n: number) => new Date(Date.now() - n * 3600_000);
  const me = 'Hotel L’Ancora <prova@hotel.test>';
  const inbox: FakeMsg[] = [
    { uid: 11, seen: true, raw: rawMail({ id: 'm11', from: 'Booking.com <noreply@booking.test>', to: me, subject: 'Nuova recensione per la tua struttura', date: h(70), text: 'Un ospite ha lasciato una recensione: 9,2 / 10. Accedi per rispondere.' }) },
    { uid: 12, seen: false, raw: rawMail({ id: 'm12', from: 'Anna Schmidt <anna.schmidt@example.de>', to: me, subject: 'Anfrage: Zimmer mit Meerblick im Juli', date: h(26), text: 'Guten Tag,\n\nwir möchten vom 12. bis 19. Juli ein Doppelzimmer mit Meerblick buchen. Ist ein Kinderbett möglich?\n\nViele Grüße\nAnna Schmidt' }) },
    { uid: 13, seen: false, raw: rawMail({ id: 'm13', from: 'Marco Rossi <marco.rossi@example.it>', to: me, subject: 'Orario di arrivo e parcheggio', date: h(5), text: 'Buongiorno,\n\narriveremo verso le 22:30: è possibile fare il check-in tardi? E il parcheggio va prenotato?\n\nGrazie, Marco', html: '<p>Buongiorno,</p><p>arriveremo verso le <b>22:30</b>: è possibile fare il check-in tardi? E il parcheggio va prenotato?</p><p>Grazie, Marco</p><img src="https://tracker.example.com/pixel.gif" width="1" height="1">' }) },
    { uid: 14, seen: false, raw: rawMail({ id: 'm14', from: 'Studio Bianchi <fatture@studiobianchi.example>', to: me, subject: 'Fattura ottobre', date: h(1), text: 'In allegato la fattura del mese di ottobre.\n\nCordiali saluti', attach: { name: 'fattura-ottobre.pdf', body: '%PDF-1.4 prova' } }) },
  ];
  return (fg.__lancoraFakeMail = { inbox, sent: [] });
}

async function fakeList(f: Folder) {
  const s = fakeStore();
  const items: MailItem[] = [];
  for (const m of s[f]) {
    const { uid, from, to, subject, date, unread, snippet } = toFull(m.uid, await simpleParser(m.raw), !m.seen);
    items.push({ uid, from, to, subject, date, unread, snippet });
  }
  return { items: items.sort((a, b) => b.uid - a.uid), unread: fakeUnread() };
}
const fakeRaw = (f: Folder, uid: number) => fakeStore()[f].find((m) => m.uid === uid)?.raw ?? null;
function fakeSeen(f: Folder, uid: number) {
  const m = fakeStore()[f].find((x) => x.uid === uid);
  if (m) m.seen = true;
}
const fakeUnread = () => fakeStore().inbox.filter((m) => !m.seen).length;
function fakeSend(c: MailboxConfig, mail: { from: string; to: string; subject: string; text: string }) {
  const s = fakeStore();
  s.sent.push({ uid: 100 + s.sent.length, seen: true, raw: rawMail({ id: `s${s.sent.length}`, from: mail.from, to: mail.to, subject: mail.subject, date: new Date(), text: mail.text }) });
  void c;
}
