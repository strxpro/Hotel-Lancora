'use client';
import { useRef } from 'react';
import { motion } from 'motion/react';
import { Trash2 } from 'lucide-react';
import type { Booking } from '@/lib/types';
import { fmtDate, todayISO } from '@/lib/dates';
import { cn, money, notti } from '@/lib/utils';
import { Button, Dialog, useAction } from './ui';
import { deleteBookingAction } from '@/app/admin/actions/bookings';

/** What the bin needs to say about a booking (from the list of Prenotazioni or from the guest card). */
export interface DeleteTarget {
  id: string;
  guest: string;
  code: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  /** room name or "camera 12", when there is one */
  room: string | null;
  total: number;
  amountPaid: number;
  status: Booking['status'];
  active: boolean;
}

/** The bin on a booking, in red so it is found at once ("Elimina" written beside it where there is room); a little shake on hover. */
export function BinButton({ onClick, label, className, text = false }: { onClick: (e: React.MouseEvent) => void; label: string; className?: string; text?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      title="Elimina"
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.9 }}
      className={cn(
        'group/bin inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-terracotta/35 bg-terracotta/[0.06] text-terracotta transition-colors hover:border-terracotta hover:bg-terracotta hover:text-white focus-visible:border-terracotta',
        text ? 'px-3.5 text-xs font-semibold' : 'w-9',
        className,
      )}
    >
      <Trash2 className="h-4 w-4 transition-transform duration-300 group-hover/bin:-rotate-12" />
      {text && <span>Elimina</span>}
    </motion.button>
  );
}

/** "Eliminare la prenotazione?": what goes away with it, said plainly, before it really goes. */
export function DeleteBookingDialog({ row, onClose, onDeleted }: { row: DeleteTarget | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const { run, pending } = useAction();
  // keeps the text while the window slides away
  const last = useRef(row);
  if (row) last.current = row;
  const r = last.current;
  const stillOn = Boolean(r && r.active && r.checkOut > todayISO());
  const lines = r
    ? [
        { text: 'Sparisce dall’elenco, dal planning e dalle statistiche, insieme ai pagamenti registrati, alle email e ai messaggi di questa prenotazione.', tone: '' },
        ...(stillOn ? [{ text: 'Le notti tornano libere sul sito. L’ospite non riceve nessuna email: se deve saperlo, usa invece “Annulla prenotazione”.', tone: '' }] : []),
        // money still held for a stay that will not happen (a past stay was paid for what it was)
        ...(r.amountPaid > 0 && (stillOn || r.status === 'cancelled')
          ? [{ text: `Ha già versato ${money(r.amountPaid, 'it', 2)}: eliminandola non viene restituito nulla. Per restituire i soldi usa prima ${r.status === 'cancelled' ? '“Rimborsa”' : '“Annulla prenotazione”'}.`, tone: 'warn' }]
          : []),
        { text: 'Non si può tornare indietro.', tone: 'strong' },
      ]
    : [];
  return (
    <Dialog
      open={Boolean(row)}
      onClose={onClose}
      title="Eliminare la prenotazione?"
      width={520}
      footer={
        <>
          <Button variant="line" onClick={onClose}>
            No, tienila
          </Button>
          <Button variant="danger" disabled={pending || !row} onClick={() => row && run(() => deleteBookingAction(row.id), { onOk: () => onDeleted(row.id) })}>
            <Trash2 className="h-4 w-4" /> {pending ? 'Elimino…' : 'Sì, elimina'}
          </Button>
        </>
      }
    >
      {r && (
        <div data-testid="delete-booking">
          <div className="flex items-center gap-4">
            <motion.span
              initial={{ scale: 0.5, rotate: -18, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-terracotta/10 text-terracotta"
              aria-hidden="true"
            >
              <motion.span className="flex" animate={{ rotate: [0, -12, 10, -6, 0] }} transition={{ delay: 0.6, duration: 0.6, repeat: Infinity, repeatDelay: 2.6 }}>
                <Trash2 className="h-7 w-7" />
              </motion.span>
            </motion.span>
            <div className="min-w-0">
              <p className="serif truncate text-[1.35rem] leading-tight text-navy">{r.guest}</p>
              <p className="text-sm text-charcoal/85">
                {fmtDate(r.checkIn, 'it', { day: 'numeric', month: 'long' })} → {fmtDate(r.checkOut, 'it', { day: 'numeric', month: 'long', year: 'numeric' })} · {notti(r.nights)}
                {r.room ? ` · ${r.room}` : ''}
              </p>
              <p className="text-xs text-mist">
                {r.code} · {money(r.total, 'it', 2)}
              </p>
            </div>
          </div>
          <ul className="mt-5 space-y-2.5">
            {lines.map((l, i) => (
              <motion.li
                key={l.text}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.08, duration: 0.4 }}
                className={cn('flex gap-2.5 text-sm leading-relaxed', l.tone === 'warn' ? 'rounded-2xl bg-terracotta/10 px-3 py-2 text-terracotta' : l.tone === 'strong' ? 'font-semibold text-navy' : 'text-charcoal/85')}
              >
                {l.tone !== 'warn' && <span className={cn('mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full', l.tone === 'strong' ? 'bg-terracotta' : 'bg-gold')} />}
                {l.text}
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
