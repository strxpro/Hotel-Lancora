'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { MEDIA_CREDITS } from '@/content/media';
import { cn } from '@/lib/utils';
import { useI18n, useLenis } from './providers';

export type LegalKind = 'privacy' | 'cookie' | 'crediti';
type Rect = { left: number; top: number; width: number; height: number };

/** Opens the privacy / cookie / credits popup, morphing out of the element that was clicked. */
export function openLegal(kind: LegalKind, from?: Element | null) {
  const r = from?.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent('legal:open', { detail: { kind, rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null } }));
}

export interface LegalHotel {
  name: string;
  postalCode: string;
  city: string;
  province: string;
  email: string;
  addressLine?: string;
  phone?: string;
  vat?: string;
  /** the cancellation rule, already written in the visitor's language */
  cancel?: { title: string; text: string };
}

const EASE = [0.22, 0.61, 0.12, 1] as const;

export function LegalDialog({ hotel }: { hotel: LegalHotel }) {
  const { t } = useI18n();
  const lenis = useLenis();
  const [state, setState] = useState<{ kind: LegalKind; rect: Rect | null } | null>(null);
  const [box, setBox] = useState({ w: 720, h: 640, l: 0, t: 0 });
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const measure = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(760, vw - 20);
    const h = Math.min(Math.round(vh * 0.86), 820);
    setBox({ w, h, l: (vw - w) / 2, t: Math.max(10, (vh - h) / 2) });
  }, []);

  useEffect(() => {
    setMounted(true);
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ kind: LegalKind; rect: Rect | null }>).detail;
      lastFocus.current = document.activeElement as HTMLElement | null;
      measure();
      setState({ kind: d.kind, rect: d.rect });
    };
    const fromHash = () => {
      const h = window.location.hash.replace('#', '');
      if (h === 'privacy' || h === 'cookie' || h === 'crediti') {
        measure();
        setState({ kind: h, rect: null });
      }
    };
    const onCookies = () => onOpen(new CustomEvent('legal:open', { detail: { kind: 'cookie', rect: null } }));
    window.addEventListener('legal:open', onOpen);
    window.addEventListener('cookies:open', onCookies);
    window.addEventListener('resize', measure);
    fromHash();
    return () => {
      window.removeEventListener('legal:open', onOpen);
      window.removeEventListener('cookies:open', onCookies);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const close = useCallback(() => {
    setState(null);
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    window.setTimeout(() => lastFocus.current?.focus?.({ preventScroll: true }), 500);
  }, []);

  useEffect(() => {
    if (!state) return;
    lenis.current?.stop();
    document.documentElement.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    const f = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 420);
    return () => {
      lenis.current?.start();
      document.documentElement.style.overflow = '';
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(f);
    };
  }, [state, close, lenis]);

  if (!mounted) return null;

  const from = state?.rect;
  const morph = from
    ? { x: from.left + from.width / 2 - (box.l + box.w / 2), y: from.top + from.height / 2 - (box.t + box.h / 2), scaleX: Math.max(0.04, from.width / box.w), scaleY: Math.max(0.03, from.height / box.h), borderRadius: 999, opacity: 1 }
    : { x: 0, y: 40, scaleX: 0.96, scaleY: 0.96, borderRadius: 28, opacity: 0 };

  const tabs: { k: LegalKind; label: string }[] = [
    { k: 'privacy', label: t.footer.privacy },
    { k: 'cookie', label: t.footer.cookies },
    { k: 'crediti', label: t.footer.credits },
  ];

  return createPortal(
    <AnimatePresence>
      {state && (
        <>
          <motion.button key="bg" type="button" aria-label={t.nav.close} tabIndex={-1} onClick={close} className="fixed inset-0 z-[120] cursor-default bg-navy-3/55 backdrop-blur-[5px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35, delay: 0.1 } }} />
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-title"
            data-lenis-prevent
            className="fixed z-[121] flex flex-col overflow-hidden bg-ivory shadow-[0_50px_140px_-40px_rgba(5,15,25,0.8)]"
            style={{ left: box.l, top: box.t, width: box.w, height: box.h, transformOrigin: 'center center' }}
            initial={morph}
            animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, borderRadius: 28, opacity: 1 }}
            exit={{ ...morph, transition: { duration: 0.5, ease: [0.65, 0, 0.35, 1] } }}
            transition={{ duration: 0.65, ease: [0.65, 0, 0.35, 1] }}
          >
            <motion.div className="flex min-h-0 flex-1 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.32, duration: 0.35 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              <header className="flex items-center justify-between gap-3 border-b border-line px-5 pb-3 pt-4 sm:px-7">
                <div className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto rounded-full bg-sand-2/70 p-1">
                  {tabs.map((x) => (
                    <button key={x.k} type="button" onClick={() => setState((s) => (s ? { ...s, kind: x.k } : s))} className={cn('relative shrink-0 rounded-full px-3.5 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] transition-colors', state.kind === x.k ? 'text-ivory' : 'text-navy/70 hover:text-navy')}>
                      {state.kind === x.k && <motion.span layoutId="legal-tab" className="absolute inset-0 rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                      <span className="relative">{x.label}</span>
                    </button>
                  ))}
                </div>
                <button ref={closeRef} type="button" onClick={close} aria-label={t.nav.close} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-ivory transition-transform hover:rotate-90">
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-9 sm:py-8">
                <AnimatePresence mode="wait">
                  <motion.article key={state.kind} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease: EASE }} className="space-y-5 text-[0.97rem] leading-[1.8] text-charcoal/85">
                    {state.kind === 'privacy' && (
                      <>
                        <p className="eyebrow text-gold-2">Informativa ai sensi degli artt. 13–14 del Reg. UE 2016/679 (GDPR)</p>
                        <h2 id="legal-title" className="display text-[clamp(2.2rem,5vw,3.4rem)] text-navy">
                          {t.footer.privacy}
                        </h2>
                        <h3 className="serif pt-2 text-[1.6rem] text-navy">Titolare del trattamento</h3>
                        <p>
                          {hotel.name}
                          {hotel.addressLine ? `, ${hotel.addressLine}` : ''}, {hotel.postalCode} {hotel.city} ({hotel.province})
                          {hotel.vat ? ` · P. IVA ${hotel.vat}` : ''} · {hotel.email}
                          {hotel.phone ? ` · ${hotel.phone}` : ''}
                        </p>
                        <h3 className="serif pt-2 text-[1.6rem] text-navy">Quali dati e perché</h3>
                        <p>Per la prenotazione e il soggiorno trattiamo nome, cognome, email, telefono, date, numero di ospiti, richieste particolari e dati di pagamento (base giuridica: esecuzione del contratto). Al momento dell’arrivo raccogliamo i dati del documento d’identità per la comunicazione obbligatoria all’autorità di pubblica sicurezza e per l’imposta di soggiorno, e conserviamo i documenti contabili come previsto dalla legge (base giuridica: obbligo di legge).</p>
                        <p>Con il tuo consenso, facoltativo e revocabile in qualsiasi momento con il link presente in ogni email, ti inviamo offerte e novità della struttura. Se scrivi dal modulo contatti o in chat usiamo i dati solo per risponderti.</p>
                        <h3 className="serif pt-2 text-[1.6rem] text-navy">Pagamenti e fornitori</h3>
                        <p>I pagamenti con carta sono gestiti da Stripe: la struttura non vede né conserva i dati della carta. Per far funzionare il sito ci affidiamo a fornitori tecnici (archiviazione dei dati in cloud, invio delle email, assistente automatico in chat), nominati responsabili del trattamento; quando un fornitore ha sede fuori dall’Unione Europea il trasferimento avviene con le garanzie previste dal GDPR (clausole contrattuali standard). L’assistente in chat non ha accesso alle prenotazioni.</p>
                        <h3 className="serif pt-2 text-[1.6rem] text-navy">Per quanto tempo</h3>
                        <p>I dati della prenotazione per il tempo necessario al soggiorno e agli adempimenti di legge (i documenti fiscali per 10 anni); i dati per le offerte finché non revochi il consenso; i messaggi per il tempo necessario a rispondere.</p>
                        {hotel.cancel && (
                          <>
                            <h3 id="cancellazione" className="serif pt-2 text-[1.6rem] text-navy">{hotel.cancel.title}</h3>
                            <p>{hotel.cancel.text}</p>
                          </>
                        )}
                        <h3 className="serif pt-2 text-[1.6rem] text-navy">Diritti</h3>
                        <p>Puoi chiedere in qualsiasi momento accesso, rettifica, cancellazione, limitazione o portabilità dei tuoi dati, opporti al trattamento e revocare il consenso scrivendo a {hotel.email}. Hai anche il diritto di presentare reclamo al Garante per la protezione dei dati personali (garanteprivacy.it).</p>
                      </>
                    )}
                    {state.kind === 'cookie' && (
                      <>
                        <p className="eyebrow text-gold-2">{t.cookies.title}</p>
                        <h2 id="legal-title" className="display text-[clamp(2.2rem,5vw,3.4rem)] text-navy">
                          {t.footer.cookies}
                        </h2>
                        <p>{t.cookies.text}</p>
                        <p className="text-sm text-mist">Il sito usa solo archiviazione tecnica (sessione dell’area riservata, preferenze di visualizzazione, animazione introduttiva). Nessun cookie di profilazione, nessun contenuto di terze parti: la mappa è disegnata dal sito con dati © OpenStreetMap (ODbL). Stripe viene caricato solo se scegli di pagare con carta.</p>
                        <button type="button" onClick={close} className="btn btn-navy mt-2 h-11 min-h-0 px-6">
                          {t.cookies.accept}
                        </button>
                      </>
                    )}
                    {state.kind === 'crediti' && (
                      <>
                        <p className="eyebrow text-gold-2">Foto</p>
                        <h2 id="legal-title" className="display text-[clamp(2.2rem,5vw,3.4rem)] text-navy">
                          {t.footer.credits}
                        </h2>
                        <p className="text-sm text-mist">Le foto del territorio provengono da Wikimedia Commons (autori e licenze qui sotto). Le foto degli interni contrassegnate come indicative sono immagini d’archivio e non ritraggono le camere dell’hotel.</p>
                        <ul className="divide-y divide-line border-y border-line text-sm">
                          {MEDIA_CREDITS.map((m) => (
                            <li key={m.src} className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between sm:gap-6">
                              <span className="text-navy">{m.alt}</span>
                              <a href={m.sourceUrl} target="_blank" rel="noopener noreferrer" className="link-u shrink-0 text-mist">
                                {m.credit} · {m.license}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </motion.article>
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
