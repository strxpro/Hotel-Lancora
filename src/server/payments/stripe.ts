import 'server-only';
import Stripe from 'stripe';
import type { DB } from '@/lib/types';
import { readIntegrations, stripeKeys } from '../integrations';

/**
 * Stripe is optional. The demo only ever accepts TEST keys (sk_test_…); live keys are refused
 * unless DEMO_MODE=false and ALLOW_LIVE_PAYMENTS=true are both set explicitly.
 */
export function stripeMode(): 'test' | 'live' | 'off' {
  const key = stripeKeys().secret;
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  if (key.startsWith('sk_live_') && process.env.DEMO_MODE === 'false' && process.env.ALLOW_LIVE_PAYMENTS === 'true') return 'live';
  return 'off';
}

/**
 * The pretend card payment (no Stripe) exists only for the demo. On the real site (DEMO_MODE=false)
 * without Stripe the guest can only choose "pay at the hotel": a booking is never confirmed as paid
 * when no money moved.
 */
export function simulationAllowed(): boolean {
  return process.env.DEMO_MODE !== 'false';
}

/** Publishable key for Embedded Checkout — only returned when it matches the secret key's mode. */
export function publishableKey(): string | null {
  const pk = stripeKeys().publishable;
  const mode = stripeMode();
  if (mode === 'test' && pk.startsWith('pk_test_')) return pk;
  if (mode === 'live' && pk.startsWith('pk_live_')) return pk;
  return null;
}

let client: { key: string; c: Stripe } | null = null;
export function stripe(): Stripe {
  if (stripeMode() === 'off') throw new Error('Stripe non configurato');
  const key = stripeKeys().secret;
  if (!client || client.key !== key) client = { key, c: new Stripe(key) };
  return client.c;
}

/**
 * The keys on the site open the hotel's OWN Stripe account (connected in Collegamenti as "conto
 * dell'hotel"): every payment lands there directly, no connected account, no "Collega Stripe".
 * Keys in the server environment are always the platform's.
 */
export function hotelOwnStripe(): boolean {
  return !process.env.STRIPE_SECRET_KEY && readIntegrations().stripe?.owner === 'hotel';
}

/** A connected account that can receive money (real, not the demo simulation). */
export function payoutDestination(db: DB): string | null {
  if (hotelOwnStripe()) return null;
  const c = db.settings.stripeConnect;
  return c.accountId && !c.simulated && c.chargesEnabled ? c.accountId : null;
}

/**
 * Card payments a guest can really make now. With the test keys always (no money moves); with the
 * real keys only once the hotel's own account is connected and can take payments: before that the
 * money would land on the platform's account instead of the hotel's, so the guest pays at the hotel.
 */
export function cardPaymentsReady(db: DB): boolean {
  const m = stripeMode();
  if (m === 'off') return false;
  if (m === 'test') return true;
  // the hotel's own account: ready once Stripe has activated it for payments
  if (hotelOwnStripe()) return db.settings.stripeConnect.direct === true && db.settings.stripeConnect.chargesEnabled;
  return payoutDestination(db) !== null;
}

const pa = globalThis as unknown as { __lancoraPlatform?: { key: string; at: number; ok: boolean } };

/**
 * With the platform's real keys, Stripe lets hotels connect only once the platform's own account
 * is activated (data, document, IBAN). Read at most every 10 minutes; true when unsure (test keys,
 * Stripe not answering) so the button is never hidden by mistake.
 */
export async function platformReady(): Promise<boolean> {
  if (stripeMode() !== 'live' || hotelOwnStripe()) return true;
  const key = stripeKeys().secret;
  const c = pa.__lancoraPlatform;
  if (c && c.key === key && Date.now() - c.at < (c.ok ? 3_600_000 : 600_000)) return c.ok;
  const acc = await Promise.race([stripe().accounts.retrieveCurrent(), new Promise<null>((r) => setTimeout(() => r(null), 3500))]).catch(() => null);
  if (!acc) return true;
  const ok = Boolean(acc.charges_enabled || acc.details_submitted);
  pa.__lancoraPlatform = { key, at: Date.now(), ok };
  return ok;
}

/**
 * Stripe does not know this hotel account with the keys in use now: it was made in test mode and
 * the site now has the live keys (or the keys of another Stripe). Test and live are two separate
 * worlds, so the hotel connects once more with the real keys.
 */
export function accountGone(e: unknown): boolean {
  const x = e as { code?: string; statusCode?: number } | null;
  return x?.code === 'account_invalid' || x?.code === 'resource_missing' || x?.statusCode === 404;
}

/** The panel back to "not connected" (the account itself, if any, stays on Stripe). */
export function clearConnect(db: DB): void {
  Object.assign(db.settings.stripeConnect, { accountId: null, simulated: false, direct: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, businessName: null, bankLast4: null, requirements: [], updatedAt: new Date().toISOString() });
}

export function platformFee(amount: number): number | undefined {
  const pct = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT ?? 0);
  return pct > 0 ? Math.round(amount * 100 * (pct / 100)) : undefined;
}

export async function createCheckoutSession(p: {
  bookingId: string;
  code: string;
  amount: number;
  description: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
  expiresInMinutes: number;
  locale: string;
  embedded: boolean;
  destination: string | null;
  image?: string | null;
}) {
  const s = stripe();
  const transfer: Partial<Stripe.Checkout.SessionCreateParams.PaymentIntentData> = p.destination
    ? { transfer_data: { destination: p.destination }, on_behalf_of: p.destination, application_fee_amount: platformFee(p.amount) }
    : {};
  const session = await s.checkout.sessions.create({
    mode: 'payment',
    ...(p.embedded ? { ui_mode: 'embedded_page', return_url: p.successUrl } : { success_url: p.successUrl, cancel_url: p.cancelUrl }),
    customer_email: p.email,
    // the card stays with the booking (a customer is created for it): the hotel can later charge a
    // no-show or a late cancellation, or the balance, without asking the guest to type it again
    customer_creation: 'always',
    client_reference_id: p.bookingId,
    metadata: { bookingId: p.bookingId, code: p.code },
    payment_intent_data: { metadata: { bookingId: p.bookingId, code: p.code }, setup_future_usage: 'off_session', ...transfer },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(p.amount * 100),
          product_data: { name: `Hotel L’Ancora · ${p.code}`, description: p.description, ...(p.image ? { images: [p.image] } : {}) },
        },
      },
    ],
    // Stripe requires ≥ 30 minutes
    expires_at: Math.floor(Date.now() / 1000) + Math.max(30, p.expiresInMinutes) * 60,
    locale: (['it', 'en', 'pl', 'de', 'fr', 'es'].includes(p.locale) ? p.locale : 'auto') as Stripe.Checkout.SessionCreateParams.Locale,
  });
  return session;
}

export function verifyWebhook(rawBody: string, signature: string | null): Stripe.Event {
  // two endpoints call the same address: the platform one (payments) and the Connect one (the hotel's account)
  const secrets = [stripeKeys().webhook, readIntegrations().stripe?.connectWebhookSecret].filter((s): s is string => Boolean(s));
  if (!secrets.length || !signature) throw new Error('Webhook Stripe non configurato');
  let last: unknown = null;
  for (const secret of secrets) {
    try {
      return stripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/* ------------------------------------------------------------------ */
/* Stripe Connect (Express): the hotel's own Stripe account receives   */
/* the money; onboarding, KYC and the bank account are handled by      */
/* Stripe's hosted pages.                                              */
/* ------------------------------------------------------------------ */

export type PayoutInterval = 'daily' | 'weekly' | 'monthly';
export interface ConnectStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  payoutInterval: PayoutInterval;
  weeklyAnchor: string;
  monthlyAnchor: number;
  requirements: string[];
  businessName: string | null;
  bankLast4: string | null;
}

/**
 * The hotel's account is created with Accounts v2 (Stripe refuses the old v1 creation for new
 * platforms). Same set-up as before: the hotel is the merchant (card payments, MCC 7011 hotels),
 * receives the transfers of the destination charges, sees the Express dashboard, and the platform
 * pays Stripe's fees and covers negative balances (Stripe's recommendation for destination charges).
 * Everything else (status, payout schedule, dashboard link) keeps using the v1 endpoints, which
 * Stripe supports for v2 accounts.
 */
export async function createConnectAccount(p: { email: string; name: string; url: string }): Promise<string> {
  const acc = await stripe().v2.core.accounts.create({
    contact_email: p.email,
    display_name: p.name,
    dashboard: 'express',
    identity: { country: 'IT' },
    configuration: {
      // MCC 7011 = Hotels, Motels, Resorts
      merchant: { mcc: '7011', capabilities: { card_payments: { requested: true } } },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    defaults: {
      currency: 'eur',
      locales: ['it-IT'],
      responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      profile: { ...(p.url.startsWith('https://') ? { business_url: p.url } : {}), product_description: 'Soggiorni in hotel prenotati dal sito ufficiale' },
    },
    metadata: { app: 'hotel-lancora' },
  });
  // payouts every day, as before (v1 settings work on v2 accounts); not blocking if it fails
  await stripe()
    .accounts.update(acc.id, { settings: { payouts: { schedule: { interval: 'daily' } } } })
    .catch(() => null);
  return acc.id;
}

export async function connectOnboardingLink(accountId: string, base: string): Promise<string> {
  const link = await stripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: { type: 'account_onboarding', account_onboarding: { refresh_url: `${base}/api/stripe/connect/refresh`, return_url: `${base}/api/stripe/connect/return` } },
  });
  return link.url;
}

export function statusFromAccount(acc: Stripe.Account): ConnectStatus {
  const sched = acc.settings?.payouts?.schedule;
  const bank = acc.external_accounts?.data?.find((x) => x.object === 'bank_account') as Stripe.BankAccount | undefined;
  return {
    chargesEnabled: Boolean(acc.charges_enabled),
    payoutsEnabled: Boolean(acc.payouts_enabled),
    detailsSubmitted: Boolean(acc.details_submitted),
    payoutInterval: (['daily', 'weekly', 'monthly'].includes(sched?.interval ?? '') ? sched!.interval : 'daily') as PayoutInterval,
    weeklyAnchor: sched?.weekly_anchor ?? 'monday',
    monthlyAnchor: sched?.monthly_anchor ?? 1,
    requirements: acc.requirements?.currently_due ?? [],
    businessName: acc.business_profile?.name ?? acc.settings?.dashboard?.display_name ?? null,
    bankLast4: bank?.last4 ?? null,
  };
}

export async function retrieveConnectStatus(accountId: string): Promise<ConnectStatus> {
  return statusFromAccount(await stripe().accounts.retrieve(accountId));
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

/** The hotel's own account (keys of the hotel): status, IBAN and payout calendar as Stripe has them. */
export async function retrieveOwnStatus(): Promise<ConnectStatus> {
  const s = stripe();
  const acc = await s.accounts.retrieveCurrent();
  const st = statusFromAccount(acc);
  // the IBAN's last digits, when Stripe lets the account read its own bank accounts
  if (!st.bankLast4) {
    const ext = await s.accounts.listExternalAccounts(acc.id, { object: 'bank_account', limit: 5 }).catch(() => null);
    const bank = ext?.data.find((x) => x.object === 'bank_account') as Stripe.BankAccount | undefined;
    if (bank?.last4) st.bankLast4 = bank.last4;
  }
  const bs = await s.balanceSettings.retrieve().catch(() => null);
  const sch = bs?.payments?.payouts?.schedule;
  if (sch?.interval && ['daily', 'weekly', 'monthly'].includes(sch.interval)) {
    st.payoutInterval = sch.interval as PayoutInterval;
    const wd = sch.weekly_payout_days?.find((d) => WEEKDAYS.includes(d));
    if (wd) st.weeklyAnchor = wd;
    if (sch.monthly_payout_days?.[0]) st.monthlyAnchor = sch.monthly_payout_days[0];
  }
  return st;
}

/** Payout calendar of the hotel's own account (Balance Settings: the account's own payouts). */
export async function updateOwnPayoutSchedule(s: { interval: PayoutInterval; weeklyAnchor: string; monthlyAnchor: number }): Promise<ConnectStatus> {
  const schedule =
    s.interval === 'weekly'
      ? { interval: 'weekly' as const, weekly_payout_days: [s.weeklyAnchor as 'monday'] }
      : s.interval === 'monthly'
        ? { interval: 'monthly' as const, monthly_payout_days: [s.monthlyAnchor] }
        : { interval: 'daily' as const };
  await stripe().balanceSettings.update({ payments: { payouts: { schedule } } });
  return retrieveOwnStatus();
}

export async function connectDashboardLink(accountId: string): Promise<string> {
  return (await stripe().accounts.createLoginLink(accountId)).url;
}

export async function updatePayoutSchedule(accountId: string, s: { interval: PayoutInterval; weeklyAnchor: string; monthlyAnchor: number }): Promise<ConnectStatus> {
  const schedule: Stripe.AccountUpdateParams.Settings.Payouts.Schedule =
    s.interval === 'weekly'
      ? { interval: 'weekly', weekly_anchor: s.weeklyAnchor as Stripe.AccountUpdateParams.Settings.Payouts.Schedule.WeeklyAnchor }
      : s.interval === 'monthly'
        ? { interval: 'monthly', monthly_anchor: s.monthlyAnchor }
        : { interval: 'daily' };
  return statusFromAccount(await stripe().accounts.update(accountId, { settings: { payouts: { schedule } } }));
}
