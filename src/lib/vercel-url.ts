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
