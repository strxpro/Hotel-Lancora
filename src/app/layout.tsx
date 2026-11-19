import type { Metadata, Viewport } from 'next';
import { Instrument_Serif, DM_Sans } from 'next/font/google';
import { headers } from 'next/headers';
import { isLocale } from '@/lib/i18n/config';
import './globals.css';

const serif = Instrument_Serif({ subsets: ['latin', 'latin-ext'], weight: '400', style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });
const sans = DM_Sans({ subsets: ['latin', 'latin-ext'], variable: '--font-ui', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
  title: { default: 'Hotel L’Ancora · Santa Teresa Gallura', template: '%s · Hotel L’Ancora' },
  description: "Hotel tre stelle a Santa Teresa Gallura, Sardegna. Camere luminose a pochi passi dal mare, prenotazione diretta e assistenza dedicata.",
  applicationName: 'Hotel L’Ancora',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#10283D',
  width: 'device-width',
  initialScale: 1,
};

// before the first paint: the intro plays once per visit (not again on reload or language change) and never with reduced motion
const bootScript = `(function(){var d=document.documentElement;d.classList.add('js');try{if(matchMedia('(prefers-reduced-motion: reduce)').matches||sessionStorage.getItem('la-intro'))d.classList.add('intro-seen')}catch(e){d.classList.add('intro-seen')}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const l = h.get('x-locale');
  const lang = isLocale(l) ? l : 'it';
  return (
    <html lang={lang} className={`${serif.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        {/* a plain inline script runs while the page is parsed, before anything is painted
            (next/script "beforeInteractive" waits for the Next runtime: the preloader flashed first) */}
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body className="min-h-dvh bg-ivory antialiased">{children}</body>
    </html>
  );
}
