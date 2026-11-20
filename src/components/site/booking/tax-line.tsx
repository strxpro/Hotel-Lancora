'use client';
import { Landmark } from 'lucide-react';
import { TAX_T, taxDetail, taxNote, type TaxQuote } from '@/lib/tourist-tax';
import { money } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useI18n } from '../providers';

/** "Tassa di soggiorno 12 € · non inclusa, si paga in hotel (2 adulti × 3 notti × 2 €)". */
export function TaxLine({ tax, className }: { tax: TaxQuote; className?: string }) {
  const { locale } = useI18n();
  const x = TAX_T[locale];
  return (
    <p className={cn('flex items-start gap-2 text-[0.78rem] leading-snug text-mist', className)} data-testid="tourist-tax-line">
      <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-2" />
      <span>
        <span className="font-semibold text-navy">
          + {x.label} {money(tax.total, locale, 2)}
        </span>{' '}
        · {taxNote(locale, tax.cash)} <span className="whitespace-nowrap">({taxDetail(locale, tax, (n) => money(n, locale, 2))})</span>
      </span>
    </p>
  );
}
