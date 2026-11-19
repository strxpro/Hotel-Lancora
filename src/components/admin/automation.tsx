'use client';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, PlugZap, RefreshCw } from 'lucide-react';
import type { ChannelState } from '@/lib/types';
import type { RoomOption } from '@/server/admin-data';
import { fmtDateTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Field, useAction, useToast } from './ui';
import { saveChannelSettings, simulateOtaReservation, simulateSyncError, testChannel } from '@/app/admin/actions/automation';

export function ChannelPanel({ channel, rooms, hasRealAdapter }: { channel: ChannelState; rooms: RoomOption[]; hasRealAdapter: boolean }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [name, setName] = useState(channel.providerName);
  const [mapping, setMapping] = useState(channel.mapping);
  return (
    <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-3">
        <Card title="Sincronizzazione canali">
          <div className="mb-5 flex items-center gap-3 overflow-x-auto text-xs font-semibold uppercase tracking-[0.12em] text-mist">
            {['Booking.com / Expedia', 'PMS / Channel manager', 'Hotel L’Ancora', 'Planning e sito'].map((s, i) => (
              <span key={s} className="flex shrink-0 items-center gap-3">
                <span className={cn('border px-3 py-2', i === 2 ? 'border-navy bg-navy text-ivory' : 'border-line bg-ivory')}>{s}</span>
                {i < 3 && <span className="text-gold">→</span>}
              </span>
            ))}
          </div>
          <p className="text-sm text-charcoal/80">Non ci colleghiamo direttamente a Booking.com o Expedia: le prenotazioni arrivano tramite il sistema già in abbonamento della struttura (nome e API da confermare). Fino ad allora è disponibile solo il simulatore, sempre etichettato come SIMULAZIONE.</p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="label">Stato</dt>
              <dd>{channel.status === 'collegato' ? <Badge tone="green">Collegato</Badge> : channel.status === 'simulazione' ? <Badge tone="gold">Simulazione</Badge> : <Badge tone="gray">Non collegato</Badge>}</dd>
            </div>
            <div>
              <dt className="label">Ultima sincronizzazione</dt>
              <dd className="text-navy">{channel.lastSync ? fmtDateTime(channel.lastSync) : '—'}</dd>
            </div>
            <div>
              <dt className="label">Prenotazioni importate</dt>
              <dd className="serif text-2xl text-navy">{channel.importedCount}</dd>
            </div>
            <div>
              <dt className="label">Adattatore reale</dt>
              <dd className="text-navy">{hasRealAdapter ? 'configurato' : 'assente'}</dd>
            </div>
          </dl>
          <Field label="Fornitore (PMS / channel manager)" className="mt-5">
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="line" disabled={pending} onClick={() => run(() => testChannel(false), { onOk: (d) => toast('ok', (d as { message: string }).message) })}>
              <PlugZap className="h-4 w-4" /> Testa connessione reale
            </Button>
            <Button variant="line" disabled={pending} onClick={() => run(() => testChannel(true), { onOk: (d) => toast('info', (d as { message: string }).message) })}>
              Testa simulatore
            </Button>
            <Button variant="gold" disabled={pending} onClick={() => run(() => simulateOtaReservation())}>
              <RefreshCw className="h-4 w-4" /> SIMULAZIONE: prenotazione Booking.com in arrivo
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => run(() => simulateSyncError())}>
              <AlertTriangle className="h-4 w-4" /> Simula errore
            </Button>
          </div>
        </Card>
        <Card title="Mappatura tipologie OTA → camere" action={<Button size="sm" disabled={pending} onClick={() => run(() => saveChannelSettings({ providerName: name, mapping }))}>Salva</Button>}>
          <p className="mb-4 text-xs text-mist">Le OTA vendono tipologie, non numeri: qui decidi quali camere corrispondono a ogni tipologia. L’assegnazione della camera precisa resta a te (Prenotazioni → “Da assegnare”).</p>
          <ul className="space-y-3">
            {mapping.map((m, i) => (
              <li key={m.externalCode} className="border border-line p-3">
                <p className="text-sm font-medium text-navy">
                  {m.externalCode} · {m.externalName}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {rooms.map((r) => {
                    const on = m.roomIds.includes(r.id);
                    return (
                      <button key={r.id} type="button" aria-pressed={on} onClick={() => setMapping(mapping.map((x, j) => (j === i ? { ...x, roomIds: on ? x.roomIds.filter((y) => y !== r.id) : [...x.roomIds, r.id] } : x)))} className={cn('border px-2.5 py-1 text-xs', on ? 'border-navy bg-navy text-ivory' : 'border-line text-mist')}>
                        {r.number}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Registro sincronizzazione" className="xl:col-span-2">
        <ul className="thin-scroll max-h-[620px] space-y-2 overflow-y-auto">
          {channel.log.map((l, i) => (
            <li key={i} className={cn('border-l-2 px-3 py-1.5 text-xs', l.level === 'error' ? 'border-terracotta bg-terracotta/5 text-terracotta' : 'border-sage bg-sage/5 text-charcoal')}>
              <span className="flex items-center gap-1.5 font-semibold">
                {l.level === 'error' ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />} {fmtDateTime(l.at)}
              </span>
              {l.message}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
