import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';

const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-instant-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('the day Stripe turns instant transfers on, the hotel is told once (panel, Telegram, e-mail)', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date());
  db.settings.hotel.email = 'reception@hotel-lancora.it';
  db.settings.stripeConnect.autoInstant = true;
  db.settings.stripeConnect.instantSince = null;
  db.outbox = [];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  const { instantJustEnabled, announceInstantPayouts } = await import('../src/server/payments/instant');
  const { mutate, readDb } = await import('../src/server/db/store');
  const ev = await import('../src/server/events');

  // a new account: no instant balance yet; eligible: the field is there (even at 0)
  assert.equal(instantJustEnabled({ instant_available: undefined }, null), false);
  assert.equal(instantJustEnabled({ instant_available: [{ amount: 0, currency: 'eur', source_types: {} }] }, null), true);
  assert.equal(instantJustEnabled({ instant_available: [{ amount: 0, currency: 'eur', source_types: {} }] }, '2026-11-23T10:00:00Z'), false);

  assert.equal(mutate((d) => announceInstantPayouts(d, ev)), true);
  const d = readDb();
  assert.ok(d.settings.stripeConnect.instantSince);
  assert.match(d.notifications[0]!.title, /bonifici immediati/);
  assert.match(d.notifications[0]!.body, /Aggiungi carta di debito/);
  assert.match(d.notifications[0]!.body, /da solo/, 'says the panel sends them by itself (auto on)');
  const mail = d.outbox.find((e) => e.template === 'avviso_hotel');
  assert.ok(mail);
  assert.equal(mail.to, 'reception@hotel-lancora.it');
  assert.match(mail.html, />Bonifici immediati attivati<\/h1>/);
  assert.match(mail.html, /\/admin\/pagamenti/);
  // never twice
  assert.equal(mutate((x) => announceInstantPayouts(x, ev)), false);
  assert.equal(readDb().outbox.filter((e) => e.template === 'avviso_hotel').length, 1);
});
