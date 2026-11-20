'use client';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { gsap, ScrollTrigger, SplitText, useGSAP, prefersReducedMotion } from '@/lib/gsap';

/** Subtle magnetic pull on pointer devices. */
export function Magnetic({ children, className, strength = 0.28 }: { children: React.ReactNode; className?: string; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * strength);
      yTo((e.clientY - (r.top + r.height / 2)) * strength);
    };
    const leave = () => {
      xTo(0);
      yTo(0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [strength]);
  return (
    <div ref={ref} className={cn('inline-block', className)}>
      {children}
    </div>
  );
}

/** Fade/slide children in when they enter the viewport. */
export function Reveal({ children, className, delay = 0, y = 36, as: Tag = 'div', stagger = 0 }: { children: React.ReactNode; className?: string; delay?: number; y?: number; as?: 'div' | 'section' | 'li' | 'p' | 'ul'; stagger?: number }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const targets = stagger ? Array.from(el.children) : [el];
      if (prefersReducedMotion()) {
        gsap.set(targets, { opacity: 1, y: 0 });
        return;
      }
      gsap.fromTo(targets, { opacity: 0, y }, { opacity: 1, y: 0, duration: 1.1, delay, stagger, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
    },
    { scope: ref },
  );
  const Comp = Tag as React.ElementType;
  return (
    <Comp ref={ref} className={className} data-reveal>
      {children}
    </Comp>
  );
}

/** Editorial heading: lines rise from a mask. Text stays readable for screen readers. */
export function SplitHeading({ children, className, as: Tag = 'h2', delay = 0, immediate = false, trigger }: { children: React.ReactNode; className?: string; as?: 'h1' | 'h2' | 'h3' | 'p'; delay?: number; immediate?: boolean; trigger?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (prefersReducedMotion()) {
        gsap.set(el, { opacity: 1 });
        return;
      }
      let split: SplitText | null = null;
      const run = () => {
        split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'split-line', autoSplit: true, onSplit: (self) => {
          gsap.set(el, { opacity: 1 });
          return gsap.from(self.lines, {
            yPercent: 110,
            duration: 1.25,
            stagger: 0.09,
            delay,
            ease: 'expo.out',
            ...(immediate ? {} : { scrollTrigger: { trigger: trigger ?? el, start: 'top 90%', once: true } }),
          });
        } });
      };
      if (immediate && !document.documentElement.classList.contains('intro-seen')) {
        const onDone = () => run();
        window.addEventListener('intro:done', onDone, { once: true });
        return () => {
          window.removeEventListener('intro:done', onDone);
          split?.revert();
        };
      }
      run();
      return () => split?.revert();
    },
    { scope: ref },
  );
  const Comp = Tag as React.ElementType;
  return (
    <Comp ref={ref} className={className} data-reveal>
      {children}
    </Comp>
  );
}

/** Image mask reveal + gentle inner scale. Children should be an absolutely filled image. */
export function ImageReveal({ children, className, direction = 'up', parallax = 0, delay = 0 }: { children: React.ReactNode; className?: string; direction?: 'up' | 'left' | 'right'; parallax?: number; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      const img = inner.current;
      if (!el || !img || prefersReducedMotion()) return;
      // morphing rounded window: the frame grows from a soft inset shape while the photo settles
      const r = getComputedStyle(el).borderTopLeftRadius || '24px';
      const from = direction === 'up' ? `inset(22% 8% 0% 8% round ${r})` : direction === 'left' ? `inset(8% 30% 8% 0% round ${r})` : `inset(8% 0% 8% 30% round ${r})`;
      gsap.fromTo(el, { clipPath: from, opacity: 0.001 }, { clipPath: `inset(0% 0% 0% 0% round ${r})`, opacity: 1, duration: 1.6, delay, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
      gsap.fromTo(img, { scale: 1.28 }, { scale: 1, duration: 2.1, delay, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
      // the scrubbed parallax only with a mouse: on phones it costs frames while scrolling
      if (parallax && !window.matchMedia('(hover: none), (pointer: coarse)').matches) {
        gsap.fromTo(img, { yPercent: -parallax }, { yPercent: parallax, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      }
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={cn('relative overflow-hidden rounded-[1.5rem]', className)}>
      <div ref={inner} className={cn('absolute', parallax ? '-inset-y-[8%] inset-x-0' : 'inset-0')}>
        {children}
      </div>
    </div>
  );
}

/** Animated number (respects reduced motion). */
export function CountUp({ value, className, format = (n: number) => String(Math.round(n)) }: { value: number; className?: string; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    if (prefersReducedMotion() || from === value) {
      el.textContent = format(value);
      return;
    }
    const o = { n: from };
    const tw = gsap.to(o, { n: value, duration: 1.1, ease: 'power3.out', onUpdate: () => void (el.textContent = format(o.n)) });
    return () => void tw.kill();
  }, [value, format]);
  return (
    <span ref={ref} className={className} aria-live="polite">
      {format(value)}
    </span>
  );
}

export function refreshScroll() {
  ScrollTrigger.refresh();
}
