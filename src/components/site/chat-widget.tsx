'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ArrowUp, Mic, Send, Sparkles, X } from 'lucide-react';
import { useLiveVoice, type VoiceClip } from '@/lib/use-live-voice';
import { LiveVoiceBubble, VoiceNote } from './voice-note';
import { cn, money } from '@/lib/utils';
import { useI18n, useLenis } from './providers';
import { AnchorMark } from './brand';
import type { Locale } from '@/lib/types';

type ChatRoom = { id: string; name: string; photo: string | null; total: number; avg: number; nights: number; maxGuests: number; href: string };
type Msg = { id: string; role: 'user' | 'assistant'; text: string; actions?: { label: string; href: string }[]; rooms?: ChatRoom[]; suggest?: string[]; live?: boolean; voice?: boolean; clip?: VoiceClip | null };
const EASE = [0.22, 0.61, 0.12, 1] as const;
const HEARD: Record<string, string> = { it: 'Ho capito', en: 'I understood', pl: 'Zrozumiałem', de: 'Verstanden', fr: 'J’ai compris', es: 'He entendido' };
const VOICE: Record<string, { talk: string; listening: string; stop: string; cancel: string; fixing: string; mic: string; short: string; rate: string; off: string; stt: string }> = {
  it: { talk: 'Parla', listening: 'Ti ascolto… il testo si scrive da solo', stop: 'Fermati', cancel: 'Annulla', fixing: 'Sistemo il testo…', mic: 'Microfono non disponibile: consenti l’accesso nel browser.', short: 'Non ho sentito parole, riprova un po’ più a lungo.', rate: 'Troppi vocali: riprova tra un minuto.', off: 'I messaggi vocali non sono attivi.', stt: 'Non sono riuscito a capire, riprova.' },
  en: { talk: 'Speak', listening: 'Listening… the text types itself', stop: 'Stop', cancel: 'Cancel', fixing: 'Tidying up the text…', mic: 'Microphone not available: allow access in your browser.', short: 'I didn’t hear any words, try a little longer.', rate: 'Too many voice messages: try again in a minute.', off: 'Voice messages are not active.', stt: 'I couldn’t understand, please try again.' },
  pl: { talk: 'Mów', listening: 'Słucham… tekst wpisuje się sam', stop: 'Zatrzymaj', cancel: 'Anuluj', fixing: 'Poprawiam tekst…', mic: 'Mikrofon niedostępny: zezwól na dostęp w przeglądarce.', short: 'Nie usłyszałem słów, spróbuj trochę dłużej.', rate: 'Za dużo wiadomości głosowych: spróbuj za minutę.', off: 'Wiadomości głosowe są wyłączone.', stt: 'Nie udało się zrozumieć, spróbuj ponownie.' },
  de: { talk: 'Sprechen', listening: 'Ich höre zu… der Text schreibt sich selbst', stop: 'Stopp', cancel: 'Abbrechen', fixing: 'Ich bereinige den Text…', mic: 'Mikrofon nicht verfügbar: Zugriff im Browser erlauben.', short: 'Ich habe keine Wörter gehört, bitte etwas länger.', rate: 'Zu viele Sprachnachrichten: in einer Minute erneut.', off: 'Sprachnachrichten sind nicht aktiv.', stt: 'Ich habe es nicht verstanden, bitte erneut.' },
  fr: { talk: 'Parler', listening: 'Je vous écoute… le texte s’écrit tout seul', stop: 'Arrêter', cancel: 'Annuler', fixing: 'Je corrige le texte…', mic: 'Micro indisponible : autorisez l’accès dans le navigateur.', short: 'Je n’ai entendu aucun mot, réessayez un peu plus longtemps.', rate: 'Trop de messages vocaux : réessayez dans une minute.', off: 'Les messages vocaux ne sont pas actifs.', stt: 'Je n’ai pas compris, réessayez.' },
  es: { talk: 'Hablar', listening: 'Te escucho… el texto se escribe solo', stop: 'Parar', cancel: 'Cancelar', fixing: 'Corrijo el texto…', mic: 'Micrófono no disponible: permite el acceso en el navegador.', short: 'No he oído palabras, inténtalo un poco más.', rate: 'Demasiados mensajes de voz: prueba en un minuto.', off: 'Los mensajes de voz no están activos.', stt: 'No lo he entendido, inténtalo de nuevo.' },
};
const LIVE: Record<string, string> = { it: 'Verificato ora', en: 'Checked just now', pl: 'Sprawdzone teraz', de: 'Gerade geprüft', fr: 'Vérifié à l’instant', es: 'Comprobado ahora' };

export function ChatWidget({ voice: voiceOn = false }: { voice?: boolean }) {
  const { t, locale } = useI18n();
  const lenis = useLenis();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'kb' | 'ai' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 250);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    const small = window.matchMedia('(max-width: 767px)').matches;
    if (small) lenis.current?.stop();
    return () => {
      document.removeEventListener('keydown', onKey);
      if (small) lenis.current?.start();
    };
  }, [open, lenis]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  const close = () => {
    setOpen(false);
    window.setTimeout(() => launcherRef.current?.focus(), 50);
  };

  const send = async (text: string, clip?: VoiceClip | null) => {
    const q = text.trim().slice(0, 500);
    if (!q || busy) return;
    setInput('');
    const user: Msg = { id: crypto.randomUUID(), role: 'user', text: q, voice: clip !== undefined, clip };
    const reply: Msg = { id: crypto.randomUUID(), role: 'assistant', text: '' };
    const history = [...msgs, user];
    setMsgs(history);
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale, messages: history.slice(-10).map((m) => ({ role: m.role, content: m.text })) }),
      });
      if (res.status === 429) throw new Error(t.chat.limit);
      if (!res.ok || !res.body) throw new Error(t.chat.error);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let started = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { t: string; mode?: 'kb' | 'ai'; text?: string; actions?: Msg['actions']; rooms?: ChatRoom[]; items?: string[] };
          if (ev.t === 'meta' && ev.mode) setMode(ev.mode);
          if (ev.t === 'status' && ev.text) setStatus(ev.text);
          if (ev.t === 'stay') reply.live = true;
          if (ev.t === 'rooms' && ev.rooms) {
            reply.rooms = ev.rooms;
            setMsgs([...history, { ...reply }]);
          }
          if (ev.t === 'suggest' && ev.items) {
            reply.suggest = ev.items;
            setMsgs([...history, { ...reply }]);
          }
          if (ev.t === 'delta' && ev.text) {
            reply.text += ev.text;
            if (!started) {
              started = true;
              setBusy(false);
              setStatus(null);
            }
            setMsgs([...history, { ...reply }]);
          }
          if (ev.t === 'actions') {
            reply.actions = ev.actions;
            setMsgs([...history, { ...reply }]);
          }
        }
      }
    } catch (e) {
      setMsgs([...history, { ...reply, text: (e as Error).message || t.chat.error }]);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  // voice: words appear while the guest speaks, then the cleaned-up text is sent
  const v = VOICE[locale] ?? VOICE.it!;
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const voice = useLiveVoice({
    endpoint: '/api/chat/transcribe',
    onText: (text) => setInput(text),
    onFinal: (text, how, clip) => {
      if (how === 'send') {
        setInput('');
        send(text, clip);
        return;
      }
      setInput(text);
      inputRef.current?.focus();
    },
    onError: (code) => setVoiceErr(v[code]),
  });
  const rec = voice.state;
  // the conversation follows the words while they are being spoken
  useEffect(() => {
    if (rec !== 'idle') listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [rec, input]);

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            ref={launcherRef}
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.45, ease: EASE }}
            aria-haspopup="dialog"
            className="float-right group z-[60] flex h-[52px] items-center gap-3 rounded-full bg-navy p-1.5 text-ivory shadow-[0_20px_50px_-15px_rgba(10,28,43,0.6)] ring-1 ring-ivory/20 sm:pr-5 [html[data-dock='1']_&]:pr-1.5"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/50 text-gold transition-transform duration-500 group-hover:rotate-[-8deg]">
              <AnchorMark className="h-5 w-4" strokeWidth={1.8} />
            </span>
            <span className="float-label hidden text-[0.7rem] font-semibold uppercase tracking-[0.2em] sm:block">{t.chat.launcher}</span>
            <span className="sr-only sm:hidden">{t.chat.launcher}</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-modal="false"
            aria-label={t.chat.title}
            data-lenis-prevent
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.45, ease: EASE }}
            style={{ transformOrigin: 'bottom right' }}
            className="fixed inset-0 z-[80] flex flex-col bg-ivory md:inset-auto md:bottom-7 md:right-7 md:h-[min(680px,calc(100vh-7rem))] md:w-[420px] md:border md:border-line md:shadow-[0_40px_100px_-30px_rgba(10,28,43,0.55)]"
          >
            <header className="flex items-start justify-between bg-navy px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] text-ivory">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gold/50 text-gold">
                  <AnchorMark className="h-5 w-4" strokeWidth={1.8} />
                </span>
                <div>
                  <p className="serif text-[1.35rem] leading-none">{t.chat.title}</p>
                  <p className="mt-1 text-[0.65rem] uppercase tracking-[0.2em] text-ivory/60">{t.chat.subtitle}</p>
                </div>
              </div>
              <button type="button" onClick={close} aria-label={t.chat.close} className="-mr-2 flex h-11 w-11 items-center justify-center">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div ref={listRef} className="thin-scroll flex-1 space-y-4 overflow-y-auto px-5 py-6" aria-live="polite">
              <Bubble msg={{ id: 'welcome', role: 'assistant', text: t.chat.welcome }} locale={locale} />
              {msgs.length === 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {t.chat.suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="border border-line bg-white px-3 py-2 text-left text-[0.82rem] text-navy transition-colors hover:border-navy">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {msgs.map((m, i) => (
                <Bubble key={m.id} msg={m} locale={locale} onAction={close} onSuggest={i === msgs.length - 1 && !busy ? send : undefined} />
              ))}
              <AnimatePresence>{rec !== 'idle' && <LiveVoiceBubble key="live-voice" text={input} busy={rec === 'busy'} listening={v.talk} fixing={v.fixing} />}</AnimatePresence>
              {busy && (
                <div className="flex items-center gap-2.5 px-1 py-2" aria-label={status ?? '…'}>
                  <span className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-gold" animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
                    ))}
                  </span>
                  <AnimatePresence>
                    {status && (
                      <motion.span key={status} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="text-[0.78rem] text-mist">
                        {status}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            <div className="border-t border-line bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <AnimatePresence>
                {rec !== 'idle' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div ref={voice.meterRef} className="mb-2 flex items-center gap-2.5 rounded-full bg-navy py-1.5 pl-3 pr-1.5 text-ivory">
                      {rec === 'rec' ? (
                        <>
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="absolute inset-0 animate-ping rounded-full bg-terracotta/70" />
                            <span className="relative h-2 w-2 rounded-full bg-terracotta" />
                          </span>
                          <span className="font-mono text-[0.72rem] tabular-nums text-ivory/75">
                            {Math.floor(voice.secs / 60)}:{String(voice.secs % 60).padStart(2, '0')}
                          </span>
                          <span className="flex h-4 items-center gap-[3px]" aria-hidden="true">
                            {[0.55, 0.85, 1, 0.75, 0.5].map((k, i) => (
                              <span key={i} className="w-[3px] rounded-full bg-gold transition-[height] duration-100" style={{ height: `calc(3px + var(--lvl, 0) * ${k * 13}px)` }} />
                            ))}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[0.7rem] text-ivory/70">{v.listening}</span>
                          <button type="button" onClick={() => voice.stop('edit')} className="h-7 shrink-0 rounded-full bg-white/10 px-2.5 text-[0.68rem] font-semibold">
                            {v.stop}
                          </button>
                          <button type="button" onClick={() => voice.stop('cancel')} aria-label={v.cancel} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ivory/70 hover:bg-white/10">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ivory/25 border-t-gold" />
                          <span className="py-1 text-[0.72rem] text-ivory/85">{v.fixing}</span>
                        </>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {voiceErr && rec === 'idle' && (
                <p className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-sand-2 px-3 py-1.5 text-[0.72rem] text-navy">
                  {voiceErr}
                  <button type="button" onClick={() => setVoiceErr(null)} aria-label="×" className="text-mist">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </p>
              )}
              {mode && (
                <p className="mb-2 flex items-center gap-1.5 text-[0.68rem] text-mist">
                  <Sparkles className="h-3 w-3 text-gold-2" /> {mode === 'ai' ? t.chat.ai : t.chat.kb}
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="flex items-end gap-2"
              >
                <label htmlFor="chat-input" className="sr-only">
                  {t.chat.placeholder}
                </label>
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  rows={1}
                  maxLength={500}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  readOnly={rec !== 'idle'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder={t.chat.placeholder}
                  className="max-h-28 min-h-11 flex-1 resize-none border-0 bg-transparent py-2.5 text-[0.95rem] outline-none placeholder:text-mist/70"
                />
                {voiceOn && (
                  <button
                    type="button"
                    onClick={() => (rec === 'rec' ? voice.stop('send') : (setVoiceErr(null), setInput(''), voice.start()))}
                    disabled={rec === 'busy' || busy}
                    aria-label={rec === 'rec' ? t.chat.send : v.talk}
                    title={v.talk}
                    className={cn('relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:opacity-40', rec === 'rec' ? 'border-terracotta bg-terracotta text-white' : 'border-line text-navy hover:border-navy')}
                  >
                    {rec === 'rec' && <motion.span className="absolute inset-0 rounded-full bg-terracotta" animate={{ scale: [1, 1.45], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />}
                    {rec === 'rec' ? <Send className="relative h-4 w-4" /> : <Mic className="h-[18px] w-[18px]" />}
                  </button>
                )}
                <button type="submit" disabled={!input.trim() || busy || rec !== 'idle'} aria-label={t.chat.send} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-navy text-ivory transition-opacity disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" />
                </button>
              </form>
              <p className="mt-1 text-[0.62rem] text-mist/80">{t.chat.privacy}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const POP = { h: { opacity: 0, y: 10, scale: 0.97 }, v: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 360, damping: 28 } } };

function Bubble({ msg, locale, onAction, onSuggest }: { msg: Msg; locale: Locale; onAction?: () => void; onSuggest?: (text: string) => void }) {
  const { role, text, actions, rooms, suggest, live } = msg;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className={cn('flex flex-col', role === 'user' ? 'items-end' : 'items-start')}>
      <div className={cn('min-w-0 max-w-[88%] whitespace-pre-line break-words px-4 py-3 text-[0.93rem] leading-relaxed', role === 'user' ? 'bg-navy text-ivory' : 'border border-line bg-white text-charcoal')}>
        {live && (
          <span className="mb-1.5 flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#3f7a4a]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#4f9a5c]/60" />
              <span className="relative h-2 w-2 rounded-full bg-[#4f9a5c]" />
            </span>
            {LIVE[locale] ?? LIVE.it}
          </span>
        )}
        {msg.voice ? <VoiceNote text={text} clip={msg.clip} heard={HEARD[locale] ?? HEARD.it!} /> : text}
      </div>

      {/* the free rooms, each one opening the booking with these dates and that room already chosen */}
      {rooms && rooms.length > 0 && (
        <motion.ul initial="h" animate="v" transition={{ staggerChildren: 0.07 }} className="mt-2 w-full max-w-[88%] space-y-1.5">
          {rooms.map((r) => (
            <motion.li key={r.id} variants={POP}>
              <Link href={r.href} onClick={onAction} className="group flex items-center gap-3 border border-line bg-white p-1.5 pr-3 transition-colors hover:border-navy">
                <span className="relative h-14 w-16 shrink-0 overflow-hidden bg-sand">
                  {r.photo && <Image src={r.photo} alt="" fill sizes="64px" className="object-cover transition-transform duration-700 group-hover:scale-110" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.86rem] font-medium text-navy">{r.name}</span>
                  <span className="block text-[0.72rem] text-mist">
                    {money(r.avg, locale)} × {r.nights}
                  </span>
                </span>
                <span className="text-right">
                  <span className="serif block text-[1.05rem] leading-none text-navy">{money(r.total, locale)}</span>
                  <ArrowRight className="ml-auto mt-1 h-3.5 w-3.5 text-gold-2 transition-transform duration-300 group-hover:translate-x-0.5" />
                </span>
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      )}

      {actions && actions.length > 0 && (
        <motion.div initial="h" animate="v" transition={{ staggerChildren: 0.06, delayChildren: rooms?.length ? 0.2 : 0 }} className="mt-2 flex flex-wrap gap-2">
          {actions.map((a, i) =>
            a.href.startsWith('http') || a.href.startsWith('tel:') || a.href.startsWith('mailto:') ? (
              <motion.a variants={POP} key={a.href + a.label} href={a.href} target={a.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="btn btn-line h-9 min-h-0 px-4 text-[0.62rem] text-navy">
                {a.label}
              </motion.a>
            ) : (
              <motion.span variants={POP} key={a.href + a.label}>
                <Link href={a.href} onClick={onAction} className={cn('btn h-9 min-h-0 px-4 text-[0.62rem]', i === 0 ? 'btn-navy' : 'btn-line text-navy')}>
                  {a.label}
                </Link>
              </motion.span>
            ),
          )}
        </motion.div>
      )}

      {onSuggest && suggest && suggest.length > 0 && (
        <motion.div initial="h" animate="v" transition={{ staggerChildren: 0.06, delayChildren: 0.3 }} className="mt-2.5 flex flex-wrap gap-1.5">
          {suggest.map((s) => (
            <motion.button variants={POP} key={s} type="button" onClick={() => onSuggest(s)} className="rounded-full border border-gold/50 bg-gold/10 px-3 py-1.5 text-[0.78rem] text-navy transition-colors hover:bg-gold/25">
              {s}
            </motion.button>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}
