'use client';
import { gsap } from '@/lib/gsap';

/**
 * Card → room page morph (shared element, manual FLIP with a fixed clone).
 *
 * It starts on the click, not when the next page arrives: the photo lifts off the card at once,
 * the page behind fades to ivory, and the photo glides toward where the room's main picture will
 * be. When the room page mounts it tells us the exact spot and the flight lands there, then hands
 * over to the real image. If the page never comes (error, back button) everything is cleaned up.
 */
type Flight = { slug: string; clone: HTMLDivElement; veil: HTMLDivElement; at: number; timer: number };
let flight: Flight | null = null;

function cleanup(f: Flight | null, fade = true) {
  if (!f) return;
  window.clearTimeout(f.timer);
  gsap.killTweensOf([f.clone, f.veil]);
  if (!fade) {
    f.clone.remove();
    f.veil.remove();
    return;
  }
  gsap.to([f.clone, f.veil], { opacity: 0, duration: 0.35, onComplete: () => (f.clone.remove(), f.veil.remove()) });
}

/** Where the main photo of a room page sits (same grid as the page) — a good first guess. */
function guessTarget(): { top: number; left: number; width: number; height: number } {
  const vw = window.innerWidth;
  const pad = vw >= 1024 ? 64 : vw >= 768 ? 48 : vw >= 640 ? 32 : 20;
  const inner = Math.min(vw - pad * 2, 1440);
  const left = (vw - inner) / 2;
  const width = vw >= 768 ? (inner - 12 * 11) * (8 / 12) + 7 * 12 : inner;
  const height = vw >= 768 ? width / (16 / 11) : width * 0.75;
  const top = vw >= 768 ? 330 : 300;
  return { top, left, width, height };
}

export function launchMorph(slug: string, el: HTMLElement | null): boolean {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  cleanup(flight, false);
  const img = el.querySelector('img');
  const r = el.getBoundingClientRect();
  if (!img || r.width < 10) return false;

  const veil = document.createElement('div');
  Object.assign(veil.style, { position: 'fixed', inset: '0', zIndex: '84', background: 'var(--color-ivory, #f7f2ea)', opacity: '0', pointerEvents: 'none' });
  const clone = document.createElement('div');
  Object.assign(clone.style, { position: 'fixed', zIndex: '85', overflow: 'hidden', top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '28px 28px 0 0', pointerEvents: 'none', boxShadow: '0 0 0 rgba(16,40,61,0)' });
  const pic = document.createElement('img');
  pic.src = img.currentSrc || img.src;
  pic.alt = '';
  Object.assign(pic.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
  clone.appendChild(pic);
  document.body.append(veil, clone);

  const to = guessTarget();
  gsap.to(veil, { opacity: 1, duration: 0.5, ease: 'power2.out' });
  // lift, then head toward the page's main photo while the route loads
  gsap
    .timeline()
    .to(clone, { scale: 1.025, boxShadow: '0 40px 80px -30px rgba(16,40,61,0.55)', duration: 0.25, ease: 'power2.out' })
    .to(clone, { scale: 1, top: to.top, left: to.left, width: to.width, height: to.height, borderRadius: 0, duration: 0.85, ease: 'expo.inOut' });

  const f: Flight = { slug, clone, veil, at: Date.now(), timer: 0 };
  f.timer = window.setTimeout(() => flight === f && (cleanup(f), (flight = null)), 6000);
  flight = f;
  return true;
}

/** Called by the room page: land the flight on `target` (hidden until the photo is in place). */
/** (No cleanup on purpose: React's double effects in development must not cut the landing short.) */
export function landMorph(slug: string, target: HTMLElement | null, scrollTop: () => void): boolean {
  const f = flight;
  if (!f || f.slug !== slug || !target) return false;
  flight = null;
  window.clearTimeout(f.timer);
  target.style.opacity = '0';
  // two frames: the router and the smooth scroll have put the new page at the top by then
  requestAnimationFrame(() => {
    scrollTop();
    requestAnimationFrame(() => {
      const to = target.getBoundingClientRect();
      const radius = getComputedStyle(target).borderTopLeftRadius || '0px';
      gsap.killTweensOf(f.clone);
      gsap
        .timeline({
          onComplete: () => {
            target.style.opacity = '1';
            gsap.to(f.clone, { opacity: 0, duration: 0.3, delay: 0.05, onComplete: () => f.clone.remove() });
          },
        })
        .to(f.clone, { top: to.top, left: to.left, width: to.width, height: to.height, scale: 1, borderRadius: radius, boxShadow: '0 0 0 rgba(16,40,61,0)', duration: 0.7, ease: 'expo.out' }, 0)
        .to(f.veil, { opacity: 0, duration: 0.6, ease: 'power2.inOut', onComplete: () => f.veil.remove() }, 0.15);
    });
  });
  return true;
}
