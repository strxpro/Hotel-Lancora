import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type Stripe from 'stripe';
import type { DB } from '../src/lib/types';

/**
 * "Ricevi subito": what the panel offers comes only from Stripe's numbers (the instant balance, net
 * of any cost, and a card that accepts instant transfers); the amount is checked again on sending.
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-instant-'));
process.env.DATA_DIR = dataDir;
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY']) delete process.env[k];
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const card = (x: Partial<Stripe.Card> = {}) => ({ object: 'card', id: 'card_1', brand: 'Visa', last4: '4242', currency: 'eur', default_for_currency: true, available_payout_methods: ['standard', 'instant'], ...x }) as unknown as Stripe.Card;
const bank = (x: Partial<Stripe.BankAccount> = {}) => ({ object: 'bank_account', id: 'ba_1', bank_name: 'Intesa', last4: '1234', currency: 'eur', default_for_currency: true, available_payout_methods: ['standard'], ...x }) as unknown as Stripe.BankAccount;
const bal = (instant: number, net?: number, available = 0, pending = 0) =>
  ({
    available: [{ amount: available, currency: 'eur' }],
    pending: [{ amount: pending, currency: 'eur' }],
    instant_available: [{ amount: instant, currency: 'eur', ...(net !== undefined ? { net_available: [{ amount: net, destination: 'card_1' }] } : {}) }],
  }) as unknown as Stripe.Balance;

test('ready: the most that can arrive, where, and what it costs', async () => {
  const { instantFromStripe } = await import('../src/server/payments/instant');
  const v = instantFromStripe(bal(50000, 49500), [bank(), card()], false);
  assert.equal(v.state, 'ready');
  assert.equal(v.max, 495);
  assert.equal(v.fee, 5);
  assert.equal(v.to, 'Visa •••• 4242');
  assert.equal(v.destination, 'card_1');
  // no cost set by the site: what is there arrives whole
  assert.equal(instantFromStripe(bal(12345), [card()], true).fee, 0);
  assert.equal(instantFromStripe(bal(12345), [card()], true).max, 123.45);
  // Stripe's limit for one transfer
  assert.equal(instantFromStripe(bal(2_000_000), [card()], false).max, 9999);
});

test('not possible yet: no card, not enabled, nothing there', async () => {
  const { instantFromStripe } = await import('../src/server/payments/instant');
  // only the IBAN, which does not accept instant transfers
  assert.equal(instantFromStripe(bal(50000), [bank()], false).state, 'no_card');
  // money waiting, none of it instant: Stripe has not switched it on (or today's limit is used)
  const v = instantFromStripe(bal(0, undefined, 30000, 10000), [card()], false);
  assert.equal(v.state, 'not_enabled');
  assert.equal(v.to, 'Visa •••• 4242');
  assert.equal(instantFromStripe(bal(0), [card()], false).state, 'empty');
  // a bank that accepts instant transfers is fine too
  assert.equal(instantFromStripe(bal(9000), [bank({ available_payout_methods: ['standard', 'instant'] })], false).to, 'Intesa •••• 1234');
});

test('the demo moves nothing and the amount is checked on sending', async () => {
  const { sendInstant, instantView } = await import('../src/server/payments/instant');
  const now = new Date().toISOString();
  const db = {
    settings: { stripeConnect: { accountId: 'acct_SIMULAZIONE', simulated: true, detailsSubmitted: true, payoutInterval: 'daily', weeklyAnchor: 'monday', monthlyAnchor: 1 } },
    payments: [
      { amount: 180, provider: 'simulazione', status: 'succeeded', createdAt: now },
      { amount: 60, provider: 'contanti', status: 'succeeded', createdAt: now },
    ],
  } as unknown as DB;
  const v = await instantView(db);
  assert.equal(v?.state, 'ready');
  assert.equal(v?.simulated, true);
  assert.equal(v?.max, 180); // card takings only, not the cash
  const r = await sendInstant(db, 100);
  assert.deepEqual([r.amount, r.simulated, r.id], [100, true, null]);
  await assert.rejects(() => sendInstant(db, 500), /al massimo/);
  await assert.rejects(() => sendInstant(db, 0.2), /minimo/);
  // nothing connected: no tile at all
  const none = { settings: { stripeConnect: { accountId: null, simulated: false } }, payments: [] } as unknown as DB;
  assert.equal(await instantView(none), null);
});

test('Stripe refusals in plain words', async () => {
  const { instantErrorText } = await import('../src/server/payments/instant');
  assert.match(instantErrorText({ code: 'instant_payouts_limit_exceeded' }), /limite/);
  assert.match(instantErrorText({ code: 'instant_payouts_unsupported' }), /non ha ancora attivato/);
  assert.match(instantErrorText({ code: 'balance_insufficient' }), /non è più disponibile/);
  assert.match(instantErrorText({}), /Nessun soldo è stato spostato/);
});
