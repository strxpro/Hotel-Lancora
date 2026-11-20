'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CalendarClock, CreditCard, Loader2, Zap } from 'lucide-react';
import { addDays, diffDays, fmtDate } from '@/lib/dates';
import { cn, money } from '@/lib/utils';
import { Dialog, useAction } from './ui';
import { chargePlannedAction } from '@/app/admin/actions/payments';

const EASE = [0.22, 0.61, 0.12, 1] as const;

export type PendingChargeRow = {
  id: string;
  code: string;
  guest: string;
  room: string | null;
  checkIn: string;
  checkOut: string;
  amount: number;
  on: string;
  due: boolean;
  auto: boolean;
  card: string | null;
  failed: string | null;
  asked: boolean;
};

/** "tra 3 giorni" / "domani" / "oggi" for the charge day. */
function whenLabel(on: string, today: string): string {
  const d = diffDays(today, on);
  if (d <= 0) return 'oggi';
  if (d === 1) return 'domani';
  return `tra ${d} giorni`;
}

/**
 * Pagamenti → "Da addebitare": the "pay later" bookings, with the day the card is charged and the
 * button to charge it now. Shown only when there is something to charge or "Più tardi" is on.
 */
export function PendingCharges({ rows, today, enabled, cardsOn }: { rows: PendingChargeRow[]; today: string; enabled: boolean; cardsOn: boolean }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [ask, setAsk] = useState<PendingChargeRow | null>(null);
  if (!rows.length && !enabled) return null;
  const total = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const week = rows.filter((r) => r.on <= addDays(today, 7)).length;

  const charge = (r: PendingChargeRow) =>
    run(
      async () => {
        const res = await chargePlannedAction(r.id);
        // refused by the bank: the row turns red with the reason
        if (!res.ok) {
          setAsk(null);
          router.refresh();
        }
        return res;
      },
      {
        success: `Addebitati ${money(r.amount, 'it', 2)} sulla carta di ${r.guest}.`,
        onOk: () => {
          setAsk(null);
          router.refresh();
        },
      },
    );

  return (
    <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.7, ease: EASE }} className="mt-4 rounded-[2rem] border border-line bg-white p-6 md:p-8" data-testid="pending-charges">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="serif text-[1.9rem] leading-tight text-navy">Da addebitare sulla carta</p>
          <p className="text-sm text-mist">Prenotazioni “paga dopo”: la carta è salvata, l’importo si addebita prima dell’arrivo.</p>
        </div>
        {rows.length > 0 && (
          <div className="flex gap-2">
            <span className="rounded-full bg-sand-2 px-3.5 py-1.5 text-xs font-semibold text-navy">
              {rows.length} {rows.length === 1 ? 'prenotazione' : 'prenotazioni'} · {money(total, 'it', 2)}
            </span>
            {week > 0 && <span className="rounded-full bg-gold/20 px-3.5 py-1.5 text-xs font-semibold text-navy">{week} entro 7 giorni</span>}
          </div>
        )}
      </div>

      {!cardsOn && <p className="mt-4 rounded-2xl bg-terracotta/10 px-4 py-2.5 text-sm text-terracotta">I pagamenti con carta non sono attivi: gli addebiti partono quando Stripe è collegato.</p>}

      {rows.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-ivory px-4 py-4 text-sm text-mist">Nessun addebito in attesa. Le nuove prenotazioni con carta compariranno qui.</p>
      ) : (
        <ul className="mt-5 grid gap-2.5">
          <AnimatePresence initial={false}>
            {rows.map((r, i) => (
              <motion.li
                key={r.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 40, height: 0 }}
                transition={{ delay: 0.05 * Math.min(i, 8), duration: 0.45, ease: EASE }}
                className={cn('flex flex-col gap-3 rounded-[1.4rem] border p-4 sm:flex-row sm:items-center', r.failed ? 'border-terracotta/40 bg-terracotta/[0.04]' : r.due ? 'border-gold/60 bg-sand-2/40' : 'border-line bg-ivory')}
              >
                <span className={cn('flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl text-center leading-none', r.failed ? 'bg-terracotta/15 text-terracotta' : r.due ? 'bg-gold text-navy-3' : 'bg-navy text-ivory')}>
                  {r.failed ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <>
                      <span className="text-[1.05rem] font-semibold">{fmtDate(r.on, 'it', { day: 'numeric' })}</span>
                      <span className="mt-0.5 text-[0.58rem] uppercase tracking-[0.12em] opacity-75">{fmtDate(r.on, 'it', { month: 'short' })}</span>
                    </>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.95rem] font-semibold text-navy">
                    {r.guest}{' '}
                    <Link href={`/admin/prenotazioni?id=${r.id}`} className="text-xs font-medium text-mist underline-offset-2 hover:text-navy hover:underline">
                      {r.code}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-[0.78rem] text-charcoal/75">
                    {r.room ? `Camera ${r.room} · ` : ''}arrivo {fmtDate(r.checkIn, 'it', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </p>
                  <p className={cn('mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem]', r.failed ? 'text-terracotta' : 'text-mist')}>
                    {r.failed ? (
                      <>Non riuscito: {r.failed}{r.asked ? ' · l’ospite ha ricevuto l’email per un’altra carta' : ''}</>
                    ) : (
                      <>
                        <CalendarClock className="h-3.5 w-3.5" /> {r.auto ? `Si addebita da solo ${whenLabel(r.on, today)}` : `Da addebitare ${whenLabel(r.on, today)}: premi tu “Addebita ora”`}
                      </>
                    )}
                    {r.card && (
                      <span className="inline-flex items-center gap-1">
                        <CreditCard className="h-3.5 w-3.5" /> {r.card}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <span className="serif text-[1.6rem] leading-none text-navy tabular-nums">{money(r.amount, 'it', 2)}</span>
                  <motion.button whileTap={{ scale: 0.96 }} type="button" disabled={pending || !cardsOn || !r.card} onClick={() => setAsk(r)} className="btn btn-navy h-11 min-h-0 px-4 text-xs disabled:opacity-40">
                    <Zap className="h-4 w-4 text-gold" /> Addebita ora
                  </motion.button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <Dialog
        open={Boolean(ask)}
        onClose={() => !pending && setAsk(null)}
        title="Addebitare adesso?"
        width={460}
        footer={
          ask && (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={pending} onClick={() => setAsk(null)} className="btn btn-line text-navy">
                No, aspetta
              </button>
              <button type="button" disabled={pending} onClick={() => charge(ask)} className="btn btn-navy">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 text-gold" />} Sì, addebita {money(ask.amount, 'it', 2)}
              </button>
            </div>
          )
        }
      >
        {ask && (
          <div className="space-y-3 text-sm text-charcoal/85">
            <p>
              Addebitiamo <strong className="text-navy">{money(ask.amount, 'it', 2)}</strong> sulla carta di <strong className="text-navy">{ask.guest}</strong>
              {ask.card ? ` (${ask.card})` : ''} per la prenotazione {ask.code}.
            </p>
            <p className="text-mist">Arrivo {fmtDate(ask.checkIn, 'it', { weekday: 'long', day: 'numeric', month: 'long' })}. Se la banca rifiuta, l’ospite riceve l’email per pagare con un’altra carta.</p>
          </div>
        )}
      </Dialog>
    </motion.section>
  );
}
