'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MotionConfig, animate, motion, useInView } from 'motion/react';
import { ArrowUpRight, CalendarClock, Hand, Landmark } from 'lucide-react';
import { cn, money } from '@/lib/utils';

/** What the payout card says, all worked out on the server (see payout-card.tsx). */
export interface PayoutView {
  /** the big calendar leaf; null when there is no day (payouts "a mano" with nothing waiting) */
  tile: { weekday: string; day: string; month: string } | null;
  /** "Martedì 24 novembre 2026" */
  heading: string;
  /** "Oggi" / "Domani" / "Tra 3 giorni" */
  rel: string | null;
  /** "Arriva sul tuo conto •••• 1234" */
  label: string;
  amount: number;
  approx: boolean;
  empty: boolean;
  badge: { text: string; tone: 'gold' | 'violet' };
  manual: boolean;
  note: string;
  error: string | null;
  stats: [string, string][] | null;
}

const EASE = [0.22, 0.61, 0.12, 1] as const;

function CountUp({ value, prefix = '' }: { value: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  // the real amount in the page's HTML; it rolls up from 0 once the card is on screen
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!inView) return;
    setShown(0);
    const c = animate(0, value, { duration: 1.1, delay: 0.35, ease: [0.16, 1, 0.3, 1], onUpdate: setShown });
    return () => c.stop();
  }, [value, inView]);
  return (
    <span ref={ref} className="tabular-nums" aria-label={`${prefix}${money(value, 'it', 2)}`}>
      {prefix}
      {money(Math.round(shown * 100) / 100, 'it', 2)}
    </span>
  );
}

export function PayoutHero({ view: v, link }: { view: PayoutView; link: boolean }) {
  const Box = (link ? Link : 'div') as React.ElementType;
  return (
    <MotionConfig reducedMotion="user">
      <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="mb-6">
        <Box
          {...(link ? { href: '/admin/pagamenti' } : {})}
          data-testid="payout-card"
          className={cn(
            'group relative block overflow-hidden rounded-[2rem] border bg-gradient-to-br from-[#fbf3e2] via-white to-[#eef0ff] p-5 shadow-[0_30px_80px_-55px_rgba(16,40,61,0.7)] md:p-7',
            v.manual ? 'border-terracotta/40' : 'border-gold/50',
            link && 'transition-[border-color,box-shadow] hover:border-navy/30 hover:shadow-[0_34px_80px_-46px_rgba(16,40,61,0.75)]',
          )}
        >
          <motion.span aria-hidden="true" className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-gold/25 blur-3xl" animate={{ x: [0, 50, 0], y: [0, 24, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }} />
          <motion.span aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-0 h-64 w-64 rounded-full bg-[#635bff]/15 blur-3xl" animate={{ x: [0, -40, 0], y: [0, -20, 0] }} transition={{ duration: 17, repeat: Infinity, ease: 'easeInOut' }} />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
              {/* the day, as a calendar leaf */}
              <motion.div
                initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.15 }}
                className="relative w-[5.25rem] shrink-0 self-start overflow-hidden rounded-[1.2rem] bg-navy text-center shadow-[0_22px_40px_-22px_rgba(10,28,43,0.9)] sm:w-[6.5rem] sm:self-center sm:rounded-[1.4rem] md:w-[7.5rem]"
                aria-hidden="true"
              >
                {v.tile ? (
                  <>
                    <span className="block bg-gold py-1 text-[0.62rem] font-bold uppercase tracking-[0.2em] text-navy-3 sm:py-1.5 sm:text-[0.7rem]">{v.tile.weekday}</span>
                    <motion.span initial={{ y: 26, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.45, duration: 0.6, ease: EASE }} className="serif block pt-1.5 text-[2.7rem] leading-none text-gold sm:pt-2 sm:text-[3.4rem] md:text-[4rem]">
                      {v.tile.day}
                    </motion.span>
                    <span className="block pb-2.5 pt-1 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-ivory/75 sm:pb-3 sm:text-[0.72rem] sm:tracking-[0.16em]">{v.tile.month}</span>
                  </>
                ) : (
                  <span className="flex h-[6rem] flex-col items-center justify-center gap-2 text-gold sm:h-[7.4rem] md:h-[8.4rem]">
                    <Hand className="h-9 w-9" />
                    <span className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-ivory/75">a mano</span>
                  </span>
                )}
                <motion.span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent" animate={{ left: ['-60%', '160%'] }} transition={{ duration: 1.4, delay: 1.2, repeat: Infinity, repeatDelay: 5, ease: 'easeInOut' }} />
              </motion.div>

              <div className="min-w-0 flex-1">
                <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5, ease: EASE }} className="flex flex-wrap items-center gap-2">
                  <span className="serif flex items-center gap-2 text-[1.2rem] leading-tight text-navy sm:text-[1.35rem] md:text-[1.6rem]">
                    <Landmark className="h-5 w-5 shrink-0 text-gold-2" /> Prossimo bonifico
                  </span>
                  <span className={cn('rounded-full px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em]', v.badge.tone === 'gold' ? 'bg-gold/20 text-[#7a5a1f]' : 'bg-[#635bff]/10 text-[#4b44c9]')}>{v.badge.text}</span>
                </motion.p>
                <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.6, ease: EASE }} className="serif mt-1.5 text-[clamp(1.5rem,3.6vw,2.7rem)] leading-[1.05] text-navy" data-testid="payout-day">
                  {v.heading}
                </motion.p>
                <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.5, ease: EASE }} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-charcoal/85">
                  {v.rel && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-navy px-3 py-1 text-[0.78rem] font-semibold text-ivory">
                      <span className="relative flex h-2 w-2">
                        <motion.span className="absolute inset-0 rounded-full bg-gold" animate={{ scale: [1, 2.4], opacity: [0.7, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }} />
                        <span className="relative h-2 w-2 rounded-full bg-gold" />
                      </span>
                      {v.rel}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="h-4 w-4 shrink-0 text-gold-2" /> {v.label}
                  </span>
                </motion.p>
              </div>
            </div>

            <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4, duration: 0.6, ease: EASE }} className="shrink-0 border-t border-navy/10 pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0 sm:text-right">
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-mist">{v.manual ? 'Su Stripe' : 'Importo'}</p>
              <p className={cn('serif mt-1 text-[clamp(2.1rem,4vw,3.1rem)] leading-none', v.empty ? 'text-navy/40' : 'text-navy')}>
                <CountUp value={v.amount} prefix={v.approx ? '≈ ' : ''} />
              </p>
              {v.empty && <p className="mt-1 text-[0.72rem] text-mist">per ora nulla da trasferire</p>}
            </motion.div>
          </div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.6 }} className="relative mt-5 flex flex-col gap-3 border-t border-navy/10 pt-4 lg:flex-row lg:items-center lg:gap-6">
            <p className="flex-1 text-xs leading-relaxed text-mist">
              {v.note}
              {v.error && <span className="block text-terracotta">{v.error}</span>}
            </p>
            {v.stats && (
              <dl className="grid shrink-0 grid-cols-3 gap-2 text-center lg:w-[24rem]">
                {v.stats.map(([k, val]) => (
                  <div key={k} className="min-w-0 rounded-2xl bg-white/80 px-2 py-2.5 ring-1 ring-line">
                    <dt className="truncate text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-mist">{k}</dt>
                    <dd className="mt-1 truncate text-[0.8rem] font-semibold text-navy">{val}</dd>
                  </div>
                ))}
              </dl>
            )}
            {link && (
              <span className="flex shrink-0 items-center gap-1 self-end text-xs font-semibold text-navy lg:self-center">
                Pagamenti <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </span>
            )}
          </motion.div>
        </Box>
      </motion.div>
    </MotionConfig>
  );
}
