/**
 * On Vercel the site knows its own address without APP_URL: the production domain (the custom
 * domain once it is attached, else the *.vercel.app one) or, for a preview, the branch address.
 * Sets APP_URL only when it is missing; returns what it set (or null).
 */
export function appUrlFromVercel(): string | null {
  if (process.env.APP_URL || !process.env.VERCEL) return null;
  const host =
    process.env.VERCEL_ENV === 'production'
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  if (!host) return null;
  process.env.APP_URL = `https://${host.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  return process.env.APP_URL;
}

/**
 * The site's address after its own redirect (e.g. hotellancora.it → www.hotellancora.it, as Vercel
 * sets a new domain up): Stripe and Telegram never follow a redirect, so their notifications must
 * go to the address that answers. Asks the site itself once; keeps APP_URL when there is no redirect.
 */
export async function settleAppUrl(): Promise<string> {
  const app = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(app)) return app;
  try {
    const r = await fetch(`${app}/robots.txt`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (loc) {
      const u = new URL(loc, app);
      if (u.protocol === 'https:' && u.host !== new URL(app).host) {
        process.env.APP_URL = u.origin;
        return u.origin;
      }
    }
  } catch {
    /* no answer: keep the address as it is */
  }
  return app;
}
