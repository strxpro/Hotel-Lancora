'use client';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, Copy, Download, KeyRound, Printer, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { fmtDateTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Dialog, Field, useAction, useToast } from './ui';
import { CodeInput } from './code-input';
import { twoFactorConfirmAction, twoFactorDisableAction, twoFactorNewCodesAction, twoFactorStartAction } from '@/app/admin/actions/two-factor';

export type TwoFactorStatus = { enabledAt: string; recoveryLeft: number; moved: boolean } | null;

const EASE = [0.22, 1, 0.36, 1] as const;
const STORES = [
  { label: 'iPhone (App Store)', href: 'https://apps.apple.com/app/google-authenticator/id388497605' },
  { label: 'Android (Google Play)', href: 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2' },
];

/**
 * "Codice dal telefono" (two-step login). Off: one button and a guided set-up in four short steps.
 * On: since when, how many emergency codes are left, new codes, turn off.
 */
export function TwoFactorCard({ status, usedRescue }: { status: TwoFactorStatus; usedRescue: number | null }) {
  const [setup, setSetup] = useState(false);
  const [ask, setAsk] = useState<'off' | 'codes' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const on = Boolean(status);
  return (
    <div id="sicurezza" className="scroll-mt-28">
      <Card title="Codice dal telefono" action={on ? <Badge tone="green"><ShieldCheck className="h-3 w-3" /> attivo</Badge> : <Badge tone="gray">non attivo</Badge>}>
        <AnimatePresence>
          {usedRescue !== null && on && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-navy">
              Sei entrato con un codice di emergenza: ne {usedRescue === 1 ? 'resta 1' : `restano ${usedRescue}`}. Se hai perso il telefono, disattiva il codice e riattivalo con quello nuovo.
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-start gap-4">
          <motion.span
            className={cn('relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl', on ? 'bg-navy text-gold' : 'bg-navy/[0.06] text-navy')}
            initial={false}
            animate={on ? { rotate: [0, -8, 8, 0], scale: [1, 1.08, 1] } : { rotate: 0, scale: 1 }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            {on ? <ShieldCheck className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}
            {on && <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-white bg-sage" />}
          </motion.span>
          <div className="min-w-0 flex-1">
            {on ? (
              <>
                <p className="font-semibold text-navy">Il tuo accesso è protetto anche dal telefono</p>
                <p className="mt-1 text-sm text-mist">Attivo dal {fmtDateTime(status!.enabledAt)}. Chi scopre la password non può entrare senza il tuo telefono.</p>
                <p className={cn('mt-2 text-sm', status!.recoveryLeft <= 2 ? 'font-semibold text-terracotta' : 'text-charcoal/80')}>
                  Codici di emergenza rimasti: {status!.recoveryLeft} di 8{status!.recoveryLeft <= 2 && ' — creane di nuovi'}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-navy">Proteggi l’accesso con il tuo telefono</p>
                <p className="mt-1 text-sm text-mist">Oltre alla password, all’accesso ti chiederemo un codice di 6 cifre che appare sul telefono e cambia ogni 30 secondi. Anche chi scopre la password non può entrare.</p>
              </>
            )}
          </div>
        </div>
        {status?.moved && (
          <p className="mt-4 flex items-start gap-2 rounded-2xl border border-terracotta/30 bg-terracotta/[0.06] px-4 py-3 text-sm text-terracotta">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Il sito è stato spostato su un nuovo server e i codici dell’app non valgono più qui: disattiva il codice e riattivalo (2 minuti).
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {on ? (
            <>
              <Button size="sm" variant="line" onClick={() => setAsk('codes')}>
                <KeyRound className="h-3.5 w-3.5" /> Nuovi codici di emergenza
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAsk('off')}>
                <ShieldOff className="h-3.5 w-3.5" /> Disattiva
              </Button>
            </>
          ) : (
            <Button onClick={() => setSetup(true)}>
              <ShieldCheck className="h-4 w-4" /> Attiva · 2 minuti
            </Button>
          )}
        </div>
      </Card>
      <SetupDialog open={setup} onClose={() => setSetup(false)} />
      <PasswordDialog
        mode={ask}
        onClose={() => setAsk(null)}
        onCodes={(c) => {
          setAsk(null);
          setCodes(c);
        }}
      />
      <Dialog open={Boolean(codes)} onClose={() => setCodes(null)} title="Nuovi codici di emergenza" width={520}>
        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
      </Dialog>
    </div>
  );
}

/* ---------------- the guided set-up ---------------- */

type Start = { qr: string; key: string; account: string; token: string };

function SetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { run, pending } = useAction();
  const [step, setStep] = useState(0);
  const [start, setStart] = useState<Start | null>(null);
  const [code, setCode] = useState('');
  const [shake, setShake] = useState(0);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [manual, setManual] = useState(false);
  const loading = useRef(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setStart(null);
    setCode('');
    setCodes(null);
    setManual(false);
  }, [open]);
  // the QR is prepared while the person reads the first step
  useEffect(() => {
    if (!open || start || loading.current) return;
    loading.current = true;
    void twoFactorStartAction()
      .then((r) => {
        if (r.ok && r.data) setStart(r.data as Start);
        else if (!r.ok) {
          toast('error', r.error);
          onClose();
        }
      })
      .finally(() => {
        loading.current = false;
      });
  }, [open, start, toast, onClose]);

  const confirm = (c: string) => {
    if (!start) return;
    run(() => twoFactorConfirmAction(start.token, c), {
      onOk: (d) => {
        setCodes((d as { recovery: string[] }).recovery);
        setStep(3);
      },
    });
  };
  // a wrong code comes back as an error toast: shake and empty the boxes
  const wrong = useRef(false);
  useEffect(() => {
    if (pending) wrong.current = true;
    else if (wrong.current && step === 2) {
      wrong.current = false;
      setShake((s) => s + 1);
      setCode('');
    }
  }, [pending, step]);

  const titles = ['Scarica l’app', 'Inquadra il codice QR', 'Scrivi il codice', 'Fatto!'];
  return (
    <Dialog open={open} onClose={onClose} title={titles[step]} width={520}>
      <div className="mb-5 flex items-center gap-1.5" aria-hidden>
        {titles.map((_, i) => (
          <motion.span key={i} className="h-1.5 rounded-full" initial={false} animate={{ width: i === step ? 28 : 10, backgroundColor: i <= step ? '#10283d' : '#e3dccd' }} transition={{ duration: 0.35, ease: EASE }} />
        ))}
        <span className="ml-auto text-xs text-mist">
          Passo {step + 1} di 4
        </span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.3, ease: EASE }}>
          {step === 0 && (
            <div>
              <p className="text-sm text-charcoal/85">
                Sul telefono installa <strong>Google Authenticator</strong> (gratis). Va bene anche Microsoft Authenticator o un’altra app per i codici che hai già.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {STORES.map((s) => (
                  <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-navy transition-colors hover:border-navy">
                    <Smartphone className="h-4 w-4 text-gold-2" /> {s.label}
                  </a>
                ))}
              </div>
              <Button className="mt-6 w-full" onClick={() => setStep(1)}>
                Ce l’ho, avanti
              </Button>
            </div>
          )}
          {step === 1 && (
            <div>
              <p className="text-sm text-charcoal/85">Nell’app tocca <strong>+</strong> e poi <strong>«Scansiona un codice QR»</strong>, e inquadra questo:</p>
              <div className="relative mx-auto mt-4 aspect-square w-full max-w-[240px] overflow-hidden rounded-3xl border border-line bg-white p-3">
                {start ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made on the server */}
                    <motion.img src={start.qr} alt="Codice QR da inquadrare con l’app" className="h-full w-full" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: EASE }} />
                    <motion.span className="pointer-events-none absolute inset-x-3 h-[2px] rounded-full bg-gold shadow-[0_0_18px_4px_rgba(197,166,116,0.55)]" initial={{ top: '8%' }} animate={{ top: ['8%', '90%', '8%'] }} transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }} />
                  </>
                ) : (
                  <span className="block h-full w-full animate-pulse rounded-2xl bg-ivory" />
                )}
              </div>
              <button type="button" onClick={() => setManual((m) => !m)} className="mx-auto mt-4 block text-sm font-semibold text-navy underline decoration-gold/60 underline-offset-4">
                {manual ? 'Nascondi la chiave' : 'Non riesci a inquadrarlo? Scrivi la chiave a mano'}
              </button>
              <AnimatePresence>
                {manual && start && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mt-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm">
                      <p className="text-xs text-mist">Nell’app: «Inserisci una chiave di configurazione». Nome: Hotel L’Ancora · Chiave:</p>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="min-w-0 flex-1 break-all font-mono text-[0.95rem] tracking-[0.08em] text-navy">{start.key}</code>
                        <Button size="sm" variant="line" aria-label="Copia la chiave" onClick={() => void navigator.clipboard?.writeText(start.key.replace(/\s/g, '')).then(() => toast('ok', 'Chiave copiata.'))}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mt-6 flex gap-2">
                <Button variant="line" onClick={() => setStep(0)}>
                  Indietro
                </Button>
                <Button className="flex-1" disabled={!start} onClick={() => setStep(2)}>
                  Fatto, avanti
                </Button>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <p className="mb-4 text-sm text-charcoal/85">
                Nell’app è comparso <strong>Hotel L’Ancora</strong> con un codice di 6 cifre. Scrivilo qui:
              </p>
              <CodeInput value={code} onChange={setCode} onComplete={confirm} disabled={pending} shake={shake} autoFocus />
              <div className="mt-6 flex gap-2">
                <Button variant="line" onClick={() => setStep(1)}>
                  Indietro
                </Button>
                <Button className="flex-1" disabled={pending || code.length !== 6} onClick={() => confirm(code)}>
                  {pending ? 'Controllo…' : 'Attiva'}
                </Button>
              </div>
            </div>
          )}
          {step === 3 && codes && (
            <div>
              <div className="mb-5 flex items-center gap-3">
                <motion.span initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 16 }} className="flex h-12 w-12 items-center justify-center rounded-full bg-sage text-white">
                  <Check className="h-6 w-6" strokeWidth={3} />
                </motion.span>
                <p className="text-sm text-charcoal/85">
                  <strong className="text-navy">Codice dal telefono attivo.</strong> Ultima cosa: salva questi codici di emergenza.
                </p>
              </div>
              <RecoveryCodes codes={codes} onDone={onClose} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Dialog>
  );
}

/* ---------------- emergency codes: shown once ---------------- */

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const text = `Hotel L’Ancora — codici di emergenza per il pannello\nOgni codice vale una volta sola. Servono se perdi o cambi il telefono.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'codici-emergenza-lancora.txt' });
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const print = () => {
    const w = window.open('', '_blank', 'width=520,height=640');
    if (!w) return toast('error', 'Il browser ha bloccato la finestra di stampa: usa «Scarica».');
    const doc = w.document;
    doc.title = 'Codici di emergenza';
    const pre = doc.createElement('pre');
    pre.textContent = text;
    pre.style.cssText = 'font:16px/1.7 ui-monospace,monospace;padding:32px;white-space:pre-wrap';
    doc.body.appendChild(pre);
    w.focus();
    w.print();
  };
  return (
    <div>
      <p className="text-sm text-mist">Se perdi o cambi il telefono, entri con uno di questi (ognuno vale una volta). Tienili in un posto sicuro: stampati o in un file, non sul telefono stesso. Non li mostreremo più.</p>
      <ol className="mt-4 grid grid-cols-2 gap-2">
        {codes.map((c, i) => (
          <motion.li key={c} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.3, ease: EASE }} className="rounded-xl border border-line bg-white px-3 py-2 text-center font-mono text-[0.95rem] tracking-[0.06em] text-navy">
            {c}
          </motion.li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="line" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast('ok', 'Codici copiati.'))}>
          <Copy className="h-3.5 w-3.5" /> Copia
        </Button>
        <Button size="sm" variant="line" onClick={download}>
          <Download className="h-3.5 w-3.5" /> Scarica
        </Button>
        <Button size="sm" variant="line" onClick={print}>
          <Printer className="h-3.5 w-3.5" /> Stampa
        </Button>
      </div>
      <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm text-charcoal/85">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 accent-[#10283d]" />
        Li ho salvati in un posto sicuro
      </label>
      <Button className="mt-4 w-full" disabled={!saved} onClick={onDone}>
        Fatto
      </Button>
    </div>
  );
}

/* ---------------- password check: new codes / turn off ---------------- */

function PasswordDialog({ mode, onClose, onCodes }: { mode: 'off' | 'codes' | null; onClose: () => void; onCodes: (c: string[]) => void }) {
  const { run, pending } = useAction();
  const [pw, setPw] = useState('');
  useEffect(() => setPw(''), [mode]);
  const go = () => {
    if (mode === 'off') run(() => twoFactorDisableAction(pw), { onOk: onClose });
    if (mode === 'codes') run(() => twoFactorNewCodesAction(pw), { onOk: (d) => onCodes((d as { recovery: string[] }).recovery) });
  };
  return (
    <Dialog
      open={mode !== null}
      onClose={onClose}
      title={mode === 'off' ? 'Disattivare il codice?' : 'Nuovi codici di emergenza'}
      width={460}
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Annulla
          </Button>
          <Button variant={mode === 'off' ? 'danger' : 'navy'} disabled={pending || !pw} onClick={go}>
            {mode === 'off' ? 'Disattiva' : 'Crea i codici'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-charcoal/85">{mode === 'off' ? 'Per entrare basterà di nuovo la sola password. Puoi riattivarlo quando vuoi.' : 'I codici di emergenza di prima smetteranno di funzionare.'}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pw && !pending) go();
        }}
      >
        <Field label="La tua password" className="mt-4">
          <input className="field" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus />
        </Field>
      </form>
    </Dialog>
  );
}
