import 'server-only';
import type { DB } from '@/lib/types';
import { addDays, fmtDate, fmtDateLong } from '@/lib/dates';
import { money, notti, ospiti } from '@/lib/utils';
import { cashPercentFor } from '@/lib/cash';
import { onlineMarkup, withMarkup } from '@/lib/online-price';
import { TAX_DEFAULT, inTaxSeason } from '@/lib/tourist-tax';
import { arrivalsOn, departuresOn, freeRoomsOn } from '../stats';
import { mutate } from '../db/store';
import { audit } from '../events';

/**
 * The owner assistant's newer topics (Telegram and panel): the day at a glance, prices and seasons
 * with card and cash, the online increase, the tourist tax, card payments and instant payouts.
 * Read-only answers come straight away; the switches go through the usual confirm buttons.
 */

const eur = (n: number) => money(n, 'it', 2);
const mdLabel = (md: string) => {
  const [m, d] = md.split('-').map(Number);
  return new Date(Date.UTC(2027, m! - 1, d!)).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', timeZone: 'UTC' });
};

/** "Oggi": arrivals, departures, free rooms tonight, money still to collect. */
export function todaySummary(db: DB, date: string): string {
  const who = (b: DB['bookings'][number]) => `${b.guest.firstName} ${b.guest.lastName}`.trim();
  const roomOf = (b: DB['bookings'][number]) => (b.roomId ? `cam. ${db.rooms.find((r) => r.id === b.roomId)?.number ?? '?'}` : 'camera da assegnare');
  const arr = arrivalsOn(db, date);
  const dep = departuresOn(db, date);
  const free = freeRoomsOn(db, date);
  const due = arr.reduce((s, b) => s + Math.max(0, b.total - b.amountPaid), 0);
  const lines = [`📅 ${fmtDateLong(date)}`, ''];
  lines.push(`🛎 Arrivi: ${arr.length}`);
  for (const b of arr.slice(0, 8)) lines.push(`• ${who(b)} · ${roomOf(b)} · ${ospiti(b.adults + b.children)} · ${notti(Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 86_400_000))}${b.total - b.amountPaid > 0.009 ? ` · da saldare ${eur(b.total - b.amountPaid)}` : ''}`);
  lines.push('', `👋 Partenze: ${dep.length}`);
  for (const b of dep.slice(0, 8)) lines.push(`• ${who(b)} · ${roomOf(b)}`);
  lines.push('', `🛏 Camere libere stanotte: ${free.length}${free.length ? ` (${free.slice(0, 10).map((r) => r.number).join(', ')})` : ''}`);
  if (due > 0.009) lines.push(`💶 Da incassare all’arrivo: ${eur(due)}`);
  return lines.join('\n');
}

/** Prices at a glance: base card/cash price per room, the seasons from today on, increase and tax. */
export function pricesOverview(db: DB, today: string): string {
  const pay = db.settings.payments;
  const m = onlineMarkup(db.settings);
  const rooms = [...db.rooms].sort((a, b) => a.number.localeCompare(b.number, 'it', { numeric: true }));
  const lines = ['🏷 Prezzi base a notte (con carta · in contanti)'];
  for (const r of rooms.slice(0, 20)) {
    const cashPct = pay.allowCashAtHotel ? cashPercentFor(r, pay) : 0;
    const cash = typeof r.cashPrice === 'number' && r.cashPrice > 0 ? r.cashPrice : Math.round(r.basePrice * (1 - cashPct / 100) * 100) / 100;
    lines.push(`• ${r.number} ${r.name}: ${eur(r.basePrice)}${pay.allowCashAtHotel ? ` · ${eur(cash)}` : ''}`);
  }
  const seasons = db.ratePeriods.filter((p) => p.to > today).sort((a, b) => a.from.localeCompare(b.from));
  lines.push('', seasons.length ? `📆 Stagioni ed eventi: ${seasons.length}` : '📆 Nessuna stagione: vale il prezzo base tutto l’anno.');
  for (const p of seasons.slice(0, 12)) {
    const where = p.roomIds === 'all' ? 'tutte' : `cam. ${p.roomIds.map((id) => db.rooms.find((r) => r.id === id)?.number ?? '?').join(', ')}`;
    const what = p.mode === 'fixed' ? `${eur(p.value)}${p.cash ? ` · contanti ${eur(p.cash)}` : ''}` : `${p.value > 0 ? '+' : ''}${p.value}%`;
    lines.push(`• ${p.label} (${fmtDate(p.from)} → ${fmtDate(addDays(p.to, -1))}, ${where}): ${what}`);
  }
  lines.push('', m ? `📈 Aumento prezzi online acceso: +${m}% sul sito (es. ${eur(100)} → ${eur(withMarkup(100, m))} con carta; contanti invariati).` : '📈 Aumento prezzi online spento: sul sito si vedono i tuoi prezzi.');
  const tax = db.settings.pricing?.touristTax;
  lines.push(tax?.enabled ? `🏛 Tassa di soggiorno: ${eur(tax.amount)} a persona (adulti) a notte, dal ${mdLabel(tax.from)} al ${mdLabel(tax.to)}${tax.maxNights ? `, max ${tax.maxNights} notti` : ''}, si paga in hotel.` : '🏛 Tassa di soggiorno spenta.');
  lines.push('', 'Per cambiare: “prezzo di agosto 150 euro, 140 in contanti”, oppure Prezzi nel pannello.');
  return lines.join('\n');
}

/** Card payments and payouts: is the hotel's account connected, automatic instant payout, balance. */
export async function paymentsStatus(db: DB): Promise<string> {
  const { cardPaymentsReady, stripeMode } = await import('../payments/stripe');
  const c = db.settings.stripeConnect;
  const mode = stripeMode();
  const lines = ['💳 Pagamenti'];
  if (mode === 'off') lines.push('• Pagamenti con carta non attivi: gli ospiti pagano in hotel.');
  else if (!c.accountId) lines.push('• Il conto Stripe dell’hotel non è ancora collegato: nel pannello “Pagamenti” → “Collega il mio conto”. Fino ad allora gli ospiti pagano in hotel.');
  else {
    lines.push(cardPaymentsReady(db) ? `• Carta sul sito: attiva${mode === 'test' ? ' (modalità prova)' : ''}.` : '• Carta sul sito: in attesa che Stripe completi la verifica del conto.');
    lines.push(c.payoutsEnabled ? `• Bonifici: attivi${c.bankLast4 ? ` sul conto •••• ${c.bankLast4}` : ''}.` : '• Bonifici: Stripe chiede ancora qualche dato (pannello → Pagamenti).');
    lines.push(c.autoInstant ? '• Bonifico immediato automatico: ACCESO (ogni pagamento con carta arriva subito).' : '• Bonifico immediato automatico: spento (scrivi “accendi il bonifico immediato automatico”).');
    try {
      const { instantView } = await import('../payments/instant');
      const v = await instantView(db);
      if (v?.state === 'ready') lines.push(`• Puoi ricevere subito: ${eur(v.max)}${v.to ? ` su ${v.to}` : ''}${v.fee ? ` (costo ${eur(v.fee)})` : ''} → pannello, “Ricevi subito”.`);
      else if (v?.state === 'empty') lines.push('• Niente da ricevere subito in questo momento.');
      else if (v?.state === 'no_card') lines.push('• Per il bonifico immediato serve una carta di debito nel conto Stripe dell’hotel.');
    } catch {
      /* the balance is a bonus: the rest of the answer stays */
    }
  }
  const pay = db.settings.payments;
  lines.push(`• Contanti in hotel: ${pay.allowCashAtHotel ? `sì (−${pay.cashDiscountPercent}% o il prezzo in contanti della stagione)` : 'no'}.`);
  return lines.join('\n');
}

export type MarkupArgs = { enabled: boolean; percent?: number };
export function markupSummary(a: MarkupArgs, db: DB): string {
  const pct = a.percent ?? db.settings.pricing?.onlineMarkup?.percent ?? 1;
  return a.enabled ? `Accendere l’aumento prezzi online del ${pct}%? Sul sito ${eur(100)} diventa ${eur(withMarkup(100, pct))} con carta; i prezzi in contanti restano uguali.` : 'Spegnere l’aumento prezzi online? Sul sito torneranno i tuoi prezzi di sempre.';
}
export function setMarkup(a: MarkupArgs, actor: string): string {
  return mutate((db) => {
    const pct = Math.min(20, Math.max(0.5, a.percent ?? db.settings.pricing?.onlineMarkup?.percent ?? 1));
    db.settings.pricing = { ...(db.settings.pricing ?? { singleUsePercent: 20, board: 'room_only' }), onlineMarkup: { enabled: a.enabled, percent: pct } };
    audit(db, actor, 'settings', 'pricing', null, a.enabled ? `Prezzi online +${pct}%` : 'Prezzi online senza aumento');
    return a.enabled ? `Fatto: sul sito i prezzi con carta sono +${pct}%. I contanti non cambiano.` : 'Fatto: aumento prezzi online spento.';
  });
}

export type TaxArgs = { enabled: boolean; amount?: number };
export function taxSummary(a: TaxArgs, db: DB): string {
  const t = { ...TAX_DEFAULT, ...(db.settings.pricing?.touristTax ?? {}) };
  const amount = a.amount ?? t.amount;
  return a.enabled ? `Accendere la tassa di soggiorno: ${eur(amount)} a persona (adulti) a notte, dal ${mdLabel(t.from)} al ${mdLabel(t.to)}? Il sito la mostra agli ospiti e si paga in hotel.` : 'Spegnere la tassa di soggiorno? Il sito non la mostrerà più.';
}
export function setTax(a: TaxArgs, actor: string): string {
  return mutate((db) => {
    const t = { ...TAX_DEFAULT, ...(db.settings.pricing?.touristTax ?? {}), enabled: a.enabled, ...(a.amount !== undefined ? { amount: Math.round(a.amount * 100) / 100 } : {}) };
    db.settings.pricing = { ...(db.settings.pricing ?? { singleUsePercent: 20, board: 'room_only' }), touristTax: t };
    audit(db, actor, 'settings', 'pricing', null, a.enabled ? `Tassa di soggiorno € ${t.amount} dal ${t.from} al ${t.to}` : 'Tassa di soggiorno spenta');
    return a.enabled ? `Fatto: tassa di soggiorno ${eur(t.amount)} a persona a notte (${inTaxSeason(new Date().toISOString().slice(0, 10), t.from, t.to) ? 'vale già da oggi' : `vale dal ${mdLabel(t.from)}`}).` : 'Fatto: tassa di soggiorno spenta.';
  });
}

export function autoInstantSummary(a: { enabled: boolean }): string {
  return a.enabled ? 'Accendere il bonifico immediato automatico? Ogni pagamento con carta arriverà subito sulla carta dell’hotel (Stripe trattiene il suo costo per il servizio immediato).' : 'Spegnere il bonifico immediato automatico? I soldi arriveranno con il bonifico normale.';
}
export function setAutoInstant(a: { enabled: boolean }, actor: string): string {
  return mutate((db) => {
    if (!db.settings.stripeConnect.accountId && !db.settings.stripeConnect.direct) return 'Prima collega il conto Stripe dell’hotel (pannello → Pagamenti).';
    db.settings.stripeConnect.autoInstant = a.enabled;
    audit(db, actor, 'instant_payout_auto', 'settings', null, a.enabled ? 'Bonifico immediato automatico acceso' : 'Bonifico immediato automatico spento');
    return a.enabled ? 'Fatto: ogni pagamento con carta arriverà subito sulla carta.' : 'Fatto: bonifico immediato automatico spento.';
  });
}

/** Rule intents for these topics (Italian, Polish and English words). `t` is the normalized text. */
export function hotelIntent(t: string, text: string): { tool: string; args: Record<string, unknown> } | null {
  const on = /\b(accendi|attiva|abilita|metti|imposta|w[lł]acz|turn on|enable)\b/.test(t);
  const off = /\b(spegni|disattiva|disabilita|togli|wy[lł]acz|turn off|disable)\b/.test(t);
  const pct = text.match(/(\d+(?:[.,]\d+)?)\s*(?:%|per ?cento|procent)/i);
  const amount = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro|eur\b)/i);
  if (/^(oggi|riepilogo( di)? oggi|com.? e oggi|situazione( di)? oggi|dzis|dzisiaj|today)\b/.test(t)) return { tool: 'today', args: {} };
  if (/(aument|ricaric|markup|narzut|podwyz).{0,30}(prezz|onlin|cen|sito)|prezzi online/.test(t)) {
    if (off) return { tool: 'set_online_markup', args: { enabled: false } };
    if (on || pct) return { tool: 'set_online_markup', args: { enabled: true, ...(pct ? { percent: Number(pct[1]!.replace(',', '.')) } : {}) } };
    return { tool: 'prices_overview', args: {} };
  }
  if (/(tassa|imposta) di soggiorno|op[lł]at\S* (miejscow|klimatyczn|turystyczn)|podatek turystyczn|tourist tax|city tax/.test(t)) {
    if (off) return { tool: 'set_tourist_tax', args: { enabled: false } };
    if (on || amount) return { tool: 'set_tourist_tax', args: { enabled: true, ...(amount ? { amount: Number(amount[1]!.replace(',', '.')) } : {}) } };
    return { tool: 'prices_overview', args: {} };
  }
  if (/(bonifico|pagament|wyp[lł]at|payout).{0,25}(immediat|subito|istantane|natychmiast|instant|automatic|automatyczn)|(immediat|subito|instant|natychmiast).{0,25}(bonific|wyp[lł]at|payout)/.test(t) && (on || off)) {
    return { tool: 'set_auto_instant', args: { enabled: !off } };
  }
  if (/^(pagamenti|stato (dei )?pagamenti|stripe|p[lł]atnosci|wyp[lł]aty|payments)\b|ricevere subito|quanto posso ricevere|bonifico immediato|stato.{0,10}stripe/.test(t)) return { tool: 'payments_status', args: {} };
  if (/^(prezzi|listino|cennik|ceny|prices)\b|(che|quali) prezzi|prezzi (attuali|di oggi|delle camere)|stagion[ei] (di )?prezz|prezzi (per|delle) stagion/.test(t)) return { tool: 'prices_overview', args: {} };
  return null;
}

export const hotelToolsHelp = [
  '📅 “Oggi”: arrivi, partenze, camere libere',
  '🏷 “Prezzi”: con carta e in contanti, stagioni, tassa',
  '💳 “Pagamenti”: Stripe, bonifici, quanto puoi ricevere subito',
  '📈 “Accendi l’aumento prezzi online del 2%”',
  '🏛 “Accendi la tassa di soggiorno a 2 euro”',
  '⚡ “Accendi il bonifico immediato automatico”',
];

