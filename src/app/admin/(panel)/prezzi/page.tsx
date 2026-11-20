import Link from 'next/link';
import { BedDouble, Landmark, PackagePlus, Percent } from 'lucide-react';
import { requirePageUser, can } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { roomOptions } from '@/server/admin-data';
import { nightlyPrice } from '@/lib/availability';
import { todayISO } from '@/lib/dates';
import { monthPrices } from '@/lib/period-prices';
import { extrasList } from '@/lib/extras';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/admin/ui';
import { PricesManager, PricingRulesForm } from '@/components/admin/managers';
import { ExtrasEditor } from '@/components/admin/extras-editor';

export const metadata = { title: 'Prezzi' };

const TABS = [
  { id: 'camere', label: 'Prezzi delle camere', icon: BedDouble },
  { id: 'sconti', label: 'Sconti e trattamento', icon: Percent },
  { id: 'tassa', label: 'Tassa di soggiorno', icon: Landmark },
  { id: 'supplementi', label: 'Supplementi', icon: PackagePlus },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePageUser('bookings.manage');
  const db = readDb();
  const today = todayISO();
  const sp = await searchParams;
  const tab: Tab = TABS.find((x) => x.id === sp.tab)?.id ?? 'camere';
  const canEdit = can(user.role, 'prices.edit');
  const rules = { singleUsePercent: db.settings.pricing?.singleUsePercent ?? 20, board: db.settings.pricing?.board ?? 'room_only', touristTax: db.settings.pricing?.touristTax, onlineMarkup: db.settings.pricing?.onlineMarkup ?? { enabled: false, percent: 1 } } as const;
  const cashPercent = db.settings.payments.allowCashAtHotel ? db.settings.payments.cashDiscountPercent : 0;
  const tax = db.settings.pricing?.touristTax;
  const extrasOn = extrasList(db.settings.pricing?.extras).filter((e) => e.enabled).length;
  const hint: Record<Tab, string | null> = {
    camere: null,
    sconti: rules.singleUsePercent > 0 ? `uso singola −${rules.singleUsePercent}%` : null,
    tassa: tax?.enabled ? `${String(tax.amount).replace('.', ',')} €` : 'spenta',
    supplementi: extrasOn ? String(extrasOn) : null,
  };
  return (
    <div>
      <PageHeader eyebrow="Tariffe" title="Prezzi" description="Il prezzo base vale tutto l’anno; le variazioni per periodo (stagioni, eventi) si sommano sopra. Ogni modifica è subito visibile nella ricerca del sito, nelle card e nel riepilogo di prenotazione." />
      {/* one subject per tab: rooms, discounts, the town's tax, the extras */}
      <nav aria-label="Sezioni dei prezzi" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {TABS.map((x) => (
          <Link key={x.id} href={x.id === 'camere' ? '/admin/prezzi' : `/admin/prezzi?tab=${x.id}`} scroll={false} aria-current={tab === x.id ? 'page' : undefined} className={cn('flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors', tab === x.id ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50')}>
            <x.icon className={cn('h-4 w-4', tab === x.id ? 'text-gold' : 'text-gold-2')} />
            {x.label}
            {hint[x.id] && <span className={cn('rounded-full px-2 py-0.5 text-[0.68rem]', tab === x.id ? 'bg-white/15 text-ivory' : 'bg-sand-2 text-navy')}>{hint[x.id]}</span>}
          </Link>
        ))}
      </nav>
      {tab === 'camere' && (
        <PricesManager
          rooms={roomOptions(db)}
          tonight={Object.fromEntries(db.rooms.map((r) => [r.id, nightlyPrice(r, today, db.ratePeriods)]))}
          months={Object.fromEntries(db.rooms.map((r) => [r.id, monthPrices(r, db.ratePeriods, today)]))}
          periods={db.ratePeriods.filter((p) => p.to >= today).map((p) => ({ id: p.id, label: p.label, from: p.from, to: p.to, roomIds: p.roomIds, mode: p.mode, value: p.value, cash: p.cash ?? null }))}
          canEdit={canEdit}
          cash={{ enabled: db.settings.payments.allowCashAtHotel, percent: db.settings.payments.cashDiscountPercent }}
        />
      )}
      {tab === 'sconti' && <PricingRulesForm part="rules" initial={rules} cashPercent={cashPercent} canEdit={canEdit} />}
      {tab === 'tassa' && <PricingRulesForm part="tax" initial={rules} cashPercent={cashPercent} canEdit={canEdit} />}
      {tab === 'supplementi' && <ExtrasEditor initial={extrasList(db.settings.pricing?.extras)} canEdit={canEdit} />}
    </div>
  );
}
