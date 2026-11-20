import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../src/lib/types';
import { addDays, todayISO } from '../src/lib/dates';
import { nextPayoutDay } from '../src/lib/payout';

/**
 * "Prossimo bonifico" from Stripe's own numbers (stand-in Stripe, no network): with payouts "a mano"
 * nothing leaves by itself, but the day the money becomes available is still told; with a daily
 * calendar the payout day is the first business day once the money is available.
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-payout-'));
process.env.DATA_DIR = dataDir;
process.env.STRIPE_SECRET_KEY = `sk_test_${'y'.repeat(30)}`;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('next payout: manual on Stripe → no day, but "available from"; daily → the first business day it can leave', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const db: DB = buildSeed(new Date('2026-11-07T10:00:00Z'));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db));
  const { stripe } = await import('../src/server/payments/stripe');
  const s = stripe() as unknown as Record<string, Record<string, unknown>>;
  let interval = 'manual';
  // 0.72 € waiting, available in a week
  const on = addDays(todayISO(), 7);
  const day = Date.UTC(Number(on.slice(0, 4)), Number(on.slice(5, 7)) - 1, Number(on.slice(8)), 12) / 1000;
  s.payouts!.list = async () => ({ data: [] });
  s.balance!.retrieve = async () => ({ available: [{ amount: 0, currency: 'eur' }], pending: [{ amount: 72, currency: 'eur' }] });
  s.accounts!.retrieveCurrent = async () => ({ settings: { payouts: { schedule: { interval, delay_days: 3 } } }, external_accounts: { data: [] } });
  s.balanceTransactions!.list = async () => ({ data: [{ status: 'pending', currency: 'eur', available_on: day, net: 72 }] });

  const { payoutInfo } = await import('../src/server/payments/payout');
  const { readDb } = await import('../src/server/db/store');
  const manual = await payoutInfo(readDb());
  assert.equal(manual.source, 'stripe');
  assert.equal(manual.status, 'manual');
  assert.equal(manual.date, null);
  assert.equal(manual.amount, 0.72);
  assert.equal(manual.availableOn, on);

  // daily: the payout leaves on the first business day from then (cache cleared)
  interval = 'daily';
  (globalThis as { __lancoraPayout?: unknown }).__lancoraPayout = undefined;
  const daily = await payoutInfo(readDb());
  assert.equal(daily.status, 'scheduled');
  assert.equal(daily.date, nextPayoutDay(on, { interval: 'daily', weeklyAnchor: 'monday', monthlyAnchor: 1 }));
  assert.equal(daily.amount, 0.72);
});
