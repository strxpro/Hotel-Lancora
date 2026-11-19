import type { MetadataRoute } from 'next';
import { LOCALES, localePath } from '@/lib/i18n/config';
import { readDb } from '@/server/db/store';
import { isPubliclyBookable } from '@/lib/availability';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const paths = ['/', '/camere', '/esperienze', '/contatti', ...readDb().rooms.filter(isPubliclyBookable).map((r) => `/camere/${r.slug}`)];
  return paths.map((p) => ({
    url: base + localePath('it', p),
    changeFrequency: p.startsWith('/camere/') ? 'weekly' : 'monthly',
    alternates: { languages: Object.fromEntries(LOCALES.map((l) => [l, base + localePath(l, p)])) },
  }));
}
