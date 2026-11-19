import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingUrl, gateLang, gatePage } from '../src/lib/site-gate';
import { instantFromBalance } from '../src/server/payments/instant';

test('password page: in the visitor language, with the hotel on Booking.com', () => {
  assert.equal(gateLang('/pl/camere', 'it-IT,it;q=0.9'), 'pl');
  assert.equal(gateLang('/', 'de-DE,de;q=0.9,en;q=0.8'), 'de');
  assert.equal(gateLang('/camere', 'ja-JP,ru;q=0.8'), 'it');
  assert.equal(gateLang('/english-page', 'fr'), 'fr');
  const pl = gatePage('/pl/camere', true, 'pl');
  assert.match(pl, /<html lang="pl">/);
  assert.match(pl, /Strona w przygotowaniu/);
  assert.match(pl, /Nieprawidłowe hasło/);
  assert.match(pl, /href="https:\/\/www\.booking\.com\/hotel\/it\/lancorasantateresagallura\.pl\.html"/);
  // the language links keep the page: /camere in Italian, /en/camere in English
  assert.match(pl, /href="\/camere" hreflang="it"/);
  assert.match(pl, /href="\/en\/camere" hreflang="en"/);
  assert.equal(bookingUrl('en'), 'https://www.booking.com/hotel/it/lancorasantateresagallura.en-gb.html');
  // the Italian page stays as before
  assert.match(gatePage('/', true), /Password non corretta/);
});

test("instant payout from the hotel's own account: Stripe's instant balance decides", () => {
  const bal = (instant: number, available = 0, pending = 0) => ({
    instant_available: [{ amount: instant, currency: 'eur', source_types: { card: instant } }],
    available: [{ amount: available, currency: 'eur', source_types: { card: available } }],
    pending: [{ amount: pending, currency: 'eur', source_types: { card: pending } }],
  }) as never;
  assert.deepEqual(instantFromBalance(bal(12345), false), { simulated: false, test: false, fee: 0, to: null, destination: null, max: 123.45, state: 'ready' });
  // money there but nothing can leave instantly: not activated yet (or today's limit reached)
  assert.equal(instantFromBalance(bal(0, 5000), false).state, 'not_enabled');
  assert.equal(instantFromBalance(bal(0), false).state, 'empty');
  assert.equal(instantFromBalance(bal(2_000_000), false).max, 9999);
});
