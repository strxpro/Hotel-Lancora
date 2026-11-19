'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, ChevronDown, Download, ImageOff, Inbox, Loader2, Lock, Mail, Paperclip, PenLine, RefreshCw, Search, Send, Settings2, Unplug, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDate } from '@/lib/dates';
import { guessProvider, type MailProvider } from '@/lib/mail-providers';
import { Dialog, useToast } from './ui';
import { connectMailboxAction, disconnectMailboxAction, mailAttachmentAction, mailListAction, mailReadAction, mailSendAction, setMailSendGuestsAction } from '@/app/admin/actions/mailbox';
import type { MailFull, MailItem } from '@/server/mail/mailbox';

const EASE = [0.22, 0.61, 0.12, 1] as const;
type Box = { provider: MailProvider; email: string; name: string; sendGuests: boolean; connectedAt: string };
type Folder = 'inbox' | 'sent';
type Guest = { name: string; code: string; bookingId: string; checkIn: string; checkOut: string; status: string } | null;
type Full = MailFull & { guest: Guest };

/* ------------------------------------------------------------------ */
/* connecting the mailbox                                              */
/* ------------------------------------------------------------------ */

const PROV: { v: MailProvider; l: string; c: string; t: string }[] = [
  { v: 'gmail', l: 'Gmail', c: '#ea4335', t: 'G' },
  { v: 'libero', l: 'Libero', c: '#1f6fd1', t: 'L' },
  { v: 'aruba', l: 'Aruba', c: '#f07c00', t: 'A' },
  { v: 'yahoo', l: 'Yahoo', c: '#6001d2', t: 'Y' },
  { v: 'icloud', l: 'iCloud', c: '#3693f3', t: 'i' },
  { v: 'altro', l: 'Altra', c: '#10283d', t: '@' },
];

const HELP: Record<MailProvider, { label: string; steps?: React.ReactNode[] }> = {
  gmail: {
    label: 'Password per le app',
    steps: [
      <>
        Apri{' '}
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="font-semibold text-navy underline underline-offset-2">
          myaccount.google.com/apppasswords
        </a>{' '}
        con l’account dell’hotel.
      </>,
      <>Scrivi un nome, per esempio “Hotel”, e premi “Crea”.</>,
      <>Copia qui le 16 lettere che Google ti mostra (gli spazi non contano).</>,
    ],
  },
  yahoo: { label: 'Password per le app', steps: [<>Su Yahoo apri “Sicurezza dell’account”.</>, <>Premi “Genera password per l’app”, scrivi “Hotel”.</>, <>Copia qui la password che ti mostra.</>] },
  icloud: { label: 'Password specifica per le app', steps: [<>Apri account.apple.com → “Accesso e sicurezza”.</>, <>“Password specifiche per le app” → “+”, scrivi “Hotel”.</>, <>Copia qui la password che ti mostra.</>] },
  libero: { label: 'Password della casella' },
  aruba: { label: 'Password della casella' },
  altro: { label: 'Password della casella' },
};

function Logo({ p, size = 36 }: { p: (typeof PROV)[number]; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ background: p.c, width: size, height: size, fontSize: size * 0.42 }}>
      {p.t}
    </span>
  );
}

export function ConnectMailbox({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [provider, setProvider] = useState<MailProvider>('gmail');
  const [touched, setTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [sendGuests, setSendGuests] = useState(true);
  const [srv, setSrv] = useState({ imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465 });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  // the provider follows the address until the owner picks one by hand
  useEffect(() => {
    if (touched) return;
    const g = guessProvider(email);
    if (g) setProvider(g);
  }, [email, touched]);

  if (!canEdit)
    return (
      <div className="rounded-[2rem] border border-line bg-white p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-gold-2" />
        <p className="serif mt-3 text-[1.6rem] text-navy">La posta non è ancora collegata</p>
        <p className="mt-1 text-sm text-mist">Può collegarla il titolare, da questa pagina.</p>
      </div>
    );

  const help = HELP[provider];
  const valid = /^\S+@\S+\.\S+$/.test(email) && pass.trim().length >= 4 && (provider !== 'altro' || (srv.imapHost.includes('.') && srv.smtpHost.includes('.')));
  const connect = async () => {
    setBusy(true);
    const r = await connectMailboxAction({
      provider,
      email: email.trim(),
      pass,
      sendGuests,
      ...(provider === 'altro' ? { imap: { host: srv.imapHost.trim(), port: srv.imapPort, secure: srv.imapPort === 993 }, smtp: { host: srv.smtpHost.trim(), port: srv.smtpPort, secure: srv.smtpPort === 465 } } : {}),
    }).catch(() => null);
    setBusy(false);
    // the page itself switches to the mailbox (the server sends it back with the answer)
    if (r?.ok) setOk(true);
    else toast('error', r && !r.ok ? r.error : 'Non collegata: riprova.');
  };

  return (
    <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="relative overflow-hidden rounded-[2rem] border border-line bg-white">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="relative overflow-hidden bg-navy-3 p-7 text-ivory md:p-9">
          <motion.span aria-hidden="true" className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-gold/25 blur-3xl" animate={{ x: [0, 50, 0], y: [0, 30, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }} />
          <div className="relative">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gold text-navy-3">
              <Inbox className="h-6 w-6" />
            </span>
            <p className="serif mt-6 text-[2.2rem] leading-[1.05]">La tua posta, qui nel pannello</p>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-ivory/70">Leggi le email degli ospiti e rispondi senza cambiare pagina. Se vuoi, anche conferme, promemoria e rimborsi partono dal tuo indirizzo.</p>
            <ul className="mt-6 space-y-2.5 text-sm text-ivory/80">
              {['Le email restano nella tua casella: qui le vedi e basta', 'Accanto a ogni email vedi se è un ospite e la sua prenotazione', 'Le risposte degli ospiti arrivano dove le aspetti'].map((t, i) => (
                <motion.li key={t} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-gold" /> {t}
                </motion.li>
              ))}
            </ul>
          </div>
        </div>

        <div className="relative p-6 md:p-8">
          <AnimatePresence mode="wait" initial={false}>
            {ok ? (
              <motion.div key="ok" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex h-full min-h-[22rem] flex-col items-center justify-center text-center">
                <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="flex h-20 w-20 items-center justify-center rounded-full bg-sage text-white">
                  <Check className="h-9 w-9" />
                </motion.span>
                <p className="serif mt-5 text-[1.8rem] text-navy">Posta collegata</p>
                <p className="mt-1 text-sm text-mist">Apro la tua casella…</p>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-mist">1 · Che posta usi?</p>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Posta">
                  {PROV.map((p) => (
                    <motion.button key={p.v} type="button" role="radio" aria-checked={provider === p.v} whileTap={{ scale: 0.95 }} onClick={() => { setProvider(p.v); setTouched(true); }} className={cn('relative flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-xs font-semibold transition-colors', provider === p.v ? 'border-navy bg-ivory text-navy' : 'border-line text-mist hover:border-navy/40')}>
                      <Logo p={p} />
                      {p.l}
                      {provider === p.v && (
                        <motion.span layoutId="mail-prov" className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-navy text-ivory">
                          <Check className="h-3 w-3" />
                        </motion.span>
                      )}
                    </motion.button>
                  ))}
                </div>

                <p className="mt-6 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-mist">2 · Indirizzo e password</p>
                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-navy">Email dell’hotel</span>
                  <input className="field mt-1.5" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="info@tuohotel.it" />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-semibold text-navy">{help.label}</span>
                  <input className="field mt-1.5" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={provider === 'gmail' ? 'xxxx xxxx xxxx xxxx' : ''} />
                </label>
                <AnimatePresence initial={false}>
                  {help.steps && (
                    <motion.ol key={provider} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 space-y-1.5 overflow-hidden rounded-2xl bg-ivory p-4 text-[0.8rem] leading-relaxed text-charcoal/85">
                      {help.steps.map((s, i) => (
                        <li key={i} className="flex gap-2.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy text-[0.65rem] font-semibold text-ivory">{i + 1}</span>
                          <span>{s}</span>
                        </li>
                      ))}
                      {provider === 'gmail' && <li className="pl-7 text-[0.74rem] text-mist">Se la pagina non si apre, prima attiva la “Verifica in due passaggi” dell’account Google.</li>}
                    </motion.ol>
                  )}
                  {provider === 'altro' && (
                    <motion.div key="srv" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <p className="mt-3 text-[0.78rem] text-mist">Li trovi nelle istruzioni del tuo fornitore della posta (cerca “configurare la posta su un programma”).</p>
                      <div className="mt-2 grid grid-cols-[1fr_5.5rem] gap-2">
                        <input className="field" value={srv.imapHost} onChange={(e) => setSrv({ ...srv, imapHost: e.target.value })} placeholder="Posta in arrivo (es. imap.tuodominio.it)" aria-label="Server posta in arrivo" />
                        <input className="field" inputMode="numeric" value={srv.imapPort} onChange={(e) => setSrv({ ...srv, imapPort: Number(e.target.value.replace(/\D/g, '')) || 993 })} aria-label="Porta posta in arrivo" />
                        <input className="field" value={srv.smtpHost} onChange={(e) => setSrv({ ...srv, smtpHost: e.target.value })} placeholder="Posta in uscita (es. smtp.tuodominio.it)" aria-label="Server posta in uscita" />
                        <input className="field" inputMode="numeric" value={srv.smtpPort} onChange={(e) => setSrv({ ...srv, smtpPort: Number(e.target.value.replace(/\D/g, '')) || 465 })} aria-label="Porta posta in uscita" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <SwitchRow on={sendGuests} onChange={setSendGuests} title="Invia da qui anche le email agli ospiti" text="Conferme, promemoria e rimborsi partono dal tuo indirizzo, e le risposte degli ospiti arrivano in questa casella." />

                <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={!valid || busy} onClick={connect} data-testid="mail-connect" className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-navy px-5 text-sm font-semibold text-ivory disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} {busy ? 'Controllo la casella…' : 'Collega la posta'}
                </motion.button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-[0.72rem] text-mist">
                  <Lock className="h-3 w-3" /> La password resta solo sul server del sito, mai nel browser.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
}

function SwitchRow({ on, onChange, title, text }: { on: boolean; onChange: (v: boolean) => void; title: string; text: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cn('mt-5 flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors', on ? 'border-navy bg-white' : 'border-line bg-white/60 hover:border-navy/40')}>
      <span className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-navy' : 'bg-line')}>
        <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 30 }} className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow', on ? 'right-0.5' : 'left-0.5')} />
      </span>
      <span className="text-[0.8rem] leading-snug text-charcoal/85">
        <span className="block font-semibold text-navy">{title}</span>
        {text}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* the mailbox                                                         */
/* ------------------------------------------------------------------ */

const HUES = ['#c49a52', '#6f8f63', '#4b6a88', '#b5654a', '#7d5ea8', '#3f8a8a'];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
const initial = (p: { name: string; address: string }) => (p.name || p.address || '?').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?';

function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => x.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
  if (day(d) === day(now)) return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
  if (day(d) === day(new Date(now.getTime() - 86400_000))) return 'ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' });
}

/** The message's own page, without its scripts and, until asked, without outside pictures (trackers). */
function MailBody({ html, text, images }: { html: string | null; text: string; images: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(240);
  const doc = useMemo(() => {
    if (!html) return null;
    const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:${images ? ' https: http:' : ''}; font-src data:`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2a33;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:#10283d}</style></head><body>${html}</body></html>`;
  }, [html, images]);
  const fit = () => {
    const d = ref.current?.contentDocument;
    if (d) setH(Math.min(4000, Math.max(120, d.documentElement.scrollHeight + 8)));
  };
  if (!doc) return <pre className="whitespace-pre-wrap break-words font-sans text-[0.9rem] leading-relaxed text-charcoal">{text}</pre>;
  return <iframe ref={ref} title="Contenuto dell’email" srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" onLoad={fit} style={{ height: h }} className="w-full border-0 bg-white" />;
}

export function Mailbox({ box: initialBox, canEdit }: { box: Box; canEdit: boolean }) {
  const toast = useToast();
  const [box, setBox] = useState(initialBox);
  const [folder, setFolder] = useState<Folder>('inbox');
  const [items, setItems] = useState<MailItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [full, setFull] = useState<Full | null>(null);
  const [opening, setOpening] = useState(false);
  const [images, setImages] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [compose, setCompose] = useState(false);
  const [menu, setMenu] = useState(false);
  const folderRef = useRef(folder);
  folderRef.current = folder;

  const load = useCallback(async (f: Folder, quiet = false) => {
    if (!quiet) setLoading(true);
    const r = await mailListAction(f).catch(() => null);
    if (folderRef.current !== f) return;
    setLoading(false);
    if (r?.ok) {
      setItems(r.data.items);
      setUnread(r.data.unread);
      setError(r.data.missing ? 'Questa cartella non esiste nella tua casella.' : null);
    } else if (!quiet) setError(r && !r.ok ? r.error : 'La casella non risponde ora.');
  }, []);

  useEffect(() => {
    setItems(null);
    setSel(null);
    setFull(null);
    void load(folder);
  }, [folder, load]);

  // new mail shows up by itself while the page is open
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible' && folderRef.current === 'inbox') void load('inbox', true);
    }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const open = async (uid: number) => {
    setSel(uid);
    setFull(null);
    setImages(false);
    setReply('');
    setOpening(true);
    const r = await mailReadAction(folder, uid).catch(() => null);
    setOpening(false);
    if (r?.ok) {
      setFull(r.data as Full);
      if (folder === 'inbox') {
        setItems((list) => list?.map((x) => (x.uid === uid ? { ...x, unread: false } : x)) ?? list);
        setUnread((n) => Math.max(0, n - (items?.find((x) => x.uid === uid)?.unread ? 1 : 0)));
      }
    } else {
      toast('error', r && !r.ok ? r.error : 'Messaggio non leggibile ora.');
      setSel(null);
    }
  };

  const download = async (i: number) => {
    if (!full) return;
    const r = await mailAttachmentAction(folder, full.uid, i).catch(() => null);
    if (!r?.ok) return toast('error', r && !r.ok ? r.error : 'Allegato non scaricato.');
    const bin = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bin], { type: r.data.type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: r.data.name });
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const sendReply = async () => {
    if (!full || !reply.trim()) return;
    const to = folder === 'inbox' ? full.from.address : (full.to[0]?.address ?? '');
    setSending(true);
    const r = await mailSendAction({ to, subject: /^re:/i.test(full.subject) ? full.subject : `Re: ${full.subject}`, text: reply, ...(folder === 'inbox' ? { replyUid: full.uid } : {}) }).catch(() => null);
    setSending(false);
    if (r?.ok) {
      setReply('');
      toast('ok', 'Risposta inviata.');
    } else toast('error', r && !r.ok ? r.error : 'Non inviata: riprova.');
  };

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!items || !s) return items;
    return items.filter((m) => `${m.from.name} ${m.from.address} ${m.to.map((t) => `${t.name} ${t.address}`).join(' ')} ${m.subject} ${m.snippet}`.toLowerCase().includes(s));
  }, [items, q]);

  const who = (m: MailItem) => (folder === 'inbox' ? m.from : (m.to[0] ?? { name: '', address: '' }));

  return (
    <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="overflow-hidden rounded-[2rem] border border-line bg-white">
      {/* top bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 md:px-5">
        <div className="relative grid grid-cols-2 rounded-full bg-ivory-2 p-1" role="tablist" aria-label="Cartelle">
          {(
            [
              ['inbox', 'Arrivate'],
              ['sent', 'Inviate'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={folder === v} onClick={() => setFolder(v)} className={cn('relative z-[1] flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors', folder === v ? 'text-ivory' : 'text-navy')}>
              {folder === v && <motion.span layoutId="mail-folder" className="absolute inset-0 -z-[1] rounded-full bg-navy" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
              {l}
              {v === 'inbox' && unread > 0 && <span className={cn('rounded-full px-1.5 text-[0.65rem] leading-4', folder === v ? 'bg-gold text-navy-3' : 'bg-terracotta text-white')}>{unread}</span>}
            </button>
          ))}
        </div>
        <label className="relative ml-auto flex min-w-[10rem] flex-1 items-center sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-mist" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca" aria-label="Cerca nella posta" className="h-10 w-full rounded-full border border-line bg-ivory pl-9 pr-3 text-sm text-navy outline-none focus:border-navy" />
        </label>
        <button type="button" onClick={() => load(folder)} aria-label="Aggiorna" title="Aggiorna" className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-navy hover:border-navy">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
        <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={() => setCompose(true)} className="flex h-10 items-center gap-2 rounded-full bg-navy px-4 text-sm font-semibold text-ivory">
          <PenLine className="h-4 w-4" /> Scrivi
        </motion.button>
        {canEdit && (
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Impostazioni della posta" className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-navy hover:border-navy">
              <Settings2 className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {menu && (
                <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} className="absolute right-0 top-12 z-20 w-[19rem] rounded-2xl border border-line bg-white p-4 shadow-[0_24px_60px_-30px_rgba(16,40,61,0.6)]">
                  <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-mist">Casella collegata</p>
                  <p className="mt-1 truncate text-sm font-semibold text-navy">{box.email}</p>
                  <SwitchRow
                    on={box.sendGuests}
                    onChange={async (v) => {
                      const r = await setMailSendGuestsAction(v).catch(() => null);
                      if (r?.ok) {
                        setBox({ ...box, sendGuests: v });
                        toast('ok', r.message ?? 'Salvato.');
                      } else toast('error', r && !r.ok ? r.error : 'Non salvato.');
                    }}
                    title="Email agli ospiti da qui"
                    text="Conferme, promemoria e rimborsi partono da questo indirizzo."
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await disconnectMailboxAction().catch(() => null);
                      if (r?.ok) window.location.reload();
                      else toast('error', 'Non scollegata: riprova.');
                    }}
                    className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-mist hover:text-terracotta"
                  >
                    <Unplug className="h-3.5 w-3.5" /> Scollega la posta
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="grid h-[calc(100svh-13rem)] min-h-[32rem] md:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
        {/* list */}
        <div className={cn('min-h-0 overflow-y-auto border-line md:border-r', sel !== null && 'hidden md:block')}>
          {error ? (
            <div className="p-8 text-center text-sm text-mist">
              <p>{error}</p>
              <button type="button" onClick={() => load(folder)} className="btn btn-navy mt-4">
                Riprova
              </button>
            </div>
          ) : !list ? (
            <div className="space-y-px">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="flex gap-3 px-4 py-4">
                  <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-sand-2" />
                  <span className="flex-1 space-y-2">
                    <span className="block h-3 w-32 animate-pulse rounded-full bg-sand-2" />
                    <span className="block h-3 w-full animate-pulse rounded-full bg-sand-2" />
                  </span>
                </div>
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-mist">
              <Inbox className="h-8 w-8 text-gold-2" /> {q ? 'Nessuna email trovata.' : 'Nessuna email qui.'}
            </div>
          ) : (
            <ul data-testid="mail-list">
              <AnimatePresence initial={false}>
                {list.map((m, i) => {
                  const p = who(m);
                  return (
                    <motion.li key={`${folder}-${m.uid}`} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03, duration: 0.35, ease: EASE }}>
                      <button type="button" onClick={() => open(m.uid)} className={cn('relative flex w-full gap-3 border-b border-line/70 px-4 py-3.5 text-left transition-colors', sel === m.uid ? 'bg-ivory' : 'hover:bg-ivory/60')}>
                        {sel === m.uid && <motion.span layoutId="mail-sel" className="absolute inset-y-0 left-0 w-1 bg-gold" />}
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: hue(p.address || p.name) }}>
                          {initial(p)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className={cn('min-w-0 flex-1 truncate text-[0.88rem] text-navy', m.unread && 'font-bold')}>{folder === 'sent' ? `A: ${p.name || p.address}` : p.name || p.address}</span>
                            <span className={cn('shrink-0 text-[0.7rem]', m.unread ? 'font-semibold text-navy' : 'text-mist')}>{when(m.date)}</span>
                          </span>
                          <span className={cn('block truncate text-[0.82rem]', m.unread ? 'font-semibold text-navy' : 'text-charcoal/80')}>{m.subject}</span>
                          <span className="block truncate text-[0.76rem] text-mist">{m.snippet}</span>
                        </span>
                        {m.unread && <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-gold" aria-label="Da leggere" />}
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>

        {/* reader */}
        <div className={cn('min-h-0 overflow-y-auto bg-ivory/40', sel === null && 'hidden md:block')}>
          <AnimatePresence mode="wait" initial={false}>
            {sel === null ? (
              <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-mist">
                <motion.span animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-gold-2 ring-1 ring-line">
                  <Mail className="h-7 w-7" />
                </motion.span>
                Scegli un’email per leggerla.
              </motion.div>
            ) : opening || !full ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full items-center justify-center text-sm text-mist">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-gold-2" /> Apro l’email…
              </motion.div>
            ) : (
              <motion.article key={`m-${full.uid}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="p-4 md:p-7" data-testid="mail-reader">
                <button type="button" onClick={() => setSel(null)} className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-navy md:hidden">
                  <ArrowLeft className="h-4 w-4" /> Tutte le email
                </button>
                <h2 className="serif text-[1.7rem] leading-tight text-navy">{full.subject}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white" style={{ background: hue(full.from.address || full.from.name) }}>
                    {initial(full.from)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-semibold text-navy">{full.from.name || full.from.address}</span>
                    <span className="block truncate text-xs text-mist">
                      {full.from.address} → {full.to.map((t) => t.address).join(', ')}
                    </span>
                  </span>
                  <span className="text-xs text-mist">{new Date(full.date).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' })}</span>
                </div>
                {full.guest && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                    <Link href={`/admin/prenotazioni?id=${full.guest.bookingId}`} className="mt-4 flex items-center gap-3 rounded-2xl bg-sage/15 px-4 py-2.5 text-sm text-[#3f5a35] ring-1 ring-sage/30 hover:bg-sage/25">
                      <UserRound className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        <b>Ospite: {full.guest.name}</b> · {full.guest.code} · {fmtDate(full.guest.checkIn, 'it', { day: 'numeric', month: 'short' })} → {fmtDate(full.guest.checkOut, 'it', { day: 'numeric', month: 'short' })}
                      </span>
                      <span className="shrink-0 text-xs font-semibold underline underline-offset-2">Apri</span>
                    </Link>
                  </motion.div>
                )}
                {full.html && !images && /<img[^>]+src=["']?https?:/i.test(full.html) && (
                  <button type="button" onClick={() => setImages(true)} className="mt-4 flex w-full items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-left text-xs text-mist ring-1 ring-line hover:text-navy">
                    <ImageOff className="h-3.5 w-3.5" /> Le immagini esterne sono nascoste (proteggono dai tracciamenti). <span className="ml-auto font-semibold text-navy">Mostra</span>
                  </button>
                )}
                <div className="mt-4 overflow-hidden rounded-2xl bg-white p-4 ring-1 ring-line md:p-5">
                  <MailBody html={full.html} text={full.text} images={images} />
                </div>
                {full.attachments.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {full.attachments.map((a) => (
                      <button key={a.i} type="button" onClick={() => download(a.i)} className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-navy ring-1 ring-line hover:ring-navy">
                        <Paperclip className="h-3.5 w-3.5 text-gold-2" /> {a.name} <span className="font-normal text-mist">{a.size > 1048576 ? `${(a.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`}</span> <Download className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-5 rounded-2xl bg-white p-3 ring-1 ring-line focus-within:ring-navy">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} placeholder={`Rispondi a ${(folder === 'inbox' ? full.from.name || full.from.address : full.to[0]?.address) ?? ''}…`} aria-label="Risposta" className="w-full resize-y bg-transparent px-1 text-sm text-charcoal outline-none" />
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="truncate text-[0.7rem] text-mist">Parte da {box.email}</span>
                    <motion.button whileTap={{ scale: 0.95 }} type="button" disabled={!reply.trim() || sending} onClick={sendReply} data-testid="mail-reply" className="flex h-10 items-center gap-2 rounded-full bg-navy px-5 text-sm font-semibold text-ivory disabled:opacity-40">
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Rispondi
                    </motion.button>
                  </div>
                </div>
              </motion.article>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Compose
        open={compose}
        onClose={() => setCompose(false)}
        from={box.email}
        onSent={() => {
          setCompose(false);
          if (folder === 'sent') void load('sent');
        }}
      />
    </motion.section>
  );
}

function Compose({ open, onClose, from, onSent }: { open: boolean; onClose: () => void; from: string; onSent: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ to: '', subject: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const send = async () => {
    setBusy(true);
    const r = await mailSendAction(f).catch(() => null);
    setBusy(false);
    if (r?.ok) {
      toast('ok', 'Email inviata.');
      setF({ to: '', subject: '', text: '' });
      onSent();
    } else toast('error', r && !r.ok ? r.error : 'Non inviata: riprova.');
  };
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} title="Nuova email" width={600}>
      <div className="space-y-3">
        <p className="text-xs text-mist">Da: {from}</p>
        <input className="field" type="email" placeholder="A (email del destinatario)" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Destinatario" />
        <input className="field" placeholder="Oggetto" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} aria-label="Oggetto" />
        <textarea className="field" rows={9} placeholder="Scrivi il messaggio…" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} aria-label="Messaggio" />
        <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1 text-[0.72rem] text-mist hover:text-navy">
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', more && 'rotate-180')} /> Come vedrà l’email
        </button>
        {more && <p className="rounded-xl bg-white p-3 text-[0.75rem] leading-relaxed text-mist ring-1 ring-line">Arriva dal tuo indirizzo, come se l’avessi scritta dalla tua casella, e la trovi poi in “Inviate”.</p>}
        <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={busy || !/^\S+@\S+\.\S+$/.test(f.to) || !f.subject.trim() || !f.text.trim()} onClick={send} className="btn btn-navy w-full disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Invia
        </motion.button>
      </div>
    </Dialog>
  );
}
