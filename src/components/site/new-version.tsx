'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Check, RefreshCw } from 'lucide-react';
import { onNewBuild, useLiveVersion } from './providers';

const RELOADED_FOR = 'la-reloaded-for';
const JUST_RELOADED = 'la-just-reloaded';
const SCROLL_AT = 'la-reload-scroll';

/** Pages where a reload could lose what the person is doing (booking, payment, the guest's own stay). */
const NOT_TEXT = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'hidden']);
const KEEP = /\/(prenotazione|soggiorno|area-ospite)(\/|$)/;

/**
 * A new version of the site went live: pages that were already open switch to it by themselves,
 * without F5, at a quiet moment: never while someone is typing or has unsent text in a field, has a
 * window open on the page, is booking or paying. A hidden tab reloads at once (nobody sees it).
 * In the panel a short note says it is happening and, after, that it is done.
 */
export function NewVersionReload({ area }: { area: 'site' | 'panel' }) {
  const [note, setNote] = useState<'coming' | 'done' | null>(null);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  // keeps the check of the server running on every page, also where nothing else listens
  // (not while booking: that page is never reloaded, the next page opened is the new version)
  useLiveVersion(() => undefined, 4000, !(area === 'site' && KEEP.test(pathname)));

  useEffect(() => {
    setMounted(true);
    let hide = 0;
    try {
      if (sessionStorage.getItem(JUST_RELOADED)) {
        sessionStorage.removeItem(JUST_RELOADED);
        const y = Number(sessionStorage.getItem(SCROLL_AT) || 0);
        sessionStorage.removeItem(SCROLL_AT);
        // back where the person was, if the browser did not do it already
        if (y > 40)
          window.setTimeout(() => {
            if (window.scrollY < 10) window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
          }, 350);
        if (area === 'panel') {
          setNote('done');
          hide = window.setTimeout(() => setNote(null), 2800);
        }
      }
    } catch {
      /* storage off: nothing to say */
    }

    let wanted: string | null = null;
    let lastTouch = 0;
    let timer = 0;
    const touched = () => {
      lastTouch = Date.now();
    };
    // fields the person wrote in: while one still holds text, the page waits (it could be lost)
    const edited = new Set<HTMLElement>();
    const onInput = (e: Event) => {
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) edited.add(t);
      else if (t instanceof HTMLInputElement && !NOT_TEXT.has(t.type)) edited.add(t);
    };
    const unsaved = () => {
      for (const el of edited) {
        if (!el.isConnected) {
          edited.delete(el);
          continue;
        }
        const v = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? '');
        if (v.trim()) return true;
      }
      return false;
    };
    const someWindowOpen = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]')).some(
        // panels that stay on the page while closed (the assistant) are marked hidden/inert
        (el) => !el.closest('[aria-hidden="true"], [inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
      );
    const busy = (hidden: boolean) => {
      if (area === 'site' && KEEP.test(window.location.pathname)) return true;
      if (someWindowOpen() || unsaved()) return true;
      if (hidden) return false;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
      // a moment of calm after the last click, key or scroll (longer for guests who are reading)
      return Date.now() - lastTouch < (area === 'panel' ? 2500 : 8000);
    };
    const go = () => {
      window.clearTimeout(timer);
      if (!wanted) return;
      const hidden = document.visibilityState !== 'visible';
      if (busy(hidden)) {
        timer = window.setTimeout(go, 1500);
        return;
      }
      try {
        // never twice for the same version (the reload did not bring it: wait for the next one)
        if (sessionStorage.getItem(RELOADED_FOR) === wanted) return;
        sessionStorage.setItem(RELOADED_FOR, wanted);
        sessionStorage.setItem(JUST_RELOADED, '1');
        sessionStorage.setItem(SCROLL_AT, String(Math.round(window.scrollY)));
      } catch {
        // without storage there is no guard against reloading again and again: leave the page as it is
        return;
      }
      if (hidden || area === 'site') return window.location.reload();
      setNote('coming');
      timer = window.setTimeout(() => window.location.reload(), 1200);
    };
    const off = onNewBuild((b) => {
      wanted = b;
      go();
    });
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const e of events) window.addEventListener(e, touched, { passive: true, capture: true });
    window.addEventListener('input', onInput, true);
    // switched to another tab or program: the moment to change, unseen
    const onHide = () => document.visibilityState === 'hidden' && go();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      off();
      window.clearTimeout(timer);
      window.clearTimeout(hide);
      for (const e of events) window.removeEventListener(e, touched, { capture: true });
      window.removeEventListener('input', onInput, true);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [area]);

  if (area !== 'panel' || !mounted) return null;
  // on the page itself, above the panel's own layers (and above the bar at the bottom on phones)
  return createPortal(
    <AnimatePresence>
      {note && (
        <motion.div
          key={note}
          role="status"
          data-testid="new-version"
          initial={{ opacity: 0, y: 24, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.25rem)] z-[400] lg:bottom-6 mx-auto flex w-max max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-full bg-navy px-5 py-3 text-sm font-semibold text-ivory shadow-[0_20px_44px_-18px_rgba(16,40,61,0.9)]"
        >
          {note === 'coming' ? (
            <motion.span className="flex text-gold" animate={{ rotate: 360 }} transition={{ duration: 1, ease: 'linear', repeat: Infinity }}>
              <RefreshCw className="h-4 w-4" />
            </motion.span>
          ) : (
            <motion.span
              className="flex h-5 w-5 items-center justify-center rounded-full bg-gold text-navy"
              initial={{ scale: 0, rotate: -60 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 16, delay: 0.1 }}
            >
              <Check className="h-3 w-3" strokeWidth={3.5} />
            </motion.span>
          )}
          {note === 'coming' ? 'Arriva la nuova versione del pannello…' : 'Pannello aggiornato'}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
