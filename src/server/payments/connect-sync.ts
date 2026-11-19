import 'server-only';
import { mutate, readDb } from '../db/store';
import { audit } from '../events';
import { accountGone, clearConnect, retrieveConnectStatus, stripeMode, type ConnectStatus } from './stripe';

let lastCheck = 0;

/**
 * Keeps the panel's copy of the hotel's Stripe account (status, IBAN, payout calendar) in step with
 * Stripe: read at most once a minute when a page that shows it opens, never longer than 3.5 s, and
 * written only when something really changed. Covers the owner who closes Stripe's page without
 * coming back through "return", and a webhook that cannot reach a temporary address.
 */
export async function syncConnectStatus(): Promise<void> {
  const c = readDb().settings.stripeConnect;
  if (!c.accountId || c.simulated || stripeMode() === 'off') return;
  if (Date.now() - lastCheck < 60_000) return;
  lastCheck = Date.now();
  const accountId = c.accountId;
  let gone = false;
  const s = await Promise.race([retrieveConnectStatus(accountId), new Promise<null>((r) => setTimeout(() => r(null), 3500))]).catch((e) => {
    gone = accountGone(e);
    return null;
  });
  // an account the current keys do not know (made with the test keys): "Collega il mio conto" again
  if (gone) {
    mutate((db) => {
      if (db.settings.stripeConnect.accountId !== accountId) return;
      clearConnect(db);
      audit(db, 'Sistema', 'stripe_disconnect', 'settings', null, `Conto ${accountId} non valido con le chiavi attuali (prova → reale): da collegare di nuovo`);
    });
    return;
  }
  if (!s) return;
  const cur = readDb().settings.stripeConnect as unknown as Record<string, unknown>;
  const changed = (Object.keys(s) as (keyof ConnectStatus)[]).some((k) => JSON.stringify(cur[k]) !== JSON.stringify(s[k]));
  if (!changed) return;
  mutate((db) => {
    if (db.settings.stripeConnect.accountId !== accountId) return;
    Object.assign(db.settings.stripeConnect, { ...s, updatedAt: new Date().toISOString() });
  });
}
