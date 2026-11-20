'use client';
import { useState } from 'react';
import { Banknote, BedDouble, Coffee, CreditCard, Landmark, Mail, MailOpen, Pencil, Percent, Send, Trash2, TrendingUp, UserRound, Wallet } from 'lucide-react';
import type { RoomOption } from '@/server/admin-data';
import type { MonthPrice } from '@/lib/period-prices';
import { addDays, fmtDate, fmtDateTime, todayISO } from '@/lib/dates';
import { cancelDeadline, cancelFeeAmount, cancelText } from '@/lib/cancellation';
import { cn, money } from '@/lib/utils';
import { TAX_DEFAULT, taxNote, touristTaxFor, type TouristTax } from '@/lib/tourist-tax';
import { Badge, Button, Card, Dialog, Empty, Field, NumInput, Segmented, StickyBar, Toggle, useAction } from './ui';
import { NiceSelect } from './nice-select';
import { removeRatePeriodAction, saveRatePeriodAction } from '@/app/admin/actions/rooms';
import { PricesBoard } from './prices-board';
import { savePaymentsAction, savePricingAction } from '@/app/admin/actions/settings';
import { markMessageRead, resendEmail } from '@/app/admin/actions/misc';
import { GuestLink } from './guest-card';

/* ---------------- prices ---------------- */
type PeriodRow = { id: string; label: string; from: string; to: string; roomIds: string[] | 'all'; mode: 'fixed' | 'percent'; value: number; cash?: number | null };
type PeriodDraft = { id: string | null; label: string; from: string; to: string; scope: 'all' | 'some'; roomIds: string[]; mode: 'fixed' | 'percent'; value: string; cash: string };

const num = (s: string) => Number(s.replace(',', '.').trim());
const newDraft = (today: string): PeriodDraft => ({ id: null, label: 'Alta stagione', from: addDays(today, 14), to: addDays(today, 28), scope: 'all', roomIds: [], mode: 'fixed', value: '', cash: '' });
const draftOf = (x: PeriodRow): PeriodDraft => ({ id: x.id, label: x.label, from: x.from, to: x.to, scope: x.roomIds === 'all' ? 'all' : 'some', roomIds: x.roomIds === 'all' ? [] : x.roomIds, mode: x.mode, value: String(x.value).replace('.', ','), cash: x.cash ? String(x.cash).replace('.', ',') : '' });

export function PricesManager({ rooms, tonight, periods, canEdit, cash = { enabled: true, percent: 5 }, months }: { months?: Record<string, MonthPrice[]>; cash?: { enabled: boolean; percent: number }; rooms: RoomOption[]; tonight: Record<string, number>; periods: PeriodRow[]; canEdit: boolean }) {
  const { run, pending } = useAction();
  const today = todayISO();
  const [p, setP] = useState<PeriodDraft>(() => newDraft(today));
  const editing = p.id !== null;
  const card = num(p.value);
  const cashValue = p.cash.trim() ? num(p.cash) : null;
  const problem =
    p.to <= p.from
      ? '“Al” deve venire dopo “dal”.'
      : p.mode === 'fixed' && !(card >= 1)
        ? 'Scrivi il prezzo con carta.'
        : p.mode === 'percent' && !card
          ? 'Scrivi la variazione in %.'
          : cashValue !== null && !(cashValue >= 1 && cashValue <= card)
            ? 'Il prezzo in contanti deve essere più basso (o uguale) di quello con carta.'
            : p.scope === 'some' && !p.roomIds.length
              ? 'Scegli almeno una camera.'
              : null;
  const nights = Math.max(0, Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000));
  const save = () =>
    run(() => saveRatePeriodAction({ id: p.id, label: p.label, from: p.from, to: p.to, roomIds: p.scope === 'all' ? 'all' : p.roomIds, mode: p.mode, value: card, cash: p.mode === 'fixed' ? cashValue : null }), { onOk: () => setP(newDraft(today)) });
  return (
    <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-5">
      <div className="xl:col-span-3">
        <PricesBoard rooms={rooms} tonight={tonight} canEdit={canEdit} cash={cash} months={months} />
      </div>
      <div data-tour="prices-periods" className="space-y-6 xl:col-span-2">
        <Card title={periods.length ? `Prezzi per stagione · ${periods.length}` : 'Prezzi per stagione'}>
          {canEdit && periods.length > 0 && <p className="mb-3 text-xs text-mist">Tocca una stagione per cambiarla.</p>}
          {/* a box of its own that scrolls: the editor stays in view below it */}
          <ul data-testid="periods-list" className="-mr-2 max-h-[23rem] space-y-2 overflow-y-auto overscroll-contain pr-2 [scrollbar-width:thin]">
            {periods.length === 0 && <li className="text-sm text-mist">Nessuna stagione: vale il prezzo base tutto l’anno.</li>}
            {[...periods].sort((a, b) => a.from.localeCompare(b.from) || a.label.localeCompare(b.label)).map((x) => (
              <li key={x.id} className={cn('flex items-stretch gap-2 border text-sm transition-colors duration-300', p.id === x.id ? 'border-gold bg-white shadow-sm' : 'border-line bg-ivory')}>
                <button type="button" disabled={!canEdit} onClick={() => setP(draftOf(x))} className="min-w-0 flex-1 px-3 py-2.5 text-left enabled:hover:bg-white/70" aria-label={`Modifica ${x.label}`}>
                  <span className="flex items-center gap-2 font-medium text-navy">
                    {x.label}
                    {canEdit && <Pencil className="h-3.5 w-3.5 text-gold-2" />}
                  </span>
                  <span className="block text-xs text-mist">
                    {fmtDate(x.from)} → {fmtDate(addDays(x.to, -1))} · {x.roomIds === 'all' ? 'tutte le camere' : `camere ${x.roomIds.map((id) => rooms.find((r) => r.id === id)?.number).join(', ')}`}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5 text-xs">
                    {x.mode === 'fixed' ? (
                      <>
                        <span className="inline-flex items-center gap-1 rounded-full bg-navy px-2 py-0.5 font-semibold text-ivory">
                          <CreditCard className="h-3 w-3" /> {money(x.value, 'it', 2)}
                        </span>
                        {cash.enabled && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-navy">
                            <Banknote className="h-3 w-3" /> {money(x.cash ?? Math.round(x.value * (1 - cash.percent / 100) * 100) / 100, 'it', 2)}
                            {!x.cash && <span className="text-mist">(−{cash.percent}%)</span>}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="rounded-full bg-navy px-2 py-0.5 font-semibold text-ivory">{`${x.value > 0 ? '+' : ''}${x.value}%`} sul prezzo base</span>
                    )}
                  </span>
                </button>
                {canEdit && (
                  <button type="button" aria-label="Rimuovi" className="px-3 text-terracotta hover:bg-terracotta/10" onClick={() => run(() => removeRatePeriodAction(x.id), { onOk: () => p.id === x.id && setP(newDraft(today)) })}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {canEdit && (
          <Card title={editing ? 'Modifica stagione' : 'Nuova stagione'}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome (es. Alta stagione, Ferragosto)" className="sm:col-span-2">
                <input className="field" value={p.label} maxLength={60} onChange={(e) => setP({ ...p, label: e.target.value })} />
              </Field>
              <Field label="Dal">
                <input type="date" className="field" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value, to: p.to <= e.target.value ? addDays(e.target.value, 7) : p.to })} />
              </Field>
              <Field label="Al (giorno di partenza)">
                <input type="date" className="field" value={p.to} min={addDays(p.from, 1)} onChange={(e) => setP({ ...p, to: e.target.value })} />
              </Field>
              {p.to > p.from && (
                <p className="-mt-1 text-xs text-mist sm:col-span-2">
                  Notti dal {fmtDate(p.from)} al {fmtDate(addDays(p.to, -1))} · {nights} {nights === 1 ? 'notte' : 'notti'}
                </p>
              )}
              <div className="sm:col-span-2">
                <Segmented id="pmode" value={p.mode} onChange={(mode) => setP({ ...p, mode })} options={[{ value: 'fixed', label: 'Prezzo a notte' }, { value: 'percent', label: 'Percentuale' }]} />
              </div>
              {p.mode === 'fixed' ? (
                <>
                  <Field label="Con carta (€ a notte)">
                    <input className="field" inputMode="decimal" placeholder="es. 120" value={p.value} onChange={(e) => setP({ ...p, value: e.target.value })} />
                  </Field>
                  {cash.enabled ? (
                    <Field label="In contanti (€ a notte)">
                      <input className="field" inputMode="decimal" placeholder={card >= 1 ? `vuoto = ${money(Math.round(card * (1 - cash.percent / 100) * 100) / 100, 'it', 2)} (−${cash.percent}%)` : 'facoltativo'} value={p.cash} onChange={(e) => setP({ ...p, cash: e.target.value })} />
                    </Field>
                  ) : (
                    <p className="self-end pb-2 text-xs text-mist">Contanti in hotel spenti (Pagamenti).</p>
                  )}
                </>
              ) : (
                <Field label="Variazione % (es. 15 o −10)" className="sm:col-span-2">
                  <input className="field" inputMode="decimal" value={p.value} onChange={(e) => setP({ ...p, value: e.target.value })} />
                </Field>
              )}
              <Field label="Camere" className="sm:col-span-2">
                <NiceSelect
                  className="w-full"
                  label="Camere"
                  value={p.scope}
                  onChange={(v) => setP({ ...p, scope: v })}
                  options={[
                    { value: 'all', label: 'Tutte le camere' },
                    { value: 'some', label: 'Solo alcune' },
                  ]}
                />
              </Field>
              {p.scope === 'some' && (
                <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                  {rooms.map((r) => (
                    <button key={r.id} type="button" onClick={() => setP({ ...p, roomIds: p.roomIds.includes(r.id) ? p.roomIds.filter((x) => x !== r.id) : [...p.roomIds, r.id] })} className={cn('border px-2.5 py-1.5 text-xs transition-colors', p.roomIds.includes(r.id) ? 'border-navy bg-navy text-ivory' : 'border-line hover:border-navy/40')}>
                      {r.number}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {problem && (p.value.trim() || editing) && <p className="mt-3 text-xs text-terracotta">{problem}</p>}
            <div className="mt-4 flex gap-2">
              <Button className="flex-1" disabled={pending || Boolean(problem)} onClick={save}>
                {editing ? 'Salva modifiche' : 'Salva stagione'}
              </Button>
              {editing && (
                <Button variant="ghost" disabled={pending} onClick={() => setP(newDraft(today))}>
                  Annulla
                </Button>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------------- payment settings ---------------- */
export function PaymentSettingsForm({ initial, stripe }: { initial: { mode: 'full' | 'deposit_percent' | 'deposit_fixed'; depositPercent: number; depositFixed: number; freeCancellationDays: number; cancellationPolicy: string; refundPolicy: string; holdMinutes: number; cashDiscountPercent: number; allowCashAtHotel: boolean; allowOnline?: boolean; cancellationFee?: { type: 'percent' | 'first_night' | 'fixed'; value: number } }; stripe: 'test' | 'live' | 'off' }) {
  const [f, setF] = useState({ ...initial, allowOnline: initial.allowOnline ?? true, cancellationFee: initial.cancellationFee ?? { type: 'percent' as const, value: 100 } });
  // a live example: an arrival two weeks from now, 3 nights at 100 €
  const exArrival = addDays(todayISO(), 14);
  const exRules = { freeCancellationDays: f.freeCancellationDays, cancellationFee: f.cancellationFee };
  const exDay = (iso: string) => fmtDate(iso, 'it', { weekday: 'long', day: 'numeric', month: 'long' });
  const how = f.allowOnline && f.allowCashAtHotel ? 'both' : f.allowOnline ? 'online' : 'hotel';
  const HOW = [
    { v: 'online', icon: CreditCard, t: 'Solo carta online', d: 'L’ospite paga sul sito quando prenota.' },
    { v: 'hotel', icon: Banknote, t: 'Solo in hotel', d: 'Nessun pagamento online: si paga all’arrivo.' },
    { v: 'both', icon: Wallet, t: 'Sceglie l’ospite', d: 'Carta online oppure in hotel all’arrivo.' },
  ] as const;
  const { run, pending } = useAction();
  return (
    <Card title="Condizioni di pagamento">
      <p className="mb-5 text-sm text-charcoal/80">
        Stripe:{' '}
        {stripe === 'test' ? <Badge tone="green">modalità test attiva</Badge> : stripe === 'live' ? <Badge tone="red">modalità live</Badge> : <Badge tone="gray">non configurato · pagamenti simulati</Badge>}
      </p>
      <p className="label">Come pagano gli ospiti?</p>
      <div role="radiogroup" className="mb-6 grid gap-2 sm:grid-cols-3">
        {HOW.map((o) => {
          const on = how === o.v;
          return (
            <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => setF({ ...f, allowOnline: o.v !== 'hotel', allowCashAtHotel: o.v !== 'online' })} className={cn('flex flex-col gap-1.5 rounded-2xl border p-3.5 text-left transition-colors', on ? 'border-navy bg-navy text-ivory' : 'border-line bg-ivory text-navy hover:border-navy/40')}>
              <o.icon className={cn('h-5 w-5', on ? 'text-gold' : 'text-gold-2')} />
              <span className="text-sm font-semibold">{o.t}</span>
              <span className={cn('text-[0.72rem] leading-snug', on ? 'text-ivory/75' : 'text-mist')}>{o.d}</span>
            </button>
          );
        })}
      </div>
      {f.allowOnline && <p className="label">Con la carta, quanto si paga subito?</p>}
      {f.allowOnline && (
      <Segmented
        id="pay-mode"
        value={f.mode}
        onChange={(mode) => setF({ ...f, mode })}
        options={[
          { value: 'full', label: 'Pagamento totale' },
          { value: 'deposit_percent', label: 'Acconto %' },
          { value: 'deposit_fixed', label: 'Acconto fisso' },
        ]}
      />
      )}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {f.allowOnline && f.mode === 'deposit_percent' && (
          <Field label="Percentuale acconto">
            <NumInput min={1} max={100} decimals={0} className="field" value={f.depositPercent} onChange={(v) => v !== null && setF({ ...f, depositPercent: v })} />
          </Field>
        )}
        {f.allowOnline && f.mode === 'deposit_fixed' && (
          <Field label="Importo acconto (€)">
            <NumInput min={1} className="field" value={f.depositFixed} onChange={(v) => v !== null && setF({ ...f, depositFixed: v })} />
          </Field>
        )}
        <div className="rounded-2xl border border-line bg-ivory p-4 sm:col-span-2">
          <p className="text-sm font-semibold text-navy">Cancellazione</p>
          <p className="mt-1 text-xs leading-relaxed text-mist">Gratis fino a un certo numero di giorni prima dell’arrivo; il termine scade a mezzanotte (00:00, ora italiana). Da quel momento chi cancella paga la penale che scegli qui.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Gratis fino a (giorni prima dell’arrivo)">
              <NumInput min={0} max={90} decimals={0} className="field" value={f.freeCancellationDays} onChange={(v) => v !== null && setF({ ...f, freeCancellationDays: v })} />
            </Field>
            <div>
              <p className="label">Penale dopo il termine</p>
              <Segmented
                id="cancel-fee"
                value={f.cancellationFee.type}
                onChange={(type) => setF({ ...f, cancellationFee: { type, value: type === 'percent' ? 100 : type === 'fixed' ? 50 : 0 } })}
                options={[
                  { value: 'percent', label: '% del soggiorno' },
                  { value: 'first_night', label: 'Prima notte' },
                  { value: 'fixed', label: 'Importo fisso' },
                ]}
              />
              {f.cancellationFee.type !== 'first_night' && (
                <div className="mt-3 flex items-center gap-2">
                  <NumInput min={0} max={f.cancellationFee.type === 'percent' ? 100 : 10000} decimals={f.cancellationFee.type === 'percent' ? 0 : 2} className="field w-28" value={f.cancellationFee.value} onChange={(v) => v !== null && setF({ ...f, cancellationFee: { ...f.cancellationFee, value: v } })} />
                  <span className="text-sm text-navy">{f.cancellationFee.type === 'percent' ? '% del totale' : '€'}</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-white px-4 py-3 text-[0.8rem] leading-relaxed text-charcoal/85 ring-1 ring-line">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-gold-2">Esempio · arrivo {exDay(exArrival)}, 3 notti, 300 €</p>
            <p className="mt-1.5">
              {f.freeCancellationDays > 0 ? (
                <>
                  Gratis fino a <strong className="text-navy">{exDay(addDays(cancelDeadline(exArrival, f.freeCancellationDays), -1))} alle 23:59</strong>. Da <strong className="text-navy">{exDay(cancelDeadline(exArrival, f.freeCancellationDays))} alle 00:00</strong> la cancellazione costa <strong className="text-navy">{money(cancelFeeAmount(exRules, 300, 3), 'it', 2)}</strong>.
                </>
              ) : (
                <>
                  Gratis fino al giorno prima dell’arrivo. Da <strong className="text-navy">{exDay(exArrival)} alle 00:00</strong> la cancellazione costa <strong className="text-navy">{money(cancelFeeAmount(exRules, 300, 3), 'it', 2)}</strong>.
                </>
              )}
            </p>
            <p className="mt-1.5 text-mist">Sul sito l’ospite legge: “{cancelText('it', exRules)}”</p>
          </div>
        </div>
        <Field label="Camera riservata durante il pagamento (minuti)">
          <NumInput min={5} max={60} decimals={0} className="field" value={f.holdMinutes} onChange={(v) => v !== null && setF({ ...f, holdMinutes: v })} />
        </Field>
        <div className="rounded-2xl border border-line bg-ivory p-4 sm:col-span-2">
          <p className="text-sm font-semibold text-navy">{f.allowCashAtHotel ? 'Pagamento in hotel all’arrivo: attivo' : 'Pagamento in hotel all’arrivo: non attivo'}</p>
          {f.allowCashAtHotel && (
            <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr] sm:items-center">
              <Field label="Sconto contanti (%)">
                <NumInput min={0} max={30} decimals={1} className="field" value={f.cashDiscountPercent} onChange={(v) => v !== null && setF({ ...f, cashDiscountPercent: v })} />
              </Field>
              <p className="text-xs leading-relaxed text-mist">Sul sito ogni camera mostra due prezzi: con carta e in contanti (−{f.cashDiscountPercent}%). In Italia non si può applicare un sovrapprezzo a chi paga con carta, quindi la differenza è sempre uno <strong>sconto per i contanti</strong>, nei limiti di legge sull’uso del contante.</p>
            </div>
          )}
        </div>
        <Field label="Nota aggiuntiva sulla cancellazione (facoltativa, mostrata dopo la regola)" className="sm:col-span-2">
          <textarea className="field" rows={3} value={f.cancellationPolicy} onChange={(e) => setF({ ...f, cancellationPolicy: e.target.value })} />
        </Field>
        <Field label="Politica di rimborso" className="sm:col-span-2">
          <textarea className="field" rows={3} value={f.refundPolicy} onChange={(e) => setF({ ...f, refundPolicy: e.target.value })} />
        </Field>
      </div>
      <Button className="mt-5" disabled={pending} onClick={() => run(() => savePaymentsAction(f))}>
        Salva condizioni
      </Button>
    </Card>
  );
}

/* ---------------- messages & outbox ---------------- */
export interface OutboxRow {
  id: string;
  to: string;
  subject: string;
  template: string;
  html: string;
  status: string;
  createdAt: string;
  error: string | null;
}
export interface MessageRow {
  id: string;
  name: string;
  email: string;
  subject: string;
  body: string;
  source: string;
  read: boolean;
  createdAt: string;
  bookingId: string | null;
}

const MODEL_LANGS = [
  ['it', 'Italiano'],
  ['en', 'English'],
  ['pl', 'Polski'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
] as const;

export function MessagesCenter({ messages, outbox, templates, smtp }: { messages: MessageRow[]; outbox: OutboxRow[]; templates: { key: string; label: string; html: string; byLang?: Partial<Record<string, string>> }[]; smtp: boolean }) {
  const [tab, setTab] = useState<'messaggi' | 'outbox' | 'modelli'>('messaggi');
  const [modelLang, setModelLang] = useState<(typeof MODEL_LANGS)[number][0]>('it');
  const [preview, setPreview] = useState<{ title: string; html: string } | null>(null);
  const { run, pending } = useAction();
  return (
    <div>
      <StickyBar className="mb-3">
        <Segmented id="msg-tab" value={tab} onChange={setTab} options={[{ value: 'messaggi', label: `Messaggi ospiti (${messages.filter((m) => !m.read).length})` }, { value: 'outbox', label: 'Demo Outbox' }, { value: 'modelli', label: 'Modelli email' }]} />
      </StickyBar>
      {tab === 'messaggi' && (
        <ul className="divide-y divide-line border border-line bg-white">
          {messages.length === 0 && <Empty icon={Mail} title="Nessun messaggio" />}
          {messages.map((m) => (
            <li key={m.id} className={cn('px-4 py-4', !m.read && 'bg-gold/[0.05]')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-navy">
                    {m.subject} {!m.read && <Badge tone="gold">nuovo</Badge>}
                  </p>
                  <p className="text-xs text-mist">
                    <GuestLink email={m.email} bookingId={m.bookingId} className="font-semibold text-navy">
                      {m.name}
                    </GuestLink>{' '}
                    · {m.email} · {m.source === 'area_ospite' ? 'area ospite' : 'modulo contatti'} · {fmtDateTime(m.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {/* a guest with a booking is answered in the conversation of the booking (it also reaches them by e-mail) */}
                  <a href={m.bookingId ? `/admin/prenotazioni?id=${m.bookingId}` : `mailto:${m.email}?subject=${encodeURIComponent('Re: ' + m.subject)}`} className="inline-flex h-9 items-center gap-1.5 border border-line px-3 text-xs font-semibold text-navy">
                    <Send className="h-3.5 w-3.5" /> {m.bookingId ? 'Rispondi nella prenotazione' : 'Rispondi'}
                  </a>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => markMessageRead(m.id, !m.read))}>
                    <MailOpen className="h-3.5 w-3.5" /> {m.read ? 'Da leggere' : 'Letto'}
                  </Button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm text-charcoal/85">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {tab === 'outbox' && (
        <div>
          <p className="mb-3 text-sm text-mist">{smtp ? 'SMTP configurato: le email vengono inviate realmente e restano qui come archivio.' : 'SMTP non configurato: le email non partono, vengono salvate qui (Demo Outbox) con l’anteprima esatta. Configura SMTP_* per inviarle.'}</p>
          <ul className="divide-y divide-line border border-line bg-white">
            {outbox.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-navy">{e.subject}</span>
                  <span className="text-xs text-mist">
                    a {e.to} · {fmtDateTime(e.createdAt)}
                    {e.error ? ` · errore: ${e.error}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={e.status === 'sent' ? 'green' : e.status === 'failed' ? 'red' : 'gray'}>{e.status === 'sent' ? 'inviata' : e.status === 'failed' ? 'errore' : 'demo outbox'}</Badge>
                  <Button size="sm" variant="line" onClick={() => setPreview({ title: e.subject, html: e.html })}>
                    Anteprima
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!smtp || pending} title={smtp ? 'Invia via SMTP' : 'Configura SMTP per inviare'} onClick={() => run(() => resendEmail(e.id))}>
                    Reinvia
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab === 'modelli' && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-mist">Ogni ospite riceve le email nella sua lingua. Anteprima in:</span>
            {MODEL_LANGS.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={modelLang === k} onClick={() => setModelLang(k)} className={cn('h-8 rounded-full border px-3 text-xs font-semibold transition-colors', modelLang === k ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/50')}>
                {l}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((t) => {
              const html = t.byLang?.[modelLang] ?? t.html;
              return (
                <button key={`${t.key}-${modelLang}`} type="button" onClick={() => setPreview({ title: t.label, html })} className="group border border-line bg-white p-3 text-left hover:border-navy">
                  <div className="relative h-44 overflow-hidden border border-line bg-ivory">
                    <iframe title={t.label} srcDoc={html} className="pointer-events-none h-[600px] w-[600px] origin-top-left scale-[0.5]" sandbox="" tabIndex={-1} />
                  </div>
                  <p className="mt-3 text-sm font-medium text-navy">{t.label}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <Dialog open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.title ?? ''} width={720}>
        {preview && <iframe title={preview.title} srcDoc={preview.html} sandbox="" className="h-[70svh] w-full border border-line bg-white" />}
      </Dialog>
    </div>
  );
}

/* ---------------- tariff rules: uso singola, what the price includes ---------------- */
const MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const mdLabel = (md: string) => `${Number(md.slice(3))} ${MONTHS_IT[Number(md.slice(0, 2)) - 1]}`;

/** "1 giugno" chosen with two small selects (day, month) */
function DayMonth({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled?: boolean; label: string }) {
  const [mm, dd] = [value.slice(0, 2), value.slice(3)];
  const days = new Date(2024, Number(mm), 0).getDate();
  return (
    <span className="flex items-center gap-1.5" aria-label={label}>
      <NiceSelect className="min-w-[4.2rem]" label={`${label}: giorno`} value={String(Number(dd))} disabled={disabled} onChange={(d) => onChange(`${mm}-${String(d).padStart(2, '0')}`)} options={Array.from({ length: days }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />
      <NiceSelect className="min-w-[8rem]" label={`${label}: mese`} value={mm} disabled={disabled} onChange={(m2) => onChange(`${m2}-${String(Math.min(Number(dd), new Date(2024, Number(m2), 0).getDate())).padStart(2, '0')}`)} options={MONTHS_IT.map((l, i) => ({ value: String(i + 1).padStart(2, '0'), label: l }))} />
    </span>
  );
}

export function PricingRulesForm({ initial, cashPercent, canEdit, part = 'all' }: { initial: { singleUsePercent: number; board: 'room_only' | 'breakfast'; touristTax?: TouristTax; onlineMarkup: { enabled: boolean; percent: number } }; cashPercent: number; canEdit: boolean; part?: 'all' | 'rules' | 'tax' }) {
  const [f, setF] = useState({ ...initial, touristTax: initial.touristTax ?? TAX_DEFAULT });
  const mk = f.onlineMarkup;
  const setMk = (patch: Partial<typeof mk>) => setF({ ...f, onlineMarkup: { ...mk, ...patch } });
  const tax = f.touristTax;
  const setTax = (patch: Partial<TouristTax>) => setF({ ...f, touristTax: { ...tax, ...patch } });
  // example: 2 adults, 3 nights in the middle of the season
  const exFrom = `2027-${tax.from}`;
  const exQuote = touristTaxFor({ ...tax, enabled: true }, exFrom, new Date(Date.UTC(2027, Number(tax.from.slice(0, 2)) - 1, Number(tax.from.slice(3)) + 3)).toISOString().slice(0, 10), 2);
  const changed = JSON.stringify(f) !== JSON.stringify({ ...initial, touristTax: initial.touristTax ?? TAX_DEFAULT });
  const { run, pending } = useAction();
  const sample = 100;
  return (
    <Card title={part === 'tax' ? 'Tassa di soggiorno' : 'Tariffe e sconti'}>
      {part !== 'tax' && (
      <>
      <p className="mb-5 text-sm text-charcoal/80">Regole che valgono per tutte le camere. Cambi qui e il sito, la ricerca e il riepilogo di prenotazione usano subito i nuovi prezzi.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-line bg-ivory p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-navy">
            <UserRound className="h-4 w-4 text-gold-2" /> Uso singola
          </p>
          <p className="mt-1 text-[0.78rem] leading-relaxed text-mist">Una persona sola in una matrimoniale o in una twin paga meno.</p>
          <div className="mt-3 flex items-center gap-2">
            <NumInput min={0} max={60} decimals={0} className="field w-24" value={f.singleUsePercent} disabled={!canEdit} onChange={(v) => v !== null && setF({ ...f, singleUsePercent: v })} />
            <span className="text-sm text-navy">% di sconto</span>
          </div>
          <p className="mt-2 text-[0.75rem] text-charcoal/70">{f.singleUsePercent > 0 ? `Esempio: ${money(sample)} a notte → ${money(sample * (1 - f.singleUsePercent / 100))} per 1 ospite` : 'Spento: 1 ospite paga il prezzo pieno.'}</p>
        </div>
        <div className="rounded-2xl border border-line bg-ivory p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-navy">
            <BedDouble className="h-4 w-4 text-gold-2" /> Trattamento
          </p>
          <p className="mt-1 text-[0.78rem] leading-relaxed text-mist">Cosa comprende il prezzo, scritto accanto alle tariffe sul sito.</p>
          <div className="mt-3 grid gap-2">
            {([
              { v: 'room_only', t: 'Solo pernottamento', d: 'senza pasti', icon: BedDouble },
              { v: 'breakfast', t: 'Pernottamento e colazione', d: 'colazione inclusa', icon: Coffee },
            ] as const).map((o) => (
              <button key={o.v} type="button" disabled={!canEdit} aria-pressed={f.board === o.v} onClick={() => setF({ ...f, board: o.v })} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors', f.board === o.v ? 'border-navy bg-navy text-ivory' : 'border-line bg-white text-navy hover:border-navy/40')}>
                <o.icon className={cn('h-4 w-4', f.board === o.v ? 'text-gold' : 'text-gold-2')} />
                <span className="flex-1 font-semibold">{o.t}</span>
                <span className={cn('text-[0.7rem]', f.board === o.v ? 'text-ivory/70' : 'text-mist')}>{o.d}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-ivory p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-navy">
            <Percent className="h-4 w-4 text-gold-2" /> Gli altri sconti
          </p>
          <ul className="mt-2 space-y-2 text-[0.8rem] leading-relaxed text-charcoal/80">
            <li>
              <strong className="text-navy">Contanti in hotel: −{cashPercent}%</strong> · si cambia in <a className="underline decoration-gold underline-offset-2" href="/admin/pagamenti">Pagamenti</a>
            </li>
            <li>
              <strong className="text-navy">Stagioni ed eventi</strong> · qui sotto, in “Variazioni per periodo” (anche prezzi più bassi, es. −15%)
            </li>
            <li>
              <strong className="text-navy">Codici promo</strong> · in <a className="underline decoration-gold underline-offset-2" href="/admin/marketing">Recensioni e Marketing</a>
            </li>
          </ul>
        </div>
      </div>
      <div className={cn('mt-4 rounded-2xl border p-4 transition-colors duration-300', mk.enabled ? 'border-gold/60 bg-white' : 'border-line bg-ivory')} data-testid="online-markup">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex flex-1 items-center gap-2 text-sm font-semibold text-navy">
            <TrendingUp className="h-4 w-4 text-gold-2" /> Aumento prezzi online
          </p>
          <Toggle checked={mk.enabled} disabled={!canEdit} onChange={(v) => setMk({ enabled: v })} label="Aumento prezzi online" />
        </div>
        <p className="mt-1 text-[0.78rem] leading-relaxed text-mist">Tutti i prezzi con carta sul sito salgono di questa percentuale (es. per coprire il costo dei bonifici immediati). Tu continui a scrivere i tuoi prezzi di sempre; il prezzo in contanti resta uguale. Per l’ospite è semplicemente il prezzo della camera.</p>
        {mk.enabled && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2">
              <NumInput min={0.5} max={20} decimals={1} className="field w-24" value={mk.percent} disabled={!canEdit} onChange={(v) => v !== null && setMk({ percent: v })} />
              <span className="text-sm text-navy">% in più</span>
            </label>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full border border-line bg-ivory px-3 py-1 text-charcoal/70 line-through decoration-gold/70">{money(sample, 'it', 2)}</span>
              <span className="text-gold-2">→</span>
              <span className="rounded-full bg-navy px-3 py-1 font-semibold text-ivory">{money(Math.round(sample * (1 + mk.percent / 100) * 100) / 100, 'it', 2)} con carta</span>
              {cashPercent > 0 && <span className="rounded-full border border-line bg-ivory px-3 py-1 text-navy">{money(Math.round(sample * (1 - cashPercent / 100) * 100) / 100, 'it', 2)} in contanti, come prima</span>}
            </div>
          </div>
        )}
        <p className="mt-3 text-[0.75rem] text-charcoal/70">{mk.enabled && mk.percent > 0 ? `Acceso: sul sito ogni prezzo con carta è più alto del ${mk.percent}% (camere, ricerca, prenotazione, chat).` : 'Spento: sul sito si vedono esattamente i prezzi che scrivi.'}</p>
      </div>
      </>
      )}
      {part !== 'rules' && (
      <div id="tassa" className={cn('scroll-mt-28 rounded-2xl border border-line bg-ivory p-4', part !== 'tax' && 'mt-4')} data-testid="tourist-tax">
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex flex-1 items-center gap-2 text-sm font-semibold text-navy">
            <Landmark className="h-4 w-4 text-gold-2" /> Tassa di soggiorno
          </p>
          <Toggle checked={tax.enabled} disabled={!canEdit} onChange={(v) => setTax({ enabled: v })} label="Tassa di soggiorno" />
        </div>
        <p className="mt-1 text-[0.78rem] leading-relaxed text-mist">Quanto paga ogni adulto per ogni notte (i bambini no). Non entra nel prezzo della camera: il sito la scrive sotto l’elenco delle camere, nella pagina della camera, nel riepilogo e nell’email di conferma, e la si paga in hotel.</p>
        {tax.enabled && (
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-navy">A persona, a notte</span>
              <span className="mt-1.5 flex items-center gap-2">
                <NumInput min={0} max={20} decimals={2} className="field w-24" value={tax.amount} disabled={!canEdit} onChange={(v) => v !== null && setTax({ amount: v })} />
                <span className="text-sm text-navy">€</span>
              </span>
            </label>
            <div>
              <span className="text-xs font-semibold text-navy">Periodo</span>
              <span className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-navy">
                dal <DayMonth label="Dal" value={tax.from} disabled={!canEdit} onChange={(v) => setTax({ from: v })} /> al <DayMonth label="Al" value={tax.to} disabled={!canEdit} onChange={(v) => setTax({ to: v })} />
              </span>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-navy">Massimo notti</span>
              <span className="mt-1.5 flex items-center gap-2">
                <NumInput min={0} max={60} decimals={0} className="field w-20" value={tax.maxNights} disabled={!canEdit} onChange={(v) => v !== null && setTax({ maxNights: v })} />
                <span className="text-[0.75rem] text-mist">0 = senza limite</span>
              </span>
            </label>
          </div>
        )}
        {tax.enabled && (
          <label className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-3 py-2.5 text-sm">
            <span className="flex items-center gap-2 text-navy">
              <Banknote className="h-4 w-4 shrink-0 text-gold-2" />
              <span>
                Si paga a parte, in contanti
                <span className="block text-[0.72rem] text-mist">Il sito lo scrive accanto al totale, quando l’ospite paga.</span>
              </span>
            </span>
            <Toggle checked={tax.cash !== false} disabled={!canEdit} onChange={(v) => setTax({ cash: v })} label="Si paga in contanti" />
          </label>
        )}
        <p className="mt-3 text-[0.75rem] text-charcoal/70">
          {tax.enabled ? `Dal ${mdLabel(tax.from)} al ${mdLabel(tax.to)} · esempio: 2 adulti, 3 notti → ${money(exQuote?.total ?? 0, 'it', 2)} da pagare in hotel${tax.cash !== false ? ', in contanti' : ''}.` : 'Spenta: il sito non mostra nessuna tassa di soggiorno.'}
        </p>
        {tax.enabled && exQuote && (
          <div className="mt-4 rounded-xl border border-dashed border-gold/50 bg-white/70 p-3">
            <p className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-mist">Così la vede l’ospite, sotto il totale</p>
            <p className="mt-1.5 flex items-start gap-2 text-[0.8rem] leading-snug text-mist">
              <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-2" />
              <span>
                <span className="font-semibold text-navy">+ Tassa di soggiorno {money(exQuote.total, 'it', 2)}</span> · {taxNote('it', tax.cash)} (2 adulti × {exQuote.nights} notti × {money(tax.amount, 'it', 2)})
              </span>
            </p>
          </div>
        )}
      </div>
      )}
      {canEdit && (
        <Button className="mt-5" disabled={pending || !changed} onClick={() => run(() => savePricingAction(f))}>
          Salva tariffe
        </Button>
      )}
    </Card>
  );
}
