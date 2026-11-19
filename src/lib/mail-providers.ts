/** The mailboxes the "Posta" tab knows by name (server addresses), shared by the page and the server. */
export type MailProvider = 'gmail' | 'libero' | 'aruba' | 'yahoo' | 'icloud' | 'altro';
export type MailServer = { host: string; port: number; secure: boolean };

export const PROVIDERS: Record<Exclude<MailProvider, 'altro'>, { imap: MailServer; smtp: MailServer }> = {
  gmail: { imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true } },
  libero: { imap: { host: 'imapmail.libero.it', port: 993, secure: true }, smtp: { host: 'smtp.libero.it', port: 465, secure: true } },
  aruba: { imap: { host: 'imaps.aruba.it', port: 993, secure: true }, smtp: { host: 'smtps.aruba.it', port: 465, secure: true } },
  yahoo: { imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true } },
  icloud: { imap: { host: 'imap.mail.me.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false } },
};

/** The provider an address most likely belongs to (a hotel's own domain: the owner picks). */
export function guessProvider(email: string): MailProvider | null {
  const d = email.split('@')[1]?.toLowerCase().trim() ?? '';
  if (/^(gmail|googlemail)\.com$/.test(d)) return 'gmail';
  if (/^(libero|inwind|iol|blu|giallo)\.it$/.test(d)) return 'libero';
  if (/^yahoo\./.test(d) || d === 'ymail.com') return 'yahoo';
  if (/^(icloud|me|mac)\.com$/.test(d)) return 'icloud';
  return null;
}
