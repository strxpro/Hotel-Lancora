'use client';
import { Landmark } from 'lucide-react';
import { TAX_RULE, TAX_T, taxNote, taxSeasonLabel, type TouristTax } from '@/lib/tourist-tax';
import { cn, money } from '@/lib/utils';
import { useI18n } from '../providers';

/**
 * The town's tax where the rooms are listed, before any date is chosen: how much per adult per
 * night, in which months, and that it is paid at the hotel (it is never in the room price).
 */
export function TaxNote({ tax, className }: { tax: TouristTax; className?: string }) {
  const { locale } = useI18n();
  if (!tax.enabled || !(tax.amount > 0)) return null;
  const r = TAX_RULE[locale];
  const season = taxSeasonLabel(tax, locale) || r.always;
  const parts = [`${money(tax.amount, locale, 2)} ${r.per}`, season, ...(tax.maxNights > 0 ? [r.max.replace('{n}', String(tax.maxNights))] : []), r.kids];
  return (
    <p className={cn('flex items-start gap-2.5 rounded-2xl bg-sand-2/70 px-4 py-3 text-[0.8rem] leading-snug text-charcoal/80', className)} data-testid="tourist-tax-note">
      <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-gold-2" />
      <span>
        <span className="font-semibold text-navy">{TAX_T[locale].label}</span> · {parts.join(' · ')} · {taxNote(locale, tax.cash)}
      </span>
    </p>
  );
}
