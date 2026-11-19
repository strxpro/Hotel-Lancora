'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, AudioLines, Check, ImagePlus, Lightbulb, Mic, MousePointer2, RotateCcw, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { LiveVoice } from './live-voice';
import { cn } from '@/lib/utils';
import { useLiveVoice, type VoiceClip } from '@/lib/use-live-voice';
import { LiveVoiceBubble, VoiceNote } from '@/components/site/voice-note';
import { playAssist, type UiStep } from '@/lib/assist';
import { PhotoMorph } from '@/components/site/photo-morph';
import { Button, useAction } from './ui';
import { askAssistant, clearAssistantAction, loadAssistantHistory, resolveAssistant } from '@/app/admin/actions/assistant';

type Msg = { id: string; role: 'user' | 'assistant'; text: string; pendingId?: string | null; resolved?: boolean; engine?: string; channel?: 'panel' | 'telegram'; voice?: boolean; local?: boolean; image?: string; images?: string[]; ui?: UiStep[] };

const SPEECH: Record<string, string> = { it: 'it-IT', en: 'en-GB', pl: 'pl-PL', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' };
const MAX_PHOTOS = 4;

/**
 * The most natural voice the browser has for a language: the "Natural"/"Online" neural voices
 * (Edge: Isabella, Elsa, Diego…), then Google's, then any voice of that language.
 */
function bestVoice(lang: string): SpeechSynthesisVoice | null {
  const all = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
  const code = lang.slice(0, 2).toLowerCase();
  const mine = all.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(code));
  const score = (v: SpeechSynthesisVoice) => (/natural|neural/i.test(v.name) ? 100 : 0) + (/online/i.test(v.name) ? 40 : 0) + (/google/i.test(v.name) ? 30 : 0) + (/isabella|elsa|diego|giuseppe|alice|federica|luca/i.test(v.name) ? 15 : 0) + (v.lang.toLowerCase().startsWith(`${code}-${code}`) ? 5 : 0) - (v.localService ? 0 : 1);
  return mine.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Text for the ear: no symbols, € in words, one sentence at a time (pauses where a person would breathe). */
function forSpeech(text: string, lang: string): string[] {
  const euro = lang === 'it' ? ' euro' : lang === 'pl' ? ' euro' : ' euros';
  const clean = text
    .replace(/\*\*/g, '')
    .replace(/[•·*#_>`]/g, ', ')
    .replace(/€\s?(\d[\d.,]*)/g, `$1${euro}`)
    .replace(/(\d[\d.,]*)\s?€/g, `$1${euro}`)
    .replace(/→/g, lang === 'it' ? ' fino al ' : ' - ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
  return clean.split(/(?<=[.!?;:])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
}

/** Shrinks a picture in the browser (max 1600 px, JPEG) before it is sent. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.85);
}

/** Light formatting for answers: lists, numbered steps and **bold**, nothing else. */
function Pretty({ text }: { text: string }) {
  const lines = text.split('\n');
  const bold = (l: string, k: number) =>
    l.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <b key={`${k}-${i}`} className="font-semibold text-navy">{part.slice(2, -2)}</b> : part));
  return (
    <div className="space-y-1">
      {lines.map((l, i) => {
        const li = l.match(/^\s*(?:[-•*]|(\d+)[.)])\s+(.*)$/);
        if (li)
          return (
            <p key={i} className="flex gap-2">
              <span className={cn('mt-[0.15em] flex h-[1.3em] min-w-[1.3em] shrink-0 items-center justify-center rounded-full text-[0.7em] font-semibold', li[1] ? 'bg-navy text-ivory' : 'text-gold-2')}>{li[1] ?? '•'}</span>
              <span>{bold(li[2]!, i)}</span>
            </p>
          );
        return l.trim() ? <p key={i}>{bold(l, i)}</p> : <span key={i} className="block h-1.5" />;
      })}
    </div>
  );
}


/** Ready questions for the page the owner is looking at. */
const CONTEXT: { re: RegExp; page: string; items: string[] }[] = [
  { re: /^\/admin\/?$/, page: 'Oggi', items: ['Chi arriva oggi?', 'Chi parte domani?', 'Quanto abbiamo incassato questa settimana?', 'Quali camere sono libere domani?'] },
  { re: /disponibilita/, page: 'Planning', items: ['Cosa significano i colori nel planning?', 'Come chiudo una camera per manutenzione?', 'Chiudi la camera 105 dal 12 al 15 novembre', 'Quali camere sono libere sabato?'] },
  { re: /prenotazioni/, page: 'Prenotazioni', items: ['Come registro una prenotazione telefonica?', 'Come segno un pagamento in contanti?', 'Mostrami le prenotazioni di dicembre', 'Chi arriva domani?'] },
  { re: /camere/, page: 'Camere', items: ['Come aggiungo una camera?', 'Come imposto un letto matrimoniale e uno singolo?', 'Crea una descrizione più elegante per la camera 108', 'Nascondi la camera 106 dal sito'] },
  { re: /prezzi/, page: 'Prezzi', items: ['Come cambio il prezzo di più camere insieme?', 'Cambia il prezzo della camera 101 a 85 euro, 80 in contanti', 'Come faccio un prezzo solo per agosto?', 'Perché il prezzo in contanti è più basso?'] },
  { re: /clienti/, page: 'Clienti', items: ['Come vedo la storia di un cliente?', 'Scrivi ai clienti tedeschi che a dicembre siamo aperti', 'Come esporto i dati di un ospite?'] },
  { re: /pagamenti/, page: 'Pagamenti', items: ['Quanto abbiamo incassato questo mese?', 'Come registro un pagamento con il POS?', 'Come collego Stripe?'] },
  { re: /marketing/, page: 'Marketing', items: ['Scrivi a tutti gli ospiti passati un’offerta del 10% per la primavera', 'Come aggiungo una recensione?', 'Come scelgo a chi mandare un’email?', 'Come cambio lo stile dell’email?'] },
  { re: /messaggi/, page: 'Messaggi', items: ['Come rispondo a un ospite?', 'Perché le email restano nella Outbox?', 'Come faccio arrivare davvero le email?'] },
  { re: /statistiche/, page: 'Statistiche', items: ['Quanto abbiamo incassato il mese scorso?', 'Quante prenotazioni dirette questo mese?', 'Quante prenotazioni sono arrivate da Booking?'] },
  { re: /(automazioni|impostazioni)/, page: 'Impostazioni', items: ['Come collego l’AI gratuita?', 'Come collego Telegram?', 'Come faccio arrivare davvero le email?'] },
  { re: /assistente/, page: 'Assistente', items: ['Cosa sai fare?', 'Quanto abbiamo incassato questa settimana?', 'Chi arriva oggi?', 'Scrivi un’email di benvenuto a chi arriva questa settimana'] },
];

function TelegramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="currentColor" d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2l-11 6.9-4.7-1.5c-1-.3-1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.3Z" />
    </svg>
  );
}

export function AssistantChat({ suggestions = [], whisper, compact = false, panel = false, inputId = 'assistant-input', active = true, live = false }: { suggestions?: string[]; whisper: boolean; compact?: boolean; panel?: boolean; inputId?: string; active?: boolean; /** the live voice conversation is connected */ live?: boolean }) {
  const [liveOpen, setLiveOpen] = useState(false);
  const pathname = usePathname();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [speak, setSpeak] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [attach, setAttach] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // up to 4 pictures in one message
  const pick = async (files: FileList | File[] | null | undefined) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const room = MAX_PHOTOS - attach.length;
    if (room <= 0) return setVoiceNote(`Puoi mandare al massimo ${MAX_PHOTOS} foto insieme.`);
    if (list.length > room) setVoiceNote(`Prese le prime ${room}: al massimo ${MAX_PHOTOS} foto per messaggio.`);
    try {
      const ready = await Promise.all(list.slice(0, room).map(shrink));
      setAttach((a) => [...a, ...ready].slice(0, MAX_PHOTOS));
    } catch {
      setVoiceNote('Non riesco ad aprire questa immagine.');
    }
  };
  const { run, pending } = useAction();
  const list = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const lastCount = useRef(0);

  const ctx = CONTEXT.find((c) => c.re.test(pathname)) ?? CONTEXT[0]!;
  const chips = [...ctx.items, ...suggestions.filter((s) => !ctx.items.includes(s))].slice(0, compact ? 4 : 6);

  const sync = useCallback(async () => {
    const h = await loadAssistantHistory().catch(() => null);
    if (!h) return;
    setLoaded(true);
    setMsgs((cur) => {
      const local = cur.filter((m) => m.local);
      const server: Msg[] = h.map((e) => ({ id: e.id, role: e.role, text: e.text, pendingId: e.pendingId, resolved: e.resolved, engine: e.engine, channel: e.channel, voice: e.voice, image: e.image, images: e.images, ui: e.ui }));
      // drop optimistic bubbles once the server has them
      const keep = local.filter((l) => !server.some((s) => s.role === l.role && (s.text === l.text || (Boolean(l.image) && Boolean(s.image) && s.text === l.text))));
      return [...server, ...keep];
    });
  }, []);

  // shared history: messages sent from Telegram show up here too
  useEffect(() => {
    if (!active) return;
    sync();
    const id = window.setInterval(() => document.visibilityState === 'visible' && sync(), 4000);
    return () => window.clearInterval(id);
  }, [active, sync]);

  useEffect(() => {
    if (msgs.length === lastCount.current && !thinking) return;
    lastCount.current = msgs.length;
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: loaded ? 'smooth' : 'auto' });
  }, [msgs, thinking, loaded]);

  // auto-grow the input up to 5 lines
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  // voices arrive a moment after the page: ask once so the best one is ready when needed
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.getVoices();
    const on = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener('voiceschanged', on);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', on);
  }, []);
  const say = (text: string, lang = 'it') => {
    if (!speak || !('speechSynthesis' in window)) return;
    const code = SPEECH[lang] ?? 'it-IT';
    const voice = bestVoice(code);
    window.speechSynthesis.cancel();
    forSpeech(text, lang).forEach((sentence, k) => {
      const u = new SpeechSynthesisUtterance(sentence);
      u.lang = voice?.lang ?? code;
      if (voice) u.voice = voice;
      // neural voices already sound natural at their own speed; the older ones a touch slower
      u.rate = voice && /natural|neural|online/i.test(voice.name) ? 1 : 0.96;
      u.pitch = 1;
      if (k > 0) u.volume = 1;
      window.speechSynthesis.speak(u);
    });
  };

  const send = (text: string, voice = false) => {
    const q = text.trim();
    const imgs = attach;
    if ((!q && !imgs.length) || thinking) return;
    setInput('');
    setAttach([]);
    setThinking(true);
    setMsgs((m) => [...m, { id: `local-${Date.now()}`, role: 'user', text: q, channel: 'panel', voice, local: true, ...(imgs.length === 1 ? { image: imgs[0] } : imgs.length > 1 ? { images: imgs } : {}) }]);
    askAssistant(q, voice, imgs.length ? imgs : null)
      .then((res) => {
        const r = res.ok ? (res.data as { text: string; pending?: { id: string } | null; engine: string; images?: string[]; ui?: UiStep[]; autoplay?: boolean; lang?: string }) : { text: res.error, pending: null, engine: 'regole' as const };
        setMsgs((m) => [...m, { id: `local-a-${Date.now()}`, role: 'assistant', text: r.text, pendingId: r.pending?.id ?? null, engine: r.engine, channel: 'panel', local: true, images: 'images' in r ? r.images : undefined, ui: 'ui' in r ? r.ui : undefined }]);
        say(r.text, 'lang' in r ? r.lang : 'it');
        if ('ui' in r && r.ui?.length && r.autoplay) window.setTimeout(() => playAssist(r.ui!), 900);
        sync();
      })
      .catch(() => setMsgs((m) => [...m, { id: `local-e-${Date.now()}`, role: 'assistant', text: 'Connessione persa, riprova tra un attimo.', local: true }]))
      .finally(() => setThinking(false));
  };

  const decide = (msg: Msg, decision: 'confirm' | 'cancel') =>
    run(() => resolveAssistant(msg.pendingId!, decision), {
      onOk: (d) => {
        const r = d as { text: string; ui?: UiStep[] };
        setMsgs((m) => [...m.map((x) => (x.id === msg.id ? { ...x, resolved: true } : x)), { id: `local-r-${Date.now()}`, role: 'assistant', text: r.text, ui: r.ui, local: true }]);
        say(r.text);
        // done: now watch where it changed
        if (r.ui?.length) window.setTimeout(() => playAssist(r.ui!), 1100);
        sync();
      },
    });

  const clear = () =>
    run(() => clearAssistantAction(), {
      onOk: () => {
        setMsgs([]);
        lastCount.current = 0;
      },
    });

  // voice: the words appear in the box while you speak, then get cleaned up (and sent)
  const [fixed, setFixed] = useState(false);
  const clips = useRef(new Map<string, VoiceClip>());
  const voice = useLiveVoice({
    endpoint: '/api/admin/transcribe',
    onText: (text) => setInput(text),
    onFinal: (text, mode, clip) => {
      if (clip) clips.current.set(text, clip);
      if (mode === 'send') {
        // it leaves as a voice message: the bubble shows the recording and what was understood
        setInput('');
        send(text, true);
        return;
      }
      setInput(text);
      setFixed(true);
      window.setTimeout(() => setFixed(false), 1600);
      area.current?.focus();
    },
    onError: (code) =>
      setVoiceNote(
        code === 'mic' ? 'Microfono non disponibile: consenti l’accesso al microfono nel browser.' : code === 'short' ? 'Non ho sentito parole: tieni premuto un po’ di più e parla vicino al microfono.' : code === 'rate' ? 'Troppi vocali in un minuto: riprova tra poco.' : code === 'off' ? 'Per parlare collega Groq (gratis) in Impostazioni → Collegamenti.' : 'Trascrizione non riuscita, riprova.',
      ),
  });
  const rec = voice.state;
  // the conversation follows the words while they are being spoken
  useEffect(() => {
    if (rec !== 'idle') list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [rec, input]);
  const startVoice = () => {
    setVoiceNote(null);
    setInput('');
    if (!whisper) return setVoiceNote('Per parlare collega Groq (gratis) in Impostazioni → Collegamenti.');
    voice.start();
  };

  const empty = loaded && msgs.length === 0;

  return (
    <div className={cn('flex flex-col', panel ? 'h-full min-h-0' : 'overflow-clip rounded-3xl border border-line bg-white', !panel && (compact ? 'h-[460px]' : 'h-[calc(100svh-15rem)] min-h-[520px]'))}>
      <div ref={list} data-lenis-prevent className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 md:p-6" aria-live="polite">
        {(empty || !loaded) && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="relative overflow-hidden rounded-[1.6rem] bg-navy p-5 text-ivory">
              <motion.span aria-hidden="true" className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/25 blur-2xl" animate={{ scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }} transition={{ duration: 6, repeat: Infinity }} />
              <p className="relative flex items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-gold">
                <Sparkles className="h-3.5 w-3.5" /> Il tuo aiutante
              </p>
              <p className="serif relative mt-2 text-[1.55rem] leading-tight">Chiedimi qualcosa, o chiedimi come si fa.</p>
              <p className="relative mt-2 text-[0.82rem] leading-relaxed text-ivory/70">Rispondo con i dati veri del pannello. Prima di cambiare qualcosa ti chiedo sempre conferma. È la stessa chat di Telegram.</p>
            </div>
          </motion.div>
        )}
        {(empty || !loaded) && (
          <div>
            <p className="flex items-center gap-2 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-mist">
              <Lightbulb className="h-3.5 w-3.5 text-gold-2" /> Su questa pagina · {ctx.page}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {chips.map((s, i) => (
                <motion.button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 + i * 0.05 }}
                  className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-ivory px-4 py-3 text-left text-[0.88rem] text-navy transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-navy/30 hover:bg-white"
                >
                  {s}
                  <Send className="h-3.5 w-3.5 shrink-0 text-mist transition-transform group-hover:translate-x-0.5 group-hover:text-navy" />
                </motion.button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <motion.div key={m.id} layout="position" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.3 }} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            {(m.channel === 'telegram' || m.voice) && (
              <span className="mb-1 flex items-center gap-1 px-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-mist">
                {m.channel === 'telegram' && <TelegramGlyph className="h-3 w-3 text-[#2AABEE]" />}
                {m.channel === 'telegram' ? 'Telegram' : ''}
                {m.voice && <Mic className="h-3 w-3" />}
                {m.voice && 'vocale'}
              </span>
            )}
            <div className={cn('min-w-0 max-w-[90%] whitespace-pre-line break-words px-4 py-3 text-[0.92rem] leading-relaxed', m.role === 'user' ? 'rounded-[1.3rem] rounded-br-md bg-navy text-ivory' : 'rounded-[1.3rem] rounded-bl-md border border-line bg-ivory text-charcoal')}>
              {m.image && (
                <a href={m.image} target="_blank" rel="noopener noreferrer" className="mb-2 block overflow-hidden rounded-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.image} alt="" className="max-h-56 w-full object-cover" />
                </a>
              )}
              {m.role === 'assistant' ? <Pretty text={m.text} /> : m.voice ? <VoiceNote text={m.text} clip={clips.current.get(m.text)} heard="Ho capito" /> : m.text}
              {m.images && m.images.length > 0 && <PhotoMorph className="mt-3" photos={m.images.map((src, i) => ({ src, alt: `${i + 1}` }))} thumbClassName={m.images.length === 1 ? 'h-44 w-full max-w-[18rem]' : 'aspect-square w-full'} grid={m.images.length > 1} max={6} />}
              {m.ui && m.ui.length > 0 && (
                <button type="button" onClick={() => playAssist(m.ui!)} className="mt-3 flex items-center gap-2 rounded-full bg-navy px-3.5 py-2 text-xs font-semibold text-ivory transition-transform hover:-translate-y-0.5">
                  <MousePointer2 className="h-3.5 w-3.5 text-gold" /> Mostramelo sullo schermo
                </button>
              )}
              {m.pendingId && !m.resolved && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => decide(m, 'confirm')} disabled={pending}>
                    <Check className="h-4 w-4" /> Conferma
                  </Button>
                  <Button size="sm" variant="line" onClick={() => decide(m, 'cancel')} disabled={pending}>
                    <X className="h-4 w-4" /> Annulla
                  </Button>
                </div>
              )}
              {m.engine === 'ai' && <p className="mt-2 text-[0.62rem] uppercase tracking-[0.12em] text-mist">con AI</p>}
            </div>
          </motion.div>
        ))}
        <AnimatePresence>{rec !== 'idle' && <LiveVoiceBubble key="live-voice" text={input} busy={rec === 'busy'} listening="Ti ascolto" fixing="Sistemo il testo" />}</AnimatePresence>
        <AnimatePresence>
          {thinking && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex w-fit items-center gap-1.5 rounded-full border border-line bg-ivory px-4 py-3" aria-label="Sto pensando">
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-gold-2" animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.14 }} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {msgs.length > 0 && !thinking && (
          <div className="flex flex-wrap gap-2 pt-1">
            {ctx.items.slice(0, 3).map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line bg-white px-3 py-1.5 text-[0.78rem] text-navy transition-colors hover:border-navy/40">
                {s}
              </button>
            ))}
            <button type="button" onClick={clear} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.78rem] text-mist transition-colors hover:text-navy">
              <RotateCcw className="h-3 w-3" /> Nuova chat
            </button>
          </div>
        )}
      </div>
      <AnimatePresence>
        {voiceNote && (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mx-3 rounded-2xl bg-sand-2 px-4 py-2 text-xs text-navy">
            {voiceNote}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {rec !== 'idle' && (
          <motion.div initial={{ opacity: 0, y: 10, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, y: 8, height: 0 }} transition={{ duration: 0.3 }} className="mx-3 mt-2 overflow-hidden">
            <div ref={voice.meterRef} className="flex items-center gap-3 rounded-2xl bg-navy px-3.5 py-2.5 text-ivory" style={{ ['--lvl' as string]: 0 }}>
              {rec === 'rec' ? (
                <>
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inset-0 animate-ping rounded-full bg-terracotta/70" />
                    <span className="relative h-2.5 w-2.5 rounded-full bg-terracotta" />
                  </span>
                  <span className="w-10 shrink-0 font-mono text-[0.78rem] tabular-nums text-ivory/80">
                    {Math.floor(voice.secs / 60)}:{String(voice.secs % 60).padStart(2, '0')}
                  </span>
                  <VoiceBars />
                  <span className="hidden min-w-0 flex-1 truncate text-[0.75rem] text-ivory/70 sm:block">Parla pure: il testo si scrive qui sotto</span>
                  <button type="button" onClick={() => voice.stop('edit')} className="ml-auto h-8 shrink-0 rounded-full bg-white/10 px-3 text-[0.72rem] font-semibold transition-colors hover:bg-white/20">
                    Fermati
                  </button>
                  <button type="button" onClick={() => voice.stop('cancel')} aria-label="Annulla il vocale" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ivory/70 transition-colors hover:bg-white/10 hover:text-ivory">
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-ivory/25 border-t-gold" />
                  <span className="text-[0.78rem] text-ivory/85">Sistemo il testo (parole capite male, ripensamenti)…</span>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {attach.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="mx-3 -mb-1 mt-2 rounded-2xl border border-line bg-white p-2 pr-3">
            <div className="flex items-center gap-2">
              <AnimatePresence initial={false}>
                {attach.map((src, k) => (
                  <motion.span key={src.slice(-40) + k} layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} className="relative h-14 w-14 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-14 w-14 rounded-xl object-cover" />
                    <button type="button" onClick={() => setAttach((a) => a.filter((_, i) => i !== k))} aria-label={`Togli la foto ${k + 1}`} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-navy text-ivory shadow">
                      <X className="h-3 w-3" />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
              {attach.length < MAX_PHOTOS && (
                <button type="button" onClick={() => fileRef.current?.click()} aria-label="Aggiungi un’altra foto" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-line text-mist hover:border-navy hover:text-navy">
                  <ImagePlus className="h-4 w-4" />
                </button>
              )}
              <span className="ml-1 min-w-0 flex-1 text-xs text-mist">
                {attach.length}/{MAX_PHOTOS} foto. Scrivi cosa vuoi (es. “aggiungile alla camera 101” o “vanno bene per il sito?”) e invia.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <form
        className={cn('relative flex items-end gap-1.5 p-2 transition-shadow', panel ? 'm-3 rounded-[1.6rem] border border-line bg-white shadow-[0_18px_40px_-28px_rgba(16,40,61,0.5)]' : 'border-t border-line', dragOver && 'ring-2 ring-gold')}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void pick(e.dataTransfer.files);
        }}
      >
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => (void pick(e.target.files), (e.target.value = ''))} />
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Allega una foto" title="Allega una foto (o incollala)" className="flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:text-navy">
          <ImagePlus className="h-5 w-5" />
        </button>
        {live && (
          <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => setLiveOpen(true)} aria-label="Parla dal vivo con l’assistente" title="Parla dal vivo: rispondo a voce e faccio quello che chiedi" className="group relative flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-navy transition-colors">
            <motion.span className="absolute inset-1.5 rounded-full bg-gold/25" animate={{ scale: [1, 1.18, 1], opacity: [0.7, 0.2, 0.7] }} transition={{ duration: 2.2, repeat: Infinity }} />
            <AudioLines className="relative h-5 w-5" />
          </motion.button>
        )}
        <LiveVoice
          open={liveOpen}
          onClose={() => {
            setLiveOpen(false);
            void sync();
          }}
        />
        <button type="button" onClick={() => setSpeak((s) => !s)} aria-pressed={speak} aria-label={speak ? 'Disattiva risposta vocale' : 'Leggi le risposte ad alta voce'} title={speak ? 'Risposte lette ad alta voce' : 'Leggi le risposte ad alta voce'} className="flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-mist transition-colors hover:text-navy">
          {speak ? <Volume2 className="h-5 w-5 text-navy" /> : <VolumeX className="h-5 w-5" />}
        </button>
        <label htmlFor={inputId} className="sr-only">
          Messaggio
        </label>
        <textarea
          ref={area}
          id={inputId}
          rows={1}
          value={input}
          maxLength={600}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((x) => x.type.startsWith('image/'));
            if (files.length) {
              e.preventDefault();
              void pick(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={rec === 'rec' ? 'Ti ascolto… parla pure' : 'Scrivi o premi il microfono…'}
          readOnly={rec !== 'idle'}
          className={cn('no-scrollbar min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-xl bg-transparent px-1 py-3 text-[0.95rem] leading-snug outline-none transition-colors duration-500 placeholder:text-mist/80', rec === 'rec' && 'text-navy/70', fixed && 'bg-gold/15 text-navy')}
        />
        <button type="button" onClick={rec === 'rec' ? () => voice.stop('send') : startVoice} disabled={rec === 'busy' || thinking} aria-label={rec === 'rec' ? 'Invia il vocale' : 'Parla'} title={rec === 'rec' ? 'Invia il vocale' : 'Parla: il testo si scrive da solo'} className={cn('relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors', rec === 'rec' ? 'border-terracotta bg-terracotta text-white' : 'border-line text-navy hover:border-navy')}>
          {rec === 'rec' && <motion.span className="absolute inset-0 rounded-full bg-terracotta" animate={{ scale: [1, 1.5], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />}
          {rec === 'busy' ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-navy/20 border-t-navy" /> : rec === 'rec' ? <Send className="relative h-4 w-4" /> : <Mic className="h-5 w-5" />}
        </button>
        <motion.button type="submit" whileTap={{ scale: 0.9 }} disabled={(!input.trim() && !attach.length) || thinking} aria-label="Invia" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-ivory transition-opacity disabled:opacity-25">
          <ArrowUp className="h-4 w-4" />
        </motion.button>
      </form>
    </div>
  );
}

/** Five bars that follow the microphone level (--lvl on the parent), pure CSS: no re-renders. */
export function VoiceBars({ className }: { className?: string }) {
  return (
    <span className={cn('flex h-5 shrink-0 items-center gap-[3px]', className)} aria-hidden="true">
      {[0.55, 0.85, 1, 0.75, 0.5].map((k, i) => (
        <span key={i} className="w-[3px] rounded-full bg-gold transition-[height] duration-100" style={{ height: `calc(4px + var(--lvl, 0) * ${k * 16}px)` }} />
      ))}
    </span>
  );
}
