'use client';
import { Banknote, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from './providers';
import { LiveMoney } from './live-money';

const SIZES = {
  sm: { card: 'text-[1.4rem]', cash: 'text-[1.6rem]' },
  md: { card: 'text-[1.75rem]', cash: 'text-[2rem]' },
  lg: { card: 'text-[2.1rem]', cash: 'text-[2.4rem]' },
} as const;

/**
 * The price with card and the price in cash at the hotel, side by side in the same style:
 * the cash amount is a touch bigger (it is the better price). Without cash, only the card price.
 */
export function PricePair({ card, cash, size = 'md', decimals = 0, className, dark = false }: { card: number | null; cash: number | null; size?: keyof typeof SIZES; decimals?: 0 | 2; className?: string; dark?: boolean }) {
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
