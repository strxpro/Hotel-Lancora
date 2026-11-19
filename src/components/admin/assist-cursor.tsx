'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, animate, motion, useMotionValue } from 'motion/react';
import { Hand, Sparkles, X } from 'lucide-react';
import { ASSIST_EVENT, type UiStep } from '@/lib/assist';

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
const visible = (e: HTMLElement) => {
  const r = e.getBoundingClientRect();
  return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden';
};

/** `sel:css`, `text:words`, or `a >> b` (b inside a). */
function resolve(target: string): HTMLElement | null {
  let scope: ParentNode = document;
  let el: HTMLElement | null = null;
  for (const raw of target.split('>>').map((s) => s.trim())) {
    if (raw.startsWith('text:')) {
      const needle = raw.slice(5).trim().toLowerCase();
      const all = [...scope.querySelectorAll<HTMLElement>('button, a, [role="button"], label, tr, li, summary, [data-assist]')].filter((e) => visible(e) && (e.innerText || '').toLowerCase().includes(needle));
      const area = (e: HTMLElement) => e.getBoundingClientRect().width * e.getBoundingClientRect().height;
      all.sort((a, b) => Number((b.innerText || '').trim().toLowerCase().startsWith(needle)) - Number((a.innerText || '').trim().toLowerCase().startsWith(needle)) || area(a) - area(b));
      el = all[0] ?? null;
    } else {
      const css = raw.startsWith('sel:') ? raw.slice(4) : raw;
      el = [...scope.querySelectorAll<HTMLElement>(css)].find(visible) ?? null;
    }
    if (!el) return null;
    scope = el;
  }
  return el;
}

async function find(target: string, timeout = 5000): Promise<HTMLElement | null> {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const el = resolve(target);
    if (el) return el;
    await wait(120);
  }
  return null;
}

/**
 * The assistant's hand: a cursor that travels across the panel, opens pages, points, clicks and
 * types — so the owner sees exactly where things are and how they are done. Any click of the
 * owner (or "Stop") ends the show.
 */
export function AssistCursor() {
  const router = useRouter();
  const x = useMotionValue(-80);
  const y = useMotionValue(-80);
  const [on, setOn] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const [ring, setRing] = useState<DOMRect | null>(null);
  const [tap, setTap] = useState(0);
  const run = useRef(0);
  const ringEl = useRef<HTMLElement | null>(null);

  // keep the highlight glued to its element while the page scrolls
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const tick = () => {
      if (ringEl.current) setRing(ringEl.current.getBoundingClientRect());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);

  const moveTo = useCallback(
    async (el: HTMLElement, id: number) => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await wait(420);
      if (run.current !== id) return false;
      const r = el.getBoundingClientRect();
      const tx = r.left + Math.min(r.width / 2, 160);
      const ty = r.top + r.height / 2;
      const d = Math.hypot(tx - x.get(), ty - y.get());
      const duration = Math.min(1.1, 0.35 + d / 1600);
      ringEl.current = el;
      await Promise.all([animate(x, tx, { duration, ease: [0.22, 0.61, 0.12, 1] }), animate(y, ty, { duration, ease: [0.3, 0.1, 0.2, 1] })]);
      return run.current === id;
    },
    [x, y],
  );

  const play = useCallback(
    async (steps: UiStep[]) => {
      const id = ++run.current;
      window.dispatchEvent(new Event('assistant:close'));
      x.set(window.innerWidth - 90);
      y.set(window.innerHeight - 90);
      setOn(true);
      await wait(380);
      for (const s of steps) {
        if (run.current !== id) return;
        if (s.do === 'wait') {
          await wait(s.ms);
          continue;
        }
        if (s.say) setSay(s.say);
        if (s.do === 'say') {
          await wait(1500);
          continue;
        }
        if (s.do === 'go') {
          const target = s.path.split('?')[0]!;
          if (window.location.pathname !== target || s.path.includes('?')) {
            ringEl.current = null;
            setRing(null);
            router.push(s.path);
            const t0 = performance.now();
            while (window.location.pathname !== target && performance.now() - t0 < 6000) await wait(100);
            await wait(650);
          } else await wait(500);
          continue;
        }
        const el = await find(s.target);
        if (!el || run.current !== id) {
          await wait(400);
          continue;
        }
        if (!(await moveTo(el, id))) return;
        if (s.do === 'point') {
          await wait(1300);
          continue;
        }
        // click (and type): a visible tap, then the real thing
        setTap((n) => n + 1);
        await wait(180);
        if (s.do === 'click') {
          el.click();
          await wait(900);
          continue;
        }
        const input = (el.matches('input,textarea') ? el : el.querySelector('input,textarea')) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!input) continue;
        input.focus();
        const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        for (const ch of s.text) {
          if (run.current !== id) return;
          setter?.call(input, input.value + ch);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(28 + Math.random() * 40);
        }
        await wait(700);
      }
      await wait(900);
      if (run.current === id) stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moveTo, router, x, y],
  );

  const stop = useCallback(() => {
    run.current++;
    setOn(false);
    setSay(null);
    setRing(null);
    ringEl.current = null;
  }, []);

  useEffect(() => {
    const onPlay = (e: Event) => play((e as CustomEvent<UiStep[]>).detail ?? []);
    window.addEventListener(ASSIST_EVENT, onPlay);
    return () => window.removeEventListener(ASSIST_EVENT, onPlay);
  }, [play]);

  // the owner takes over: any real click or Esc stops the show
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stop();
    const onDown = (e: PointerEvent) => e.isTrusted && !(e.target as HTMLElement).closest('[data-assist-ui]') && stop();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [on, stop]);

  return (
    <AnimatePresence>
      {on && (
        <motion.div key="assist" data-assist-ui className="pointer-events-none fixed inset-0 z-[140]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {ring && (
            <motion.span
              className="absolute rounded-2xl ring-[3px] ring-gold shadow-[0_0_0_9999px_rgba(10,28,43,0.18),0_0_30px_6px_rgba(182,149,98,0.45)]"
              initial={false}
              animate={{ left: ring.left - 6, top: ring.top - 6, width: ring.width + 12, height: ring.height + 12 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            />
          )}
          <motion.div className="absolute left-0 top-0" style={{ x, y }}>
            {/* the hand */}
            <motion.svg key={tap} width="34" height="40" viewBox="0 0 34 40" className="-ml-[5px] -mt-[3px] drop-shadow-[0_8px_14px_rgba(10,28,43,0.45)]" animate={tap ? { scale: [1, 0.82, 1] } : undefined} transition={{ duration: 0.28 }}>
              <path d="M5 3 L5 31 L12.5 24.5 L17.6 36 L22.4 33.8 L17.4 22.6 L27.5 22.2 Z" fill="#10283D" stroke="#F8F5EE" strokeWidth="2.4" strokeLinejoin="round" />
            </motion.svg>
            {tap > 0 && <motion.span key={`r${tap}`} className="absolute -left-5 -top-5 h-10 w-10 rounded-full border-2 border-gold" initial={{ scale: 0.3, opacity: 1 }} animate={{ scale: 1.8, opacity: 0 }} transition={{ duration: 0.6 }} />}
            <AnimatePresence mode="wait">
              {say && (
                <motion.p key={say} initial={{ opacity: 0, y: 6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} className="absolute left-7 top-9 flex w-max max-w-[min(300px,70vw)] items-start gap-2 rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-[0.82rem] font-medium leading-snug text-navy shadow-[0_18px_40px_-12px_rgba(10,28,43,0.55)] ring-1 ring-gold/40">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-2" />
                  {say}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
          <motion.button
            type="button"
            data-assist-ui
            onClick={stop}
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="pointer-events-auto absolute bottom-24 left-1/2 flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-white pl-3 pr-4 text-xs font-semibold text-navy shadow-[0_18px_40px_-16px_rgba(10,28,43,0.6)] ring-1 ring-line md:bottom-6"
          >
            <Hand className="h-4 w-4 text-gold-2" /> L’assistente sta mostrando · <X className="h-3.5 w-3.5" /> Ferma
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
