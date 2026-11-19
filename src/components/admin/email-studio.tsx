'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, CheckCircle2, ChevronDown, Copy, ImagePlus, Languages, Loader2, Mail, Monitor, Palette, PenLine, Search, Send, Smartphone, Sparkles, Trash2, Upload, Users, Wand2 } from 'lucide-react';
import type { Campaign, EmailTheme, Locale } from '@/lib/types';
import { DEFAULT_THEME, EMAIL_THEMES } from '@/lib/email-themes';
import { fmtDateTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Flag } from '@/components/site/flags';
import { Button, Dialog, Toggle, useAction, useToast } from './ui';
import { TokenEditor } from './token-editor';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { deleteCampaignAction, draftEmailAction, duplicateCampaignAction, emailThemesAction, generateEmailImageAction, previewCampaignAction, saveCampaignAction, sendCampaignAction, sendCampaignTestAction } from '@/app/admin/actions/marketing';

type Draft = Omit<Campaign, 'id' | 'status' | 'sentAt' | 'recipients' | 'createdAt'> & { id?: string };
type Who = 'consent_all' | 'past_guests' | 'future_guests' | 'pick';
export type StudioGuest = { email: string; name: string; lang: Locale; consent: boolean; unsubscribed: boolean; country: string; stays: number; next: string | null };

const LANGS: Locale[] = ['it', 'en', 'pl', 'de', 'fr', 'es'];
const LANG_NAME: Record<Locale, string> = { it: 'Italiano', en: 'Inglese', pl: 'Polacco', de: 'Tedesco', fr: 'Francese', es: 'Spagnolo' };
const EASE = [0.22, 0.61, 0.12, 1] as const;
const IDEAS = ['Offerta −10% per chi torna in primavera', 'Grazie per essere stati da noi, vi aspettiamo', 'Benvenuti: il check-in è dalle 14, parcheggio gratuito vicino', 'Il calendario dell’estate è aperto, prenotate prima'];

const EMPTY: Draft = { name: 'Nuova email', subject: '', headline: '', body: '', ctaLabel: 'Prenota ora', ctaUrl: '/prenotazione', image: '', audience: 'consent_all', selected: [], langs: [], translate: true, personal: false, theme: DEFAULT_THEME };

function StepCard({ n, title, icon: Icon, children, tour, done }: { n: number; title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; tour?: string; done?: boolean }) {
  return (
    <motion.section data-tour={tour} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, ease: EASE }} className="relative rounded-[1.75rem] border border-line bg-white p-4 md:p-6">
      <header className="mb-4 flex items-center gap-3">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors', done ? 'bg-sage text-white' : 'bg-navy text-ivory')}>{done ? <Check className="h-4 w-4" /> : n}</span>
        <h3 className="serif flex-1 text-[1.45rem] leading-tight text-navy">{title}</h3>
        <Icon className="h-5 w-5 text-gold-2" />
      </header>
      {children}
    </motion.section>
  );
}

/** Schematic preview of an email look: header, photo, title, text lines, button. */
function ThemeThumb({ t, selected, onClick, i = 0 }: { t: EmailTheme; selected: boolean; onClick: () => void; i?: number }) {
  return (
    <motion.button type="button" onClick={onClick} initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.06, duration: 0.4, ease: EASE }} whileHover={{ y: -3 }} className={cn('relative w-full rounded-2xl p-2 text-left ring-2 transition-shadow', selected ? 'ring-navy shadow-[0_18px_40px_-24px_rgba(16,40,61,0.7)]' : 'ring-transparent hover:ring-line')} style={{ background: t.bg }} aria-pressed={selected} aria-label={`Stile ${t.name}`}>
      <span className="block overflow-hidden" style={{ background: t.card, borderRadius: Math.min(16, t.radius) }}>
        {t.layout === 'hero' && <span className="block h-8 bg-[url(/media/demo/hero-capo-testa.jpg)] bg-cover bg-center" />}
        {t.layout !== 'minimal' ? (
          <span className="flex h-5 items-center justify-center text-[0.45rem] tracking-[0.3em]" style={{ background: t.headerBg, color: t.headerInk, fontFamily: t.font === 'serif' ? 'Georgia, serif' : 'Arial' }}>
            L’ANCORA
          </span>
        ) : (
          <span className="block px-2 pt-2 text-[0.45rem] tracking-[0.3em]" style={{ color: t.headerInk }}>
            L’ANCORA
          </span>
        )}
        {(t.layout === 'classic' || t.layout === 'postcard') && <span className={cn('block h-7 bg-[url(/media/demo/hero-capo-testa.jpg)] bg-cover bg-center', t.layout === 'postcard' && 'mx-2 mt-2 rounded-md')} />}
        <span className="block space-y-1 p-2">
          <span className="block h-1.5 w-3/4 rounded-full" style={{ background: t.accent }} />
          <span className="block h-1 w-full rounded-full opacity-30" style={{ background: t.ink }} />
          <span className="block h-1 w-5/6 rounded-full opacity-30" style={{ background: t.ink }} />
          <span className="mt-1.5 block h-2.5 w-1/3 rounded-full" style={{ background: t.accent }} />
        </span>
      </span>
      <span className="mt-1.5 flex items-center justify-between gap-1 px-0.5 text-[0.68rem] font-semibold" style={{ color: t.layout === 'hero' && t.bg.toLowerCase() < '#555555' ? t.headerInk : t.ink }}>
        <span className="truncate">{t.name}</span>
        {selected && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
      </span>
    </motion.button>
  );
}

export function EmailStudio({ campaigns, images, smtp, ai, defaultTestEmail, guests, prefill }: { campaigns: Campaign[]; images: { src: string; alt: string }[]; smtp: boolean; ai: boolean; defaultTestEmail: string; guests: StudioGuest[]; prefill?: string | null }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const pre = prefill ? guests.find((g) => g.email.toLowerCase() === prefill.toLowerCase()) : undefined;
  const [d, setD] = useState<Draft>(() => (pre ? { ...EMPTY, name: `Email a ${pre.name}`, selected: [pre.email], personal: true, ctaLabel: '', ctaUrl: '' } : EMPTY));
  const [who, setWho] = useState<Who>(pre ? 'pick' : 'consent_all');
  const [words, setWords] = useState('');
  const [writing, setWriting] = useState(false);
  const [written, setWritten] = useState<'ai' | 'template' | null>(null);
  const [manual, setManual] = useState(false);
  const [stylePrompt, setStylePrompt] = useState('');
  const [styleBusy, setStyleBusy] = useState(false);
  const [aiThemes, setAiThemes] = useState<EmailTheme[] | null>(null);
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  const [extraImages, setExtraImages] = useState<{ src: string; alt: string }[]>([]);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<{ html: string; subject: string; count: number; byLang: Record<string, number> } | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [testTo, setTestTo] = useState(defaultTestEmail);
  const [confirm, setConfirm] = useState(false);
  const [sent, setSent] = useState<{ recipients: number; smtp: boolean; languages: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const payload = useMemo(() => ({ ...d, audience: who === 'pick' ? 'consent_all' : who, selected: who === 'pick' ? d.selected : [] }) as Draft, [d, who]);
  const ready = d.subject.trim().length >= 3 && d.headline.trim().length >= 3 && d.body.trim().length >= 10;

  // live preview + audience size (debounced)
  const key = useMemo(() => JSON.stringify(payload), [payload]);
  useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await previewCampaignAction({ ...payload, subject: payload.subject || 'Oggetto', headline: payload.headline || 'Il titolo della tua email', body: payload.body || 'Scrivi a sinistra cosa vuoi dire: il testo compare qui.' });
      if (r.ok && r.data) setPreview(r.data);
    }, 380);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const write = (text = words) => {
    if (text.trim().length < 3) {
      toast('error', 'Scrivi almeno qualche parola: cosa vuoi dire ai clienti?');
      return;
    }
    setWriting(true);
    run(() => draftEmailAction(text), {
      onOk: (r) => {
        const x = r as { draft: { subject: string; headline: string; body: string; ctaLabel: string; ctaUrl: string }; mode: 'ai' | 'template' };
        setD((cur) => ({ ...cur, ...x.draft, name: x.draft.subject.slice(0, 60) || cur.name }));
        setWritten(x.mode);
        setWriting(false);
      },
    });
    window.setTimeout(() => setWriting(false), 40000);
  };

  const askStyles = () => {
    setStyleBusy(true);
    run(() => emailThemesAction(stylePrompt), {
      onOk: (r) => {
        setAiThemes((r as { themes: EmailTheme[] }).themes);
        setStyleBusy(false);
      },
    });
    window.setTimeout(() => setStyleBusy(false), 40000);
  };

  const upload = async (f: File) => {
    const fd = new FormData();
    setImgBusy(true);
    fd.append('file', await shrinkPhoto(f));
    const r = await fetch('/api/admin/upload', { method: 'POST', body: fd }).catch(() => null);
    const j = r ? ((await r.json()) as { src?: string; error?: string }) : { error: 'Caricamento non riuscito' };
    setImgBusy(false);
    if (j.src) {
      setExtraImages((x) => [{ src: j.src!, alt: 'Foto caricata' }, ...x]);
      set('image', j.src);
    } else toast('error', j.error ?? 'Caricamento non riuscito');
  };

  const genImage = () => {
    setImgBusy(true);
    run(() => generateEmailImageAction(imgPrompt || d.headline || 'mare cristallino al tramonto'), {
      onOk: (r) => {
        const src = (r as { src: string }).src;
        setExtraImages((x) => [{ src, alt: 'Immagine AI' }, ...x]);
        set('image', src);
        setImgBusy(false);
      },
    });
    window.setTimeout(() => setImgBusy(false), 70000);
  };

  const visibleGuests = guests.filter((g) => !g.unsubscribed && (!q || `${g.name} ${g.email} ${g.country}`.toLowerCase().includes(q.toLowerCase())) && (!d.langs?.length || d.langs.includes(g.lang)));
  const togglePick = (email: string) => set('selected', d.selected?.includes(email) ? d.selected.filter((e) => e !== email) : [...(d.selected ?? []), email]);
  const langCount = (l: Locale) => guests.filter((g) => g.lang === l && !g.unsubscribed && (who === 'pick' || g.consent)).length;
  const allThemes = EMAIL_THEMES;
  const count = preview?.count ?? 0;

  if (sent) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center rounded-[2rem] border border-line bg-white px-6 py-14 text-center">
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }} className="flex h-20 w-20 items-center justify-center rounded-full bg-sage text-white">
          <Send className="h-8 w-8" />
        </motion.span>
        <p className="serif mt-6 text-[2.2rem] leading-tight text-navy">{sent.smtp ? 'Email partite!' : 'Email pronte nella Outbox'}</p>
        <p className="mt-2 max-w-md text-sm text-mist">
          {sent.recipients} {sent.recipients === 1 ? 'persona' : 'persone'} · lingue {sent.languages.map((l) => l.toUpperCase()).join(', ')}.{' '}
          {sent.smtp ? 'Ognuno la riceve nella sua lingua, con il link per disiscriversi.' : 'Collega le email in Impostazioni → Collegamenti per spedirle davvero.'}
        </p>
        <Button className="mt-6" onClick={() => { setSent(null); setD(EMPTY); setWords(''); setWritten(null); }}>
          Scrivi un’altra email
        </Button>
      </motion.div>
    );
  }

  return (
    <div>
      <div className={cn('mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-xs', smtp ? 'bg-sage/10 text-[#3f5a35]' : 'bg-gold/10 text-gold-2')}>
        <Mail className="h-4 w-4" />
        {smtp ? 'Email collegate: arrivano davvero nelle caselle degli ospiti.' : 'Email non ancora collegate: restano nella Outbox finché non colleghi Brevo o Gmail (Impostazioni → Collegamenti).'}
        <span className="ml-auto flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> {ai ? 'AI attiva' : 'AI non collegata: testi semplici dalle tue parole'}
        </span>
      </div>
      <div className="grid gap-5 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <div className="space-y-4">
          {/* 1. words */}
          <StepCard n={1} title="Cosa vuoi dire ai clienti?" icon={PenLine} tour="mk-words" done={Boolean(written) || ready}>
            <div className="relative">
              <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={3} maxLength={1200} placeholder="Scrivi con parole tue, anche in polacco o in inglese. Es. “a dicembre siamo aperti, 10% di sconto a chi torna”" className="field min-h-[6.5rem] resize-none pr-4 text-[0.95rem] leading-relaxed" aria-label="Cosa vuoi dire" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setWords(idea)} className="rounded-full border border-line bg-ivory px-3 py-1.5 text-[0.75rem] text-navy transition-colors hover:border-navy/40">
                  {idea}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => write()} disabled={pending && writing} className="relative flex h-12 items-center gap-2 overflow-hidden rounded-full bg-navy px-6 text-sm font-semibold text-ivory disabled:opacity-70">
                {writing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4 text-gold" />}
                {writing ? 'Sto scrivendo…' : written ? 'Riscrivi' : 'Scrivi l’email per me'}
                {writing && <motion.span className="absolute inset-y-0 left-0 w-1/3 bg-white/10" animate={{ x: ['-100%', '320%'] }} transition={{ duration: 1.2, repeat: Infinity }} />}
              </motion.button>
              <button type="button" onClick={() => setManual((m) => !m)} aria-expanded={manual} className="flex h-12 items-center gap-2 rounded-full border border-line px-5 text-sm font-semibold text-navy hover:border-navy/40">
                <PenLine className="h-4 w-4" /> Messaggio personalizzato <ChevronDown className={cn('h-4 w-4 transition-transform', manual && 'rotate-180')} />
              </button>
            </div>
            <AnimatePresence>
              {written && !manual && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-2xl bg-ivory p-4">
                  <p className="flex items-center gap-2 text-xs font-semibold text-[#3f5a35]">
                    <CheckCircle2 className="h-4 w-4" /> {written === 'ai' ? 'Scritta con l’AI: la vedi a destra.' : 'Pronta con le tue parole: la vedi a destra.'}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-navy">{d.subject.replace(/\{nome\}/g, 'Giulia')}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-mist">{d.body.replace(/\{nome\}/g, 'Giulia')}</p>
                  <button type="button" onClick={() => setManual(true)} className="mt-2 text-xs font-semibold text-navy underline decoration-gold underline-offset-2">
                    Voglio cambiare qualcosa a mano
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {manual && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
                  <div className="mt-5 space-y-4 border-t border-line pt-5">
                    <p className="text-xs text-mist">Tocca le pastiglie (Nome, Camera…) per inserire i dati di ogni ospite: ognuno vedrà i suoi.</p>
                    <div>
                      <p className="label">Oggetto</p>
                      <TokenEditor id="em-subject" label="Oggetto" value={d.subject} onChange={(v) => set('subject', v)} placeholder="Es. Nome, ti aspettiamo a dicembre" maxLength={120} />
                    </div>
                    <div>
                      <p className="label">Titolo nell’email</p>
                      <TokenEditor id="em-headline" label="Titolo" value={d.headline} onChange={(v) => set('headline', v)} placeholder="Una riga che si legge subito" maxLength={140} />
                    </div>
                    <div>
                      <p className="label">Testo</p>
                      <TokenEditor id="em-body" label="Testo" multiline value={d.body} onChange={(v) => set('body', v)} placeholder="Ciao…" />
                    </div>
                    <div>
                      <p className="label">Pulsante</p>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { l: 'Prenota ora', u: '/prenotazione' },
                          { l: 'Vedi le camere', u: '/camere' },
                          { l: 'Scopri la zona', u: '/esperienze' },
                          { l: '', u: '' },
                        ].map((b) => (
                          <button key={b.l || 'none'} type="button" onClick={() => setD((x) => ({ ...x, ctaLabel: b.l, ctaUrl: b.u }))} className={cn('rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors', d.ctaLabel === b.l && d.ctaUrl === b.u ? 'border-navy bg-navy text-ivory' : 'border-line text-navy hover:border-navy/40')}>
                            {b.l || 'Nessun pulsante'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </StepCard>

          {/* 2. photo */}
          <StepCard n={2} title="Una foto" icon={ImagePlus} done={Boolean(d.image)}>
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <button type="button" onClick={() => set('image', '')} className={cn('flex h-20 w-28 shrink-0 items-center justify-center rounded-2xl border text-xs', !d.image ? 'border-navy text-navy ring-2 ring-navy' : 'border-line text-mist')}>
                Nessuna
              </button>
              <button type="button" onClick={() => file.current?.click()} disabled={imgBusy} className="flex h-20 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-navy/30 text-xs text-navy hover:bg-navy/[0.03]">
                <Upload className="h-4 w-4" /> La tua foto
              </button>
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              {[...extraImages, ...images].map((im) => (
                <motion.button key={im.src} layout type="button" onClick={() => set('image', im.src)} aria-label={im.alt} className={cn('relative h-20 w-28 shrink-0 overflow-hidden rounded-2xl border transition', d.image === im.src ? 'border-navy ring-2 ring-navy' : 'border-line opacity-85 hover:opacity-100')}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.src} alt="" className="h-full w-full object-cover" />
                  {d.image === im.src && (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-navy text-ivory">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </motion.button>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-ivory p-3 sm:flex-row sm:items-center">
              <Sparkles className="hidden h-4 w-4 shrink-0 text-gold-2 sm:block" />
              <input value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} placeholder="Oppure descrivi una foto: “colazione in terrazza vista mare”" className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Descrivi l’immagine" />
              <Button size="sm" variant="line" disabled={imgBusy} onClick={genImage}>
                {imgBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} {imgBusy ? 'Creo…' : 'Crea con AI'}
              </Button>
            </div>
            <p className="mt-2 text-[0.7rem] text-mist">Le immagini AI richiedono un account Pollinations collegato con credito disponibile e sono salvate sul tuo server: possono non ritrarre la struttura reale.</p>
          </StepCard>

          {/* 3. style */}
          <StepCard n={3} title="Lo stile" icon={Palette} done={Boolean(d.theme)}>
            <div className="flex flex-col gap-2 rounded-2xl bg-navy p-3 text-ivory sm:flex-row sm:items-center">
              <Sparkles className="hidden h-4 w-4 shrink-0 text-gold sm:block" />
              <input value={stylePrompt} onChange={(e) => setStylePrompt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askStyles()} placeholder="Come la vuoi? “più elegante e scura”, “estiva e luminosa”…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ivory/50" aria-label="Descrivi lo stile" />
              <Button size="sm" variant="gold" disabled={styleBusy} onClick={askStyles}>
                {styleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} 4 proposte
              </Button>
            </div>
            <AnimatePresence>
              {aiThemes && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <p className="mb-2 mt-4 text-xs font-semibold text-navy">Ecco 4 proposte · tocca quella che ti piace</p>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {aiThemes.map((t, i) => (
                      <ThemeThumb key={t.id + i} t={t} i={i} selected={d.theme?.id === t.id} onClick={() => set('theme', t)} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <p className="mb-2 mt-4 text-xs text-mist">Oppure scegli uno stile pronto</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {allThemes.map((t, i) => (
                <ThemeThumb key={t.id} t={t} i={i} selected={d.theme?.id === t.id} onClick={() => set('theme', t)} />
              ))}
            </div>
          </StepCard>

          {/* 4. people */}
          <StepCard n={4} title="A chi mandarla" icon={Users} tour="mk-people" done={count > 0}>
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-ivory p-1 sm:grid-cols-4">
              {(
                [
                  ['consent_all', 'Tutti'],
                  ['past_guests', 'Già stati qui'],
                  ['future_guests', 'In arrivo'],
                  ['pick', 'Scelgo io'],
                ] as [Who, string][]
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setWho(k)} className={cn('relative rounded-xl py-2.5 text-xs font-semibold transition-colors', who === k ? 'text-ivory' : 'text-navy')}>
                  {who === k && <motion.span layoutId="who-pill" className="absolute inset-0 rounded-xl bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                  <span className="relative">{l}</span>
                </button>
              ))}
            </div>
            <p className="mb-2 mt-4 flex items-center gap-1.5 text-xs font-semibold text-navy">
              <Languages className="h-4 w-4 text-gold-2" /> Solo chi parla… <span className="font-normal text-mist">(nessuna scelta = tutte le lingue)</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {LANGS.map((l) => {
                const on = d.langs?.includes(l);
                return (
                  <button key={l} type="button" onClick={() => set('langs', on ? d.langs!.filter((x) => x !== l) : [...(d.langs ?? []), l])} className={cn('flex h-9 items-center gap-2 rounded-full border px-3 text-xs transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/30')}>
                    <Flag locale={l} className="h-3 w-4 rounded-[2px]" /> {LANG_NAME[l]}
                    <span className={cn('rounded-full px-1.5 text-[0.62rem]', on ? 'bg-white/15' : 'bg-sand-2')}>{langCount(l)}</span>
                  </button>
                );
              })}
            </div>
            <AnimatePresence initial={false}>
              {who === 'pick' && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-4 rounded-2xl border border-line">
                    <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                      <Search className="h-4 w-4 text-mist" />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca un cliente…" className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none" aria-label="Cerca cliente" />
                      <button type="button" onClick={() => set('selected', [...new Set([...(d.selected ?? []), ...visibleGuests.filter((g) => d.personal || g.consent).map((g) => g.email)])])} className="text-xs font-semibold text-navy">
                        Tutti
                      </button>
                      {(d.selected?.length ?? 0) > 0 && (
                        <button type="button" onClick={() => set('selected', [])} className="text-xs text-mist">
                          Nessuno
                        </button>
                      )}
                    </div>
                    <ul className="thin-scroll max-h-72 overflow-y-auto overscroll-contain p-1.5">
                      {visibleGuests.slice(0, 200).map((g) => {
                        const on = d.selected?.includes(g.email) ?? false;
                        const blocked = !d.personal && !g.consent;
                        return (
                          <li key={g.email}>
                            <button type="button" disabled={blocked} onClick={() => togglePick(g.email)} className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', on ? 'bg-navy/[0.06]' : 'hover:bg-ivory', blocked && 'opacity-45')}>
                              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-navy/25')}>{on && <Check className="h-3.5 w-3.5" />}</span>
                              <Flag locale={g.lang} className="h-3 w-4 shrink-0 rounded-[2px]" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-navy">{g.name}</span>
                                <span className="block truncate text-[0.7rem] text-mist">
                                  {g.email}
                                  {blocked ? ' · nessun consenso alle promozioni' : ''}
                                </span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <label className="mt-3 flex items-start gap-3 rounded-2xl bg-ivory p-3 text-sm text-charcoal/85">
                    <Toggle size="sm" checked={Boolean(d.personal)} onChange={(v) => set('personal', v)} label="Messaggio di servizio" />
                    <span>
                      <b className="text-navy">Messaggio di servizio</b> (informazioni sul soggiorno, non pubblicità): può arrivare anche a chi non ha accettato le promozioni.
                    </span>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
            <label className="mt-3 flex items-start gap-3 rounded-2xl bg-ivory p-3 text-sm text-charcoal/85">
              <Toggle size="sm" checked={d.translate !== false} onChange={(v) => set('translate', v)} label="Traduci per ogni ospite" />
              <span>
                <b className="text-navy">Traduci per ogni ospite</b> nella sua lingua (scrivi in italiano, il tedesco la riceve in tedesco…).
              </span>
            </label>
            <motion.div layout className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-navy px-4 py-3 text-ivory">
              <Users className="h-4 w-4 text-gold" />
              <span className="text-sm">
                Arriva a <AnimatePresence mode="popLayout"><motion.b key={count} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="inline-block text-gold">{count}</motion.b></AnimatePresence> {count === 1 ? 'persona' : 'persone'}
              </span>
              <span className="ml-auto flex flex-wrap gap-1">
                {Object.entries(preview?.byLang ?? {}).map(([l, n]) => (
                  <span key={l} className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem]">
                    <Flag locale={l as Locale} className="h-2.5 w-3.5 rounded-[2px]" /> {n}
                  </span>
                ))}
              </span>
            </motion.div>
          </StepCard>

          {/* 5. send */}
          <StepCard n={5} title="Prova e invia" icon={Send}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input className="field min-w-0 flex-1 text-sm" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Email per la prova" />
              <Button variant="line" disabled={pending || !ready} onClick={() => run(() => sendCampaignTestAction(payload, testTo))}>
                Mandala a me
              </Button>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button variant="line" disabled={pending || !ready} onClick={() => run(() => saveCampaignAction(payload), { onOk: (r) => set('id', (r as { id: string }).id) })}>
                Salva bozza
              </Button>
              <motion.button type="button" whileTap={{ scale: 0.97 }} disabled={pending || !ready || count === 0} onClick={() => setConfirm(true)} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gold px-6 text-sm font-semibold text-navy-3 shadow-[0_14px_30px_-16px_rgba(182,149,98,0.9)] disabled:opacity-40">
                <Send className="h-4 w-4" /> Invia a {count} {count === 1 ? 'persona' : 'persone'}
              </motion.button>
            </div>
            {!ready && <p className="mt-2 text-xs text-mist">Prima scrivi l’email (passo 1).</p>}
          </StepCard>
        </div>

        {/* live preview */}
        <div className="xl:sticky xl:top-20 xl:self-start">
          <div className="rounded-[1.75rem] border border-line bg-white p-3 md:p-4">
            <div className="flex items-center justify-between gap-2 px-1 pb-3">
              <p className="min-w-0 truncate text-sm">
                <span className="text-mist">Oggetto: </span>
                <b className="text-navy">{preview?.subject || '—'}</b>
              </p>
              <div className="flex shrink-0 rounded-full bg-ivory p-1">
                {(['desktop', 'mobile'] as const).map((v) => (
                  <button key={v} type="button" aria-label={v === 'desktop' ? 'Computer' : 'Telefono'} onClick={() => setDevice(v)} className={cn('flex h-8 w-9 items-center justify-center rounded-full transition-colors', device === v ? 'bg-navy text-ivory' : 'text-mist')}>
                    {v === 'desktop' ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </div>
            <motion.div layout className={cn('mx-auto overflow-hidden rounded-2xl border border-line bg-[#EFE9DD]', device === 'mobile' ? 'max-w-[360px]' : 'w-full')}>
              {preview ? <iframe title="Anteprima email" srcDoc={preview.html} sandbox="" className="h-[620px] w-full bg-transparent" /> : <div className="flex h-[620px] items-center justify-center text-sm text-mist">Anteprima…</div>}
            </motion.div>
            <p className="mt-2 px-1 text-[0.7rem] text-mist">Anteprima in italiano con i dati del primo destinatario. Gli ospiti stranieri la ricevono tradotta.</p>
          </div>
        </div>
      </div>

      {campaigns.length > 0 && (
        <section className="mt-8">
          <h3 className="serif mb-3 text-[1.5rem] text-navy">Email precedenti</h3>
          <ul className="grid gap-2.5 md:grid-cols-2">
            {campaigns.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3.5">
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', c.status === 'sent' ? 'bg-sage/15 text-[#3f5a35]' : 'bg-gold/15 text-gold-2')}>{c.status === 'sent' ? <Send className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-navy">{c.subject.replace(/\{nome\}/g, '…')}</span>
                  <span className="block truncate text-xs text-mist">{c.status === 'sent' ? `Inviata ${c.sentAt ? fmtDateTime(c.sentAt) : ''} · ${c.recipients} persone` : 'Bozza'}</span>
                </span>
                {c.status === 'draft' && (
                  <button type="button" onClick={() => { setD({ ...EMPTY, ...c, id: c.id }); setWho(c.selected?.length ? 'pick' : c.audience); setWritten('template'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-navy hover:border-navy/40">
                    Apri
                  </button>
                )}
                <button type="button" aria-label="Duplica" title="Duplica" onClick={() => run(() => duplicateCampaignAction(c.id))} className="flex h-8 w-8 items-center justify-center rounded-full text-mist hover:bg-ivory hover:text-navy">
                  <Copy className="h-4 w-4" />
                </button>
                <button type="button" aria-label="Elimina" title="Elimina" onClick={() => run(() => deleteCampaignAction(c.id))} className="flex h-8 w-8 items-center justify-center rounded-full text-mist hover:bg-terracotta/10 hover:text-terracotta">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Inviare a ${count} ${count === 1 ? 'persona' : 'persone'}?`}
        footer={
          <>
            <Button variant="line" onClick={() => setConfirm(false)}>
              Annulla
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(() => sendCampaignAction(payload), {
                  onOk: (r) => {
                    setConfirm(false);
                    setSent(r as { recipients: number; smtp: boolean; languages: string[] });
                  },
                })
              }
            >
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Traduco e invio…
                </>
              ) : (
                'Sì, invia'
              )}
            </Button>
          </>
        }
      >
        <p className="text-sm text-charcoal/85">
          “{preview?.subject}” · {Object.entries(preview?.byLang ?? {}).map(([l, n]) => `${l.toUpperCase()} ${n}`).join(' · ')}.{' '}
          {d.translate !== false ? 'Ogni ospite la riceve nella sua lingua.' : 'Tutti la ricevono in italiano.'} {smtp ? '' : 'Le email resteranno nella Outbox finché non colleghi un servizio email.'}
        </p>
      </Dialog>
    </div>
  );
}
