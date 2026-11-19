import { cronDenied, runJobs } from '@/server/cron/auth';
import { readDb } from '@/server/db/store';
import { sendReviewRequests } from '@/server/reviews';
import { ensureStripeWebhook } from '@/server/payments/webhook-setup';
import { stablePublicUrl } from '@/server/telegram/poller';
import { setMenu, setWebhook, telegramConfigured, tg } from '@/server/telegram/api';
import { syncTables } from '@/server/db/tables-sync';
import { cloudConfigured } from '@/server/db/cloud';
import { settleAppUrl } from '@/lib/vercel-url';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Every hour, the upkeep the server used to do when it started:
 * review requests, Stripe's notifications to this address, the bot's webhook on this address,
 * and the copy of the data in the real tables (when the table export is on).
 */
export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  // the address that answers (a new domain may redirect to www): Stripe and Telegram do not follow redirects
  await settleAppUrl();
  return runJobs({
    reviews: () => sendReviewRequests(),
    stripe: async () => ((await ensureStripeWebhook()) ? 'collegato' : 'invariato'),
    telegram: async () => {
      const base = stablePublicUrl();
      const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
      if (!telegramConfigured() || !base || secret.length < 16) return 'saltato';
      const url = `${base}/api/telegram/webhook`;
      // the Menu button with the quick commands (cheap: kept in place every hour)
      const { BOT_COMMANDS } = await import('@/server/telegram/handle');
      await setMenu(BOT_COMMANDS).catch((e) => console.error('[telegram] menu:', (e as Error).message));
      const info = await tg<{ url?: string }>('getWebhookInfo');
      if (info.url === url) return 'invariato · menu ok';
      await setWebhook(url, secret);
      return 'collegato · menu ok';
    },
    tables: async () => {
      if (process.env.TABLES_EXPORT === 'off' || !cloudConfigured()) return 'spento';
      const r = await syncTables(readDb(), { full: true });
      return r.ok ? `${r.upserts} righe` : `errore: ${r.error}`;
    },
  });
}
