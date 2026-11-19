import { requirePageUser, can } from '@/server/auth/guard';
import { readDb } from '@/server/db/store';
import { roomOptions } from '@/server/admin-data';
import { nightlyPrice } from '@/lib/availability';
import { todayISO } from '@/lib/dates';
import { monthPrices } from '@/lib/period-prices';
import { PageHeader } from '@/components/admin/ui';
import { PricesManager, PricingRulesForm } from '@/components/admin/managers';

export const metadata = { title: 'Prezzi' };

export default async function PricesPage() {
  const user = await requirePageUser('bookings.manage');
  const db = readDb();
  const today = todayISO();
  const tonight = Object.fromEntries(db.rooms.map((r) => [r.id, nightlyPrice(r, today, db.ratePeriods)]));
  return (
    <div>
      <PageHeader eyebrow="Tariffe" title="Prezzi" description="Il prezzo base vale tutto l’anno; le variazioni per periodo (stagioni, eventi) si sommano sopra. Ogni modifica è subito visibile nella ricerca del sito, nelle card e nel riepilogo di prenotazione." />
      <div className="mb-6">
        <PricingRulesForm initial={{ singleUsePercent: db.settings.pricing?.singleUsePercent ?? 20, board: db.settings.pricing?.board ?? 'room_only', touristTax: db.settings.pricing?.touristTax }} cashPercent={db.settings.payments.allowCashAtHotel ? db.settings.payments.cashDiscountPercent : 0} canEdit={can(user.role, 'prices.edit')} />
      </div>
      <PricesManager rooms={roomOptions(db)} tonight={tonight} months={Object.fromEntries(db.rooms.map((r) => [r.id, monthPrices(r, db.ratePeriods, today)]))} periods={db.ratePeriods.filter((p) => p.to >= today).map((p) => ({ id: p.id, label: p.label, from: p.from, to: p.to, roomIds: p.roomIds, mode: p.mode, value: p.value, cash: p.cash ?? null }))} canEdit={can(user.role, 'prices.edit')} cash={{ enabled: db.settings.payments.allowCashAtHotel, percent: db.settings.payments.cashDiscountPercent }} />
    </div>
  );
}
