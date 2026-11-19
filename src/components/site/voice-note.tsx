'use client';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VoiceClip } from '@/lib/use-live-voice';

const BARS = [0.35, 0.7, 0.5, 0.95, 0.6, 0.85, 0.4, 0.75, 0.55, 0.9, 0.45, 0.65, 0.3, 0.8, 0.5, 0.6, 0.38, 0.7];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

/**
 * A sent voice message: play button + wave + length on top, and underneath the words exactly as
 * they were understood (after the clean-up). The recording can be played back in this tab.
 */
export function VoiceNote({ text, clip, heard, className }: { text: string; clip?: VoiceClip | null; heard: string; className?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = () => {
    if (!clip) return;
    if (!audio.current) {
      const a = new Audio(clip.url);
      a.onended = () => (setPlaying(false), setPos(0));
      a.ontimeupdate = () => setPos(Number.isFinite(a.duration) && a.duration ? a.currentTime / a.duration : Math.min(1, a.currentTime / clip.secs));
      audio.current = a;
    }
    if (playing) audio.current.pause();
    else void audio.current.play().catch(() => setPlaying(false));
    setPlaying(!playing);
  };
  return (
    <span className={cn('block min-w-[12rem]', className)}>
      <span className="flex items-center gap-2.5">
        <button type="button" onClick={toggle} disabled={!clip} aria-label={playing ? 'Pausa' : 'Play'} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-current transition-colors enabled:hover:bg-white/25 disabled:opacity-70">
          {!clip ? <Mic className="h-4 w-4" /> : playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}
        </button>
        <span className="flex h-6 flex-1 items-center gap-[2.5px]" aria-hidden="true">
          {BARS.map((h, i) => (
            <span key={i} className={cn('w-[3px] rounded-full transition-colors duration-200', i / BARS.length < pos ? 'bg-gold' : 'bg-current opacity-45')} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
        </span>
        <span className="shrink-0 font-mono text-[0.7rem] tabular-nums opacity-70">{clip ? mmss(clip.secs) : ''}</span>
      </span>
      <span className="mt-2.5 block border-t border-current/15 pt-2">
        <span className="mb-0.5 flex items-center gap-1 text-[0.6rem] font-semibold uppercase tracking-[0.16em] opacity-60">
          <Mic className="h-3 w-3" /> {heard}
        </span>
        {text}
      </span>
    </span>
  );
}

/** While speaking: the message being born, in the conversation itself — the words fill in live. */
export function LiveVoiceBubble({ text, busy, listening, fixing }: { text: string; busy: boolean; listening: string; fixing: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ type: 'spring', stiffness: 360, damping: 30 }} className="flex flex-col items-end">
      <div className="max-w-[90%] rounded-[1.3rem] rounded-br-md border border-dashed border-terracotta/50 bg-navy/90 px-4 py-3 text-[0.92rem] leading-relaxed text-ivory">
        <span className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {!busy && <span className="absolute inset-0 animate-ping rounded-full bg-terracotta/70" />}
            <span className={cn('relative h-2.5 w-2.5 rounded-full', busy ? 'bg-gold' : 'bg-terracotta')} />
          </span>
          <span className="flex h-5 items-center gap-[3px]" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <motion.span key={i} className="w-[3px] rounded-full bg-gold" animate={busy ? { height: 4 } : { height: [4, 8 + ((i * 7) % 11), 5, 14 - ((i * 5) % 8), 4] }} transition={{ duration: 0.9 + (i % 3) * 0.15, repeat: Infinity, ease: 'easeInOut', delay: i * 0.07 }} />
            ))}
          </span>
          <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ivory/70">{busy ? fixing : listening}</span>
        </span>
        {text && (
          <span className="mt-2 block border-t border-white/15 pt-2">
            {text}
            {!busy && <motion.span aria-hidden="true" className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.18em] bg-gold" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 1, repeat: Infinity }} />}
          </span>
        )}
      </div>
    </motion.div>
  );
}
