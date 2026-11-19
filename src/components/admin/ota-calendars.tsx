'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowRight, Check, ChevronDown, ClipboardPaste, Copy, ExternalLink, Link2, Loader2, ShieldCheck, Unplug } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDateTime } from '@/lib/dates';
import { useAction, useToast } from './ui';
import { calendarsOverview, connectCalendarAction, markReturnLinkAction, removeCalendarAction } from '@/app/admin/actions/automation';

export type Portal = 'booking' | 'expedia' | 'airbnb';
export type CalendarOverview = {
  publicSite: boolean;
  calendars: { id: string; roomId: string; source: string; url: string; lastSync: string | null; lastError: string | null; nights: number; returnAt?: string | null; readAt?: string | null }[];
  rooms: { id: string; number: string; name: string; exportUrl: string }[];
};
type Room = CalendarOverview['rooms'][number];
type Cal = CalendarOverview['calendars'][number];

const EASE = [0.22, 0.61, 0.12, 1] as const;

export const PORTALS: Record<Portal, { name: string; color: string; open: string; openLabel: string; where: string[]; back: string; note: string }> = {
  booking: {
    name: 'Booking.com',
    color: '#003580',
    open: 'https://admin.booking.com/',
    openLabel: 'Apri Booking.com',
    where: ['Nell’extranet: Tariffe e disponibilità → Sincronizza calendari.', 'Scegli la camera → “Esporta calendario” → copia il link.', 'Qui sotto premi “Incolla e collega” accanto alla stessa camera.'],
    back: 'Su Booking.com, nella stessa camera: “Importa calendario” → incolla il link del sito → dagli un nome (per esempio “Sito”) → Importa.',
    note: 'Se “Sincronizza calendari” non c’è, Booking.com non la offre per questa struttura: scrivici e la colleghiamo noi.',
  },
  expedia: {
    name: 'Expedia',
    color: '#1f2b6c',
    open: 'https://www.expediapartnercentral.com/',
    openLabel: 'Apri Expedia',
    where: ['In Partner Central apri il calendario delle camere → “Sincronizzazione calendario”.', 'Copia il link di esportazione della camera.', 'Qui sotto premi “Incolla e collega” accanto alla stessa camera.'],
    back: 'Su Expedia, nella sincronizzazione della stessa camera: “Importa calendario” → incolla il link del sito → Salva.',
    note: 'Expedia offre il calendario solo ad alcune strutture: se non lo trovi, scrivici e la colleghiamo noi.',
  },
  airbnb: {
    name: 'Airbnb',
    color: '#ff385c',
    open: 'https://www.airbnb.it/hosting/calendar',
    openLabel: 'Apri Airbnb',
    where: ['Nel calendario dell’annuncio: Disponibilità → Sincronizza calendari → Esporta calendario.', 'Copia il link.', 'Qui sotto premi “Incolla e collega” accanto alla camera di quell’annuncio.'],
    back: 'Su Airbnb, nello stesso annuncio: Sincronizza calendari → “Importa calendario” → incolla il link del sito → nome “Sito” → Importa.',
    note: 'Ogni annuncio Airbnb corrisponde a una camera.',
  },
};

/** The calendars and rooms, loaded once and reloaded after every change. */
export function useCalendarOverview() {
  const [data, setData] = useState<CalendarOverview | null>(null);
  const load = useCallback(async () => {
    const r = await calendarsOverview().catch(() => null);
    if (r?.ok) setData(r.data as CalendarOverview);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, load };
}

/** Where one room stands with one portal, in both directions. */
function stateOf(c: Cal | null, publicSite: boolean) {
  const inbound: 'ok' | 'bad' | 'todo' = !c ? 'todo' : c.lastError ? 'bad' : 'ok';
  const outbound: 'ok' | 'wait' | 'todo' | 'later' = !c || c.lastError ? 'todo' : c.readAt ? 'ok' : !publicSite ? 'later' : c.returnAt ? 'wait' : 'todo';
  return { inbound, outbound, linked: inbound === 'ok' };
}

/**
 * Connecting one portal, room after room, in both directions:
 *  1. the portal's link → "Incolla e collega": the nights sold there close here (checked at once);
 *  2. the site's link, copied by itself → pasted in the portal: the nights sold here close there.
 *     The site sees when the portal reads it, so "both directions" is shown only when it truly works.
 * The wrong link, a link of another portal or the same link for two rooms are caught with a plain sentence.
 * No password passes through us.
 */
export function PortalConnect({ portal, data, reload }: { portal: Portal; data: CalendarOverview | null; reload: () => Promise<void> }) {
  const toast = useToast();
  const { run, pending } = useAction();
  const [manual, setManual] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState<boolean | null>(null);
  const rows = useRef<Record<string, HTMLLIElement | null>>({});
  const p = PORTALS[portal];
  const rooms = data?.rooms ?? [];
  const publicSite = Boolean(data?.publicSite);
  const calOf = (roomId: string) => data?.calendars.find((c) => c.roomId === roomId && c.source === portal) ?? null;
  const linkedCount = rooms.filter((r) => stateOf(calOf(r.id), publicSite).linked).length;
  const bothCount = rooms.filter((r) => stateOf(calOf(r.id), publicSite).outbound === 'ok').length;
  const next = rooms.find((r) => !calOf(r.id)) ?? null;
  const all = rooms.length > 0 && linkedCount === rooms.length;
  const showHow = howOpen ?? linkedCount === 0;
  const siteLink = (r: Room) => `${r.exportUrl}&per=${portal}`;

  const goTo = (roomId: string | undefined) => {
    if (roomId) window.setTimeout(() => rows.current[roomId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 380);
  };
  const nextAfter = (roomId: string) => rooms.find((x) => x.id !== roomId && !calOf(x.id))?.id;

  const copySite = async (r: Room, quiet = false) => {
    try {
      await navigator.clipboard.writeText(siteLink(r));
      setCopied(r.id);
      if (!quiet) toast('ok', `Link del sito copiato: incollalo su ${p.name} in “Importa calendario” della camera ${r.number}.`);
      return true;
    } catch {
      if (!quiet) toast('error', 'Il browser non ha permesso di copiare: seleziona il link qui sotto e copialo.');
      return false;
    }
  };

  const connect = (r: Room, url: string) => {
    setBusy(r.id);
    run(() => connectCalendarAction({ roomId: r.id, url, source: portal }), {
      onOk: (d) => {
        const res = d as { message: string };
        setManual((m) => ({ ...m, [r.id]: '' }));
        setTyping(null);
        void (async () => {
          // the way back: the site's link is ready in the clipboard for the portal
          const auto = publicSite && (await copySite(r, true));
          toast('ok', auto ? `${res.message} Il link del sito è già copiato: incollalo su ${p.name} in “Importa calendario”.` : res.message);
          await reload();
          if (!publicSite) goTo(nextAfter(r.id));
        })();
      },
    });
  };

  const pasteAndConnect = async (r: Room) => {
    // the browser may first ask permission to read the clipboard: the paste field opens meanwhile
    const slow = window.setTimeout(() => setTyping(r.id), 2500);
    try {
      const text = (await navigator.clipboard.readText()).trim();
      window.clearTimeout(slow);
      if (!/^https:\/\//i.test(text)) {
        toast('error', `Negli appunti non c’è un link: copia prima il link “Esporta calendario” da ${p.name}.`);
        setTyping(r.id);
        return;
      }
      connect(r, text);
    } catch {
      // the browser did not allow reading the clipboard: paste by hand
      window.clearTimeout(slow);
      setTyping(r.id);
    }
  };

  const markBack = (c: Cal, r: Room, done: boolean) =>
    run(() => markReturnLinkAction(c.id, done), {
      onOk: () => {
        void reload();
        if (done) goTo(nextAfter(r.id));
      },
    });

  return (
    <div className="space-y-5">
      {/* progress: how many rooms, in which direction */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="relative overflow-hidden rounded-[1.5rem] p-5 text-white" style={{ background: p.color }}>
        <motion.span aria-hidden="true" className="pointer-events-none absolute -right-14 -top-16 h-52 w-52 rounded-full bg-white/15 blur-3xl" animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0.85, 0.5] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-white/70">Camere collegate</p>
            <p className="serif mt-1 flex items-baseline gap-2 text-[2.6rem] leading-none">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={linkedCount} initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 14, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }}>
                  {data ? linkedCount : '·'}
                </motion.span>
              </AnimatePresence>
              <span className="text-2xl text-white/50">/ {rooms.length || '·'}</span>
            </p>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {all ? (
              <motion.p key="all" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 20 }} className="flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-2 text-[0.78rem] font-semibold">
                <motion.span initial={{ rotate: -90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.1 }} className="flex h-6 w-6 items-center justify-center rounded-full bg-white" style={{ color: p.color }}>
                  <Check className="h-3.5 w-3.5" />
                </motion.span>
                Tutto collegato: le date si aggiornano da sole
              </motion.p>
            ) : next ? (
              <motion.button key={next.id} type="button" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} onClick={() => goTo(next.id)} className="flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-[0.78rem] font-semibold hover:bg-white/25">
                Adesso: camera {next.number} <ArrowRight className="h-3.5 w-3.5" />
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
        <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/20">
          <motion.div className="h-full rounded-full bg-white" initial={{ width: 0 }} animate={{ width: rooms.length ? `${(linkedCount / rooms.length) * 100}%` : 0 }} transition={{ duration: 0.9, ease: EASE }} />
        </div>
        <div className="relative mt-3 grid gap-1 text-[0.72rem] text-white/85 sm:grid-cols-2">
          <span className="flex items-center gap-2">
            <ArrowRight className="h-3.5 w-3.5 shrink-0" /> {p.name} → sito: {linkedCount}/{rooms.length || '·'}
          </span>
          <span className="flex items-center gap-2">
            <ArrowRight className="h-3.5 w-3.5 shrink-0 rotate-180" /> Sito → {p.name}: {publicSite ? `${bothCount}/${rooms.length || '·'}` : 'si accende con l’indirizzo definitivo del sito'}
          </span>
        </div>
      </motion.div>

      {/* how to: open by default until the first room is linked */}
      <div className="rounded-2xl bg-ivory">
        <button type="button" onClick={() => setHowOpen(!showHow)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
          <span className="text-sm font-semibold text-navy">Come si fa (2 minuti a camera)</span>
          <motion.span animate={{ rotate: showHow ? 180 : 0 }} className="text-mist">
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {showHow && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
              <div className="px-4 pb-4">
                <a href={p.open} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-[0_14px_30px_-18px_rgba(16,40,61,0.8)] transition-transform hover:-translate-y-0.5" style={{ background: p.color }}>
                  {p.openLabel} <ExternalLink className="h-4 w-4" />
                </a>
                <ol className="mt-4 space-y-2.5">
                  {[...p.where, publicSite ? 'Il sito copia da solo il suo link: incollalo su ' + p.name + ' in “Importa calendario” della stessa camera e premi “Fatto”.' : null]
                    .filter((s): s is string => Boolean(s))
                    .map((s, i) => (
                      <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + i * 0.06 }} className="flex gap-3 text-sm leading-relaxed text-charcoal/85">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-[0.7rem] font-semibold text-ivory">{i + 1}</span>
                        {s}
                      </motion.li>
                    ))}
                </ol>
                <p className="mt-3 text-[0.75rem] leading-relaxed text-mist">{p.note}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!data ? (
        <p className="flex items-center gap-2 py-6 text-sm text-mist">
          <Loader2 className="h-4 w-4 animate-spin" /> Carico le camere…
        </p>
      ) : (
        <ul className="space-y-2">
          {rooms.map((r, i) => {
            const c = calOf(r.id);
            const s = stateOf(c, publicSite);
            const isNext = next?.id === r.id;
            const working = pending && busy === r.id;
            return (
              <motion.li
                key={r.id}
                ref={(el) => {
                  rows.current[r.id] = el;
                }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 * i }}
                className={cn('relative rounded-2xl border p-3 transition-colors', s.outbound === 'ok' ? 'border-sage/40 bg-sage/[0.06]' : s.linked ? 'border-sage/30 bg-white' : s.inbound === 'bad' ? 'border-terracotta/40 bg-terracotta/[0.04]' : isNext ? 'border-transparent bg-white' : 'border-line bg-white')}
                style={isNext ? { boxShadow: `0 0 0 2px ${p.color}` } : undefined}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className={cn('flex h-9 w-12 items-center justify-center rounded-xl text-sm font-semibold transition-colors', s.linked ? 'bg-sage text-white' : 'bg-navy text-ivory')}>{r.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-navy">{r.name}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <Way tone={s.inbound} label={`${p.name} → sito`} />
                      <Way tone={s.outbound} label={`sito → ${p.name}`} />
                    </span>
                  </span>
                  <AnimatePresence mode="wait" initial={false}>
                    {s.outbound === 'ok' ? (
                      <motion.span key="both" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 20 }} className="flex items-center gap-1 rounded-full bg-sage/15 px-2.5 py-1 text-[0.7rem] font-semibold text-[#3f5a35]">
                        <Check className="h-3.5 w-3.5" /> in entrambe le direzioni
                      </motion.span>
                    ) : s.linked ? (
                      <motion.span key="in" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 20 }} className="flex items-center gap-1 rounded-full bg-sage/15 px-2.5 py-1 text-[0.7rem] font-semibold text-[#3f5a35]">
                        <Check className="h-3.5 w-3.5" /> collegata · {c!.nights} {c!.nights === 1 ? 'notte' : 'notti'}
                      </motion.span>
                    ) : (
                      <motion.button key="go" type="button" initial={{ opacity: 0 }} animate={{ opacity: 1 }} disabled={pending} onClick={() => void pasteAndConnect(r)} className="flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-semibold text-white shadow-[0_10px_24px_-14px_rgba(16,40,61,0.9)] transition-transform hover:-translate-y-0.5 disabled:opacity-50" style={{ background: p.color }}>
                        {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />} {s.inbound === 'bad' ? 'Incolla di nuovo' : 'Incolla e collega'}
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>

                {isNext && !working && (
                  <motion.span initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="absolute -top-2.5 left-4 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-white" style={{ background: p.color }}>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                    </span>
                    adesso
                  </motion.span>
                )}

                {/* the way back, right after the room is linked */}
                <AnimatePresence initial={false}>
                  {c && s.linked && s.outbound === 'todo' && (
                    <motion.div key="back" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
                      <div className="mt-3 rounded-xl border border-dashed p-3 sm:ml-[3.75rem]" style={{ borderColor: `${p.color}55`, background: `${p.color}0a` }}>
                        <p className="text-[0.78rem] font-semibold text-navy">Ultimo passo per la camera {r.number}: il sito → {p.name}</p>
                        <p className="mt-1 text-[0.75rem] leading-relaxed text-charcoal/80">{p.back}</p>
                        <input readOnly value={siteLink(r)} onFocus={(e) => e.currentTarget.select()} aria-label={`Link del sito per ${p.name}, camera ${r.number}`} className="mt-2 h-8 w-full truncate rounded-full border border-line bg-white px-3 text-[0.68rem] text-mist outline-none focus:border-navy" />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" onClick={() => void copySite(r)} className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-navy hover:border-navy">
                            {copied === r.id ? <Check className="h-3.5 w-3.5 text-sage" /> : <Copy className="h-3.5 w-3.5" />} {copied === r.id ? 'Copiato' : 'Copia il link del sito'}
                          </button>
                          <motion.button whileTap={{ scale: 0.96 }} type="button" disabled={pending} onClick={() => markBack(c, r, true)} className="flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-semibold text-white disabled:opacity-50" style={{ background: p.color }}>
                            <Check className="h-3.5 w-3.5" /> Fatto, l’ho incollato
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  {c && s.outbound === 'wait' && (
                    <motion.p key="wait" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 overflow-hidden text-[0.74rem] leading-relaxed text-mist sm:pl-[3.75rem]">
                      Aspettiamo che {p.name} legga il sito per la prima volta (di solito entro qualche ora): non devi fare altro, qui diventa verde da solo.{' '}
                      <button type="button" disabled={pending} onClick={() => markBack(c, r, false)} className="font-semibold text-navy underline underline-offset-2">
                        Non l’ho ancora incollato
                      </button>
                    </motion.p>
                  )}
                </AnimatePresence>

                {c && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.72rem] text-mist sm:pl-[3.75rem]">
                    {c.lastError && (
                      <p className="flex w-full items-start gap-1.5 text-terracotta">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {c.lastError}
                      </p>
                    )}
                    {c.lastSync && <span>aggiornata {fmtDateTime(c.lastSync)}</span>}
                    {c.readAt && <span>· {p.name} ha letto il sito {fmtDateTime(c.readAt)}</span>}
                    <button type="button" disabled={pending} onClick={() => run(() => removeCalendarAction(c.id), { onOk: () => void reload() })} className="flex h-7 items-center gap-1.5 rounded-full px-2.5 font-semibold hover:text-terracotta">
                      <Unplug className="h-3.5 w-3.5" /> Scollega
                    </button>
                    {publicSite && s.outbound !== 'todo' && (
                      <button type="button" onClick={() => void copySite(r)} className="flex h-7 items-center gap-1.5 rounded-full border border-line bg-white px-2.5 font-semibold text-navy hover:border-navy">
                        <Copy className="h-3 w-3" /> link del sito
                      </button>
                    )}
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {(!c || c.lastError) && typing === r.id && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="mt-2 flex gap-2 sm:pl-[3.75rem]">
                        <input autoFocus value={manual[r.id] ?? ''} onChange={(e) => setManual((m) => ({ ...m, [r.id]: e.target.value }))} placeholder={`Incolla qui il link di ${p.name}`} className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3.5 text-xs outline-none focus:border-navy" />
                        <button type="button" disabled={pending || (manual[r.id] ?? '').trim().length < 10} onClick={() => connect(r, manual[r.id] ?? '')} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-navy px-4 text-xs font-semibold text-ivory disabled:opacity-40">
                          <Link2 className="h-3.5 w-3.5" /> Collega
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-3 rounded-2xl border border-line bg-white p-3.5 text-[0.74rem] leading-relaxed text-mist">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-sage" />
        <p>
          Passano solo le date occupate (niente nomi né prezzi). Il sito rilegge {p.name} ogni 15 minuti e ancora un attimo prima di ogni prenotazione fatta sul sito; {p.name} legge il sito ogni qualche ora. Ti avvisiamo su Telegram per ogni nuova prenotazione o cancellazione arrivata da {p.name} e subito se la stessa notte risulta venduta due volte.
        </p>
      </div>
    </div>
  );
}

/** One direction of the link: a coloured dot and a few words. */
function Way({ tone, label }: { tone: 'ok' | 'bad' | 'todo' | 'wait' | 'later'; label: string }) {
  const dot = { ok: 'bg-sage', bad: 'bg-terracotta', todo: 'bg-line', wait: 'bg-gold', later: 'bg-line' }[tone];
  const word = { ok: '', bad: ' · da ricontrollare', todo: '', wait: ' · in attesa', later: ' · presto' }[tone];
  return (
    <span className={cn('flex items-center gap-1.5 text-[0.68rem]', tone === 'ok' ? 'text-[#3f5a35]' : tone === 'bad' ? 'text-terracotta' : 'text-mist')}>
      <span className="relative flex h-1.5 w-1.5">
        {tone === 'wait' && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-70', dot)} />}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', dot)} />
      </span>
      {label}
      {word}
    </span>
  );
}
