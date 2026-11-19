import 'server-only';
import type Stripe from 'stripe';
import { readIntegrations, writeIntegrations } from '../integrations';
import { settleAppUrl } from '@/lib/vercel-url';

const DESC = 'Hotel L’Ancora – conferma prenotazioni';
const CHECKOUT_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired'];

/**
 * Stripe tells the site about payments (platform endpoint) and about the hotel's own account
 * (Connect endpoint, account.updated) at /api/stripe/webhook. The site's address can change (a
 * temporary public link, later the real domain): at every start the site checks that Stripe calls
 * the current address and, if not, moves both endpoints by itself — nothing for anyone to paste.
 * Only for keys connected from the panel (keys in .env bring their own STRIPE_WEBHOOK_SECRET).
 * Returns true when the endpoints point at this address.
 */
export async function ensureStripeWebhook(force = false): Promise<boolean> {
  if (process.env.STRIPE_WEBHOOK_SECRET || (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'off')) return false;
  const st = readIntegrations().stripe;
  if (!st?.secretKey || !/^(sk|rk)_(test|live)_/.test(st.secretKey)) return false;
  // Stripe does not follow redirects: the address that answers (e.g. www.hotellancora.it)
  const app = await settleAppUrl();
  if (!app.startsWith('https://')) return false;
  const url = `${app}/api/stripe/webhook`;
  // the hotel's own Stripe (not a platform) has no connected accounts: only the payments endpoint
  const direct = st.owner === 'hotel';
  if (!force && st.webhookUrl === url && st.webhookId && st.webhookSecret && (direct || (st.connectWebhookId && st.connectWebhookSecret))) return true;

  const StripeSdk = (await import('stripe')).default;
  const client = new StripeSdk(st.secretKey);
  // the old ones of this site (an earlier address, or made by the panel) go; other projects' stay
  const list = await client.webhookEndpoints.list({ limit: 100 });
  for (const w of list.data) {
    const ours = w.metadata?.app === 'hotel-lancora' || w.description === DESC || w.id === st.webhookId || w.id === st.connectWebhookId;
    if (ours) await client.webhookEndpoints.del(w.id).catch(() => null);
  }
  const base = { url, description: DESC, metadata: { app: 'hotel-lancora' } };
  const wh = await client.webhookEndpoints.create({ ...base, enabled_events: CHECKOUT_EVENTS });
  // an account that is not a Connect platform refuses this one: the payments endpoint is kept anyway
  const cw = direct
    ? null
    : await client.webhookEndpoints.create({ ...base, connect: true, enabled_events: ['account.updated'] }).catch((e) => {
        console.error('[stripe] endpoint Connect non creato:', (e as Error).message);
        return null;
      });
  const now = readIntegrations().stripe;
  if (!now) return false;
  writeIntegrations({ stripe: { ...now, webhookId: wh.id, webhookSecret: wh.secret, connectWebhookId: cw?.id, connectWebhookSecret: cw?.secret ?? undefined, webhookUrl: url } });
  return true;
}
