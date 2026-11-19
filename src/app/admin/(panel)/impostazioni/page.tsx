import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { getProvider } from '@/server/ai/provider';
import { transcriptionConfigured, transcriptionLabel } from '@/server/ai/transcribe';
import { telegramConfigured } from '@/server/telegram/api';
import { stripeMode } from '@/server/payments/stripe';
import { emailTransport, geminiKey, groqKey, maskKey, readIntegrations, translationsMode } from '@/server/integrations';
import { transportLabel } from '@/server/email/transport';
import Link from 'next/link';
import { Clock, Hotel, MessageCircleQuestion, Plug, ShieldCheck, Umbrella } from 'lucide-react';
import { PageHeader } from '@/components/admin/ui';
import { AccountCard, AuditCard, FaqCard, FloorsCard, GoLiveCard, HotelForm, HouseRulesCard, ServicesCard, StayTimesCard } from '@/components/admin/settings';
import { houseRules } from '@/lib/house-rules';
import { PlacesEditor } from '@/components/admin/places-editor';
import { placeList } from '@/server/places';
import { cn } from '@/lib/utils';
import { demoSummary } from '@/server/go-live';
import { Connections, type ConnectionsData } from '@/components/admin/connections';
import { AccessCard } from '@/components/admin/access';
import { TwoFactorCard, type TwoFactorStatus } from '@/components/admin/two-factor';
import { secretReadable } from '@/server/auth/totp';
import { OWNER_ID } from '@/server/setup';

export const metadata = { title: 'Impostazioni' };

const TABS = [
  { id: 'collegamenti', label: 'Collegamenti', icon: Plug },
  { id: 'struttura', label: 'La struttura', icon: Hotel },
  { id: 'orari', label: 'Arrivo, partenza e regole', icon: Clock },
  { id: 'dintorni', label: 'Spiagge e dintorni', icon: Umbrella },
  { id: 'servizi', label: 'Servizi e domande', icon: MessageCircleQuestion },
  { id: 'sicurezza', label: 'Sicurezza', icon: ShieldCheck },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ codici?: string; tab?: string }> }) {
  const user = await requirePageUser('settings.edit');
  const db = readDb();
  // the phone code of the person looking: only what the card shows, never the key itself
  const tf = db.users.find((u) => u.id === user.id)?.twoFactor;
  const twoFactor: TwoFactorStatus = tf ? { enabledAt: tf.enabledAt, recoveryLeft: tf.recovery.length, moved: !secretReadable(tf.secret) } : null;
  const sp = await searchParams;
  const left = Number(sp.codici);
  const tab: Tab = sp.codici !== undefined ? 'sicurezza' : (TABS.find((x) => x.id === sp.tab)?.id ?? 'collegamenti');
  const usedRescue = Number.isInteger(left) && left >= 0 && left <= 8 ? left : null;
  const provider = getProvider();
  const stored = readIntegrations();
  const mail = emailTransport();
  const lc = db.telegram.linkCode && new Date(db.telegram.linkCode.expiresAt) > new Date() ? db.telegram.linkCode : null;
  const data: ConnectionsData = {
    groq: {
      connected: Boolean(provider),
      source: provider?.id === 'groq' ? (process.env.GROQ_API_KEY ? 'env' : 'panel') : provider ? 'other' : null,
      label: provider?.id === 'groq' ? 'Groq · gratuito' : (provider?.label ?? ''),
      masked: provider?.id === 'groq' ? maskKey(groqKey()) : null,
    },
    voice: { connected: transcriptionConfigured(), label: transcriptionLabel() },
    live: { connected: Boolean(geminiKey()), source: process.env.GEMINI_API_KEY ? 'env' : stored.geminiKey ? 'panel' : null },
    telegram: { configured: telegramConfigured(), chats: db.telegram.linkedChats.map((c) => ({ chatId: c.chatId, name: c.name, linkedAt: c.linkedAt })), linkCode: lc ? { code: lc.code, expiresAt: lc.expiresAt } : null },
    smtp: { connected: Boolean(mail), kind: mail?.kind ?? null, source: mail?.source ?? null, from: mail?.kind === 'smtp' ? mail.smtp.from : mail?.kind === 'cloudflare' ? `${mail.cf.fromName} <${mail.cf.fromAddress}>` : null, host: transportLabel(mail), hotelEmail: db.settings.hotel.email },
    translations: { mode: translationsMode(), ai: Boolean(provider) },
    // the platform's keys: in the demo for everyone, on the real site only for the technical assistance (never the owner)
    stripe: { keysInPanel: process.env.DEMO_MODE !== 'false' || (user.role === 'admin' && user.id !== OWNER_ID), real: process.env.DEMO_MODE === 'false', mode: stripeMode(), source: process.env.STRIPE_SECRET_KEY ? 'env' : stored.stripe ? 'panel' : null, account: stored.stripe?.accountName ?? null, owner: stored.stripe?.owner === 'hotel' ? 'hotel' : 'platform', webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET || stored.stripe?.webhookSecret), https: (process.env.APP_URL ?? '').startsWith('https://') },
    // the portals' calendars (Automazioni): how many rooms are linked
    ...(() => {
      const n = (db.channel.calendars ?? []).filter((c) => !c.lastError).length;
      return { channel: n ? `${n} ${n === 1 ? 'calendario collegato' : 'calendari collegati'}` : 'Da collegare', channelOn: n > 0 };
    })(),
  };
  return (
    <div>
      <PageHeader eyebrow="Configurazione" title="Impostazioni" description="Collegamenti, dati della struttura, servizi usati dal chatbot e sicurezza." />
      {/* one subject per tab: what the owner looks for is one tap away, never at the bottom of a long page */}
      <nav aria-label="Sezioni delle impostazioni" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {TABS.map((x) => (
          <Link key={x.id} href={x.id === 'collegamenti' ? '/admin/impostazioni' : `/admin/impostazioni?tab=${x.id}`} scroll={false} aria-current={tab === x.id ? 'page' : undefined} className={cn('flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors', tab === x.id ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50')}>
            <x.icon className={cn('h-4 w-4', tab === x.id ? 'text-gold' : 'text-gold-2')} />
            {x.label}
          </Link>
        ))}
      </nav>
      {tab === 'collegamenti' && <Connections data={data} />}
      {tab === 'struttura' && (
        <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
          <HotelForm hotel={db.settings.hotel} />
          <div className="space-y-6">
            <FloorsCard enableLower={db.settings.floors.enableLower} />
            {db.settings.demoMode && <GoLiveCard counts={demoSummary(db)} />}
          </div>
        </div>
      )}
      {tab === 'orari' && (
        <>
          <StayTimesCard hotel={db.settings.hotel} tax={db.settings.pricing?.touristTax ?? null} />
          <HouseRulesCard initial={houseRules(db.settings)} />
        </>
      )}
      {tab === 'dintorni' && <PlacesEditor initial={placeList(db)} custom={Boolean(db.settings.places?.length)} />}
      {tab === 'servizi' && (
        <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
          <ServicesCard services={db.settings.services} />
          <FaqCard faq={db.settings.faq} />
        </div>
      )}
      {tab === 'sicurezza' && (
        <div id="sicurezza" className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
          <div className="space-y-6">
            {/* "restore demo data" only while the data is still the demo one */}
            <AccountCard demo={process.env.DEMO_MODE === 'true' && db.settings.demoMode} />
            <TwoFactorCard status={twoFactor} usedRescue={usedRescue} />
            <AccessCard />
          </div>
          <AuditCard entries={db.audit.slice(0, 120)} />
        </div>
      )}
    </div>
  );
}
