'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { Maximize2, Sparkles, X } from 'lucide-react';
import { useMediaQuery } from '@/components/site/providers';
import { AssistantChat } from './assistant-chat';

const EASE = [0.22, 0.61, 0.12, 1] as const;

/**
 * The owner assistant as an overlay: a panel sliding in from the right on desktop, a bottom
 * popup on phones. It stays mounted after the first open, so the conversation survives closing.
 */
/** Opens the assistant panel from anywhere in the admin (the shell listens for this event). */
export function OpenAssistantButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event('assistant:open'))}>
      {children}
    </button>
  );
}

export function AssistantPanel({ open, onClose, whisper, live = false }: { open: boolean; onClose: () => void; whisper: boolean; live?: boolean }) {
  const desktop = useMediaQuery('(min-width: 768px)', true);
  const [mounted, setMounted] = useState(false);
  const drag = useDragControls();
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  // the page behind must not scroll while the chat is open (wheel/touch stay inside the chat)
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => document.getElementById('panel-assistant-input')?.focus(), 450);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open, onClose]);
  if (!mounted) return null;

  return (
    <>
      <AnimatePresence>{open && <motion.button type="button" aria-label="Chiudi assistente" onClick={onClose} className="fixed inset-0 z-[100] touch-none bg-navy-3/30 backdrop-blur-[2px] md:bg-navy-3/15" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}</AnimatePresence>
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Assistente"
        aria-hidden={!open}
        inert={!open}
        initial={false}
        animate={open ? 'open' : 'closed'}
        variants={
          desktop
            ? { open: { x: 0, opacity: 1, scale: 1 }, closed: { x: '108%', opacity: 0.6, scale: 0.98 } }
            : { open: { y: 0 }, closed: { y: '105%' } }
        }
        transition={desktop ? { duration: 0.55, ease: EASE } : { type: 'spring', stiffness: 340, damping: 34 }}
        drag={desktop ? false : 'y'}
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 600) onClose();
        }}
        className={
          desktop
            ? 'fixed bottom-3 right-3 top-3 z-[101] flex w-[440px] flex-col overflow-hidden rounded-[2rem] bg-ivory shadow-[-30px_0_90px_-30px_rgba(10,28,43,0.55)] ring-1 ring-line'
            : 'fixed inset-x-0 bottom-0 z-[101] flex h-[86svh] flex-col overflow-hidden rounded-t-[2rem] bg-ivory pb-[env(safe-area-inset-bottom)] shadow-[0_-30px_80px_-30px_rgba(10,28,43,0.6)]'
        }
      >
        {!desktop && (
          <div className="flex justify-center pt-2.5" onPointerDown={(e) => drag.start(e)} style={{ touchAction: 'none' }}>
            <span className="h-1.5 w-12 rounded-full bg-navy/15" />
          </div>
        )}
        <header className="relative flex items-center gap-3 overflow-hidden px-5 pb-4 pt-4" onPointerDown={(e) => !desktop && drag.start(e)} style={{ touchAction: desktop ? undefined : 'none' }}>
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center">
            <motion.span className="absolute inset-0 rounded-2xl bg-[conic-gradient(from_0deg,#B69562,#10283D,#7A8C6E,#B69562)]" animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: 'linear' }} />
            <span className="absolute inset-[2px] rounded-[0.9rem] bg-navy" />
            <Sparkles className="relative h-5 w-5 text-gold" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="serif block text-[1.5rem] leading-none text-navy">Assistente</span>
            <span className="mt-1 block text-xs text-mist">Stessa chat di Telegram · chiedi anche “come si fa?”</span>
          </span>
          <Link href="/admin/assistente" onClick={onClose} aria-label="Apri a schermo intero" title="Apri a schermo intero" className="hidden h-10 w-10 items-center justify-center rounded-full text-mist hover:bg-navy/5 hover:text-navy md:flex">
            <Maximize2 className="h-4 w-4" />
          </Link>
          <button type="button" onClick={onClose} aria-label="Chiudi" className="flex h-10 w-10 items-center justify-center rounded-full bg-navy/5 text-navy hover:bg-navy/10">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="mx-5 h-px bg-line" />
        <div className="min-h-0 flex-1">
          <AssistantChat panel active={open} inputId="panel-assistant-input" whisper={whisper} live={live} />
        </div>
      </motion.aside>
    </>
  );
}
