import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-stripe-direct-'));
process.env.DATA_DIR = dataDir;
for (const k of ['STORE_MODE', 'GROQ_API_KEY', 'TELEGRAM_BOT_TOKEN', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY']) delete process.env[k];
process.env.DEMO_MODE = 'false';
process.env.ALLOW_LIVE_PAYMENTS = 'true';
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("the hotel's own Stripe: no connected account in between, cards on once Stripe activated the account", async () => {
  const { writeIntegrations } = await import('../src/server/integrations');
  const { cardPaymentsReady, hotelOwnStripe, payoutDestination, stripeMode } = await import('../src/server/payments/stripe');
  const { mutate, readDb } = await import('../src/server/db/store');
  const key = 'sk_live_' + 'x'.repeat(30);
  writeIntegrations({ stripe: { secretKey: key, publishableKey: 'pk_live_' + 'y'.repeat(30), owner: 'hotel' } });
  assert.equal(stripeMode(), 'live');
  assert.equal(hotelOwnStripe(), true);
  mutate((db) => Object.assign(db.settings.stripeConnect, { accountId: null, simulated: false, direct: true, chargesEnabled: false }));
  // not activated yet on Stripe: guests pay at the hotel
  assert.equal(cardPaymentsReady(readDb()), false);
  mutate((db) => Object.assign(db.settings.stripeConnect, { chargesEnabled: true }));
  assert.equal(cardPaymentsReady(readDb()), true);
  // the money stays on the hotel's account: no transfer to anyone
  assert.equal(payoutDestination(readDb()), null);
  // the same keys marked as the site's platform: a hotel account must be connected first
  writeIntegrations({ stripe: { secretKey: key, publishableKey: 'pk_live_' + 'y'.repeat(30), owner: 'platform' } });
  assert.equal(hotelOwnStripe(), false);
  assert.equal(cardPaymentsReady(readDb()), false);
});
