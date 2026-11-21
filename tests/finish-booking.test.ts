import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';

// the server modules read DATA_DIR when they load: set it first, import them inside the tests
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-finish-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('an unpaid hold that runs out frees the nights and e-mails the guest a link to finish, once a day', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date());
  const base = db.bookings[0]!;
  const past = new Date(Date.now() - 60_000).toISOString();
  const hold = (id: string, token: string, minutesAgo: number) => ({
    ...structuredClone(base),
    id,
    code: `LA-${id.toUpperCase()}`,
    token,
    status: 'pending_payment' as const,
    holdExpiresAt: past,
    amountPaid: 0,
    source: 'sito' as const,
    demo: false,
    simulated: false,
    guest: { firstName: 'Anna', lastName: 'Verdi', email: 'anna.verdi@gmail.com', phone: '+39 333 1', lang: 'en' as const },
    specialRequests: 'Arrivo tardi\n\nSupplementi richiesti, da pagare in hotel: Culla = 10 €',
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  });
  db.bookings = [hold('h1', 'TokenOfTheFirstHold_0123456789ab', 30)];
  db.outbox = [];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));

  const { releaseExpiredHolds, resumeDetails } = await import('../src/server/bookings');
  const { readDb, mutate } = await import('../src/server/db/store');
  const { isBookingActive } = await import('../src/lib/availability');
  // the nights are free from the minute the hold runs out, even before the sweep
  assert.equal(isBookingActive(readDb().bookings[0]!), false);

  assert.equal(releaseExpiredHolds(), 1);
  let d = readDb();
  assert.equal(d.bookings[0]!.status, 'cancelled');
  const mail = d.outbox.find((e) => e.template === 'prenotazione_da_finire');
  assert.ok(mail, 'the guest gets the e-mail');
  assert.equal(mail.to, 'anna.verdi@gmail.com');
  assert.match(mail.subject, /not finished/, 'in the guest’s language');
  assert.match(mail.html, /riprendi=TokenOfTheFirstHold_0123456789ab/);
  assert.match(mail.html, /checkIn=/);
  assert.match(d.notifications[0]!.body, /link per finire/, 'the owner is told the guest was written to');

  // the link fills the form again with what the guest typed (the supplements line is not repeated)
  assert.deepEqual(resumeDetails('TokenOfTheFirstHold_0123456789ab'), { firstName: 'Anna', lastName: 'Verdi', email: 'anna.verdi@gmail.com', phone: '+39 333 1', specialRequests: 'Arrivo tardi' });
  assert.equal(resumeDetails('not-a-real-token-at-all-0000'), null);

  // a second abandoned attempt the same day: no second e-mail
  mutate((x) => {
    x.bookings.push(hold('h2', 'TokenOfTheSecondHold_0123456789', 10));
  });
  releaseExpiredHolds();
  d = readDb();
  assert.equal(d.outbox.filter((e) => e.template === 'prenotazione_da_finire').length, 1);
});
