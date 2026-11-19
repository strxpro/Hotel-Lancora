import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB, Locale } from '../src/lib/types';

const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-emails-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

async function demo() {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date('2026-11-07T10:00:00Z'));
  Object.assign(db.settings.payments, { cancellationFee: { type: 'percent', value: 100 }, cancellationPolicy: 'Nota del proprietario in italiano.', refundPolicy: 'Rimborso entro 10 giorni.' });
  const b = db.bookings.find((x) => x.status === 'confirmed' && x.roomId)!;
  const room = db.rooms.find((r) => r.id === b.roomId)!;
  return { db, b, room };
}

test('every guest e-mail is written in the guest language; owner notes only in Italian', async () => {
  const { renderEmail } = await import('../src/server/email/templates');
  const { db, b, room } = await demo();
  const expect: Record<Locale, { subject: RegExp; rule: RegExp }> = {
    it: { subject: /^Prenotazione confermata · /, rule: /Cancellazione gratuita/ },
    en: { subject: /^Booking confirmed · /, rule: /Free cancellation/ },
    pl: { subject: /^Rezerwacja potwierdzona · /, rule: /Bezpłatne anulowanie/ },
    de: { subject: /^Buchung bestätigt · /, rule: /Kostenlose Stornierung/ },
    fr: { subject: /^Réservation confirmée · /, rule: /Annulation gratuite/ },
    es: { subject: /^Reserva confirmada · /, rule: /Cancelación gratuita/ },
  };
  for (const lang of Object.keys(expect) as Locale[]) {
    const guest = { ...b, guest: { ...b.guest, lang } };
    const r = renderEmail('conferma', { booking: guest, room, settings: db.settings });
    assert.equal(r.lang, lang);
    assert.match(r.subject, expect[lang].subject, lang);
    assert.match(r.html, new RegExp(`<html lang="${lang}">`));
    assert.match(r.text, expect[lang].rule, lang);
    assert.equal(r.html.includes('Nota del proprietario in italiano.'), lang === 'it', `owner note in ${lang}`);
    assert.ok(r.html.includes(lang === 'it' ? '/soggiorno/' : `/${lang}/soggiorno/`), `guest area link in ${lang}`);
  }
  // the language also comes from the country when the guest never chose one
  const de = renderEmail('rimborso', { booking: { ...b, guest: { ...b.guest, lang: undefined, country: 'AT' } }, room, settings: db.settings, extra: { amount: 50 } });
  assert.equal(de.lang, 'de');
  assert.match(de.subject, /^Erstattung veranlasst/);
  assert.match(de.text, /50,00/);
  // every template has text in every language (no Italian left in a Polish e-mail)
  for (const t of ['promemoria', 'modifica', 'cancellazione', 'ringraziamento', 'offerta_ritorno'] as const) {
    const pl = renderEmail(t, { booking: { ...b, guest: { ...b.guest, lang: 'pl' } }, room, settings: db.settings, extra: { promoCode: 'WRACAM', reviewUrl: 'https://g.page/x' } });
    assert.equal(pl.lang, 'pl');
    assert.doesNotMatch(pl.text, /\b(Ciao|Grazie|prenotazione|Prenotazione|Speriamo|Torna)\b/, t);
  }
  // messages to the hotel stay in Italian
  assert.equal(renderEmail('richiesta_ospite', { booking: { ...b, guest: { ...b.guest, lang: 'fr' } }, room, settings: db.settings, extra: { message: 'x' } }).lang, 'it');
});

test('guest area code: same template and fields (extra.code, extra.lang), language of the page', async () => {
  const { renderEmail } = await import('../src/server/email/templates');
  const { db, b } = await demo();
  const r = renderEmail('codice_accesso', { booking: b, room: null, settings: db.settings, extra: { code: '123456', lang: 'fr' } });
  assert.equal(r.lang, 'fr');
  assert.equal(r.subject, '123456 est votre code pour l’espace client');
  assert.match(r.html, /123456/);
  assert.match(r.html, /\/fr\/area-ospite/);
});

test('Make webhook receives template, language, booking code and guest name', async () => {
  const { sendEmail } = await import('../src/server/email/transport');
  let body: Record<string, string> = {};
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  try {
    await sendEmail({ to: 'x@gmail.com', subject: 's', html: '<p>h</p>', text: 't', meta: { id: 'em-1', template: 'conferma', lang: 'de', bookingCode: 'LA-1', guestName: 'Anna Weber', hotel: 'Hotel L’Ancora' } }, { kind: 'webhook', source: 'panel', hook: { url: 'https://hook.example.invalid/x' } });
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual([body.template, body.lang, body.booking_code, body.guest_name, body.email_id, body.kind], ['conferma', 'de', 'LA-1', 'Anna Weber', 'em-1', 'servizio']);
});

test('the e-mail of a website review is kept for the hotel and never published', async () => {
  const { db } = await demo();
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  const { createReview, publicReviews } = await import('../src/server/reviews');
  const { readDb } = await import('../src/server/db/store');
  const f = createReview({ name: 'Marta', email: 'Marta.R@Example.com', rating: 5, comment: 'Bellissimo soggiorno', lang: 'it', photos: [], roomId: null, publish: true });
  assert.equal(readDb().feedback.find((x) => x.id === f.id)?.email, 'marta.r@example.com');
  const { toTables } = await import('../src/server/db/tables');
  assert.equal(toTables(readDb()).feedback.find((r) => r.id === f.id)?.email, 'marta.r@example.com');
  const shown = publicReviews(readDb(), 'it').map((r) => JSON.stringify(r)).join('');
  assert.doesNotMatch(shown, /marta\.r@example\.com/);
});
