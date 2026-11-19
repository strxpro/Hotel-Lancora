'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import { ArrowRight, Banknote, BedDouble, Building2, Check, ChevronDown, CreditCard, Eye, EyeOff, KeyRound, Loader2, Send, Smartphone, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MEDIA } from '@/content/media';
import { useToast } from './ui';
import { setupAccountAction, setupChoiceAction, setupHotelAction } from '@/app/admin/actions/setup';
import { startStripeConnectAction } from '@/app/admin/actions/payments';
import { generateLinkCode, linkedChatsAction } from '@/app/admin/actions/automation';

const EASE = [0.22, 1, 0.36, 1] as const;

export interface SetupView {
  items: { key: string; title: string; text: string; done: boolean; waiting?: string; href: string; cta: string }[];
  done: number;
  total: number;
  allDone: boolean;
  wizard: boolean;
  celebrate: boolean;
  ownerName: string;
  hotelName: string;
  hotel: { name: string; phone: string; email: string; addressLine: string; postalCode: string; city: string };
  stripeStarted: boolean;
  telegramLinked: boolean;
}

/* ------------------------------------------------------------------ */
/* the wizard (first sign-in with the starter login)                   */
/* ------------------------------------------------------------------ */

type StepKey = 'welcome' | 'account' | 'hotel' | 'payments' | 'telegram' | 'done';
const STEPS: { key: Exclude<StepKey, 'welcome' | 'done'>; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'account', label: 'Accesso', icon: KeyRound },
  { key: 'hotel', label: 'Hotel', icon: Building2 },
  { key: 'payments', label: 'Pagamenti', icon: CreditCard },
  { key: 'telegram', label: 'Telefono', icon: Smartphone },
];

function firstStep(v: SetupView): StepKey {
  const done = (k: string) => v.items.find((i) => i.key === k)?.done;
  // first sign-in with the starter login: always the welcome page first (even if a phone is already linked)
  if (!done('account')) return 'welcome';
  if (!done('hotel')) return 'hotel';
  if (!done('payments') && !v.stripeStarted) return 'payments';
  if (!done('telegram')) return 'telegram';
  return 'done';
}

export function SetupWizard({ view }: { view: SetupView }) {
  const router = useRouter();
  const [step, setStep] = useState<StepKey>(() => firstStep(view));
  const [leaving, setLeaving] = useState(false);
  const leaveIntro = useCallback(() => {
    setLeaving((was) => {
      if (!was) setTimeout(() => setStep('account'), 720);
      return true;
    });
  }, []);
  const [open, setOpen] = useState(true);
  const [, start] = useTransition();
  const next = useCallback((to: StepKey) => {
    setStep(to);
    router.refresh();
  }, [router]);
  useEffect(() => {
    document.documentElement.style.overflow = open ? 'hidden' : '';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [open]);
  if (typeof document === 'undefined' || !open) return null;
  const index = STEPS.findIndex((s) => s.key === step);
  const finish = () =>
    start(async () => {
      await setupChoiceAction('wizard_done');
      setOpen(false);
      router.refresh();
    });

  return createPortal(
    <motion.div className="fixed inset-0 z-[300] overflow-y-auto bg-[radial-gradient(120%_90%_at_50%_0%,#13304a_0%,#0a1b2a_55%,#050d18_100%)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="dialog" aria-modal="true" aria-label="Configurazione del pannello">
      <Atmosphere dim={step !== 'welcome'} />
      <AnimatePresence mode="wait">
        {step === 'welcome' ? (
          <motion.div key="intro" className="relative z-[2]" exit={{ opacity: 0, y: -28, filter: 'blur(14px)' }} transition={{ duration: 0.8, ease: EASE }}>
            <Letterbox closing={leaving} />
            <Intro hotel={view.hotelName || 'Hotel L’Ancora'} onNext={leaveIntro} />
          </motion.div>
        ) : (
          <motion.div key="steps" className="relative z-[2] mx-auto flex min-h-full w-full max-w-xl flex-col px-5 py-10 sm:py-14" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            <div className="flex flex-col items-center gap-4 text-ivory/70">
              <span className="pl-[0.42em] text-[0.6rem] font-semibold uppercase tracking-[0.42em] text-gold/90">{view.hotelName || 'Hotel L’Ancora'}</span>
              {index >= 0 && (
                <span className="flex items-center gap-1.5" aria-label={`Passo ${index + 1} di ${STEPS.length}`}>
                  {STEPS.map((s, k) => (
                    <motion.span key={s.key} className={cn('h-1 rounded-full', k < index ? 'bg-gold' : k === index ? 'bg-ivory' : 'bg-ivory/20')} animate={{ width: k === index ? 30 : 8 }} transition={{ duration: 0.5, ease: EASE }} />
                  ))}
                </span>
              )}
            </div>
            <div className="mt-12 flex-1">
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ opacity: 0, y: 24, filter: 'blur(10px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -18, filter: 'blur(8px)' }} transition={{ duration: 0.6, ease: EASE }}>
                  {step === 'account' && <AccountStep onNext={() => next('hotel')} />}
                  {step === 'hotel' && <HotelStep hotel={view.hotel} onNext={() => next(view.items.find((i) => i.key === 'payments')?.done || view.stripeStarted ? 'telegram' : 'payments')} />}
                  {step === 'payments' && <PaymentsStep started={view.stripeStarted} onNext={() => next('telegram')} />}
                  {step === 'telegram' && <TelegramStep linked={view.telegramLinked} onNext={() => next('done')} />}
                  {step === 'done' && <DoneStep view={view} onFinish={finish} />}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  );
}

function Glow() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <motion.div className="absolute -left-40 top-10 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(70,150,255,0.35),transparent_65%)] blur-3xl" animate={{ x: [0, 60, -20, 0], y: [0, 40, 80, 0] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute -right-32 bottom-0 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(182,149,98,0.28),transparent_65%)] blur-3xl" animate={{ x: [0, -50, 10, 0], y: [0, -30, -70, 0] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />
    </div>
  );
}

/** The pointer as a small, springy offset from the centre of the screen (depth between layers). */
function useParallax(strength: number) {
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const x = useSpring(px, { stiffness: 40, damping: 18, mass: 1 });
  const y = useSpring(py, { stiffness: 40, damping: 18, mass: 1 });
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    const on = (e: PointerEvent) => {
      px.set((e.clientX / window.innerWidth - 0.5) * strength);
      py.set((e.clientY / window.innerHeight - 0.5) * strength);
    };
    window.addEventListener('pointermove', on);
    return () => window.removeEventListener('pointermove', on);
  }, [px, py, strength]);
  return { x, y };
}

/**
 * The room behind the set-up: the coast photo pushed in very slowly, the two soft lights, a light that
 * follows the pointer, film grain and a vignette. On the form steps the photo steps back (dim).
 */
function Atmosphere({ dim }: { dim: boolean }) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(-1000);
  const my = useMotionValue(-1000);
  const sx = useSpring(mx, { stiffness: 70, damping: 20, mass: 0.8 });
  const sy = useSpring(my, { stiffness: 70, damping: 20, mass: 0.8 });
  const light = useMotionTemplate`radial-gradient(520px circle at ${sx}px ${sy}px, rgba(150,195,255,0.09), transparent 62%)`;
  const depth = useParallax(-28);
  useEffect(() => {
    const on = (e: PointerEvent) => {
      mx.set(e.clientX);
      my.set(e.clientY);
    };
    window.addEventListener('pointermove', on);
    return () => window.removeEventListener('pointermove', on);
  }, [mx, my]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <motion.div className="absolute -inset-8" style={{ x: depth.x, y: depth.y }}>
        <motion.div className="absolute inset-0" initial={{ opacity: 0, scale: reduce ? 1.04 : 1.18 }} animate={{ opacity: dim ? 0.13 : 0.34, scale: 1.04 }} transition={{ opacity: { duration: 1.8, ease: EASE }, scale: { duration: 18, ease: [0.16, 1, 0.3, 1] } }}>
          <Image src={MEDIA.hero.src} alt="" fill preload sizes="100vw" quality={70} className="object-cover object-[50%_58%] grayscale-[35%]" />
        </motion.div>
      </motion.div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,13,24,0.6)_0%,rgba(5,13,24,0.25)_45%,rgba(5,13,24,0.92)_100%)]" />
      <Glow />
      <motion.div className="absolute inset-0" style={{ background: light }} />
      <div className="la-grain absolute -inset-[60%] opacity-[0.07] mix-blend-overlay" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_42%,rgba(2,6,12,0.78)_100%)]" />
    </div>
  );
}

/** A film's running time in the corner: hours:minutes:seconds:frames at 24 frames a second. */
function Timecode({ delay }: { delay: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now() + delay * 1000;
    const tick = (now: number) => {
      const f = Math.max(0, Math.floor(((now - t0) / 1000) * 24));
      const p = (n: number) => String(n).padStart(2, '0');
      if (ref.current) ref.current.textContent = `${p(Math.floor(f / 86400))}:${p(Math.floor(f / 1440) % 60)}:${p(Math.floor(f / 24) % 60)}:${p(f % 24)}`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [delay]);
  return <span ref={ref} className="tabular-nums">00:00:00:00</span>;
}

/**
 * Like the opening of a film: a gold thread across the dark, the two halves part and stay as the black
 * bars of the cinema screen, with the small titles in them. Leaving, they close again (a cut to black).
 */
function Letterbox({ closing }: { closing: boolean }) {
  const reduce = useReducedMotion();
  const ease = [0.76, 0, 0.24, 1] as const;
  const bar = closing ? '50.5vh' : 'max(2.75rem, 7vh)';
  const t = { delay: closing ? 0 : reduce ? 0 : 0.75, duration: closing ? 0.7 : reduce ? 0 : 1.5, ease };
  const small = 'text-[0.52rem] font-semibold uppercase tracking-[0.32em] text-white/40 sm:text-[0.56rem]';
  const show = { initial: { opacity: 0 }, animate: { opacity: closing ? 0 : 1 }, transition: { delay: closing ? 0 : reduce ? 0 : 2.6, duration: closing ? 0.25 : 1.4 } };
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[5]">
      <motion.div className="absolute inset-x-0 top-0 flex items-end justify-between bg-[#020509] px-5 pb-2.5 sm:px-8" initial={{ height: reduce ? bar : '50.5vh' }} animate={{ height: bar }} transition={t}>
        <motion.span className={small} {...show}>
          Hotel L’Ancora <span className="hidden sm:inline">· Santa Teresa Gallura</span>
        </motion.span>
        <motion.span className={cn(small, 'hidden sm:block')} {...show}>
          41°14′ N · 9°11′ E
        </motion.span>
      </motion.div>
      <motion.div className="absolute inset-x-0 bottom-0 flex items-start justify-between bg-[#020509] px-5 pt-2.5 sm:px-8" initial={{ height: reduce ? bar : '50.5vh' }} animate={{ height: bar }} transition={t}>
        <motion.span className={small} {...show}>
          Capitolo I · <span className="text-white/60">La configurazione</span>
        </motion.span>
        <motion.span className={small} {...show}>
          <Timecode delay={reduce ? 0 : 0.75} />
        </motion.span>
      </motion.div>
      {!reduce && (
        <motion.div className="absolute inset-x-0 top-1/2 mx-auto h-px w-[64vw] bg-gradient-to-r from-transparent via-gold to-transparent" initial={{ scaleX: 0, opacity: 1 }} animate={{ scaleX: [0, 1, 1.15], opacity: [1, 1, 0] }} transition={{ duration: 1.6, times: [0, 0.45, 1], ease: EASE }} />
      )}
    </div>
  );
}

/** The button of the intro: a gold outline that the pointer pulls a little, filled with gold on hover. */
function IntroButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 16, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 220, damping: 16, mass: 0.5 });
  return (
    <span className="relative inline-flex">
      <motion.span aria-hidden className="absolute inset-0 rounded-full border border-gold/50" animate={{ scale: [1, 1.38], opacity: [0.5, 0] }} transition={{ duration: 2.8, repeat: Infinity, ease: 'easeOut', delay: 1.2 }} />
      <motion.button
        ref={ref}
        type="button"
        onClick={onClick}
        style={{ x: sx, y: sy }}
        onPointerMove={(e) => {
          const r = ref.current?.getBoundingClientRect();
          if (!r) return;
          x.set((e.clientX - r.left - r.width / 2) * 0.3);
          y.set((e.clientY - r.top - r.height / 2) * 0.4);
        }}
        onPointerLeave={() => {
          x.set(0);
          y.set(0);
        }}
        whileTap={{ scale: 0.96 }}
        className="group relative inline-flex h-14 items-center gap-3 overflow-hidden rounded-full border border-gold/70 bg-white/[0.03] px-10 text-[0.7rem] font-semibold uppercase tracking-[0.34em] text-ivory backdrop-blur-sm transition-colors duration-500 hover:text-navy-3"
      >
        <span aria-hidden className="absolute inset-0 origin-bottom scale-y-0 rounded-full bg-gold transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-y-100" />
        <motion.span aria-hidden className="absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent" initial={{ x: '-150%' }} animate={{ x: ['-150%', '420%'] }} transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 3.6, ease: 'easeInOut', delay: 1.6 }} />
        <span className="relative pl-[0.34em]">{children}</span>
        <ArrowRight className="relative h-4 w-4 transition-transform duration-500 group-hover:translate-x-1" />
      </motion.button>
    </span>
  );
}

/** The first page: everything in the middle, one thing at a time, nothing more than needed. */
function Intro({ hotel, onNext }: { hotel: string; onNext: () => void }) {
  const reduce = useReducedMotion();
  const at = (s: number) => (reduce ? 0 : s);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onNext();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onNext]);
  const word = 'Benvenuto';
  const depth = useParallax(10);
  return (
    <motion.div style={{ x: depth.x, y: depth.y }} className="flex min-h-[100svh] flex-col items-center justify-center px-6 py-20 text-center">
      {!reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[3] mix-blend-screen"
          style={{ background: 'linear-gradient(105deg, transparent 32%, rgba(255,186,120,0.22) 44%, rgba(255,228,196,0.38) 50%, rgba(255,186,120,0.18) 56%, transparent 68%)' }}
          initial={{ x: '-70%', opacity: 0 }}
          animate={{ x: '70%', opacity: [0, 1, 0] }}
          transition={{ delay: 1.75, duration: 2.8, ease: [0.45, 0, 0.2, 1] }}
        />
      )}
      <motion.p initial={{ opacity: 0, letterSpacing: '0.8em' }} animate={{ opacity: 1, letterSpacing: '0.45em' }} transition={{ delay: at(1.1), duration: 2, ease: EASE }} className="pl-[0.45em] text-[0.6rem] font-semibold uppercase text-gold sm:text-[0.66rem]">
        {hotel}
      </motion.p>
      <motion.span aria-hidden initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={{ delay: at(1.4), duration: 1.6, ease: EASE }} className="mt-7 block h-px w-28 bg-gradient-to-r from-transparent via-gold/80 to-transparent sm:w-40" />
      <h1 className="serif mt-9 leading-[0.92] text-ivory drop-shadow-[0_0_38px_rgba(150,190,255,0.22)]" aria-label="Benvenuto nel tuo pannello">
        <span aria-hidden className="flex justify-center overflow-hidden pb-[0.1em] text-[clamp(3.6rem,13vw,8.5rem)]">
          {word.split('').map((c, k) => (
            <motion.span key={k} className="inline-block" initial={{ y: '110%', filter: 'blur(10px)' }} animate={{ y: '0%', filter: 'blur(0px)' }} transition={{ delay: at(1.6 + k * 0.055), duration: 1.25, ease: EASE }}>
              {c}
            </motion.span>
          ))}
        </span>
        <motion.span aria-hidden className="mt-1 block text-[clamp(1.4rem,3.6vw,2.4rem)] italic text-ivory/65" initial={{ opacity: 0, y: 12, filter: 'blur(12px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: at(2.3), duration: 1.4, ease: EASE }}>
          nel tuo pannello
        </motion.span>
      </h1>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: at(2.8), duration: 1.4 }} className="mt-8 max-w-sm text-[0.92rem] leading-relaxed text-ivory/55">
        Quattro passi, pochi minuti. Quello che non hai sotto mano lo fai dopo.
      </motion.p>
      <ol className="mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
        {STEPS.map((s, k) => (
          <motion.li key={s.key} initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: at(3.1 + k * 0.14), duration: 0.9, ease: EASE }} className="flex items-center gap-4">
            <span className="group flex items-center gap-2 text-[0.64rem] font-semibold uppercase tracking-[0.26em] text-ivory/50 transition-colors duration-500 hover:text-ivory">
              <span className="tabular-nums text-gold/80 transition-colors duration-500 group-hover:text-gold">0{k + 1}</span>
              {s.label}
            </span>
            {k < STEPS.length - 1 && <motion.span aria-hidden className="block h-px w-6 origin-left bg-ivory/20" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: at(3.25 + k * 0.14), duration: 0.8, ease: EASE }} />}
          </motion.li>
        ))}
      </ol>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: at(3.8), duration: 1.1, ease: EASE }} className="mt-14 flex flex-col items-center">
        <IntroButton onClick={onNext}>Iniziamo</IntroButton>
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: at(4.8), duration: 1.2 }} className="mt-6 pl-[0.34em] text-[0.56rem] font-semibold uppercase tracking-[0.34em] text-ivory/30">
          oppure premi Invio
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

function StepTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="text-center">
      <p className="pl-[0.3em] text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gold">{eyebrow}</p>
      <h2 className="serif mt-3 text-[clamp(2.3rem,6vw,3.4rem)] leading-[1.02] text-ivory">{title}</h2>
      <p className="mx-auto mt-4 max-w-md text-[0.95rem] leading-relaxed text-ivory/65">{text}</p>
    </div>
  );
}

const darkField = 'w-full rounded-2xl border border-ivory/15 bg-ivory/[0.06] px-4 py-3.5 text-[0.95rem] text-ivory placeholder:text-ivory/35 outline-none transition focus:border-gold/70 focus:bg-ivory/[0.09] focus:ring-2 focus:ring-gold/25';

function DarkField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-ivory/55">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ivory/45">{hint}</span>}
    </label>
  );
}

function Primary({ children, disabled, onClick, type = 'button' }: { children: React.ReactNode; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit' }) {
  return (
    <motion.button type={type} disabled={disabled} onClick={onClick} whileHover={disabled ? undefined : { y: -2 }} whileTap={disabled ? undefined : { scale: 0.98 }} className="group relative inline-flex h-14 items-center justify-center gap-2 overflow-hidden rounded-full bg-gold px-8 text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-navy-3 shadow-[0_18px_50px_-18px_rgba(182,149,98,0.9)] transition disabled:opacity-40">
      <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      <span className="relative flex items-center gap-2">{children}</span>
    </motion.button>
  );
}

function Later({ onClick, children = 'Più tardi' }: { onClick: () => void; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-14 px-4 text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-ivory/55 transition hover:text-ivory">
      {children}
    </button>
  );
}

function strength(p: string): number {
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

function AccountStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const st = strength(pw);
  const ok = name.trim().length >= 2 && /.+@.+\..+/.test(email) && pw.length >= 10 && pw === pw2;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        start(async () => {
          setErr('');
          const r = await setupAccountAction({ name, email, password: pw });
          if (r.ok) onNext();
          else setErr(r.error);
        });
      }}
    >
      <StepTitle eyebrow="Passo 1 di 4" title="Il tuo accesso" text="Da oggi entri con la tua e-mail e una password che conosci solo tu. L’accesso di prova smette di funzionare." />
      <div className="mt-8 space-y-4">
        <DarkField label="Il tuo nome">
          <input className={darkField} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Es. Marco Rossi" />
        </DarkField>
        <DarkField label="La tua e-mail">
          <input className={cn(darkField, err && 'border-terracotta/70')} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }} autoComplete="email" placeholder="nome@email.it" />
        </DarkField>
        <DarkField label="Password" hint="Almeno 10 caratteri. Meglio con numeri e un simbolo.">
          <span className="relative block">
            <input className={cn(darkField, 'pr-12')} type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Nascondi la password' : 'Mostra la password'} className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-ivory/60 hover:text-ivory">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
          <span className="mt-2 flex gap-1.5" aria-hidden>
            {[0, 1, 2, 3].map((k) => (
              <motion.span key={k} className="h-1 flex-1 rounded-full" animate={{ backgroundColor: k < st ? (st >= 3 ? '#7A8C6E' : '#B69562') : 'rgba(248,245,238,0.15)' }} />
            ))}
          </span>
        </DarkField>
        <DarkField label="Ripeti la password">
          <input className={cn(darkField, pw2 && pw2 !== pw && 'border-terracotta/70')} type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </DarkField>
      </div>
      <AnimatePresence>
        {err && (
          <motion.p role="alert" initial={{ opacity: 0, y: -6, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35, ease: EASE }} className="mt-5 overflow-hidden rounded-2xl border border-terracotta/50 bg-terracotta/15 px-4 py-3 text-center text-sm text-ivory">
            {err}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="mt-9 flex justify-center">
        <Primary type="submit" disabled={!ok || pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva e continua
        </Primary>
      </div>
    </form>
  );
}

function HotelStep({ hotel, onNext }: { hotel: SetupView['hotel']; onNext: () => void }) {
  const toast = useToast();
  const [h, setH] = useState(hotel);
  const [pending, start] = useTransition();
  const set = (k: keyof SetupView['hotel']) => (e: React.ChangeEvent<HTMLInputElement>) => setH({ ...h, [k]: e.target.value });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setupHotelAction(h);
          if (r.ok) onNext();
          else toast('error', r.error);
        });
      }}
    >
      <StepTitle eyebrow="Passo 2 di 4" title="I dati dell’hotel" text="Li vedono gli ospiti sul sito, nelle e-mail e nelle conferme. Controlla che siano giusti." />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <DarkField label="Nome dell’hotel">
            <input className={darkField} value={h.name} onChange={set('name')} />
          </DarkField>
        </div>
        <DarkField label="Telefono">
          <input className={darkField} value={h.phone} onChange={set('phone')} inputMode="tel" />
        </DarkField>
        <DarkField label="E-mail per gli ospiti">
          <input className={darkField} type="email" value={h.email} onChange={set('email')} />
        </DarkField>
        <div className="sm:col-span-2">
          <DarkField label="Indirizzo">
            <input className={darkField} value={h.addressLine} onChange={set('addressLine')} placeholder="Via, numero" />
          </DarkField>
        </div>
        <DarkField label="CAP">
          <input className={darkField} value={h.postalCode} onChange={set('postalCode')} inputMode="numeric" />
        </DarkField>
        <DarkField label="Città">
          <input className={darkField} value={h.city} onChange={set('city')} />
        </DarkField>
      </div>
      <div className="mt-9 flex justify-center">
        <Primary type="submit" disabled={pending || h.name.trim().length < 2}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Conferma e continua
        </Primary>
      </div>
    </form>
  );
}

function ChoiceTile({ icon: Icon, title, text, onClick, primary, busy }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; onClick: () => void; primary?: boolean; busy?: boolean }) {
  return (
    <motion.button type="button" onClick={onClick} disabled={busy} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }} className={cn('flex w-full items-start gap-4 rounded-[1.5rem] border p-5 text-left transition', primary ? 'border-gold/60 bg-gold/[0.12] hover:bg-gold/[0.18]' : 'border-ivory/12 bg-ivory/[0.04] hover:border-ivory/25')}>
      <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', primary ? 'bg-gold text-navy-3' : 'bg-ivory/10 text-ivory')}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}</span>
      <span>
        <span className="block text-[1rem] font-semibold text-ivory">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-ivory/65">{text}</span>
      </span>
    </motion.button>
  );
}

function PaymentsStep({ started, onNext }: { started: boolean; onNext: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const choose = async (c: 'payments_hotel') => {
    setBusy(c);
    const r = await setupChoiceAction(c);
    setBusy(null);
    if (r.ok) onNext();
    else toast('error', r.error);
  };
  const stripe = async () => {
    setBusy('stripe');
    await setupChoiceAction('payments_stripe');
    const r = await startStripeConnectAction();
    if (r.ok && r.data?.url) window.location.assign(r.data.url);
    else {
      setBusy(null);
      toast('error', r.ok ? 'Pagina di Stripe non disponibile.' : r.error);
    }
  };
  return (
    <div>
      <StepTitle eyebrow="Passo 3 di 4" title="Dove arrivano i soldi" text="Le prenotazioni pagate con carta arrivano sul tuo conto. Stripe (la piattaforma dei pagamenti) ti chiede i dati dell’attività e l’IBAN, una volta sola." />
      <div className="mt-8 space-y-3">
        <ChoiceTile primary icon={CreditCard} busy={busy === 'stripe'} title={started ? 'Completa i dati su Stripe' : 'Collega il mio conto'} text={started ? 'Hai già iniziato: riapri la pagina e finisci dove eri rimasto.' : 'Si apre la pagina sicura di Stripe. Alla fine torni qui da solo.'} onClick={stripe} />
        <ChoiceTile icon={Banknote} busy={busy === 'payments_hotel'} title="Per ora solo in hotel" text="Gli ospiti pagano all’arrivo. Puoi collegare la carta quando vuoi da Pagamenti." onClick={() => void choose('payments_hotel')} />
      </div>
      <div className="mt-6 flex justify-center">
        <Later onClick={onNext} />
      </div>
    </div>
  );
}

function TelegramStep({ linked, onNext }: { linked: boolean; onNext: () => void }) {
  const toast = useToast();
  const [link, setLink] = useState<{ code: string; url: string } | null>(null);
  const [done, setDone] = useState(linked);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!link || done) return;
    const t = setInterval(async () => {
      const list = await linkedChatsAction().catch(() => []);
      if (list.length) setDone(true);
    }, 3000);
    return () => clearInterval(t);
  }, [link, done]);
  const get = async () => {
    setBusy(true);
    const r = await generateLinkCode();
    setBusy(false);
    if (r.ok && r.data) {
      setLink(r.data);
      window.open(r.data.url, '_blank', 'noopener');
    } else toast('error', r.ok ? 'Telegram non disponibile.' : r.error);
  };
  return (
    <div>
      <StepTitle eyebrow="Passo 4 di 4" title="Gli avvisi sul telefono" text="Su Telegram ti arrivano le nuove prenotazioni, i messaggi degli ospiti e il report della sera. Puoi anche scrivere o parlare all’assistente." />
      <div className="mt-8 flex justify-center">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="ok" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-4 rounded-[1.5rem] border border-sage/50 bg-sage/15 p-5 text-ivory">
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 14 }} className="flex h-12 w-12 items-center justify-center rounded-full bg-sage text-ivory">
                <Check className="h-6 w-6" />
              </motion.span>
              Telefono collegato: il primo avviso è già partito.
            </motion.div>
          ) : link ? (
            <motion.div key="code" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-[1.5rem] border border-ivory/12 bg-ivory/[0.05] p-5 text-ivory/80">
              <p className="text-sm">Su Telegram premi <strong className="text-ivory">Avvia</strong>. Se Telegram non si è aperto, tocca qui:</p>
              <a href={link.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-12 items-center gap-2 rounded-full bg-[#29a9eb] px-6 text-sm font-semibold text-white">
                <Send className="h-4 w-4" /> Apri Telegram
              </a>
              <p className="mt-4 flex items-center gap-2 text-xs text-ivory/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aspetto il tuo telefono…
              </p>
            </motion.div>
          ) : (
            <motion.div key="start">
              <ChoiceTile primary icon={Smartphone} busy={busy} title="Collega il mio telefono" text="Si apre Telegram con il bot dell’hotel: un tocco su Avvia e hai finito." onClick={() => void get()} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mt-8 flex items-center justify-center gap-2">
        {done ? (
          <Primary onClick={onNext}>
            Continua <ArrowRight className="h-4 w-4" />
          </Primary>
        ) : (
          <Later
            onClick={() => {
              void setupChoiceAction('telegram_skip');
              onNext();
            }}
          />
        )}
      </div>
    </div>
  );
}

function DoneStep({ view, onFinish }: { view: SetupView; onFinish: () => void }) {
  const left = view.items.filter((i) => !i.done);
  return (
    <div>
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-full bg-gold text-navy-3 shadow-[0_0_60px_rgba(182,149,98,0.6)]">
        <Check className="h-8 w-8" />
      </motion.span>
      <StepTitle eyebrow="Fatto" title="La configurazione è pronta" text={left.length ? 'Il riepilogo: con il segno di spunta quello che è già a posto. Il resto lo ritrovi nella pagina “Oggi”, quando vuoi.' : 'Hai sistemato tutto. Il pannello è tuo.'} />
      <ul className="mx-auto mt-8 w-full max-w-sm space-y-3">
        {view.items.map((i, k) => (
          <motion.li key={i.key} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + k * 0.14, duration: 0.5, ease: EASE }} className="flex items-center gap-3 text-[0.95rem]">
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', i.done ? 'bg-sage text-ivory shadow-[0_0_18px_rgba(111,128,106,0.6)]' : 'border border-ivory/25')}>
              {i.done ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.5 + k * 0.14, duration: 0.5, ease: EASE }} />
                </svg>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              )}
            </span>
            <span className={i.done ? 'text-ivory' : 'text-ivory/60'}>{i.title}</span>
            {!i.done && <span className="ml-auto text-xs text-ivory/40">più tardi</span>}
          </motion.li>
        ))}
      </ul>
      <div className="mt-10 flex justify-center">
        <Primary onClick={onFinish}>
          Entra nel pannello <ArrowRight className="h-4 w-4" />
        </Primary>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Oggi": what is still missing                                       */
/* ------------------------------------------------------------------ */

const ICON: Record<string, React.ComponentType<{ className?: string }>> = { account: KeyRound, hotel: Building2, payments: CreditCard, telegram: Smartphone, portals: Sparkles, photos: BedDouble };

export function SetupChecklist({ view }: { view: SetupView }) {
  const [open, setOpen] = useState(true);
  const pct = view.total ? view.done / view.total : 0;
  const R = 26;
  const C = 2 * Math.PI * R;
  if (view.allDone) return null;
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="mb-8 overflow-hidden rounded-[2rem] border border-line bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-5 px-5 py-5 text-left md:px-7">
        <span className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
            <circle cx="32" cy="32" r={R} fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
            <motion.circle cx="32" cy="32" r={R} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className="text-gold" strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - pct) }} transition={{ duration: 1.2, ease: EASE }} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-navy">
            {view.done}/{view.total}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.24em] text-gold-2">Da completare</span>
          <span className="serif mt-1 block text-[1.6rem] leading-tight text-navy">Ancora {view.total - view.done} {view.total - view.done === 1 ? 'passo' : 'passi'} e il sito è tutto tuo</span>
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-navy">
          <ChevronDown className="h-5 w-5" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: EASE }} className="grid gap-px overflow-hidden border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
            {view.items.map((i, k) => {
              const Icon = ICON[i.key] ?? Sparkles;
              return (
                <motion.li key={i.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * k, duration: 0.4, ease: EASE }} className={cn('flex items-start gap-4 bg-white p-5', i.done && 'bg-ivory/60')}>
                  <span className={cn('relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', i.done ? 'bg-sage text-ivory' : 'bg-navy/[0.06] text-navy')}>
                    {i.done ? (
                      <motion.svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, delay: 0.2 + 0.08 * k, ease: EASE }} />
                      </motion.svg>
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block font-semibold', i.done ? 'text-mist line-through decoration-sage/60' : 'text-navy')}>{i.title}</span>
                    <span className="mt-0.5 block text-sm text-mist">{i.waiting ?? i.text}</span>
                    {!i.done && (
                      <a href={i.href} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-navy px-4 text-xs font-semibold text-ivory transition hover:bg-navy-2">
                        {i.cta} <ArrowRight className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </span>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* the welcome moment (right after the guided set-up)                  */
/* ------------------------------------------------------------------ */

const SMOKE = [
  { c: 'rgba(56,132,255,0.75)', s: 46, x: [-30, 10, -10], y: [10, -20, 0], d: 9 },
  { c: 'rgba(0,190,255,0.55)', s: 38, x: [20, -15, 30], y: [-15, 15, -5], d: 11 },
  { c: 'rgba(90,70,255,0.45)', s: 52, x: [0, 25, -20], y: [25, 0, 15], d: 13 },
  { c: 'rgba(30,110,220,0.6)', s: 60, x: [-10, -35, 15], y: [-25, 10, -10], d: 15 },
  { c: 'rgba(182,149,98,0.35)', s: 30, x: [35, 5, 20], y: [20, -10, 30], d: 12 },
];

function Words({ text, delay, className }: { text: string; delay: number; className?: string }) {
  return (
    <span className={className}>
      {text.split(' ').map((w, k) => (
        <motion.span key={k} className="inline-block" initial={{ opacity: 0, y: 26, filter: 'blur(14px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: delay + k * 0.09, duration: 0.9, ease: EASE }}>
          {w}
          {' '}
        </motion.span>
      ))}
    </span>
  );
}

export function WelcomeCelebration({ name, hotel }: { name: string; hotel: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState(0); // 0 smoke · 1 question · 2 skip visible
  const [closing, setClosing] = useState<null | 'guide' | 'skip'>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(false);
  const finish = useCallback(
    (how: 'guide' | 'skip') => {
      if (done.current) return;
      done.current = true;
      setClosing(how);
      void setupChoiceAction('celebrated');
      setTimeout(() => {
        router.refresh();
        if (how === 'guide') window.dispatchEvent(new Event('tour:start'));
      }, 1100);
    },
    [router],
  );
  // the page underneath does not scroll while the moment plays
  useEffect(() => {
    if (closing) return;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [closing]);
  // the question after the words, "Salta" a few seconds later, the guide by itself after 5 s without a touch
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 5200);
    const t2 = setTimeout(() => setPhase(2), 8200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  useEffect(() => {
    if (phase < 1) return;
    const arm = () => {
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => finish('guide'), 5000);
    };
    arm();
    const ev = ['pointermove', 'keydown', 'touchstart', 'wheel'] as const;
    ev.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    return () => {
      if (idle.current) clearTimeout(idle.current);
      ev.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [phase, finish]);
  const sparks = useMemo(() => Array.from({ length: 28 }, (_, k) => ({ k, x: (k * 37) % 100, d: 6 + ((k * 13) % 7), s: 2 + (k % 3), delay: (k % 9) * 0.6 })), []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {!closing || closing ? (
        <motion.div key="welcome" className="fixed inset-0 z-[320] flex items-center justify-center overflow-hidden bg-[#050d18]" initial={{ opacity: 0 }} animate={{ opacity: closing ? 0 : 1 }} transition={{ duration: closing ? 1.1 : 0.8, ease: EASE }} role="dialog" aria-modal="true" aria-label="Benvenuto">
          {/* blue smoke */}
          <div className="absolute inset-0" aria-hidden>
            {SMOKE.map((m, k) => (
              <motion.div
                key={k}
                className="absolute left-1/2 top-1/2 rounded-full"
                style={{ width: `${m.s}rem`, height: `${m.s}rem`, marginLeft: `-${m.s / 2}rem`, marginTop: `-${m.s / 2}rem`, background: `radial-gradient(circle, ${m.c}, transparent 62%)`, filter: 'blur(48px)' }}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: [0, 0.95, 0.75, 0.9], scale: [0.4, 1.15, 0.95, 1.08], x: m.x.map((v) => `${v}vw`), y: m.y.map((v) => `${v}vh`) }}
                transition={{ duration: m.d, ease: 'easeInOut', repeat: Infinity, repeatType: 'mirror', delay: k * 0.15 }}
              />
            ))}
            {/* the glow behind the words */}
            <motion.div className="absolute left-1/2 top-1/2 h-[26rem] w-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(120,190,255,0.45),transparent_65%)] blur-2xl" animate={{ opacity: [0.4, 0.9, 0.55, 0.85], scale: [0.95, 1.05, 1] }} transition={{ duration: 5, repeat: Infinity, repeatType: 'mirror' }} />
            {sparks.map((p) => (
              <motion.span key={p.k} className="absolute rounded-full bg-white" style={{ left: `${p.x}%`, bottom: '-2%', width: p.s, height: p.s, boxShadow: '0 0 12px rgba(160,210,255,0.9)' }} animate={{ y: ['0vh', '-105vh'], opacity: [0, 1, 0] }} transition={{ duration: p.d, repeat: Infinity, delay: p.delay, ease: 'linear' }} />
            ))}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(3,8,16,0.85)_100%)]" />
          </div>

          <div className="relative px-6 text-center text-white">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.42em] text-white/70">
              <Words text="Configurazione completata" delay={0.5} />
            </p>
            <h1 className="serif mt-6 text-[clamp(2.4rem,7vw,5rem)] leading-[1.02] drop-shadow-[0_0_30px_rgba(120,190,255,0.55)]">
              <Words text={`Benvenuto${name ? `, ${name}` : ''}`} delay={1.1} />
            </h1>
            <p className="mt-3 text-[clamp(1.05rem,2.6vw,1.5rem)] text-white/85">
              <Words text="nel tuo pannello di amministrazione" delay={2} />
            </p>
            <motion.div initial={{ opacity: 0, scale: 0.92, filter: 'blur(16px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} transition={{ delay: 3.1, duration: 1.3, ease: EASE }} className="mt-10">
              <span className="serif block bg-[linear-gradient(110deg,#ffffff_20%,#cfe6ff_40%,#ffffff_55%,#e9d6b3_75%,#ffffff_90%)] bg-[length:250%_100%] bg-clip-text text-[clamp(2.8rem,9vw,6.4rem)] leading-none text-transparent [animation:la-shimmer_4s_linear_infinite]">{hotel || 'Hotel L’Ancora'}</span>
              <motion.span className="mx-auto mt-5 block h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" initial={{ width: 0 }} animate={{ width: '70%' }} transition={{ delay: 3.6, duration: 1.4, ease: EASE }} />
            </motion.div>

            <AnimatePresence>
              {phase >= 1 && !closing && (
                <motion.div key="q" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, ease: EASE }} className="mt-12">
                  <p className="text-[1rem] text-white/80">Vuoi una visita guidata del pannello?</p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                    <motion.button type="button" onClick={() => finish('guide')} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} className="relative h-13 min-h-[3.25rem] overflow-hidden rounded-full bg-white px-8 text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-[#0b2236] shadow-[0_0_40px_rgba(140,200,255,0.65)]">
                      Sì, mostrami il pannello
                    </motion.button>
                    <AnimatePresence>
                      {phase >= 2 && (
                        <motion.button key="skip" type="button" onClick={() => finish('skip')} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="h-13 min-h-[3.25rem] rounded-full border border-white/30 px-7 text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-white/80 hover:border-white/60 hover:text-white">
                          Salta
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
                  <p className="mt-4 text-xs text-white/45">Se non tocchi nulla, la guida parte da sola tra qualche secondo.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
