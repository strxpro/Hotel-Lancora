import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { renderEmail, TEMPLATE_LABELS } from '@/server/email/templates';
import { smtpConfigured } from '@/server/events';
import { LOCALES, type EmailTemplate, type Locale } from '@/lib/types';
import { PageHeader } from '@/components/admin/ui';
import { MessagesCenter } from '@/components/admin/managers';

export const metadata = { title: 'Messaggi' };

export default async function MessagesPage() {
  await requirePageUser('bookings.manage');
  const db = readDb();
  const sample = db.bookings.find((b) => b.status === 'confirmed' && b.roomId) ?? null;
  const room = sample ? (db.rooms.find((r) => r.id === sample.roomId) ?? null) : null;
  const keys: EmailTemplate[] = ['conferma', 'promemoria', 'modifica', 'cancellazione', 'rimborso', 'ringraziamento', 'offerta_ritorno', 'richiesta_recensione', 'codice_accesso', 'prenotazione_da_finire'];
  const render = (k: EmailTemplate, lang: Locale) => renderEmail(k, { booking: sample, room, settings: db.settings, extra: { amount: 120, promoCode: 'DIRETTO10', reviewUrl: db.settings.hotel.googleReviewUrl || undefined, lang, code: '483920' } }).html;
  // every guest e-mail in the six languages of the site: the owner can see what each guest receives
  const templates = keys.map((k) => ({ key: k, label: TEMPLATE_LABELS[k], html: render(k, 'it'), byLang: Object.fromEntries(LOCALES.map((l) => [l, render(k, l)])) }));
  return (
    <div>
      <PageHeader eyebrow="Comunicazioni" title="Messaggi" description="Richieste degli ospiti, archivio delle email inviate e anteprima dei modelli in ogni lingua." />
      <MessagesCenter
        messages={db.messages.filter((m) => m.sender !== 'hotel').map((m) => ({ id: m.id, name: m.name, email: m.email, subject: m.subject, body: m.body, source: m.source, read: m.read, createdAt: m.createdAt, bookingId: m.bookingId }))}
        outbox={db.outbox.slice(0, 80).map((e) => ({ id: e.id, to: e.to, subject: e.subject, template: e.template, html: e.html, status: e.status, createdAt: e.createdAt, error: e.error }))}
        templates={templates}
        smtp={smtpConfigured()}
      />
    </div>
  );
}
