'use client';
import { motion } from 'motion/react';
import { Banknote, Check, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from './providers';
import { LiveMoney } from './live-money';

const SIZES = {
  sm: { card: 'text-[1.4rem]', cash: 'text-[1.6rem]' },
  md: { card: 'text-[1.75rem]', cash: 'text-[2rem]' },
  lg: { card: 'text-[2.1rem]', cash: 'text-[2.4rem]' },
} as const;

export type PayWay = 'card' | 'cash';

/**
 * The price with card and the price in cash at the hotel, side by side in the same style:
 * the cash amount is a touch bigger (it is the better price). Without cash, only the card price.
 * With `onPick` the two prices are buttons: a tap chooses how to pay (the chosen one fills in).
 * `compact`: narrow places (room cards): the words without the little icons and round marks, so they fit whole.
 */
export function PricePair({ card, cash, size = 'md', decimals = 0, className, dark = false, selected = null, onPick, compact = false }: { card: number | null; cash: number | null; size?: keyof typeof SIZES; decimals?: 0 | 2; className?: string; dark?: boolean; selected?: PayWay | null; onPick?: (way: PayWay) => void; compact?: boolean }) {
  const { t } = useI18n();
  const s = SIZES[size];
  const label = 'flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.16em]';
  // a room paid only in cash at the hotel
  if (card === null) {
    return (
      <div className={className}>
        <p className={cn(label, dark ? 'text-[#b9d1ab]' : 'text-sage')}>
          <Banknote className="h-3.5 w-3.5" /> {t.booking.pay.priceCash}
        </p>
        <p className={cn('serif mt-1 leading-none', s.cash, dark ? 'text-[#d9e8cf]' : 'text-[#3f5a35]')}>
          <LiveMoney value={cash ?? 0} decimals={decimals} badge={false} />
        </p>
      </div>
    );
  }
  if (cash === null || cash >= card) {
    return (
      <div className={className}>
        <p className={cn(label, dark ? 'text-ivory/60' : 'text-mist')}>
          <CreditCard className="h-3.5 w-3.5" /> {t.booking.pay.priceCard}
        </p>
        <p className={cn('serif mt-1 leading-none', s.cash, dark ? 'text-gold' : 'text-navy')}>
          <LiveMoney value={card} decimals={decimals} badge={false} />
        </p>
      </div>
    );
  }
  if (onPick) {
    return (
      // very narrow (a room card on a phone): one price under the other, label left and amount right
      <div className={cn('@container', className)}>
        <div role="radiogroup" aria-label={t.booking.pay.method} className="grid grid-cols-2 items-stretch gap-2 @max-[13rem]:grid-cols-1 @max-[13rem]:gap-1.5">
          <WayButton way="card" on={selected === 'card'} onPick={onPick} title={t.booking.pay.priceCard} amount={card} decimals={decimals} size={s.card} compact={compact} />
          <WayButton way="cash" on={selected === 'cash'} onPick={onPick} title={t.booking.pay.priceCash} amount={cash} decimals={decimals} size={s.cash} compact={compact} />
        </div>
      </div>
    );
  }
  return (
    <div className={cn('grid grid-cols-2 items-end gap-2', className)}>
      <div className="min-w-0">
        <p className={cn(label, dark ? 'text-ivory/60' : 'text-mist')}>
          <CreditCard className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{t.booking.pay.priceCard}</span>
        </p>
        <p className={cn('serif mt-1 truncate leading-none', s.card, dark ? 'text-ivory' : 'text-navy')}>
          <LiveMoney value={card} decimals={decimals} badge={false} />
        </p>
      </div>
      <div className={cn('min-w-0 rounded-2xl px-3 py-2', dark ? 'bg-white/10' : 'bg-sage/10')}>
        <p className={cn(label, dark ? 'text-[#b9d1ab]' : 'text-sage')}>
          <Banknote className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{t.booking.pay.priceCash}</span>
        </p>
        <p className={cn('serif mt-1 truncate leading-none', s.cash, dark ? 'text-[#d9e8cf]' : 'text-[#3f5a35]')}>
          <LiveMoney value={cash} decimals={decimals} badge={false} />
        </p>
      </div>
    </div>
  );
}

/** One of the two prices as a button: navy when the card is chosen, green when cash is. */
function WayButton({ way, on, onPick, title, amount, decimals, size, compact }: { way: PayWay; on: boolean; onPick: (way: PayWay) => void; title: string; amount: number; decimals: 0 | 2; size: string; compact: boolean }) {
  const card = way === 'card';
  const Icon = card ? CreditCard : Banknote;
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={on}
      data-way={way}
      onClick={(e) => {
        e.stopPropagation();
        onPick(way);
      }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      className={cn(
        'group/way relative min-w-0 cursor-pointer rounded-2xl border px-2.5 py-2 text-left transition-[background-color,border-color,color,box-shadow] duration-300 sm:px-3 @max-[13rem]:flex @max-[13rem]:items-center @max-[13rem]:justify-between @max-[13rem]:gap-2 @max-[13rem]:rounded-xl @max-[13rem]:py-1.5',
        card
          ? on
            ? 'border-navy bg-navy text-ivory shadow-[0_16px_30px_-18px_rgba(16,40,61,0.85)]'
            : 'border-line bg-white text-navy hover:border-navy/60 hover:shadow-[0_14px_28px_-20px_rgba(16,40,61,0.6)]'
          : on
            ? 'border-sage bg-sage text-ivory shadow-[0_16px_30px_-18px_rgba(63,90,53,0.85)]'
            : 'border-sage/30 bg-sage/10 text-[#3f5a35] hover:border-sage hover:shadow-[0_14px_28px_-20px_rgba(63,90,53,0.6)]',
      )}
    >
      {/* phones: the words only (no icon, no round mark), so "In contanti" fits whole */}
      <span className={cn('flex items-center gap-1.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em]', !compact && 'sm:pr-5 sm:text-[0.62rem] sm:tracking-[0.16em]', on ? 'text-ivory/85' : card ? 'text-mist' : 'text-sage')}>
        <Icon className={cn('hidden h-3.5 w-3.5 shrink-0', !compact && 'sm:block')} /> <span className="truncate">{title}</span>
      </span>
      <span className={cn('serif mt-1 block truncate leading-none @max-[13rem]:mt-0 @max-[13rem]:shrink-0 @max-[13rem]:text-[1.3rem]', size)}>
        <LiveMoney value={amount} decimals={decimals} badge={false} />
      </span>
      {/* the round "chosen" mark, like a radio button */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute right-2 top-2 hidden h-4 w-4 items-center justify-center rounded-full border transition-colors duration-300', !compact && 'sm:flex',
          on ? cn('border-ivory bg-ivory', card ? 'text-navy' : 'text-sage') : card ? 'border-navy/25 group-hover/way:border-navy/60' : 'border-sage/50 group-hover/way:border-sage',
        )}
      >
        {on && (
          <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }} className="flex">
            <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
          </motion.span>
        )}
      </span>
    </motion.button>
  );
}
