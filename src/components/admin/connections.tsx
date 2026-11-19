'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight, AudioLines, Bot, Check, CircleDashed, Loader2, Wand2, ChevronDown, Copy, CreditCard, ExternalLink, Languages, Mail, Mic, Network, Smartphone, Sparkles, Unplug, User, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, useAction, useToast } from './ui';
import { connectCloudflareEmailAction, connectEmailWebhookAction, connectGroqAction, connectSmtpAction, connectStripeAction, disconnectEmailAction, sendTestEmailAction, disconnectGroqAction, disconnectStripeAction, setTranslationsAction, autoSetupAction, type SetupCheck } from '@/app/admin/actions/integrations';
import { generateLinkCode, testTelegram, unlinkChat } from '@/app/admin/actions/automation';
import { removeGeminiKeyAction, saveGeminiKeyAction } from '@/app/admin/actions/live';

export interface ConnectionsData {
  groq: { connected: boolean; source: 'panel' | 'env' | 'other' | null; label: string; masked: string | null };
  /** the live voice conversation (Google AI Studio key) */
  live?: { connected: boolean; source: 'panel' | 'env' | null };
  voice: { connected: boolean; label: string };
  telegram: { configured: boolean; chats: { chatId: string; name: string; linkedAt: string }[]; linkCode: { code: string; expiresAt: string } | null };
  smtp: { connected: boolean; kind: 'smtp' | 'cloudflare' | 'webhook' | null; source: 'panel' | 'env' | null; from: string | null; host: string | null; hotelEmail: string };
  translations: { mode: 'mymemory' | 'off'; ai: boolean };
  stripe: { mode: 'test' | 'live' | 'off'; source: 'env' | 'panel' | null; account: string | null; webhook: boolean; https: boolean; /** key fields are a developer tool: shown while the site is a demo, and on the real site only to the technical assistance, never to the hotel owner */ keysInPanel?: boolean; /** the real site (not the demo): live keys take real money */ real?: boolean };
  channel: string;
  channelOn?: boolean;
}

type Tone = 'on' | 'off' | 'wait';

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.12em]', tone === 'on' ? 'bg-sage/15 text-[#3f5a35]' : tone === 'wait' ? 'bg-gold/15 text-gold-2' : 'bg-navy/[0.06] text-mist')}>
      <span className="relative flex h-2 w-2">
        {tone === 'on' && <span className="absolute inset-0 animate-ping rounded-full bg-sage opacity-60" />}
        <span className={cn('relative h-2 w-2 rounded-full', tone === 'on' ? 'bg-sage' : tone === 'wait' ? 'bg-gold' : 'bg-mist/50')} />
      </span>
      {children}
    </span>
  );
}

/** Tiny "how it works" animation: three stations and a dot travelling between them. */
function Flow({ nodes, active }: { nodes: { icon: React.ComponentType<{ className?: string }>; label: string }[]; active: boolean }) {
  return (
    <div className="relative mt-4 flex items-center justify-between rounded-2xl bg-ivory px-3 py-3" aria-hidden="true">
      <span className="absolute left-10 right-10 top-[1.6rem] h-px bg-[repeating-linear-gradient(90deg,var(--color-line)_0_6px,transparent_6px_10px)]" />
      {active && (
        <motion.span className="absolute top-[calc(1.6rem-4px)] h-2 w-2 rounded-full bg-gold shadow-[0_0_0_4px_rgba(182,149,98,0.18)]" initial={{ left: '12%' }} animate={{ left: ['12%', '50%', '86%'] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.4 }} />
      )}
      {nodes.map((n, i) => (
        <span key={n.label} className="relative z-[1] flex w-20 flex-col items-center gap-1.5 text-center">
          <motion.span className={cn('flex h-9 w-9 items-center justify-center rounded-xl ring-1', active ? 'bg-white text-navy ring-line' : 'bg-white/60 text-mist ring-line/60')} animate={active ? { y: [0, -2, 0] } : undefined} transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8 }}>
            <n.icon className="h-4 w-4" />
          </motion.span>
          <span className="text-[0.62rem] leading-tight text-mist">{n.label}</span>
        </span>
      ))}
    </div>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mt-3 space-y-2.5">
      {items.map((s, i) => (
        <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }} className="flex gap-3 text-[0.84rem] leading-relaxed text-charcoal/85">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-[0.7rem] font-semibold text-ivory">{i + 1}</span>
          <span className="pt-0.5">{s}</span>
        </motion.li>
      ))}
    </ol>
  );
}

function Tile({ icon: Icon, title, what, tone, status, children, flow, open, onToggle, accent }: { icon: React.ComponentType<{ className?: string }>; title: string; what: string; tone: Tone; status: string; children?: React.ReactNode; flow?: React.ReactNode; open: boolean; onToggle: () => void; accent: string }) {
  return (
    <motion.article layout className={cn('relative flex flex-col overflow-hidden rounded-[1.75rem] border bg-white p-5 transition-shadow', open ? 'border-navy/25 shadow-[0_30px_70px_-45px_rgba(16,40,61,0.6)]' : 'border-line')}>
      <span aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-[0.14] blur-2xl" style={{ background: accent }} />
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-ivory shadow-[0_10px_24px_-14px_rgba(16,40,61,0.8)]" style={{ background: accent }}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="serif text-[1.35rem] leading-tight text-navy">{title}</h3>
          <p className="mt-0.5 text-[0.8rem] leading-snug text-mist">{what}</p>
        </div>
      </div>
      <div className="mt-3">
        <StatusPill tone={tone}>{status}</StatusPill>
      </div>
      {flow}
      <button type="button" onClick={onToggle} aria-expanded={open} className="mt-4 flex items-center justify-between rounded-2xl px-1 py-1 text-left text-[0.8rem] font-semibold text-navy">
        {tone === 'on' ? 'Gestisci' : 'Come si collega'}
        <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 0.61, 0.12, 1] }} className="overflow-hidden">
            <div className="pt-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function Countdown({ until }: { until: string }) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(until).getTime() - Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setLeft(Math.max(0, new Date(until).getTime() - Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [until]);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <>{left ? `valido ancora ${m}:${String(s).padStart(2, '0')}` : 'scaduto'}</>;
}

export function Connections({ data }: { data: ConnectionsData }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(data.groq.connected ? null : 'groq');
  const [key, setKey] = useState('');
  const [gkey, setGkey] = useState('');
  const [sk, setSk] = useState('');
  const [pk, setPk] = useState('');
  const [code, setCode] = useState(data.telegram.linkCode);
  const [smtp, setSmtp] = useState({ preset: 'brevo' as 'brevo' | 'gmail' | 'altro', host: '', port: 587, user: '', pass: '', fromName: 'Hotel L’Ancora', fromEmail: '' });
  const [mailWay, setMailWay] = useState<'make' | 'cloudflare' | 'smtp'>('make');
  const [testTo, setTestTo] = useState('');
  const [hook, setHook] = useState({ url: '', secret: '', testTo: '' });
  const [cf, setCf] = useState({ accountId: '', apiToken: '', fromAddress: '', fromName: 'Hotel L’Ancora', testTo: '' });
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  return (
    <section aria-labelledby="conn-title" data-tour="connections" className="mb-10">
      <div className="mb-5 flex flex-col gap-1">
        <p className="eyebrow text-gold-2">Collegamenti</p>
        <h2 id="conn-title" className="serif text-[1.9rem] leading-tight text-navy">
          Cosa è collegato al tuo hotel
        </h2>
        <p className="max-w-2xl text-sm text-mist">Verde = funziona. Tocca una scheda per collegare o scollegare: ti guido passo passo. Le chiavi restano sul server e non si vedono più dopo il salvataggio.</p>
      </div>
      <SetupAll onOpen={(id) => { setOpen(id); window.setTimeout(() => document.querySelector(`[data-conn="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80); }} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* ---------- AI ---------- */}
        <Tile
          icon={Sparkles}
          accent="#B69562"
          title="Assistente intelligente"
          what="Capisce i vocali, scrive le email per te, traduce e risponde a domande libere."
          tone={data.groq.connected ? 'on' : 'off'}
          status={data.groq.connected ? 'Attivo' : 'Non collegato'}
          open={open === 'groq'}
          onToggle={() => toggle('groq')}
          flow={<Flow active={data.groq.connected} nodes={[{ icon: Mic, label: 'tu parli o scrivi' }, { icon: Sparkles, label: 'l’assistente capisce' }, { icon: Mail, label: 'email, risposte' }]} />}
        >
          {data.groq.connected ? (
            <div className="space-y-3 text-sm">
              <p className="text-charcoal/80">Collegato e funzionante: capisce i vocali, scrive e traduce per te.</p>
              {data.groq.source === 'panel' && (
                <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => disconnectGroqAction())}>
                  <Unplug className="h-4 w-4" /> Scollega
                </Button>
              )}
            </div>
          ) : (
            <>
              <Steps
                items={[
                  <>
                    Apri{' '}
                    <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline decoration-gold underline-offset-2">
                      console.groq.com/keys <ExternalLink className="inline h-3 w-3" />
                    </a>{' '}
                    e accedi con Google (è gratis, senza carta).
                  </>,
                  <>Premi “Create API Key”, dai un nome (es. Hotel) e copia la chiave: inizia con <b>gsk_</b>.</>,
                  <>Incollala qui sotto e premi “Collega”. Controllo io che funzioni.</>,
                ]}
              />
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input className="field min-w-0 flex-1 font-mono text-sm" type="password" autoComplete="off" spellCheck={false} placeholder="gsk_…" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Chiave Groq" />
                <Button disabled={pending || key.trim().length < 20} onClick={() => run(() => connectGroqAction(key), { onOk: () => setKey('') })}>
                  {pending ? 'Controllo…' : 'Collega'}
                </Button>
              </div>
            </>
          )}
        </Tile>

        {/* ---------- live voice ---------- */}
        <Tile
          icon={AudioLines}
          accent="#4A8FD6"
          title="Conversazione dal vivo"
          what="Parli con l’assistente come al telefono: risponde con una voce italiana naturale e fa quello che chiedi."
          tone={data.live?.connected ? 'on' : 'off'}
          status={data.live?.connected ? 'Attiva' : 'Non collegata'}
          open={open === 'live'}
          onToggle={() => toggle('live')}
          flow={<Flow active={Boolean(data.live?.connected)} nodes={[{ icon: Mic, label: 'tu parli' }, { icon: AudioLines, label: 'voce dal vivo' }, { icon: Building2, label: 'il gestionale' }]} />}
        >
          {data.live?.connected ? (
            <div className="space-y-3 text-sm">
              <p className="text-charcoal/80">Attiva: nell’assistente trovi il tasto “Parla dal vivo”. Gratis entro il limite giornaliero di Google.</p>
              {data.live.source === 'panel' && (
                <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => removeGeminiKeyAction())}>
                  <Unplug className="h-4 w-4" /> Scollega
                </Button>
              )}
            </div>
          ) : (
            <>
              <Steps
                items={[
                  <>
                    Apri{' '}
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline decoration-gold underline-offset-2">
                      aistudio.google.com/apikey <ExternalLink className="inline h-3 w-3" />
                    </a>{' '}
                    e accedi con un account Google (gratis, senza carta).
                  </>,
                  <>Premi “Create API key” e copia la chiave: inizia con <b>AIza</b>.</>,
                  <>Incollala qui sotto e premi “Collega”. Controllo io che funzioni.</>,
                ]}
              />
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input className="field min-w-0 flex-1 font-mono text-sm" type="password" autoComplete="off" spellCheck={false} placeholder="AIza…" value={gkey} onChange={(e) => setGkey(e.target.value)} aria-label="Chiave Google AI Studio" />
                <Button disabled={pending || gkey.trim().length < 20} onClick={() => run(() => saveGeminiKeyAction(gkey), { onOk: () => setGkey('') })}>
                  {pending ? 'Controllo…' : 'Collega'}
                </Button>
              </div>
            </>
          )}
        </Tile>

        {/* ---------- Telegram ---------- */}
        <Tile
          icon={Bot}
          accent="#2AABEE"
          title="Telegram"
          what="Ricevi gli avvisi sul telefono e comanda l’hotel scrivendo o con un vocale."
          tone={data.telegram.configured && data.telegram.chats.length ? 'on' : data.telegram.configured ? 'wait' : 'off'}
          status={!data.telegram.configured ? 'Non disponibile' : data.telegram.chats.length ? `${data.telegram.chats.length} ${data.telegram.chats.length === 1 ? 'telefono collegato' : 'telefoni collegati'}` : 'Da collegare'}
          open={open === 'telegram'}
          onToggle={() => toggle('telegram')}
          flow={<Flow active={data.telegram.chats.length > 0} nodes={[{ icon: Smartphone, label: 'il tuo telefono' }, { icon: Bot, label: 'bot L’Ancora' }, { icon: Building2, label: 'pannello' }]} />}
        >
          {!data.telegram.configured ? (
            <p className="text-sm text-charcoal/80">Telegram si attiva una volta sola, da chi gestisce il sito. Poi colleghi il telefono con un tocco in Automazioni.</p>
          ) : (
            <div className="space-y-4">
              {data.telegram.chats.length > 0 && (
                <ul className="space-y-2">
                  {data.telegram.chats.map((c) => (
                    <li key={c.chatId} className="flex items-center justify-between gap-3 rounded-2xl bg-ivory px-3 py-2.5 text-sm">
                      <span className="flex items-center gap-2 text-navy">
                        <Smartphone className="h-4 w-4 text-mist" /> {c.name}
                      </span>
                      <button type="button" disabled={pending} onClick={() => run(() => unlinkChat(c.chatId))} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-terracotta transition-colors hover:bg-terracotta/10">
                        <Unplug className="h-3.5 w-3.5" /> Scollega
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Steps
                items={[
                  <>Sul telefono apri Telegram e cerca il bot dell’hotel, poi premi “Avvia”.</>,
                  <>Premi qui “Genera codice”.</>,
                  <>
                    Scrivi al bot <b>/collega</b> e il codice. Fatto: puoi anche mandare vocali.
                  </>,
                ]}
              />
              <AnimatePresence mode="wait">
                {code && new Date(code.expiresAt) > new Date() ? (
                  <motion.div key="code" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl bg-navy p-4 text-ivory">
                    <p className="text-[0.66rem] uppercase tracking-[0.18em] text-gold">Scrivi al bot</p>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <code className="text-[1.5rem] tracking-[0.12em]">/collega {code.code}</code>
                      <button
                        type="button"
                        aria-label="Copia"
                        onClick={() => {
                          navigator.clipboard?.writeText(`/collega ${code.code}`);
                          toast('ok', 'Copiato');
                        }}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-ivory/60">
                      <Countdown until={code.expiresAt} />
                    </p>
                  </motion.div>
                ) : (
                  <motion.div key="btn" className="flex flex-wrap gap-2">
                    <Button disabled={pending} onClick={() => run(() => generateLinkCode(), { onOk: (d) => setCode({ code: (d as { code: string }).code, expiresAt: new Date(Date.now() + 15 * 60000).toISOString() }) })}>
                      Genera codice
                    </Button>
                    {data.telegram.chats.length > 0 && (
                      <Button variant="line" disabled={pending} onClick={() => run(() => testTelegram(), { onOk: (d) => toast('ok', (d as { message: string }).message) })}>
                        Manda una prova
                      </Button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              <p className="text-xs text-mist">Voce: {data.voice.label}.</p>
            </div>
          )}
        </Tile>

        {/* ---------- Email ---------- */}
        <Tile
          icon={Mail}
          accent="#10283D"
          title="Email agli ospiti"
          what="Conferme, promemoria e le tue email partono davvero dalla casella dell’hotel."
          tone={data.smtp.connected ? 'on' : 'off'}
          status={data.smtp.connected ? 'Attive' : 'Non collegate'}
          open={open === 'smtp'}
          onToggle={() => toggle('smtp')}
          flow={<Flow active={data.smtp.connected} nodes={[{ icon: Building2, label: 'pannello' }, { icon: Mail, label: 'casella hotel' }, { icon: User, label: 'ospite' }]} />}
        >
          {data.smtp.connected ? (
            <div className="space-y-3 text-sm">
              <p className="text-charcoal/80">
                {data.smtp.kind === 'webhook' || !data.smtp.from ? 'Le email partono dalla casella dell’hotel.' : <>Le email partono da <b>{data.smtp.from}</b>.</>}
              </p>
              {data.smtp.kind === 'cloudflare' && <p className="rounded-xl bg-ivory px-3 py-2 text-xs text-mist">Cloudflare invia solo email di servizio (conferme, promemoria, recensioni). Le campagne promozionali restano nella Outbox: per quelle collega Make.com o Brevo.</p>}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className="field min-w-0 flex-1 text-sm" type="email" placeholder="La tua email per la prova" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Email per la prova" />
                <Button size="sm" disabled={pending || !testTo.includes('@')} onClick={() => run(() => sendTestEmailAction(testTo))}>
                  <Mail className="h-4 w-4" /> Invia prova
                </Button>
              </div>
              {data.smtp.source === 'panel' && (
                <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => disconnectEmailAction())}>
                  <Unplug className="h-4 w-4" /> Scollega
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-sand-2/60 p-1">
                {([
                  ['make', 'Make.com'],
                  ['cloudflare', 'Cloudflare'],
                  ['smtp', 'Brevo / Gmail'],
                ] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setMailWay(k)} className={cn('relative rounded-xl py-2 text-xs font-semibold transition-colors', mailWay === k ? 'text-ivory' : 'text-navy')}>
                    {mailWay === k && <motion.span layoutId="mail-way" className="absolute inset-0 rounded-xl bg-navy" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
              {mailWay === 'make' && (
                <div className="space-y-3">
                  <Steps
                    items={[
                      <>Su <a href="https://www.make.com/en/login" target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline decoration-gold underline-offset-2">make.com <ExternalLink className="inline h-3 w-3" /></a> crea uno scenario: primo modulo <b>Webhooks → Custom webhook</b> → “Add” → copia l’indirizzo.</>,
                      <>Secondo modulo <b>Gmail → Send an email</b> (collega la casella dell’hotel): To = <code>to</code>, Subject = <code>subject</code>, Content = <code>html</code>, Reply-to = <code>reply_to</code>.</>,
                      <>Attiva lo scenario (“Immediately”), incolla qui l’indirizzo e premi Collega: mando un’email di prova.</>,
                    ]}
                  />
                  <input className="field font-mono text-sm" placeholder="https://hook.eu2.make.com/…" autoComplete="off" spellCheck={false} value={hook.url} onChange={(e) => setHook({ ...hook, url: e.target.value })} aria-label="Indirizzo webhook Make" />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="field text-sm" placeholder="Parola segreta (facoltativa)" autoComplete="off" value={hook.secret} onChange={(e) => setHook({ ...hook, secret: e.target.value })} aria-label="Parola segreta" />
                    <input className="field text-sm" type="email" placeholder="La tua email per la prova" value={hook.testTo} onChange={(e) => setHook({ ...hook, testTo: e.target.value })} aria-label="Email per la prova" />
                  </div>
                  <Button disabled={pending || !hook.url.startsWith('https://') || !hook.testTo.includes('@')} onClick={() => run(() => connectEmailWebhookAction({ url: hook.url, secret: hook.secret || undefined, testTo: hook.testTo }))}>
                    {pending ? 'Invio la prova…' : 'Collega Make.com'}
                  </Button>
                  <p className="text-xs leading-relaxed text-mist">Va bene anche per le campagne: partono dalla vera casella dell’hotel. Ogni email usa un’operazione di Make.</p>
                </div>
              )}
              {mailWay === 'cloudflare' && (
                <div className="space-y-3">
                  <Steps
                    items={[
                      <>Il dominio del mittente (es. tuohotel.it) deve essere su Cloudflare: <b>Compute &amp; AI → Email Service → Email Sending → Onboard Domain</b> (aggiunge SPF e DKIM da solo).</>,
                      <>
                        Crea un token in{' '}
                        <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline decoration-gold underline-offset-2">
                          API Tokens <ExternalLink className="inline h-3 w-3" />
                        </a>{' '}
                        con il permesso “Email Sending: Edit”; l’Account ID è nella pagina del dominio.
                      </>,
                      <>Per scrivere agli ospiti serve il piano Workers Paid (5 $ al mese, 3000 email incluse). Solo email di servizio: niente campagne.</>,
                    ]}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="field font-mono text-sm" placeholder="Account ID" autoComplete="off" spellCheck={false} value={cf.accountId} onChange={(e) => setCf({ ...cf, accountId: e.target.value })} aria-label="Account ID Cloudflare" />
                    <input className="field font-mono text-sm" type="password" placeholder="API token" autoComplete="new-password" value={cf.apiToken} onChange={(e) => setCf({ ...cf, apiToken: e.target.value })} aria-label="API token Cloudflare" />
                    <input className="field text-sm" type="email" placeholder="prenotazioni@tuohotel.it" value={cf.fromAddress} onChange={(e) => setCf({ ...cf, fromAddress: e.target.value })} aria-label="Mittente" />
                    <input className="field text-sm" placeholder="Nome mittente" value={cf.fromName} onChange={(e) => setCf({ ...cf, fromName: e.target.value })} aria-label="Nome mittente" />
                  </div>
                  <input className="field text-sm" type="email" placeholder="La tua email per la prova" value={cf.testTo} onChange={(e) => setCf({ ...cf, testTo: e.target.value })} aria-label="Email per la prova" />
                  <Button disabled={pending || !cf.accountId || cf.apiToken.length < 30 || !cf.fromAddress || !cf.testTo.includes('@')} onClick={() => run(() => connectCloudflareEmailAction(cf), { onOk: () => setCf((c) => ({ ...c, apiToken: '' })) })}>
                    {pending ? 'Invio la prova…' : 'Collega Cloudflare'}
                  </Button>
                </div>
              )}
              {mailWay === 'smtp' && (
              <div className="space-y-3">
              <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-ivory p-1">
                {(['brevo', 'gmail', 'altro'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setSmtp({ ...smtp, preset: p })} className={cn('relative rounded-xl py-2 text-xs font-semibold capitalize transition-colors', smtp.preset === p ? 'text-ivory' : 'text-navy')}>
                    {smtp.preset === p && <motion.span layoutId="smtp-preset" className="absolute inset-0 rounded-xl bg-navy" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                    <span className="relative">{p === 'altro' ? 'Altro' : p === 'brevo' ? 'Brevo' : 'Gmail'}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-mist">
                {smtp.preset === 'brevo'
                  ? 'Brevo è gratis fino a 300 email al giorno: crea l’account su brevo.com → SMTP e API → genera una chiave SMTP. Utente = il login SMTP mostrato da Brevo.'
                  : smtp.preset === 'gmail'
                    ? 'Gmail: attiva la verifica in 2 passaggi e crea una “password per le app” (myaccount.google.com/apppasswords). Utente = il tuo indirizzo Gmail.'
                    : 'Usa i dati SMTP del tuo provider (Aruba, Register, Libero…).'}
              </p>
              {smtp.preset === 'altro' && (
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <input className="field text-sm" placeholder="smtp.esempio.it" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} aria-label="Server SMTP" />
                  <input className="field text-sm" inputMode="numeric" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) || 587 })} aria-label="Porta" />
                </div>
              )}
              <input className="field text-sm" placeholder="Utente SMTP" autoComplete="off" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} aria-label="Utente SMTP" />
              <input className="field text-sm" type="password" autoComplete="new-password" placeholder="Password o chiave SMTP" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} aria-label="Password SMTP" />
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="field text-sm" placeholder="Nome mittente" value={smtp.fromName} onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })} aria-label="Nome mittente" />
                <input className="field text-sm" type="email" placeholder="info@tuohotel.it" value={smtp.fromEmail} onChange={(e) => setSmtp({ ...smtp, fromEmail: e.target.value })} aria-label="Email mittente" />
              </div>
              <Button disabled={pending || !smtp.user || !smtp.pass || !smtp.fromEmail} onClick={() => run(() => connectSmtpAction(smtp), { onOk: () => setSmtp((s) => ({ ...s, pass: '' })) })}>
                {pending ? 'Controllo…' : 'Collega'}
              </Button>
              </div>
              )}
            </div>
          )}
        </Tile>

        {/* ---------- Translations ---------- */}
        <Tile
          icon={Languages}
          accent="#7A8C6E"
          title="Traduzioni"
          what="Camere ed email tradotte da sole in inglese, polacco, tedesco, francese e spagnolo."
          tone={data.translations.ai || data.translations.mode === 'mymemory' ? 'on' : 'off'}
          status={data.translations.ai || data.translations.mode === 'mymemory' ? 'Attive' : 'Spente'}
          open={open === 'tr'}
          onToggle={() => toggle('tr')}
          flow={<Flow active={data.translations.ai || data.translations.mode === 'mymemory'} nodes={[{ icon: Building2, label: 'scrivi in italiano' }, { icon: Languages, label: 'traduzione' }, { icon: User, label: 'ospite nella sua lingua' }]} />}
        >
          <div className="space-y-3 text-sm text-charcoal/80">
            <p>{data.translations.ai ? 'Le traduzioni sono fatte dall’assistente: naturali, nelle cinque lingue del sito.' : 'Traduzioni automatiche attive, con un limite di parole al giorno.'}</p>
            {!data.translations.ai && (
              <Button variant={data.translations.mode === 'mymemory' ? 'line' : 'navy'} size="sm" disabled={pending} onClick={() => run(() => setTranslationsAction(data.translations.mode !== 'mymemory'))}>
                {data.translations.mode === 'mymemory' ? 'Spegni traduzioni' : 'Accendi traduzioni'}
              </Button>
            )}
          </div>
        </Tile>

        {/* ---------- Stripe ---------- */}
        <Tile
          icon={CreditCard}
          accent="#635BFF"
          title="Pagamenti con carta"
          what="Gli ospiti pagano online, i soldi arrivano sul conto dell’hotel."
          tone={data.stripe.mode === 'off' ? 'off' : 'on'}
          status={data.stripe.mode === 'live' ? 'Attivi' : data.stripe.mode === 'test' ? 'Modalità prova' : data.stripe.real ? 'Da attivare' : 'Simulati (demo)'}
          open={open === 'stripe'}
          onToggle={() => toggle('stripe')}
          flow={<Flow active={data.stripe.mode !== 'off'} nodes={[{ icon: User, label: 'ospite paga' }, { icon: CreditCard, label: 'pagamento sicuro' }, { icon: Building2, label: 'conto hotel' }]} />}
        >
          {data.stripe.mode !== 'off' ? (
            <div className="space-y-3 text-sm text-charcoal/80">
              <p>
                {data.stripe.mode === 'test' ? 'Modalità prova: nessun addebito reale (carta di prova 4242 4242 4242 4242).' : 'Pagamenti con carta attivi: gli incassi arrivano sul conto dell’hotel.'}
              </p>
              <p className="text-xs text-mist">Le prenotazioni pagate si confermano da sole.</p>
              <div className="flex flex-wrap gap-2">
                {data.stripe.source === 'panel' && (
                  <Button variant="line" size="sm" disabled={pending} onClick={() => run(() => disconnectStripeAction())}>
                    <Unplug className="h-4 w-4" /> Scollega
                  </Button>
                )}
                <Link href="/admin/pagamenti" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-4 text-xs font-semibold text-navy">
                  Pagamenti e bonifici <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ) : !data.stripe.keysInPanel ? (
            <div className="space-y-3 text-sm text-charcoal/85">
              <p>I pagamenti con carta vengono attivati da chi gestisce il sito: non devi creare chiavi né incollare codici.</p>
              <p className="text-xs text-mist">Appena sono pronti, nella pagina <b>Pagamenti</b> compare il pulsante <b>“Collega Stripe”</b>: un clic, Stripe ti guida nella creazione del conto (dati dell’attività, IBAN, documento) e da quel momento gli incassi con carta arrivano a te.</p>
              <Link href="/admin/pagamenti" className="inline-flex h-10 items-center gap-2 rounded-full bg-navy px-4 text-xs font-semibold text-ivory">
                Vai a Pagamenti <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-3 rounded-xl bg-gold/10 px-3 py-2 text-[0.72rem] leading-relaxed text-charcoal/80">
                {data.stripe.real ? (
                  <>
                    <b>Solo per l’assistenza tecnica.</b> Il titolare non vede questi campi: dopo, usa solo “Collega Stripe” in Pagamenti. Con le chiavi <b>live</b> gli incassi sono veri.
                  </>
                ) : (
                  <>
                    <b>Solo per le prove (sito demo).</b> Sul sito consegnato all’hotel questi campi non compaiono: le chiavi della piattaforma stanno sul server e il proprietario usa solo “Collega Stripe”.
                  </>
                )}
              </p>
              <Steps
                items={[
                  <>
                    Apri{' '}
                    <a href="https://dashboard.stripe.com/register" target="_blank" rel="noopener noreferrer" className="font-semibold text-navy underline decoration-gold underline-offset-2">
                      dashboard.stripe.com <ExternalLink className="inline h-3 w-3" />
                    </a>{' '}
                    e crea l’account dell’hotel (gratis: email, poi dati dell’attività e IBAN per ricevere i soldi).
                  </>,
                  <>
                    {data.stripe.real ? (
                      <>
                        Vai su <b>Sviluppatori → Chiavi API</b> (modalità <b>live</b>): “Chiave pubblicabile” (pk_live_…) e “Chiave segreta” (sk_live_…, premi “Mostra”). Per una prova senza soldi veri vanno bene anche le chiavi di test.
                      </>
                    ) : (
                      <>
                        Vai su <b>Sviluppatori → Chiavi API</b>. Per provare usa le chiavi di <b>test</b>: “Chiave pubblicabile” (pk_test_…) e “Chiave segreta” (sk_test_…, premi “Mostra”).
                      </>
                    )}
                  </>,
                  <>Incollale qui sotto e premi “Collega”. Controllo io che funzionino; quando il sito è online creo anche il collegamento automatico (webhook).</>,
                ]}
              />
              <div className="mt-4 space-y-2">
                <input className="field font-mono text-sm" autoComplete="off" spellCheck={false} placeholder={data.stripe.real ? 'pk_live_…' : 'pk_test_…'} value={pk} onChange={(e) => setPk(e.target.value)} aria-label="Chiave pubblicabile Stripe" />
                <input className="field font-mono text-sm" type="password" autoComplete="off" spellCheck={false} placeholder={data.stripe.real ? 'sk_live_…' : 'sk_test_…'} value={sk} onChange={(e) => setSk(e.target.value)} aria-label="Chiave segreta Stripe" />
                <Button disabled={pending || sk.trim().length < 20 || pk.trim().length < 20} onClick={() => run(() => connectStripeAction(sk, pk), { onOk: (d) => { const r = d as { accountName: string; webhook: boolean }; setSk(''); setPk(''); toast('ok', `Stripe collegato: ${r.accountName}${r.webhook ? ' · conferma automatica attiva' : ''}.`); } })}>
                  {pending ? 'Controllo…' : 'Collega Stripe'}
                </Button>
              </div>
              <p className="mt-3 text-xs text-mist">Le chiavi restano sul server. In alternativa, “Collega Stripe” nella pagina Pagamenti apre la registrazione guidata di Stripe (serve l’account della piattaforma).</p>
            </>
          )}
        </Tile>

        {/* ---------- Channel manager ---------- */}
        <Tile
          icon={Network}
          accent="#6B7376"
          title="Booking.com, Expedia e Airbnb"
          what="Le prenotazioni dei portali entrano da sole nel planning, senza doppie vendite."
          tone={data.channelOn ? 'on' : 'wait'}
          status={data.channel}
          open={open === 'ch'}
          onToggle={() => toggle('ch')}
          flow={<Flow active={Boolean(data.channelOn)} nodes={[{ icon: Network, label: 'portali' }, { icon: Check, label: 'calendari' }, { icon: Building2, label: 'planning' }]} />}
        >
          <p className="text-sm text-charcoal/80">Si collegano in Automazioni: un tocco per portale, poi “Incolla e collega” per ogni camera.</p>
          <Link href="/admin/automazioni" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-navy">
            Apri Automazioni <ArrowRight className="h-4 w-4" />
          </Link>
        </Tile>
      </div>
    </section>
  );
}

const TILE_OF: Partial<Record<SetupCheck['id'], string>> = { ai: 'groq', voice: 'groq', telegram: 'telegram', email: 'smtp', stripe: 'stripe' };

/**
 * One button for everything: it tries each service for real, repairs what it can by itself and
 * lists in plain words what works and the single step still missing for the rest.
 */
function SetupAll({ onOpen }: { onOpen: (tile: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<SetupCheck[] | null>(null);
  const run = async () => {
    setBusy(true);
    const r = await autoSetupAction().catch(() => null);
    setBusy(false);
    if (r?.ok) setChecks(r.data as SetupCheck[]);
    else toast('error', r && !r.ok ? r.error : 'Controllo non riuscito, riprova.');
  };
  const ok = checks?.filter((c) => c.state === 'ok').length ?? 0;
  return (
    <div className="mb-6 overflow-hidden rounded-[1.75rem] bg-navy text-ivory">
      <div className="flex flex-wrap items-center gap-4 p-5 md:p-6">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold/20 text-gold">
          <Wand2 className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="serif text-[1.5rem] leading-tight">{checks ? `${ok} su ${checks.length} collegamenti attivi` : 'Collega tutto con un clic'}</p>
          <p className="mt-1 text-[0.82rem] leading-relaxed text-ivory/70">{checks ? 'Verde = funziona. Per il resto c’è scritto l’unico passo che manca.' : 'Provo ogni servizio per davvero (AI, vocali, Telegram, email, pagamenti, database), sistemo da solo quello che posso e ti dico cosa manca.'}</p>
        </div>
        <button type="button" onClick={run} disabled={busy} className="flex h-12 items-center gap-2 rounded-full bg-gold px-6 text-sm font-semibold text-navy-3 transition-transform enabled:hover:-translate-y-0.5 disabled:opacity-70">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {busy ? 'Controllo…' : checks ? 'Controlla di nuovo' : 'Controlla e collega tutto'}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {checks && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: [0.22, 0.61, 0.12, 1] }} className="divide-y divide-white/10 overflow-hidden border-t border-white/10">
            {checks.map((c, i) => (
              <motion.li key={c.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 + i * 0.07 }} className="flex flex-wrap items-start gap-3 px-5 py-3.5 md:px-6">
                <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', c.state === 'ok' ? 'bg-[#4f9a5c]/25 text-[#9fd9a9]' : c.state === 'error' ? 'bg-terracotta/30 text-[#f3b8a8]' : 'bg-gold/20 text-gold')}>
                  {c.state === 'ok' ? <Check className="h-4 w-4" /> : c.state === 'error' ? <AlertTriangle className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{c.label}</p>
                  <p className="text-[0.8rem] leading-relaxed text-ivory/70">{c.detail}</p>
                  {c.todo && <p className="mt-1 text-[0.8rem] leading-relaxed text-gold">→ {c.todo}</p>}
                  {c.sql && (
                    <div className="mt-2 rounded-xl bg-black/25 p-3">
                      <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-[0.7rem] leading-relaxed text-ivory/85">{c.sql}</pre>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => navigator.clipboard.writeText(c.sql!).then(() => toast('ok', 'SQL copiato: incollalo nell’editor di Supabase.'))} className="flex h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 text-[0.72rem] font-semibold hover:bg-white/25">
                          <Copy className="h-3.5 w-3.5" /> Copia SQL
                        </button>
                        {c.link && (
                          <a href={c.link} target="_blank" rel="noopener noreferrer" className="flex h-8 items-center gap-1.5 rounded-full bg-gold px-3 text-[0.72rem] font-semibold text-navy-3">
                            Apri l’editor SQL <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {c.state !== 'ok' && TILE_OF[c.id] && (
                  <button type="button" onClick={() => onOpen(TILE_OF[c.id]!)} className="h-8 shrink-0 rounded-full bg-white/10 px-3 text-[0.72rem] font-semibold hover:bg-white/20">
                    Apri la scheda
                  </button>
                )}
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
