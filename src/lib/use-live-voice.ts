'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speak → see the words appear while you talk → a cleaned-up text at the end.
 *
 *  · live words: the browser's own recogniser when it works (Chrome, Edge, Safari: word by word);
 *    where it does not (Opera, Firefox…) the recording so far is sent to Whisper every few seconds,
 *    so the text still fills in and earlier words get corrected as more context arrives;
 *  · at the end the whole recording is transcribed once more and cleaned up on the server
 *    (misheard words, "Monday… no, Tuesday" → "Tuesday").
 * The microphone level is written to a CSS variable (`--lvl`, 0…1) on `meterRef`, without re-renders.
 */
export type VoiceState = 'idle' | 'rec' | 'busy';
/** The recording itself, so the sent message can be played back (this browser tab only). */
export type VoiceClip = { url: string; secs: number };
type Rec = { lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };

let nativeBroken = false; // remembered for the page: Opera exposes the API but it never answers

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
}
const extOf = (mime: string) => (mime.includes('mp4') ? 'voce.m4a' : mime.includes('ogg') ? 'voce.ogg' : 'voce.webm');

export function useLiveVoice({ endpoint, onText, onFinal, onError, partialEvery = 2600, maxSeconds = 90 }: { endpoint: string; onText: (text: string) => void; onFinal: (text: string, mode: 'send' | 'edit', clip: VoiceClip | null) => void; onError: (code: 'mic' | 'short' | 'stt' | 'rate' | 'off') => void; partialEvery?: number; maxSeconds?: number }) {
  const [state, setState] = useState<VoiceState>('idle');
  const [secs, setSecs] = useState(0);
  const meterRef = useRef<HTMLDivElement | null>(null);
  const cb = useRef({ onText, onFinal, onError });
  cb.current = { onText, onFinal, onError };
  const s = useRef<{
    stream: MediaStream | null;
    rec: MediaRecorder | null;
    chunks: Blob[];
    mime: string;
    native: Rec | null;
    nativeAt: number;
    nativeFinal: string;
    ctx: AudioContext | null;
    raf: number;
    timer: number;
    poll: number;
    started: number;
    inFlight: boolean;
    seq: number;
    mode: 'send' | 'edit' | 'cancel';
  }>({ stream: null, rec: null, chunks: [], mime: '', native: null, nativeAt: 0, nativeFinal: '', ctx: null, raf: 0, timer: 0, poll: 0, started: 0, inFlight: false, seq: 0, mode: 'send' });

  const post = useCallback(
    async (mode: 'partial' | 'final') => {
      const st = s.current;
      const fd = new FormData();
      fd.append('audio', new Blob(st.chunks, { type: st.mime || 'audio/webm' }), extOf(st.mime));
      fd.append('mode', mode);
      const r = await fetch(endpoint, { method: 'POST', body: fd });
      const j = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!r.ok) throw Object.assign(new Error(j.error || 'stt'), { status: r.status });
      return (j.text ?? '').trim();
    },
    [endpoint],
  );

  const cleanup = useCallback(() => {
    const st = s.current;
    window.clearInterval(st.timer);
    window.clearInterval(st.poll);
    cancelAnimationFrame(st.raf);
    try {
      st.native?.abort();
    } catch {
      /* already stopped */
    }
    st.native = null;
    st.stream?.getTracks().forEach((t) => t.stop());
    st.stream = null;
    st.ctx?.close().catch(() => undefined);
    st.ctx = null;
    meterRef.current?.style.setProperty('--lvl', '0');
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    const st = s.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return cb.current.onError('mic');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return cb.current.onError('mic');
    }
    st.stream = stream;
    st.chunks = [];
    st.mime = pickMime();
    st.nativeFinal = '';
    st.nativeAt = 0;
    st.seq += 1;
    st.mode = 'send';
    st.started = Date.now();
    const seq = st.seq;

    const rec = new MediaRecorder(stream, st.mime ? { mimeType: st.mime } : undefined);
    st.mime = rec.mimeType || st.mime;
    rec.ondataavailable = (e) => e.data.size && st.chunks.push(e.data);
    rec.onstop = async () => {
      const mode = st.mode;
      const dur = Date.now() - st.started;
      cleanup();
      if (mode === 'cancel' || seq !== st.seq) return setState('idle');
      if (dur < 700 || !st.chunks.length) {
        setState('idle');
        return cb.current.onError('short');
      }
      setState('busy');
      try {
        const clip: VoiceClip | null = st.chunks.length ? { url: URL.createObjectURL(new Blob(st.chunks, { type: st.mime || 'audio/webm' })), secs: Math.max(1, Math.round(dur / 1000)) } : null;
        const text = await post('final');
        setState('idle');
        if (!text) return cb.current.onError('short');
        cb.current.onFinal(text, mode, clip);
      } catch (e) {
        setState('idle');
        const status = (e as { status?: number }).status;
        cb.current.onError(status === 429 ? 'rate' : status === 501 ? 'off' : 'stt');
      }
    };
    rec.start(250);
    st.rec = rec;
    setState('rec');
    setSecs(0);
    st.timer = window.setInterval(() => {
      const sec = Math.floor((Date.now() - st.started) / 1000);
      setSecs(sec);
      if (sec >= maxSeconds && rec.state === 'recording') rec.stop();
    }, 250);

    // microphone level → --lvl
    try {
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let smooth = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        smooth = smooth * 0.7 + Math.min(1, Math.sqrt(sum / buf.length) * 4.5) * 0.3;
        meterRef.current?.style.setProperty('--lvl', smooth.toFixed(3));
        st.raf = requestAnimationFrame(tick);
      };
      st.ctx = ctx;
      tick();
    } catch {
      /* no meter, still recording */
    }

    // live words, 1: the browser's recogniser
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec; opr?: unknown };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (Ctor && !nativeBroken && !W.opr && !/OPR\/|Brave/i.test(navigator.userAgent)) {
      try {
        const n = new Ctor();
        n.lang = navigator.language || 'it-IT';
        n.continuous = true;
        n.interimResults = true;
        n.maxAlternatives = 1;
        n.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]!;
            if (r.isFinal) st.nativeFinal += `${r[0].transcript} `;
            else interim += r[0].transcript;
          }
          st.nativeAt = Date.now();
          if (seq === st.seq) cb.current.onText(`${st.nativeFinal}${interim}`.replace(/\s+/g, ' ').trim());
        };
        n.onerror = (e) => {
          if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) nativeBroken = true;
        };
        n.onend = () => {
          // Chrome ends after silences: keep listening while we are recording
          if (st.native === n && rec.state === 'recording' && !nativeBroken) {
            try {
              n.start();
            } catch {
              /* will fall back to Whisper */
            }
          }
        };
        n.start();
        st.native = n;
      } catch {
        nativeBroken = true;
      }
    }

    // live words, 2: Whisper on what was said so far, when the browser gives nothing
    // (first words after ~1.2 s, then about every 2.6 s: the free tier allows ~20 a minute)
    let lastPartial = 0;
    st.poll = window.setInterval(async () => {
      if (rec.state !== 'recording' || st.inFlight || Date.now() - st.nativeAt < 2500 || Date.now() - st.started < 1200 || Date.now() - lastPartial < partialEvery) return;
      st.inFlight = true;
      lastPartial = Date.now();
      try {
        const text = await post('partial');
        if (text && seq === st.seq && rec.state === 'recording') cb.current.onText(text);
      } catch {
        /* a missed live update is fine: the final transcription will come */
      } finally {
        st.inFlight = false;
      }
    }, 400);
  }, [state, cleanup, post, partialEvery, maxSeconds]);

  /** 'send': clean up and send · 'edit': clean up and leave it in the box · 'cancel': throw away */
  const stop = useCallback((mode: 'send' | 'edit' | 'cancel' = 'send') => {
    const st = s.current;
    st.mode = mode;
    try {
      st.native?.stop();
    } catch {
      /* ignore */
    }
    st.native = null;
    if (st.rec?.state === 'recording') st.rec.stop();
    else {
      cleanup();
      setState('idle');
    }
  }, [cleanup]);

  return { state, secs, start, stop, meterRef };
}
