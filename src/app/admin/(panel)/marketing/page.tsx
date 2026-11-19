import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { addDays, todayISO } from '@/lib/dates';
import { PageHeader } from '@/components/admin/ui';
import { MarketingTabs, PromosPanel, ReviewsPanel } from '@/components/admin/marketing';
import { EmailStudio } from '@/components/admin/email-studio';
import { MEDIA } from '@/content/media';
import { smtpConfigured } from '@/server/events';
import { getProvider } from '@/server/ai/provider';
import { guestProfiles } from '@/server/guests';

export const metadata = { title: 'Recensioni e Marketing' };

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ scrivi?: string; tab?: string }> }) {
  await requirePageUser('marketing.manage');
  const sp = await searchParams;
  const db = readDb();
  const today = todayISO();
  const recent = db.bookings
    .filter((b) => b.status === 'confirmed' && b.checkOut <= today && b.checkOut >= addDays(today, -14))
    .sort((a, b) => b.checkOut.localeCompare(a.checkOut))
    .slice(0, 12)
    .map((b) => ({ id: b.id, guest: `${b.guest.firstName} ${b.guest.lastName}`, checkOut: b.checkOut, marketing: b.consents.marketing, code: b.code }));
  const guests = guestProfiles(db).map((g) => ({ email: g.email, name: g.name, lang: g.lang, consent: g.consent, unsubscribed: g.unsubscribed, country: g.country, stays: g.stays, next: g.next }));
  const roomPhotos = db.rooms.flatMap((r) => r.photos.slice(0, 1).map((p) => ({ src: p.src, alt: p.alt })));
  const images = [MEDIA.renaBianca, MEDIA.hero, MEDIA.capoTestaFaro, MEDIA.torreTramonto, MEDIA.vistaMare, MEDIA.mattino, MEDIA.valleDellaLuna, MEDIA.paeseMare].map((m) => ({ src: m.src, alt: m.alt }));
  return (
    <div>
      <PageHeader eyebrow="Ospiti felici" title="Recensioni e Marketing" description="Scrivi ai clienti con parole tue: l’AI prepara l’email, tu scegli a chi mandarla e ognuno la riceve nella sua lingua." />
      <MarketingTabs
        initial={sp.tab === 'recensioni' ? 'reviews' : sp.tab === 'codici' ? 'promos' : 'email'}
        email={<EmailStudio campaigns={db.campaigns} smtp={smtpConfigured()} ai={Boolean(getProvider())} defaultTestEmail={db.settings.hotel.email} guests={guests} prefill={sp.scrivi ?? null} images={[...images, ...roomPhotos].filter((x, i, a) => a.findIndex((y) => y.src === x.src) === i).slice(0, 18)} />}
        reviews={<ReviewsPanel feedback={db.feedback} settings={db.settings.reviews} rooms={[...db.rooms].sort((a, b) => a.number.localeCompare(b.number, 'it', { numeric: true })).map((r) => ({ id: r.id, number: r.number, name: r.name }))} />}
        promos={<PromosPanel promotions={db.promotions} recent={recent} googleUrl={db.settings.hotel.googleReviewUrl} />}
      />
    </div>
  );
}
