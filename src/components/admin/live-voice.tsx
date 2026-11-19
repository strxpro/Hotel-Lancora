'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Headphones, Loader2, Mic, MicOff, PhoneOff, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { liveStartAction, liveToolAction } from '@/app/admin/actions/live';

type Status = 'connecting' | 'listening' | 'speaking' | 'working' | 'ended' | 'error';
type Line = { who: 'tu' | 'ancora'; text: string };

const MAX_MS = 14.5 * 60_000; // Google closes audio sessions at 15 minutes

/** Microphone → 16 kHz 16-bit PCM in 40 ms pieces, plus the level for the animation (runs off the main thread). */
const WORKLET = `
class LaMic extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.acc = 0; this.cnt = 0; this.out = new Int16Array(640); this.n = 0; this.peak = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      const a = v < 0 ? -v : v;
      if (a > this.peak) this.peak = a;
      this.acc += v; this.cnt += 1;
      if (this.cnt >= this.ratio) {
        const s = Math.max(-1, Math.min(1, this.acc / this.cnt));
        this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.acc = 0; this.cnt -= this.ratio;
        if (this.n === this.out.length) {
          this.port.postMessage({ pcm: this.out.buffer.slice(0), level: this.peak });
          this.n = 0; this.peak = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('la-mic', LaMic);
`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64Pcm(b64: string): Float32Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const f = new Float32Array(new ArrayBuffer(pcm.length * 4));
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 0x8000;
  return f;
}

/**
 * The live conversation: you speak, the assistant answers with a natural Italian voice and does
 * what you ask through the hotel's assistant (with its confirmations). You can interrupt it by
 * speaking. Opened from the assistant ("Parla dal vivo").
 */
export function LiveVoice({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('connecting');
  const [note, setNote] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const orb = useRef<HTMLDivElement>(null);
  const live = useRef<{
    session?: { sendRealtimeInput: (p: unknown) => void; sendToolResponse: (p: unknown) => void; close: () => void };
    stream?: MediaStream;
    mic?: AudioContext;
    out?: AudioContext;
    gain?: GainNode;
    analyser?: AnalyserNode;
    next: number;
    sources: AudioBufferSourceNode[];
    micLevel: number;
    muted: boolean;
    working: boolean;
    closed: boolean;
    started: number;
    raf?: number;
    timer?: ReturnType<typeof setInterval>;
  }>({ next: 0, sources: [], micLevel: 0, muted: false, working: false, closed: false, started: 0 });

  const say = useCallback((who: Line['who'], text: string, append: boolean) => {
    if (!text) return;
    setLines((ls) => {
      const last = ls.at(-1);
      if (append && last?.who === who) return [...ls.slice(0, -1), { who, text: (last.text + text).replace(/\s+/g, ' ') }];
      return [...ls, { who, text: text.trim() }].slice(-12);
    });
  }, []);

  const stopPlayback = () => {
    const l = live.current;
    l.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    l.sources = [];
    l.next = 0;
  };

  const teardown = useCallback((final?: Status, why?: string) => {
    const l = live.current;
    if (l.closed) return;
    l.closed = true;
    try {
      l.session?.close();
    } catch {
      /* closed */
    }
    stopPlayback();
    l.stream?.getTracks().forEach((t) => t.stop());
    void l.mic?.close().catch(() => null);
    void l.out?.close().catch(() => null);
    if (l.raf) cancelAnimationFrame(l.raf);
    if (l.timer) clearInterval(l.timer);
    if (final) setStatus(final);
    if (why) setNote(why);
  }, []);

  const start = useCallback(async () => {
    const l = live.current;
    Object.assign(l, { next: 0, sources: [], micLevel: 0, muted: false, working: false, closed: false, started: Date.now() });
    setLines([]);
    setNote(null);
    setStatus('connecting');
    setMuted(false);
    try {
      // the microphone first: the browser asks for permission now
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      l.stream = stream;
      const r = await liveStartAction();
      if (!r.ok || !r.data) throw new Error(r.ok ? 'Conversazione non disponibile.' : r.error);
      const { token, model } = r.data;
      const { GoogleGenAI, Modality } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1beta' } });

      // voice out: a gain and an analyser for the animation
      const out = new AudioContext();
      const gain = out.createGain();
      const analyser = out.createAnalyser();
      analyser.fftSize = 512;
      gain.connect(analyser);
      analyser.connect(out.destination);
      Object.assign(l, { out, gain, analyser });

      const play = (b64: string) => {
        if (l.closed) return;
        const f = fromBase64Pcm(b64);
        if (!f.length) return;
        const buf = out.createBuffer(1, f.length, 24000);
        buf.copyToChannel(f, 0);
        const src = out.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        const at = Math.max(out.currentTime + 0.02, l.next);
        src.start(at);
        l.next = at + buf.duration;
        l.sources.push(src);
        src.onended = () => (l.sources = l.sources.filter((x) => x !== src));
      };

      const session = await ai.live.connect({
        model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: () => setStatus('listening'),
          onmessage: (msg) => {
            const sc = msg.serverContent;
            if (sc?.interrupted) stopPlayback();
            for (const part of sc?.modelTurn?.parts ?? []) if (part.inlineData?.data) play(part.inlineData.data);
            if (sc?.inputTranscription?.text) say('tu', sc.inputTranscription.text, true);
            if (sc?.outputTranscription?.text) say('ancora', sc.outputTranscription.text, true);
            if (sc?.turnComplete) setLines((ls) => [...ls]);
            const calls = msg.toolCall?.functionCalls ?? [];
            if (calls.length) {
              l.working = true;
              setStatus('working');
              void Promise.all(
                calls.map(async (c) => {
                  const res = await liveToolAction({ name: c.name, args: c.args ?? {} }).catch(() => null);
                  const response = res?.ok ? (res.data as Record<string, unknown>) : { errore: res && !res.ok ? res.error : 'Il gestionale non risponde, riprova.' };
                  return { id: c.id, name: c.name, response };
                }),
              ).then((functionResponses) => {
                l.working = false;
                if (!l.closed) session.sendToolResponse({ functionResponses });
              });
            }
            if (msg.goAway) setNote('La conversazione sta per chiudersi: tra poco puoi ricominciarne una nuova.');
          },
          onerror: () => teardown('error', 'La connessione si è interrotta.'),
          onclose: (e) => {
            if (live.current.closed) return;
            const why = e?.reason && /quota|limit|exhaust/i.test(e.reason) ? 'Per oggi i minuti gratuiti sono finiti: riprova domani.' : 'Conversazione chiusa.';
            teardown('ended', why);
          },
        },
      });
      l.session = session as unknown as typeof l.session;

      // microphone → 16 kHz pieces → Google
      const mic = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await mic.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(mic, 'la-mic');
      mic.createMediaStreamSource(stream).connect(node);
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
        l.micLevel = e.data.level;
        if (l.closed || l.muted) return;
        l.session?.sendRealtimeInput({ audio: { data: toBase64(e.data.pcm), mimeType: 'audio/pcm;rate=16000' } });
      };
      l.mic = mic;

      // the orb breathes with whoever is speaking; the state follows the audio
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (l.closed) return;
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        const speaking = l.sources.length > 0 && out.currentTime < l.next;
        const level = speaking ? peak : l.muted ? 0 : l.micLevel;
        if (orb.current) orb.current.style.setProperty('--lvl', String(Math.min(1, level * 2.2)));
        setStatus((s) => (s === 'error' || s === 'ended' || s === 'connecting' ? s : l.working ? 'working' : speaking ? 'speaking' : 'listening'));
        l.raf = requestAnimationFrame(loop);
      };
      l.raf = requestAnimationFrame(loop);
      l.timer = setInterval(() => {
        const ms = Date.now() - l.started;
        setElapsed(ms);
        if (ms > MAX_MS) teardown('ended', 'Quindici minuti: la conversazione si chiude. Puoi ricominciarne una nuova.');
      }, 500);
    } catch (e) {
      const m = (e as Error).message || '';
      const why = /Permission|NotAllowed|denied/i.test(m) ? 'Serve il permesso del microfono: consentilo nella barra del browser e riprova.' : /NotFound|device/i.test(m) ? 'Non trovo un microfono collegato.' : m;
      teardown('error', why);
    }
  }, [say, teardown]);

  useEffect(() => {
    if (!open) return;
    live.current.closed = false;
    void start();
    return () => teardown();
  }, [open, start, teardown]);

  useEffect(() => {
    live.current.muted = muted;
  }, [muted]);

  if (typeof document === 'undefined') return null;
  const label = { connecting: 'Mi collego…', listening: 'Ti ascolto', speaking: 'Sto parlando', working: 'Controllo nel gestionale…', ended: 'Conversazione finita', error: 'Non riesco a parlare' }[status];
  const mm = Math.floor(elapsed / 60_000);
  const ss = Math.floor((elapsed % 60_000) / 1000);
  const shown = lines.slice(-4);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[260] flex flex-col items-center justify-between overflow-hidden bg-[radial-gradient(120%_90%_at_50%_10%,#173a5c_0%,#0b1d2e_55%,#050d16_100%)] px-5 py-8 text-ivory" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45 }} role="dialog" aria-modal="true" aria-label="Conversazione dal vivo">
          <div className="flex w-full max-w-xl items-center justify-between">
            <span className="flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-ivory/60">
              <Sparkles className="h-3.5 w-3.5 text-gold" /> Conversazione dal vivo
            </span>
            <span className="tabular-nums text-xs text-ivory/50">
              {mm}:{String(ss).padStart(2, '0')}
            </span>
          </div>

          {/* the orb */}
          <div className="relative flex flex-1 items-center justify-center">
            <div ref={orb} className="relative h-56 w-56 [--lvl:0]" aria-hidden>
              <motion.div
                className={cn('absolute inset-0 rounded-full blur-2xl transition-colors duration-700', status === 'speaking' ? 'bg-[#4aa3ff]/60' : status === 'working' ? 'bg-sage/60' : status === 'error' ? 'bg-terracotta/50' : 'bg-gold/45')}
                style={{ transform: 'scale(calc(1 + var(--lvl) * 0.55))' }}
                animate={{ opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2.4, repeat: Infinity }}
              />
              <div className="absolute inset-6 rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff_0%,#cfe6ff_18%,#4a8fd6_48%,#14385a_80%)] shadow-[0_0_80px_rgba(120,190,255,0.55)] transition-transform duration-100" style={{ transform: 'scale(calc(0.92 + var(--lvl) * 0.22))' }} />
              {status === 'working' && <motion.div className="absolute -inset-3 rounded-full border-2 border-sage/70 border-t-transparent" animate={{ rotate: 360 }} transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }} />}
              {status === 'connecting' && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-navy" />
                </span>
              )}
            </div>
          </div>

          <div className="w-full max-w-xl">
            <AnimatePresence mode="wait">
              <motion.p key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="serif text-center text-[1.9rem] leading-tight">
                {label}
              </motion.p>
            </AnimatePresence>
            <div className="mt-5 min-h-[7.5rem] space-y-2" aria-live="polite">
              <AnimatePresence initial={false}>
                {shown.map((ln, k) => (
                  <motion.p key={`${k}-${ln.who}-${ln.text.slice(0, 12)}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: k === shown.length - 1 ? 1 : 0.55, y: 0 }} className={cn('text-center text-[0.98rem] leading-relaxed', ln.who === 'tu' ? 'text-ivory/70' : 'text-ivory')}>
                    <span className="mr-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-gold/80">{ln.who === 'tu' ? 'Tu' : 'L’Ancora'}</span>
                    {ln.text}
                  </motion.p>
                ))}
              </AnimatePresence>
              {!lines.length && status === 'listening' && <p className="text-center text-sm text-ivory/55">Parla pure: “Chi arriva oggi?”, “Quante camere libere ho sabato?”, “Blocca la 104 domani”.</p>}
            </div>
            {note && <p className="mt-3 text-center text-sm text-gold">{note}</p>}
            <div className="mt-6 flex items-center justify-center gap-4">
              {status === 'ended' || status === 'error' ? (
                <motion.button type="button" whileTap={{ scale: 0.95 }} onClick={() => void start()} className="h-14 rounded-full bg-gold px-7 text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-navy-3">
                  Ricomincia
                </motion.button>
              ) : (
                <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => setMuted((m) => !m)} aria-pressed={muted} aria-label={muted ? 'Riattiva il microfono' : 'Silenzia il microfono'} className={cn('flex h-14 w-14 items-center justify-center rounded-full ring-1 transition-colors', muted ? 'bg-ivory text-navy ring-ivory' : 'bg-white/10 text-ivory ring-white/20 hover:bg-white/15')}>
                  {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </motion.button>
              )}
              <motion.button
                type="button"
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  teardown('ended');
                  onClose();
                }}
                aria-label="Chiudi la conversazione"
                className="flex h-16 w-16 items-center justify-center rounded-full bg-terracotta text-ivory shadow-[0_14px_40px_-12px_rgba(192,103,75,0.9)]"
              >
                <PhoneOff className="h-6 w-6" />
              </motion.button>
            </div>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[0.7rem] text-ivory/40">
              <Headphones className="h-3.5 w-3.5" /> Con le cuffie la conversazione è più fluida. Puoi interrompere parlando.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
