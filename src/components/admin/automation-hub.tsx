'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, BedDouble, CalendarCheck2, Check, CreditCard, Loader2, LogIn, LogOut, MailWarning, MessageSquare, PlugZap, RefreshCw, Send, Sparkles, UserPlus, X, XCircle } from 'lucide-react';
import type { NotificationType } from '@/lib/types';
import { cn } from '@/lib/utils';
import { fmtDateTime } from '@/lib/dates';
import { Dialog, Toggle, useAction, useToast } from './ui';
import { PORTALS, PortalConnect, useCalendarOverview, type Portal } from './ota-calendars';
import { generateLinkCode, linkedChatsAction, saveReportScheduleAction, sendReportNow, setNotificationAction, syncCalendarsAction, testTelegram, unlinkChat } from '@/app/admin/actions/automation';
import { TimeDaysPicker } from './nice-select';

type Slot = { time: string; days: number[] };
type Schedule = { morning: Slot; evening: Slot };
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const daysText = (d: number[]) => (d.length === 7 ? 'ogni giorno' : d.length === 5 && !d.includes(6) && !d.includes(7) ? 'dal lunedì al venerdì' : `${d.length} giorni a settimana`);

type Chat = { chatId: string; name: string; linkedAt: string };
const EASE = [0.22, 0.61, 0.12, 1] as const;

/**
 * Automazioni for the owner: one tile per service (Telegram, Booking.com, Expedia, Airbnb), one
 * button each, and the Telegram notices that switch on and off with a tap.
 * No tokens, webhooks or technical steps on screen.
 */
export function AutomationHub({ telegramReady, chats: initialChats, toggles, checkOutBy, schedule = { morning: { time: '08:00', days: EVERY_DAY }, evening: { time: '21:00', days: EVERY_DAY } } }: { telegramReady: boolean; chats: Chat[]; toggles: Partial<Record<NotificationType, boolean>>; checkOutBy: string; schedule?: Schedule }) {
  const toast = useToast();
  const router = useRouter();
  const { run, pending } = useAction();
  const { data, load } = useCalendarOverview();
  const [chats, setChats] = useState(initialChats);
  const [open, setOpen] = useState<Portal | null>(null);
  const [syncing, setSyncing] = useState(false);

  const portalState = (k: Portal) => {
    const list = data?.calendars.filter((c) => c.source === k) ?? [];
    return { rooms: list.filter((c) => !c.lastError).length, errors: list.filter((c) => c.lastError).length };
  };

  const syncAll = () => {
    setSyncing(true);
    run(() => syncCalendarsAction(), {
      onOk: (d) => {
        toast('ok', (d as { message: string }).message);
        void load();
        router.refresh();
      },
    });
  };
  useEffect(() => {
    if (!pending) setSyncing(false);
  }, [pending]);

  return (
    <div className="space-y-12">
      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="label">Collegamenti</p>
            <p className="text-sm text-mist">Un tocco per collegare: da quel momento tutto resta sincronizzato da solo.</p>
          </div>
          <motion.button whileTap={{ scale: 0.96 }} type="button" disabled={pending} onClick={syncAll} className="flex h-11 items-center gap-2 rounded-full bg-navy px-5 text-xs font-semibold text-ivory shadow-[0_14px_30px_-18px_rgba(16,40,61,0.9)] disabled:opacity-60">
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} /> Sincronizza tutto
          </motion.button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TelegramTile index={0} ready={telegramReady} chats={chats} setChats={setChats} />
          {(Object.keys(PORTALS) as Portal[]).map((k, i) => {
            const s = portalState(k);
            return (
              <Tile
                key={k}
                index={i + 1}
                mark={<PortalMark portal={k} />}
                title={PORTALS[k].name}
                text={k === 'airbnb' ? 'Le notti prenotate su Airbnb si chiudono da sole nel planning.' : `Le notti vendute su ${PORTALS[k].name} si chiudono da sole nel planning e sul sito.`}
                status={!data ? { tone: 'wait', label: 'Controllo…' } : s.errors ? { tone: 'bad', label: `${s.errors} da ricontrollare` } : s.rooms ? { tone: 'ok', label: `${s.rooms} ${s.rooms === 1 ? 'camera collegata' : 'camere collegate'}` } : { tone: 'todo', label: 'Da collegare' }}
                action={
                  <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={() => setOpen(k)} className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold text-white transition-[filter] hover:brightness-110" style={{ background: PORTALS[k].color }}>
                    <PlugZap className="h-4 w-4" /> {s.rooms || s.errors ? 'Gestisci' : 'Collega'}
                  </motion.button>
                }
              />
            );
          })}
        </div>
      </section>

      <Notices toggles={toggles} checkOutBy={checkOutBy} linked={chats.length > 0} schedule={schedule} />

      <Dialog open={open !== null} onClose={() => setOpen(null)} title={open ? `Collega ${PORTALS[open].name}` : ''} width={720}>
        {open && <PortalConnect portal={open} data={data} reload={load} />}
      </Dialog>
    </div>
  );
}

/* ---------------- tiles ---------------- */

type Status = { tone: 'ok' | 'todo' | 'bad' | 'wait'; label: string };

function Tile({ index, mark, title, text, status, action, children }: { index: number; mark: React.ReactNode; title: string; text: string; status: Status; action: React.ReactNode; children?: React.ReactNode }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 22, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.07 * index, duration: 0.6, ease: EASE }}
      whileHover={{ y: -4 }}
      className="group relative flex min-h-[250px] flex-col overflow-hidden rounded-[1.75rem] border border-line bg-white p-5 shadow-[0_24px_50px_-42px_rgba(16,40,61,0.7)] transition-shadow hover:shadow-[0_30px_60px_-36px_rgba(16,40,61,0.55)]"
    >
      <div className="flex items-start justify-between gap-3">
        {mark}
        <StatusPill status={status} />
      </div>
      <h3 className="serif mt-5 text-[1.65rem] leading-tight text-navy">{title}</h3>
      <p className="mt-1.5 text-[0.82rem] leading-relaxed text-mist">{text}</p>
      {children}
      <div className="mt-auto pt-5">{action}</div>
    </motion.article>
  );
}

function StatusPill({ status }: { status: Status }) {
  const tone = { ok: 'bg-sage/15 text-[#3f5a35]', todo: 'bg-gold/15 text-gold-2', bad: 'bg-terracotta/12 text-terracotta', wait: 'bg-sand-2 text-mist' }[status.tone];
  const dot = { ok: 'bg-sage', todo: 'bg-gold', bad: 'bg-terracotta', wait: 'bg-mist' }[status.tone];
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={status.label} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className={cn('flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.12em]', tone)}>
        <span className="relative flex h-2 w-2">
          {status.tone === 'ok' && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', dot)} />}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', dot)} />
        </span>
        {status.label}
      </motion.span>
    </AnimatePresence>
  );
}

function PortalMark({ portal }: { portal: Portal }) {
  const m = { booking: { t: 'B.', c: '#003580', f: '#ffffff' }, expedia: { t: 'E', c: '#ffc72c', f: '#1f2b6c' }, airbnb: { t: 'a', c: '#ff385c', f: '#ffffff' } }[portal];
  return (
    <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-bold shadow-[0_10px_24px_-14px_rgba(16,40,61,0.8)] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105" style={{ background: m.c, color: m.f }}>
      {m.t}
    </span>
  );
}

/* ---------------- Telegram: one button, then press "Avvia" in Telegram ---------------- */

function TelegramTile({ index, ready, chats, setChats }: { index: number; ready: boolean; chats: Chat[]; setChats: (c: Chat[]) => void }) {
  const toast = useToast();
  const router = useRouter();
  const { run, pending } = useAction();
  const [waiting, setWaiting] = useState<{ code: string; url: string } | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [showPeople, setShowPeople] = useState(false);
  const known = useRef(new Set(chats.map((c) => c.chatId)));

  // after the button: look every few seconds whether the new person pressed "Avvia"
  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      if (stop) return;
      const list = await linkedChatsAction().catch(() => null);
      if (list) {
        const fresh = list.find((c) => !known.current.has(c.chatId));
        if (fresh) {
          known.current = new Set(list.map((c) => c.chatId));
          setChats(list);
          setWaiting(null);
          setJoined(fresh.name);
          router.refresh();
          window.setTimeout(() => setJoined(null), 4500);
          return;
        }
      }
      if (Date.now() - started > 15 * 60_000) return setWaiting(null);
      window.setTimeout(tick, 2500);
    };
    const t = window.setTimeout(tick, 2500);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
  }, [waiting, setChats, router]);

  const connect = () => {
    // open the tab now (a click), fill it when the link is ready: browsers block late pop-ups
    const tab = window.open('', '_blank');
    run(() => generateLinkCode(), {
      onOk: (d) => {
        const r = d as { code: string; url: string };
        if (tab) tab.location.href = r.url;
        setWaiting(r);
      },
    });
    window.setTimeout(() => {
      if (tab && tab.location.href === 'about:blank') tab.close();
    }, 8000);
  };

  const n = chats.length;
  return (
    <Tile
      index={index}
      mark={
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#229ED9] text-white shadow-[0_10px_24px_-14px_rgba(34,158,217,0.9)] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
          <Send className="h-5 w-5 -translate-x-px translate-y-px" />
        </span>
      }
      title="Telegram"
      text="Avvisi e report sul telefono. Puoi anche scrivere o mandare un vocale al bot per gestire l’hotel."
      status={!ready ? { tone: 'bad', label: 'Non disponibile' } : n ? { tone: 'ok', label: `${n} ${n === 1 ? 'persona collegata' : 'persone collegate'}` } : { tone: 'todo', label: 'Da collegare' }}
      action={
        <div className="space-y-2">
          <motion.button whileTap={{ scale: 0.97 }} type="button" disabled={!ready || pending || Boolean(waiting)} onClick={connect} className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#229ED9] text-sm font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60">
            {pending && !waiting ? <Loader2 className="h-4 w-4 animate-spin" /> : n ? <UserPlus className="h-4 w-4" /> : <Send className="h-4 w-4" />} {n ? 'Collega un’altra persona' : 'Collega Telegram'}
          </motion.button>
          {n > 0 && (
            <button type="button" onClick={() => setShowPeople((s) => !s)} className="w-full text-center text-[0.72rem] font-semibold text-mist hover:text-navy">
              {showPeople ? 'Chiudi' : 'Persone collegate e prova'}
            </button>
          )}
        </div>
      }
    >
      <AnimatePresence>
        {waiting && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#229ED9]/10 p-3">
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-[#229ED9]/30" />
                <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#229ED9] text-white">
                  <Send className="h-4 w-4" />
                </span>
              </span>
              <span className="min-w-0 flex-1 text-[0.78rem] leading-snug text-navy">
                Su Telegram premi <strong>Avvia</strong>.{' '}
                <a href={waiting.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Non si è aperto?
                </a>
              </span>
              <button type="button" aria-label="Annulla" onClick={() => setWaiting(null)} className="text-mist hover:text-navy">
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
        {joined && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }} className="mt-4 flex items-center gap-3 rounded-2xl bg-sage/15 p-3 text-[0.8rem] font-semibold text-[#3f5a35]">
            <motion.span initial={{ rotate: -90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.1 }} className="flex h-8 w-8 items-center justify-center rounded-full bg-sage text-white">
              <Check className="h-4 w-4" />
            </motion.span>
            Collegato: {joined}
          </motion.div>
        )}
        {showPeople && n > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
              {chats.map((c) => (
                <li key={c.chatId} className="flex items-center justify-between gap-2 px-3 py-2 text-[0.8rem]">
                  <span className="min-w-0 truncate text-navy">
                    {c.name} <span className="text-[0.68rem] text-mist">· {fmtDateTime(c.linkedAt)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => unlinkChat(c.chatId), {
                        onOk: () => {
                          const rest = chats.filter((x) => x.chatId !== c.chatId);
                          known.current = new Set(rest.map((x) => x.chatId));
                          setChats(rest);
                        },
                      })
                    }
                    className="shrink-0 text-[0.7rem] font-semibold text-mist hover:text-terracotta"
                  >
                    Scollega
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" disabled={pending} onClick={() => run(() => testTelegram(), { onOk: (d) => toast('ok', (d as { message: string }).message) })} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-line py-2 text-[0.72rem] font-semibold text-navy hover:border-navy">
              <Send className="h-3.5 w-3.5" /> Manda un messaggio di prova
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Tile>
  );
}

/* ---------------- notices ---------------- */

function Notices({ toggles, checkOutBy, linked, schedule }: { toggles: Partial<Record<NotificationType, boolean>>; checkOutBy: string; linked: boolean; schedule: Schedule }) {
  const toast = useToast();
  const [on, setOn] = useState<Partial<Record<NotificationType, boolean>>>(toggles);
  const [sending, setSending] = useState(false);
  const [plan, setPlan] = useState<Schedule>(schedule);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the times are saved by themselves, a moment after the last touch
  const change = (k: keyof Schedule, v: Slot) => {
    const next = { ...plan, [k]: v };
    setPlan(next);
    setSaved('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await saveReportScheduleAction(next).catch(() => null);
      if (r?.ok) {
        setSaved('saved');
        setTimeout(() => setSaved('idle'), 1800);
      } else {
        setSaved('idle');
        toast('error', r && !r.ok ? r.error : 'Orari non salvati: riprova.');
      }
    }, 600);
  };
  const rows: { k: NotificationType; icon: React.ComponentType<{ className?: string }>; title: string; text: string }[] = [
    { k: 'nuovo_arrivo', icon: LogIn, title: 'Chi arriva oggi', text: `Alle ${plan.morning.time}, ${daysText(plan.morning.days)}: nomi, camere e quanto resta da saldare.` },
    { k: 'partenza_oggi', icon: LogOut, title: 'Chi parte oggi', text: `Alle ${plan.morning.time}, ${daysText(plan.morning.days)}: partenze e saldi da incassare.` },
    { k: 'camera_da_controllare', icon: BedDouble, title: 'Camere da preparare', text: `Alle ${checkOutBy}, ora del check-out: prima quelle dove arriva qualcuno.` },
    { k: 'nuova_prenotazione', icon: CalendarCheck2, title: 'Nuova prenotazione', text: 'Subito, da sito, telefono o portali.' },
    { k: 'nuovo_pagamento', icon: CreditCard, title: 'Pagamento ricevuto', text: 'Subito, quando arrivano soldi.' },
    { k: 'prenotazione_cancellata', icon: XCircle, title: 'Prenotazione cancellata', text: 'Subito, con l’eventuale rimborso.' },
    { k: 'pagamento_non_completato', icon: MailWarning, title: 'Prenotazione lasciata a metà', text: 'Con i recapiti, per richiamare il cliente.' },
    { k: 'messaggio_ospite', icon: MessageSquare, title: 'Messaggio di un ospite', text: 'Quando qualcuno scrive dal sito.' },
    { k: 'errore_sincronizzazione', icon: RefreshCw, title: 'Calendario di un portale fermo', text: 'Solo se Booking, Expedia o Airbnb smettono di aggiornarsi.' },
  ];
  const isOn = (k: NotificationType) => on[k] !== false;
  // saved at once; a failed save puts the switch back and says why
  const flip = async (k: NotificationType, v: boolean) => {
    setOn((s) => ({ ...s, [k]: v }));
    const r = await setNotificationAction(k, v).catch(() => null);
    if (!r?.ok) {
      setOn((s) => ({ ...s, [k]: !v }));
      toast('error', r && !r.ok ? r.error : 'Non salvato: riprova.');
    }
  };
  const reportNow = async () => {
    setSending(true);
    const r = await sendReportNow().catch(() => null);
    setSending(false);
    if (r?.ok) toast('ok', (r.data as { message: string }).message);
    else toast('error', r && !r.ok ? r.error : 'Report non inviato: riprova.');
  };

  return (
    <section>
      <div className="mb-5">
        <p className="label">Avvisi su Telegram</p>
        <p className="text-sm text-mist">{linked ? 'Arrivano a tutte le persone collegate. Un tocco li accende o li spegne.' : 'Collega Telegram qui sopra per riceverli sul telefono. Intanto li trovi nelle notifiche del pannello.'}</p>
      </div>

      {/* the evening report */}
      <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.2 }} className="relative mb-4 overflow-hidden rounded-[1.75rem] bg-navy p-5 text-ivory md:p-6">
        <motion.span aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-gold/25 blur-3xl" animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold text-navy-3">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="serif text-[1.55rem] leading-tight">Report della giornata</p>
            <p className="mt-1 max-w-2xl text-[0.82rem] leading-relaxed text-ivory/70">Alle {plan.evening.time}, {daysText(plan.evening.days)}: quante persone sul sito, prenotazioni e incassi, cosa migliorare e cosa arriva nei prossimi giorni. Lo scrive l’assistente con i dati dell’hotel; nei giorni tranquilli ti parla di quello che verrà.</p>
            <div className="mt-3">
              <TimeDaysPicker tone="dark" label="report della sera" time={plan.evening.time} days={plan.evening.days} onChange={(v) => change('evening', v)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.96 }}
              type="button"
              disabled={sending}
              onClick={() => void reportNow()}
              className="flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-xs font-semibold text-ivory ring-1 ring-white/20 hover:bg-white/15 disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-gold" />} Ricevilo ora
            </motion.button>
            <Toggle checked={isOn('report_giornaliero')} onChange={(v) => void flip('report_giornaliero', v)} label="Report della giornata" />
          </div>
        </div>
      </motion.div>

      {/* the morning message: arrivals and departures */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE, delay: 0.24 }} className="mb-4 flex flex-wrap items-center gap-4 rounded-[1.5rem] border border-line bg-white p-4 md:p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold/20 text-navy">
          <LogIn className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-navy">Messaggio del mattino</span>
          <span className="block text-[0.74rem] text-mist">Chi arriva e chi parte oggi, all’ora e nei giorni che scegli.</span>
        </span>
        <TimeDaysPicker label="messaggio del mattino" time={plan.morning.time} days={plan.morning.days} onChange={(v) => change('morning', v)} />
        <AnimatePresence>
          {saved !== 'idle' && (
            <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5 text-xs font-semibold text-sage">
              {saved === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {saved === 'saving' ? 'Salvo…' : 'Salvato'}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      <ul className="grid gap-2 md:grid-cols-2">
        {rows.map((r, i) => {
          const Icon = r.icon;
          const active = isOn(r.k);
          return (
            <motion.li key={r.k} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + 0.04 * i, duration: 0.5, ease: EASE }} className={cn('flex items-center gap-3 rounded-2xl border p-3.5 transition-colors', active ? 'border-line bg-white' : 'border-transparent bg-sand-2/50')}>
              <motion.span animate={{ scale: active ? 1 : 0.9, opacity: active ? 1 : 0.5 }} className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors', active ? 'bg-navy text-ivory' : 'bg-white text-mist')}>
                <Icon className="h-4 w-4" />
              </motion.span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-semibold transition-colors', active ? 'text-navy' : 'text-mist')}>{r.title}</span>
                <span className="block text-[0.74rem] leading-snug text-mist">{r.text}</span>
              </span>
              <Toggle checked={active} onChange={(v) => void flip(r.k, v)} label={r.title} />
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
