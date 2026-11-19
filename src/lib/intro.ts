/**
 * When the first screen may move.
 *  · 'after-intro': the preloader still covers the page → animate when it lifts ("intro:done");
 *  · 'now':         client-side navigation (the site was already open) → animate straight away,
 *                   the layout effect runs before the first paint so nothing jumps;
 *  · 'still':       full page load without the preloader (seen earlier in this visit, reduced
 *                   motion, or the scripts arrived after the curtain): the page is already on screen
 *                   as it is, so it must not hide and replay — that would look like a second intro.
 */
export type OpeningMode = 'after-intro' | 'now' | 'still';

export function openingMode(): OpeningMode {
  const pre = document.querySelector<HTMLElement>('.preloader');
  if (pre) {
    const cs = getComputedStyle(pre);
    if (cs.display !== 'none' && cs.visibility !== 'hidden' && pre.getBoundingClientRect().bottom > window.innerHeight * 0.6) return 'after-intro';
  }
  return (window as typeof window & { __laHydrated?: boolean }).__laHydrated ? 'now' : 'still';
}

/** Runs `play` at the right moment (or never, in 'still'); returns the cleanup. */
export function onOpening(play: () => void): () => void {
  const mode = openingMode();
  if (mode === 'now') {
    play();
    return () => undefined;
  }
  if (mode === 'still') return () => undefined;
  let fired = false;
  const go = () => {
    if (fired) return;
    fired = true;
    play();
  };
  window.addEventListener('intro:done', go, { once: true });
  const safety = window.setTimeout(go, 3500);
  return () => {
    window.removeEventListener('intro:done', go);
    window.clearTimeout(safety);
  };
}

/** Called once the site has hydrated: from now on a mounting page is a client-side navigation. */
export function markHydrated() {
  (window as typeof window & { __laHydrated?: boolean }).__laHydrated = true;
}
