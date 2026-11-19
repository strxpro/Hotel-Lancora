import { requirePageUser } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { getProvider } from '@/server/ai/provider';
import { transcriptionConfigured, transcriptionLabel } from '@/server/ai/transcribe';
import { telegramConfigured } from '@/server/telegram/api';
import { stripeMode } from '@/server/payments/stripe';
import { emailTransport, geminiKey, groqKey, maskKey, readIntegrations, translationsMode } from '@/server/integrations';
import { transportLabel } from '@/server/email/transport';
import { PageHeader } from '@/components/admin/ui';
import { AccountCard, AuditCard, FaqCard, FloorsCard, GoLiveCard, HotelForm, ServicesCard } from '@/components/admin/settings';
import { demoSummary } from '@/server/go-live';
import { Connections, type ConnectionsData } from '@/components/admin/connections';
import { AccessCard } from '@/components/admin/access';
import { TwoFactorCard, type TwoFactorStatus } from '@/components/admin/two-factor';
import { secretReadable } from '@/server/auth/totp';
import { OWNER_ID } from '@/server/setup';

export const metadata = { title: 'Impostazioni' };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ codici?: string }> }) {
  const user = await requirePageUser('settings.edit');
  const db = readDb();
  // the phone code of the person looking: only what the card shows, never the key itself
  const tf = db.users.find((u) => u.id === user.id)?.twoFactor;
  const twoFactor: TwoFactorStatus = tf ? { enabledAt: tf.enabledAt, recoveryLeft: tf.recovery.length, moved: !secretReadable(tf.secret) } : null;
  const left = Number((await searchParams).codici);
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
    stripe: { keysInPanel: process.env.DEMO_MODE !== 'false' || (user.role === 'admin' && user.id !== OWNER_ID), real: process.env.DEMO_MODE === 'false', mode: stripeMode(), source: process.env.STRIPE_SECRET_KEY ? 'env' : stored.stripe ? 'panel' : null, account: stored.stripe?.accountName ?? null, webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET || stored.stripe?.webhookSecret), https: (process.env.APP_URL ?? '').startsWith('https://') },
    // the portals' calendars (Automazioni): how many rooms are linked
    ...(() => {
      const n = (db.channel.calendars ?? []).filter((c) => !c.lastError).length;
      return { channel: n ? `${n} ${n === 1 ? 'calendario collegato' : 'calendari collegati'}` : 'Da collegare', channelOn: n > 0 };
    })(),
  };
  return (
    <div>
      <PageHeader eyebrow="Configurazione" title="Impostazioni" description="Collegamenti, dati della struttura, servizi usati dal chatbot e sicurezza." />
      <Connections data={data} />
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-2">
        <div className="space-y-6">
          <HotelForm hotel={db.settings.hotel} />
          <FloorsCard enableLower={db.settings.floors.enableLower} />
          {db.settings.demoMode && <GoLiveCard counts={demoSummary(db)} />}
          {/* "restore demo data" only while the data is still the demo one */}
          <AccountCard demo={process.env.DEMO_MODE === 'true' && db.settings.demoMode} />
          <TwoFactorCard status={twoFactor} usedRescue={usedRescue} />
          <AccessCard />
        </div>
        <div className="space-y-6">
          <ServicesCard services={db.settings.services} />
          <FaqCard faq={db.settings.faq} />
          <AuditCard entries={db.audit.slice(0, 120)} />
        </div>
      </div>
    </div>
  );
}
