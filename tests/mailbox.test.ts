import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The "Posta" tab: the hotel's mailbox in the panel. Providers known by address, refusals in plain
 * words, guest e-mails leaving from the mailbox when the owner wants, and reading / answering
 * (checked on the test mailbox, which never touches a real server).
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-mailbox-'));
process.env.DATA_DIR = dataDir;
for (const k of ['SMTP_HOST', 'SMTP_FROM', 'CLOUDFLARE_ACCOUNT_ID', 'EMAIL_WEBHOOK_URL', 'HOTEL_MAIL_FAKE']) delete process.env[k];
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const box = {
  provider: 'gmail' as const,
  email: 'hotel@gmail.com',
  name: 'Hotel L’Ancora',
  user: 'hotel@gmail.com',
  pass: 'abcdabcdabcdabcd',
  imap: { host: 'imap.gmail.com', port: 993, secure: true },
  smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
  sendGuests: true,
  connectedAt: '2026-11-19T10:00:00Z',
};

test('the provider follows the address', async () => {
  const { guessProvider } = await import('../src/lib/mail-providers');
  assert.equal(guessProvider('info@gmail.com'), 'gmail');
  assert.equal(guessProvider('mario@libero.it'), 'libero');
  assert.equal(guessProvider('x@yahoo.it'), 'yahoo');
  assert.equal(guessProvider('x@icloud.com'), 'icloud');
  assert.equal(guessProvider('info@hotellancora.it'), null);
});

test('refusals in the owner’s words', async () => {
  const { mailErrorText, snippetOf } = await import('../src/server/mail/mailbox');
  assert.match(mailErrorText({ authenticationFailed: true }, 'gmail'), /password per le app/);
  assert.match(mailErrorText({ code: 'EAUTH' }, 'aruba'), /Email o password non corretti/);
  assert.match(mailErrorText({ code: 'ENOTFOUND' }), /non trovato/);
  assert.match(mailErrorText({ code: 'ETIMEDOUT' }), /non risponde/);
  // previews: no quoted lines, no leftover encoded blocks
  assert.equal(snippetOf('Ciao!\n> vecchio testo\nArriviamo alle 22  QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eg=='), 'Ciao! Arriviamo alle 22');
});

test('guest e-mails leave from the mailbox only when the owner wants', async () => {
  const { writeIntegrations, emailTransport } = await import('../src/server/integrations');
  writeIntegrations({ emailWebhook: { url: 'https://hook.example.com/x' }, mailbox: box });
  const t = emailTransport();
  assert.equal(t?.kind, 'smtp');
  assert.equal(t?.kind === 'smtp' && t.smtp.from, 'Hotel L’Ancora <hotel@gmail.com>');
  assert.equal(t?.kind === 'smtp' && t.smtp.host, 'smtp.gmail.com');
  // switched off: back to what was connected before (the Make scenario), nothing lost
  writeIntegrations({ mailbox: { ...box, sendGuests: false } });
  assert.equal(emailTransport()?.kind, 'webhook');
  // the page never sees the password
  const { mailboxPublic } = await import('../src/server/mail/mailbox');
  assert.equal(JSON.stringify(mailboxPublic()).includes(box.pass), false);
});

test('reading, attachments and answering in the same conversation (test mailbox)', async () => {
  process.env.HOTEL_MAIL_FAKE = '1';
  const { writeIntegrations } = await import('../src/server/integrations');
  writeIntegrations({ mailbox: box });
  const { listMail, readMail, mailAttachment, sendMail, testMailbox, mailUnreadCached } = await import('../src/server/mail/mailbox');
  await assert.rejects(() => testMailbox({ ...box, pass: 'sbagliata' }), /password per le app/);
  const l = await listMail('inbox');
  assert.equal(l.items[0].subject, 'Fattura ottobre'); // newest first
  assert.equal(l.unread, 3);
  assert.equal(mailUnreadCached(), 3);
  const m = await readMail('inbox', 13);
  assert.equal(m.from.address, 'marco.rossi@example.it');
  assert.match(m.html ?? '', /22:30/);
  assert.equal((await listMail('inbox')).unread, 2); // opened = read
  const inv = await readMail('inbox', 14);
  assert.equal(inv.attachments[0].name, 'fattura-ottobre.pdf');
  const a = await mailAttachment('inbox', 14, 0);
  assert.equal(Buffer.from(a.base64, 'base64').toString(), '%PDF-1.4 prova');
  await sendMail({ to: 'marco.rossi@example.it', subject: 'Re: Orario di arrivo e parcheggio', text: 'Certo, la aspettiamo!', replyUid: 13 });
  const sent = await listMail('sent');
  assert.equal(sent.items.length, 1);
  const s = await readMail('sent', sent.items[0].uid);
  assert.equal(s.to[0].address, 'marco.rossi@example.it');
  assert.match(s.text, /Certo, la aspettiamo!/);
  assert.match(s.text, /> arriveremo verso le 22:30/); // the original, quoted below
  delete process.env.HOTEL_MAIL_FAKE;
});
