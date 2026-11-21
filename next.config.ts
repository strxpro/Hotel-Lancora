import type { NextConfig } from 'next';
import { appUrlFromVercel } from './src/lib/vercel-url';

// the build on Vercel (sitemap, robots, page metadata) also needs the site's own address
appUrlFromVercel();

// every build gets its own name (the commit on Vercel): pages opened before a new version went live
// see a different name from the server and reload themselves (components/site/new-version.tsx).
// Set once in the main process, so every build worker inlines the same name.
process.env.NEXT_PUBLIC_BUILD_ID ||= (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || Date.now().toString(36);

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(self)' },
  // once a browser has seen the site over https it never goes back to plain http (ignored on http://localhost)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  // no other site may show these pages inside a frame (click-jacking), no injected <base>, no plugins
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

/** The panel and its login: never in search engines (Next already marks its pages as not cacheable). */
const adminHeaders = [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }];

const nextConfig: NextConfig = {
  // a new version can be built next to the running one (NEXT_BUILD_DIR=.next-build) and swapped in seconds
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID },
  // read at run time by the panel's database check: on Vercel only traced files reach the server
  outputFileTracingIncludes: { '/**': ['./supabase/hotel-tables.sql'] },
  images: {
    qualities: [60, 75, 85],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 828, 1080, 1280, 1600, 1920, 2560],
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/admin/:path*', headers: adminHeaders },
      { source: '/admin', headers: adminHeaders },
    ];
  },
};

export default nextConfig;
