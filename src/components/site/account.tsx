'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CalendarDays, KeyRound, LogOut, Mail, MessageSquareText, ShieldCheck, Users } from 'lucide-react';
import { ACCOUNT_T } from '@/lib/i18n/account-dict';
import { fill, plural } from '@/lib/i18n/config';
import { diffDays, fmtDate } from '@/lib/dates';
import { cn, money } from '@/lib/utils';
import type { GuestStay } from '@/server/guest-access';
import { askCode, checkCode, signOutGuest } from '@/app/[locale]/area-ospite/actions';
import { useI18n } from './providers';
import { TLink } from './transition';

const EASE = [0.22, 0.61, 0.12, 1] as const;

/** Step 1: e-mail. Step 2: the 6-digit code from the e-mail. No passwords. */
export function GuestSignIn() {
  const { locale } = useI18n();
  const a = ACCOUNT_T[locale];
  const router = useRouter();
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [pending, start] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);
  useEffect(() => {
    if (stage === 'code') codeRef.current?.focus();
  }, [stage]);

  const send = () =>
    start(async () => {
      setError(null);
      const r = await askCode(email, locale);
      if (!r.ok) return setError(r.error === 'email' ? a.errEmail : r.error === 'busy' ? a.errBusy : a.errNoEmail);
      setWait(r.cooldown);
      setCode('');
      setStage('code');
    });

  const verify = (value: string) =>
    start(async () => {
      setError(null);
      const r = await checkCode(email, value);
      if (r.ok) return router.refresh();
      setCode('');
      setError(r.error === 'wrong' ? fill(a.errWrong, { n: r.left ?? 0 }) : r.error === 'busy' ? a.errBusy : r.error === 'locked' ? a.errLocked : a.errExpired);
    });

  const perks = [
    { icon: CalendarDays, text: a.perks[0] },
    { icon: MessageSquareText, text: a.perks[1] },
    { icon: ShieldCheck, text: a.safe },
  ];

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
      <div>
        <p className="eyebrow text-gold-2">{a.nav}</p>
        <h1 className="display mt-4 text-[clamp(2.6rem,5vw,4.4rem)] text-navy">{a.title}</h1>
        <p className="mt-5 max-w-md text-[0.98rem] leading-relaxed text-charcoal/80">{a.intro}</p>
        <ul className="mt-8 hidden space-y-3 lg:block">
          {perks.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-charcoal/75">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sand-2 text-gold-2">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative overflow-hidden rounded-[1.75rem] border border-line bg-white p-6 shadow-[0_30px_60px_-45px_rgba(16,40,61,0.55)] sm:p-9">
        <AnimatePresence mode="wait" initial={false}>
          {stage === 'email' ? (
            <motion.form
              key="email"
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={{ duration: 0.4, ease: EASE }}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy text-ivory">
                <Mail className="h-5 w-5" />
              </span>
              <label className="mt-7 block">
                <span className="label">{a.email}</span>
                <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={a.emailPh} className="field" aria-invalid={Boolean(error)} />
              </label>
              <button type="submit" disabled={pending || !email.trim()} className="btn btn-navy mt-6 w-full">
                {pending ? a.sending : a.send} {!pending && <ArrowRight className="h-4 w-4" />}
              </button>
            </motion.form>
          ) : (
            <motion.form
              key="code"
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 18 }}
              transition={{ duration: 0.4, ease: EASE }}
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 6) verify(code);
              }}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/20 text-gold-2">
                <KeyRound className="h-5 w-5" />
              </span>
              <h2 className="serif mt-6 text-[1.9rem] leading-tight text-navy">{a.codeTitle}</h2>
              <p className="mt-2 text-sm leading-relaxed text-charcoal/75">{fill(a.codeIntro, { email: email.trim() })}</p>
              <label className="mt-6 block">
                <span className="label">{a.code}</span>
                <input
                  ref={codeRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCode(v);
                    if (v.length === 6 && !pending) verify(v);
                  }}
                  className="field serif text-center text-[2rem] tracking-[0.5em] tabular-nums"
                  aria-invalid={Boolean(error)}
                  aria-describedby="code-help"
                />
              </label>
              <button type="submit" disabled={pending || code.length !== 6} className="btn btn-navy mt-6 w-full">
                {pending ? a.checking : a.verify}
              </button>
              <div id="code-help" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <button type="button" disabled={wait > 0 || pending} onClick={send} className="link-u font-semibold uppercase tracking-[0.16em] text-navy disabled:cursor-default disabled:text-mist">
                  {wait > 0 ? fill(a.resendIn, { s: wait }) : a.resend}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStage('email');
                    setError(null);
                  }}
                  className="text-mist underline-offset-2 hover:underline"
                >
                  {a.change}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {error && (
            <motion.p role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 rounded-2xl border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-sm text-terracotta">
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        <p className="mt-6 flex items-start gap-2 border-t border-line pt-5 text-xs leading-relaxed text-mist lg:hidden">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage" /> {a.safe}
        </p>
      </div>
    </div>
  );
}

const TONE: Record<GuestStay['state'], string> = {
  inhouse: 'bg-gold text-navy-3',
  upcoming: 'bg-sage/15 text-sage',
  pending: 'bg-terracotta/10 text-terracotta',
  past: 'bg-sand-2 text-mist',
  cancelled: 'bg-line/60 text-mist',
};
const PORTAL: Partial<Record<GuestStay['source'], string>> = { booking: 'Booking.com', expedia: 'Expedia', altro_ota: 'OTA' };

export function GuestStays({ email, name, stays }: { email: string; name: string; stays: GuestStay[] }) {
  const { locale, href } = useI18n();
  const a = ACCOUNT_T[locale];
  const router = useRouter();
  const [pending, start] = useTransition();
  const first = name.trim() ? name.trim().charAt(0).toLocaleUpperCase(locale) + name.trim().slice(1) : '';
  const current = stays.filter((s) => s.state === 'inhouse' || s.state === 'pending' || s.state === 'upcoming');
  const history = stays.filter((s) => s.state === 'past' || s.state === 'cancelled');

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-col gap-6 border-b border-line pb-10 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow text-gold-2">{a.nav}</p>
          <h1 className="display mt-4 text-[clamp(2.6rem,5vw,4.4rem)] text-navy">{first ? fill(a.hello, { name: first }) : a.title}</h1>
          <p className="mt-3 text-sm text-mist">{fill(a.signedAs, { email })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TLink href={href('/prenotazione')} label={a.bookCta} className="btn btn-navy h-11 min-h-0 px-5 text-[0.66rem]">
            {a.bookCta}
          </TLink>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await signOutGuest();
                router.refresh();
              })
            }
            className="btn btn-line h-11 min-h-0 px-5 text-[0.66rem] text-navy"
          >
            <LogOut className="h-4 w-4" /> {a.signOut}
          </button>
        </div>
      </div>

      <section className="mt-12" aria-labelledby="acc-current">
        <h2 id="acc-current" className="serif text-[1.9rem] text-navy">
          {a.current}
        </h2>
        {current.length ? (
          <ul className="mt-6 space-y-5">
            {current.map((s, i) => (
              <StayCard key={s.token} stay={s} index={i} />
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-[1.4rem] border border-dashed border-line bg-white/60 px-6 py-8 text-center text-sm text-mist">{a.none}</p>
        )}
      </section>

      {history.length > 0 && (
        <section className="mt-16" aria-labelledby="acc-history">
          <h2 id="acc-history" className="serif text-[1.6rem] text-navy">
            {a.history}
          </h2>
          <ul className="mt-6 space-y-4">
            {history.map((s, i) => (
              <StayCard key={s.token} stay={s} index={i} compact />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StayCard({ stay: s, index, compact }: { stay: GuestStay; index: number; compact?: boolean }) {
  const { t, locale, href } = useI18n();
  const a = ACCOUNT_T[locale];
  const nights = diffDays(s.checkIn, s.checkOut);
  const due = Math.max(0, Math.round((s.total - s.paid) * 100) / 100);
  const dim = s.state === 'cancelled' || s.state === 'past';
  const day = (iso: string) => fmtDate(iso, locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <motion.li initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * index, duration: 0.5, ease: EASE }} className={cn('overflow-hidden rounded-[1.6rem] border border-line bg-white', compact ? 'md:grid md:grid-cols-[180px_1fr]' : 'md:grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]')}>
      <div className={cn('relative bg-sand', compact ? 'hidden md:block' : 'aspect-[16/9] md:aspect-auto md:min-h-[240px]')}>
        {s.photo && <Image src={s.photo} alt="" fill sizes="(min-width:768px) 340px, 100vw" className={cn('object-cover', dim && 'grayscale-[40%] opacity-90')} />}
      </div>
      <div className={cn('flex flex-col gap-5', compact ? 'p-5 md:p-6' : 'p-6 md:p-8')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em]', TONE[s.state])}>{a.states[s.state]}</span>
            <p className={cn('serif mt-3 leading-tight text-navy', compact ? 'text-[1.4rem]' : 'text-[1.9rem]', s.state === 'cancelled' && 'line-through decoration-1')}>{s.roomName ? `${s.roomName} · N° ${s.roomNumber}` : a.roomTbd}</p>
            <p className="mt-1 text-xs tracking-[0.12em] text-mist">
              {t.booking.code} {s.code}
              {PORTAL[s.source] ? ` · ${fill(a.portal, { portal: PORTAL[s.source]! })}` : ''}
            </p>
          </div>
        </div>

        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="label mb-1">{t.search.arrival}</dt>
            <dd className="text-navy">{day(s.checkIn)}</dd>
          </div>
          <div>
            <dt className="label mb-1">{t.search.departure}</dt>
            <dd className="text-navy">{day(s.checkOut)}</dd>
          </div>
          <div>
            <dt className="label mb-1 flex items-center gap-1.5">
              <Users className="h-3 w-3" /> {t.search.guests}
            </dt>
            <dd className="text-navy">
              {plural(locale, s.adults + s.children, t.search.guestsCount)} · {plural(locale, nights, t.booking.nights)}
            </dd>
          </div>
        </dl>

        {!compact && (
          <div className="grid gap-3 rounded-2xl bg-sand-2/50 p-4 text-sm sm:grid-cols-3">
            <p className="flex justify-between gap-3 sm:block">
              <span className="label block">{a.total}</span>
              <span className="serif text-lg text-navy">{money(s.total, locale, 2)}</span>
            </p>
            <p className="flex justify-between gap-3 sm:block">
              <span className="label block">{a.paid}</span>
              <span className="serif text-lg text-navy">{money(s.paid, locale, 2)}</span>
              {s.method && <span className="block text-xs text-mist">{a.method[s.method]}</span>}
            </p>
            <p className="flex justify-between gap-3 sm:block">
              <span className="label block">{due > 0 ? a.due : a.settled}</span>
              <span className={cn('serif text-lg', due > 0 ? 'text-navy' : 'text-sage')}>{due > 0 ? money(due, locale, 2) : '✓'}</span>
            </p>
          </div>
        )}

        <div className="mt-auto">
          <TLink href={href(`/soggiorno/${s.token}`)} label={a.manage} className={cn('group inline-flex items-center gap-2 font-semibold uppercase', compact ? 'link-u text-[0.7rem] tracking-[0.2em] text-navy' : 'btn btn-navy h-11 min-h-0 px-5 text-[0.66rem] tracking-[0.16em]')}>
            {a.manage} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </TLink>
        </div>
      </div>
    </motion.li>
  );
}
