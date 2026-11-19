'use client';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ShieldCheck, Smartphone } from 'lucide-react';
import { cancelLoginCode, login, loginCode, type LoginState } from '@/app/admin/auth-actions';
import { CodeInput } from './code-input';

const EASE = [0.22, 1, 0.36, 1] as const;

export function LoginForm({ next }: { next: string }) {
  const [pw, pwAction, pwPending] = useActionState(login, undefined);
  const [cs, codeAction, codePending] = useActionState(loginCode, undefined);
  const [view, setView] = useState<'password' | 'code'>('password');
  const [notice, setNotice] = useState<string | null>(null);

  // the password was right and the login has the phone code: second step
  useEffect(() => {
    if (pw?.step === 'code') {
      setView('code');
      setNotice(null);
    }
  }, [pw]);
  // the 5 minutes for the code ran out: back to the password, with the reason
  useEffect(() => {
    if (cs && !cs.step && cs.error) {
      setView('password');
      setNotice(cs.error);
    }
  }, [cs]);

  const error = view === 'password' ? (notice ?? (pw?.step ? undefined : pw?.error)) : cs?.step === 'code' ? cs.error : undefined;
  return (
    <div className="relative mt-10">
      <AnimatePresence mode="wait" initial={false}>
        {view === 'password' ? (
          <motion.form key="pw" action={(f) => { setNotice(null); pwAction(f); }} className="space-y-5" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.35, ease: EASE }}>
            <input type="hidden" name="next" value={next} />
            <label className="block">
              <span className="label">Login / Email</span>
              <input name="email" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} className="field" />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input name="password" type="password" required autoComplete="current-password" className="field" />
            </label>
            {error && (
              <p role="alert" className="text-sm text-terracotta">
                {error}
              </p>
            )}
            <button type="submit" disabled={pwPending} className="btn btn-navy w-full">
              {pwPending ? 'Accesso…' : 'Accedi'}
            </button>
          </motion.form>
        ) : (
          <CodeStep key="code" next={next} name={pw?.name} action={codeAction} pending={codePending} error={error} attempt={cs} onBack={() => setView('password')} />
        )}
      </AnimatePresence>
    </div>
  );
}

function CodeStep({ next, name, action, pending, error, attempt, onBack }: { next: string; name?: string; action: (f: FormData) => void; pending: boolean; error?: string; attempt: LoginState; onBack: () => void }) {
  const form = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState('');
  const [rescue, setRescue] = useState(false);
  const [shake, setShake] = useState(0);
  const [, startBack] = useTransition();
  const seen = useRef(attempt);
  // a wrong code: the boxes shake and empty, ready for the next one (not for an answer from before)
  useEffect(() => {
    if (attempt === seen.current) return;
    seen.current = attempt;
    if (attempt?.step === 'code' && attempt.error) {
      setShake((s) => s + 1);
      setCode('');
    }
  }, [attempt]);
  return (
    <motion.form ref={form} action={action} className="space-y-5" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.35, ease: EASE }}>
      <input type="hidden" name="next" value={next} />
      <div className="flex items-start gap-3">
        <motion.span initial={{ scale: 0.6, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.1 }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-navy text-gold">
          {rescue ? <ShieldCheck className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
        </motion.span>
        <div>
          <p className="font-semibold text-navy">{name ? `Ciao ${name}, ultimo passaggio` : 'Ultimo passaggio'}</p>
          <p className="mt-0.5 text-sm text-mist">{rescue ? 'Scrivi uno dei codici di emergenza che hai salvato (ognuno vale una volta sola).' : 'Apri l’app Authenticator sul telefono e scrivi il codice di 6 cifre di «Hotel L’Ancora».'}</p>
        </div>
      </div>
      {rescue ? (
        <label className="block">
          <span className="label">Codice di emergenza</span>
          <input name="code" required autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="xxxxx-xxxxx" className="field font-mono tracking-[0.12em]" />
        </label>
      ) : (
        <CodeInput name="code" value={code} onChange={setCode} onComplete={() => window.setTimeout(() => form.current?.requestSubmit(), 120)} disabled={pending} shake={shake} autoFocus />
      )}
      <label className="flex cursor-pointer items-start gap-3 text-sm text-charcoal/85">
        <input type="checkbox" name="trust" className="mt-0.5 h-4 w-4 accent-[#10283d]" />
        <span>Non chiedere il codice su questo dispositivo per 30 giorni <span className="block text-xs text-mist">Solo su un computer o telefono tuo, non condiviso.</span></span>
      </label>
      <AnimatePresence>
        {error && (
          <motion.p key={error} role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm text-terracotta">
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <button type="submit" disabled={pending || (!rescue && code.length !== 6)} className="btn btn-navy w-full">
        {pending ? 'Controllo…' : 'Entra'}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <button type="button" onClick={() => startBack(async () => { await cancelLoginCode(); onBack(); })} className="inline-flex items-center gap-1.5 text-mist transition-colors hover:text-navy">
          <ArrowLeft className="h-4 w-4" /> Indietro
        </button>
        <button type="button" onClick={() => { setRescue((r) => !r); setCode(''); }} className="font-semibold text-navy underline decoration-gold/60 underline-offset-4 hover:decoration-navy">
          {rescue ? 'Usa il codice dell’app' : 'Telefono perso? Usa un codice di emergenza'}
        </button>
      </div>
    </motion.form>
  );
}
