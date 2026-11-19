'use client';
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, LifeBuoy, Plus, RotateCcw, ShieldCheck, ShieldOff, Trash2, UserRound } from 'lucide-react';
import { fmtDateTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Dialog, Field, Segmented, useAction } from './ui';
import { addUserAction, removeUserAction, resetUserTwoFactorAction, restartSetupAction, setUserPasswordAction, usersOverviewAction } from '@/app/admin/actions/setup';

type Row = { id: string; name: string; email: string; role: 'admin' | 'staff'; me: boolean; owner: boolean; starter: boolean; lastLogin: string | null; twoFactor: boolean };

/**
 * Who can enter the panel. Passwords are never shown (they are not even stored: only a fingerprint):
 * whoever forgets theirs gets a new one from an administrator, here, by phone or in person.
 */
export function AccessCard() {
  const { run, pending } = useAction();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pw, setPw] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState<Row | null>(null);
  const load = useCallback(() => {
    void usersOverviewAction().then((r) => r.ok && r.data && setRows(r.data as Row[]));
  }, []);
  useEffect(() => load(), [load]);
  const me = rows?.find((r) => r.me);
  return (
    <Card
      title="Accessi al pannello"
      action={
        <Button size="sm" variant="line" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Aggiungi
        </Button>
      }
    >
      <p className="mb-4 text-sm text-mist">Chi può entrare e con quale e-mail. Le password non si vedono mai: se qualcuno la dimentica, gliene imposti una nuova da qui.</p>
      <ul className="divide-y divide-line">
        {!rows && <li className="h-16 animate-pulse rounded-xl bg-ivory" />}
        <AnimatePresence initial={false}>
          {rows?.map((r) => (
            <motion.li key={r.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-3 py-3.5">
              <span className={cn('flex h-10 w-10 items-center justify-center rounded-full', r.owner ? 'bg-gold/20 text-navy' : 'bg-navy/[0.06] text-navy')}>{r.owner ? <KeyRound className="h-4 w-4" /> : r.name.toLowerCase().includes('assistenza') ? <LifeBuoy className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold text-navy">
                  {r.name} {r.me && <Badge tone="navy">tu</Badge>} {r.owner && <Badge tone="gold">proprietario</Badge>} {r.starter && <Badge tone="gray">accesso di prova</Badge>}
                  {r.twoFactor && (
                    <Badge tone="green">
                      <ShieldCheck className="h-3 w-3" /> codice dal telefono
                    </Badge>
                  )}
                </span>
                <span className="block truncate text-xs text-mist">
                  {r.email} · {r.role === 'admin' ? 'amministratore' : 'reception'} · {r.lastLogin ? `ultimo accesso ${fmtDateTime(r.lastLogin)}` : 'mai entrato'}
                </span>
              </span>
              <span className="flex gap-1.5">
                <Button size="sm" variant="line" onClick={() => setPw(r)}>
                  Nuova password
                </Button>
                {r.twoFactor && !r.me && (
                  <Button size="sm" variant="line" title="Telefono perso o cambiato: entra con la sola password e riattiva il codice" disabled={pending} onClick={() => setPhone(r)}>
                    <ShieldOff className="h-3.5 w-3.5" /> Togli codice
                  </Button>
                )}
                {!r.me && !r.owner && (
                  <Button size="sm" variant="ghost" aria-label={`Elimina ${r.name}`} disabled={pending} onClick={() => run(() => removeUserAction(r.id), { onOk: load })}>
                    <Trash2 className="h-3.5 w-3.5 text-terracotta" />
                  </Button>
                )}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {me && !me.owner && (
        <div className="mt-5 rounded-2xl border border-line bg-ivory px-4 py-3 text-sm text-charcoal/85">
          <p className="font-semibold text-navy">Consegna del sito</p>
          <p className="mt-1 text-mist">Riporta l’accesso del proprietario a quello di prova: al prossimo ingresso parte di nuovo la configurazione guidata.</p>
          <Button size="sm" variant="line" className="mt-3" disabled={pending} onClick={() => run(() => restartSetupAction(), { onOk: load })}>
            <RotateCcw className="h-3.5 w-3.5" /> Rifai la configurazione iniziale
          </Button>
        </div>
      )}
      <PasswordDialog row={pw} onClose={() => setPw(null)} onDone={load} />
      <AddDialog open={adding} onClose={() => setAdding(false)} onDone={load} />
      <Dialog
        open={Boolean(phone)}
        onClose={() => setPhone(null)}
        title="Togliere il codice dal telefono?"
        width={480}
        footer={
          <>
            <Button variant="line" onClick={() => setPhone(null)}>
              Annulla
            </Button>
            <Button variant="danger" disabled={pending || !phone} onClick={() => phone && run(() => resetUserTwoFactorAction(phone.id), { onOk: () => { setPhone(null); load(); } })}>
              Togli il codice
            </Button>
          </>
        }
      >
        <p className="text-sm text-charcoal/85">
          Per <strong>{phone?.name}</strong> ({phone?.email}). Fallo solo se ha perso o cambiato il telefono e te lo ha chiesto <strong>di persona o al telefono</strong>: potrà entrare con la sola password e riattivare il codice dal nuovo telefono.
        </p>
      </Dialog>
    </Card>
  );
}

function PasswordDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const { run, pending } = useAction();
  const [p, setP] = useState('');
  useEffect(() => setP(''), [row]);
  return (
    <Dialog
      open={Boolean(row)}
      onClose={onClose}
      title="Nuova password"
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Annulla
          </Button>
          <Button disabled={pending || p.length < 10 || !row} onClick={() => row && run(() => setUserPasswordAction(row.id, p), { onOk: () => { onClose(); onDone(); } })}>
            Salva
          </Button>
        </>
      }
    >
      <p className="text-sm text-charcoal/85">
        Per <strong>{row?.name}</strong> ({row?.email}). Comunicala alla persona di persona o al telefono, non per e-mail.
      </p>
      <Field label="Nuova password" className="mt-4" hint="Almeno 10 caratteri.">
        <input className="field" type="text" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" />
      </Field>
    </Dialog>
  );
}

function AddDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { run, pending } = useAction();
  const [f, setF] = useState({ name: '', email: '', role: 'staff' as 'admin' | 'staff', password: '' });
  useEffect(() => {
    if (open) setF({ name: '', email: '', role: 'staff', password: '' });
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nuovo accesso"
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            Annulla
          </Button>
          <Button disabled={pending || f.name.length < 2 || !f.email.includes('@') || f.password.length < 10} onClick={() => run(() => addUserAction(f), { onOk: () => { onClose(); onDone(); } })}>
            Crea l’accesso
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nome">
          <input className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Es. Reception, Assistenza tecnica" />
        </Field>
        <Field label="E-mail">
          <input className="field" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <div>
          <p className="label">Cosa può fare</p>
          <Segmented id="new-user-role" value={f.role} onChange={(v) => setF({ ...f, role: v })} options={[{ value: 'staff', label: 'Reception' }, { value: 'admin', label: 'Tutto (amministratore)' }]} />
        </div>
        <Field label="Password" hint="Almeno 10 caratteri.">
          <input className="field" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        </Field>
      </div>
    </Dialog>
  );
}
