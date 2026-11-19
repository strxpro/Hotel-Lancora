'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Banknote, BedDouble, Camera, CreditCard, EyeOff, ImagePlus, Pencil, Plus, Star, Trash2, Wallet } from 'lucide-react';
import { fmtDate } from '@/lib/dates';
import { NiceSelect } from './nice-select';
import type { Feedback, Room, RoomStatus } from '@/lib/types';
import { ReviewsManager } from './reviews-manager';
import { cn, money, ospiti } from '@/lib/utils';
import { Badge, Button, Dialog, Drawer, Segmented, StickyBar, Toggle, useAction } from './ui';
import { deleteRoomAction, setPriceAction, setRoomPaymentAction, setVisibilityAction } from '@/app/admin/actions/rooms';

/** What a room is doing: the next 30 nights, the guest in it now, the next one, nights sold this month. */
export type RoomStats = { occ30: number; month: number; next: { date: string; guest: string } | null; now: string | null };

const FLOOR: Record<string, string> = { terra: 'Piano terra', superiore: 'Piano superiore', inferiore: 'Piano inferiore' };
const TYPE: Record<string, string> = { singola: 'Singola', doppia: 'Doppia', matrimoniale: 'Matrimoniale', tripla: 'Tripla', family: 'Family', suite: 'Junior suite' };

type HotelPay = { online: boolean; cash: boolean };

export function RoomsList({ rooms, canPrice, feedback = [], canReviews = false, canDelete = false, stats = {}, hotelPay = { online: true, cash: true } }: { rooms: Room[]; canPrice: boolean; feedback?: Feedback[]; canReviews?: boolean; canDelete?: boolean; stats?: Record<string, RoomStats>; hotelPay?: HotelPay }) {
  const [floor, setFloor] = useState<'all' | 'terra' | 'superiore' | 'inferiore'>('all');
  const [reviewsOf, setReviewsOf] = useState<Room | null>(null);
  const adminRooms = rooms.map((r) => ({ id: r.id, number: r.number, name: r.name }));
  const list = rooms.filter((r) => floor === 'all' || r.floor === floor);
  const live = rooms.filter((r) => r.status === 'available' && !r.hidden);
  const occ = rooms.length ? Math.round(rooms.reduce((sum, r) => sum + (stats[r.id]?.occ30 ?? 0), 0) / rooms.length) : 0;
  const avg = live.length ? live.reduce((sum, r) => sum + r.basePrice, 0) / live.length : 0;
  const busy = rooms.filter((r) => stats[r.id]?.now).length;
  return (
    <div>
      {/* the rooms at a glance */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { k: 'Sul sito', v: `${live.length} / ${rooms.length}`, s: 'camere prenotabili' },
          { k: 'Occupate stanotte', v: String(busy), s: busy === 1 ? 'camera con un ospite' : 'camere con un ospite' },
          { k: 'Prossimi 30 giorni', v: `${occ}%`, s: 'notti già vendute' },
          { k: 'Prezzo medio', v: money(avg), s: 'a notte, camere sul sito' },
        ].map((x, i) => (
          <motion.div key={x.k} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="rounded-[1.4rem] border border-line bg-white px-5 py-4">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-mist">{x.k}</p>
            <p className="serif mt-1 text-[1.9rem] leading-none text-navy">{x.v}</p>
            <p className="mt-1 text-xs text-mist">{x.s}</p>
          </motion.div>
        ))}
      </div>
      <StickyBar className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented id="floor" value={floor} onChange={setFloor} options={[{ value: 'all', label: 'Tutte' }, { value: 'terra', label: 'Piano terra' }, { value: 'superiore', label: 'Piano superiore' }, ...(rooms.some((r) => r.floor === 'inferiore') ? [{ value: 'inferiore' as const, label: 'Inferiore' }] : [])]} />
        <Link href="/admin/camere/nuova" data-tour="room-add" className="inline-flex h-11 items-center gap-2 rounded-full bg-navy px-5 text-[0.8rem] font-semibold text-ivory transition-transform active:scale-95">
          <Plus className="h-4 w-4" /> Aggiungi camera
        </Link>
      </div>
      </StickyBar>
      <ul data-tour="rooms-list" className="grid gap-3 xl:grid-cols-2">
        {list.map((r) => (
          <RoomRow key={r.id} room={r} canPrice={canPrice} canDelete={canDelete} stats={stats[r.id]} hotelPay={hotelPay} reviews={feedback.filter((f) => f.roomId === r.id)} onReviews={canReviews ? () => setReviewsOf(r) : undefined} />
        ))}
      </ul>
      <Drawer open={Boolean(reviewsOf)} onClose={() => setReviewsOf(null)} title={reviewsOf ? `Recensioni · camera ${reviewsOf.number} ${reviewsOf.name}` : ''}>
        {reviewsOf && <ReviewsManager feedback={feedback} rooms={adminRooms} roomId={reviewsOf.id} />}
      </Drawer>
    </div>
  );
}

const PAY = [
  { v: 'card', label: 'Carta', title: 'Solo carta: pagamento online sul sito', icon: CreditCard },
  { v: 'cash', label: 'Contanti', title: 'Solo contanti: si paga in hotel all’arrivo', icon: Banknote },
  { v: 'both', label: 'Entrambi', title: 'Carta o contanti: sceglie l’ospite', icon: Wallet },
] as const;

/** Card or cash for this room, one click, with what the hotel-wide settings allow. */
function PaySwitch({ room, hotelPay }: { room: Room; hotelPay: HotelPay }) {
  const { run, pending } = useAction();
  const [pay, setPay] = useState<'both' | 'card' | 'cash'>(room.payment ?? 'both');
  const choose = (v: 'both' | 'card' | 'cash') => {
    if (v === pay) return;
    const prev = pay;
    setPay(v);
    run(async () => {
      const r = await setRoomPaymentAction(room.id, v);
      if (!r.ok) setPay(prev);
      return r;
    });
  };
  const warn = pay === 'cash' && !hotelPay.cash ? 'In Pagamenti i contanti sono spenti: per ora vale l’impostazione generale.' : pay === 'card' && !hotelPay.online ? 'In Pagamenti la carta online è spenta: per ora vale l’impostazione generale.' : null;
  return (
    <div className="mt-3">
      <div role="radiogroup" aria-label={`Come si paga la camera ${room.number}`} className="relative inline-flex rounded-full bg-ivory p-1 ring-1 ring-line">
        {PAY.map((o) => {
          const on = pay === o.v;
          return (
            <button key={o.v} type="button" role="radio" aria-checked={on} title={o.title} disabled={pending} onClick={() => choose(o.v)} className={cn('relative z-[1] flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.72rem] font-semibold transition-colors', on ? 'text-ivory' : 'text-navy/70 hover:text-navy')}>
              {on && <motion.span layoutId={`pay-${room.id}`} className="absolute inset-0 -z-[1] rounded-full bg-navy" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <o.icon className={cn('h-3.5 w-3.5', on ? 'text-gold' : 'text-gold-2')} />
              {o.label}
            </button>
          );
        })}
      </div>
      {warn && <p className="mt-1.5 text-[0.7rem] text-terracotta">{warn}</p>}
    </div>
  );
}

/** The room's photo in the list: rounded, the second photo on hover, how many photos, demo label. */
function RoomPhoto({ room: r }: { room: Room }) {
  const [a, b] = r.photos;
  return (
    <Link href={`/admin/camere/${r.id}`} aria-label={`Foto e dettagli camera ${r.number}`} className="group/photo relative block aspect-[4/3] self-start overflow-hidden rounded-[1.1rem] bg-sand ring-1 ring-line">
      {a ? (
        <>
          <Image src={a.src} alt="" fill sizes="(min-width:640px) 176px, 112px" className="object-cover transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.22,0.61,0.12,1)] group-hover/photo:scale-[1.06]" />
          {b && <Image src={b.src} alt="" fill sizes="(min-width:640px) 176px, 112px" className="object-cover opacity-0 transition-opacity duration-700 group-hover/photo:opacity-100" />}
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-navy-3/60 to-transparent" />
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-navy-3/70 px-2 py-0.5 text-[0.62rem] font-semibold text-ivory backdrop-blur">
            <Camera className="h-3 w-3" /> {r.photos.length}
          </span>
          {r.photos.some((p) => p.demo) && <span className="absolute right-1.5 top-1.5 rounded-full bg-ivory/90 px-2 py-0.5 text-[0.56rem] font-bold uppercase tracking-[0.1em] text-mist">demo</span>}
        </>
      ) : (
        <span className="flex h-full flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold text-navy">
          <ImagePlus className="h-5 w-5 text-gold-2" /> Aggiungi foto
        </span>
      )}
    </Link>
  );
}

const STATUS: { value: RoomStatus; label: string; dot: string; hint: string }[] = [
  { value: 'available', label: 'Disponibile', dot: '#7A8C6E', hint: 'Prenotabile sul sito' },
  { value: 'unavailable', label: 'Non disponibile', dot: '#C0674B', hint: 'Chiusa: nessuno può prenotarla' },
  { value: 'draft', label: 'Bozza', dot: '#B69562', hint: 'Ancora da completare' },
];

function RoomRow({ room: r, canPrice, canDelete, stats, reviews, onReviews, hotelPay }: { room: Room; canPrice: boolean; canDelete: boolean; stats?: RoomStats; reviews: Feedback[]; onReviews?: () => void; hotelPay: HotelPay }) {
  const [del, setDel] = useState(false);
  const pub = reviews.filter((f) => !f.pending);
  const avg = pub.length ? pub.reduce((sum, f) => sum + f.rating, 0) / pub.length : 0;
  const waiting = reviews.filter((f) => f.pending).length;
  const { run, pending } = useAction();
  const [price, setPrice] = useState(String(r.basePrice));
  const langs = (['en', 'pl', 'de', 'fr', 'es'] as const).map((l) => ({ l, s: r.translations[l]?.status ?? 'da_tradurre', live: Boolean(r.translations[l]?.published) }));
  return (
    <li className={cn('relative grid grid-cols-[112px_1fr] gap-4 rounded-[1.6rem] border border-line bg-white p-3 pb-12 transition-shadow hover:shadow-[0_22px_50px_-36px_rgba(16,40,61,0.55)] sm:grid-cols-[176px_1fr] sm:pb-3 2xl:grid-cols-[176px_1fr_150px]', r.status === 'draft' && 'border-dashed')}>
      <RoomPhoto room={r} />
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-baseline gap-2">
              <span className="serif text-[1.7rem] leading-none text-navy">{r.number}</span>
              <span className="truncate text-sm text-charcoal">{r.name}</span>
            </p>
            <p className="mt-1 text-xs text-mist">
              {TYPE[r.type]} · {ospiti(r.maxGuests)} · {FLOOR[r.floor]}
              {r.size ? ` · ${r.size} m²` : ''}
            </p>
            <button type="button" disabled={!onReviews} onClick={onReviews} className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-ivory px-2.5 py-1 text-xs text-navy transition-colors hover:bg-sand-2 disabled:cursor-default" title="Vedi e gestisci le recensioni">
              <Star className="h-3.5 w-3.5 text-gold" fill="currentColor" />
              {pub.length ? <b>{avg.toFixed(1).replace('.', ',')}</b> : 'nessuna'}
              <span className="text-mist">({pub.length} recensioni)</span>
              {waiting > 0 && <span className="rounded-full bg-gold px-1.5 text-[0.62rem] font-bold text-navy-3">{waiting} da approvare</span>}
            </button>
          </div>
          <Link href={`/admin/camere/${r.id}`} aria-label={`Modifica camera ${r.number}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-navy hover:border-navy">
            <Pencil className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1">
            <span className="text-sm text-mist">€</span>
            <label className="sr-only" htmlFor={`p-${r.id}`}>
              Prezzo per notte camera {r.number}
            </label>
            <input id={`p-${r.id}`} className="w-20 border-b border-line bg-transparent py-1 text-lg text-navy outline-none focus:border-navy disabled:opacity-60" inputMode="decimal" value={price} disabled={!canPrice} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} />
            {Number(price.replace(',', '.')) !== r.basePrice && (
              <Button size="sm" disabled={pending} onClick={() => run(() => setPriceAction(r.id, Number(price.replace(',', '.'))))}>
                Salva
              </Button>
            )}
          </div>
          <NiceSelect size="sm" label={`Stato camera ${r.number}`} value={r.status} disabled={pending} onChange={(v) => run(() => setVisibilityAction(r.id, { status: v }))} options={STATUS} className="min-w-[9.5rem]" />
          <span className="flex items-center gap-2 text-xs text-mist">
            <Toggle size="sm" checked={!r.hidden} disabled={pending} onChange={(v) => run(() => setVisibilityAction(r.id, { hidden: !v }))} label={`Visibile sul sito, camera ${r.number}`} />
            {r.hidden ? (
              <span className="flex items-center gap-1">
                <EyeOff className="h-3.5 w-3.5" /> nascosta
              </span>
            ) : (
              'sul sito'
            )}
          </span>
        </div>
        <PaySwitch room={r} hotelPay={hotelPay} />
        <div className="mt-3 flex flex-wrap gap-1">
          <Badge tone="green">IT</Badge>
          {langs.map((x) => (
            <Badge key={x.l} tone={x.s === 'tradotto' ? 'green' : x.s === 'da_verificare' ? 'gold' : 'gray'}>
              {x.l.toUpperCase()}
              {!x.live ? '·' : ''}
            </Badge>
          ))}
        </div>
      </div>
      {stats && <RoomPulse stats={stats} />}
      {canDelete && (
        <motion.button
          type="button"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setDel(true)}
          aria-label={`Elimina camera ${r.number}`}
          title="Elimina camera"
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-terracotta text-ivory shadow-[0_10px_24px_-10px_rgba(192,103,75,0.9)] transition-colors hover:bg-[#a9563d]"
        >
          <Trash2 className="h-4 w-4" />
        </motion.button>
      )}
      <Dialog
        open={del}
        onClose={() => setDel(false)}
        title={`Eliminare la camera ${r.number}?`}
        footer={
          <>
            <Button variant="line" onClick={() => setDel(false)}>
              No, tienila
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => run(() => deleteRoomAction(r.id), { onOk: () => setDel(false) })}>
              <Trash2 className="h-4 w-4" /> Sì, elimina
            </Button>
          </>
        }
      >
        <p className="text-sm text-charcoal/85">
          <strong>{r.number} · {r.name}</strong> sparisce dal sito e dal planning. Le prenotazioni passate restano nello storico. Se vuoi solo fermarla per un po’, metti lo stato su “Non disponibile”.
        </p>
      </Dialog>
    </li>
  );
}

/** The right column of a card: the next 30 nights, who is in it now, the next guest. */
function RoomPulse({ stats: s }: { stats: RoomStats }) {
  const R = 22;
  const C = 2 * Math.PI * R;
  return (
    <div className="col-span-2 flex items-center gap-4 border-t border-line pr-12 pt-3 2xl:col-span-1 2xl:pr-0 2xl:flex-col 2xl:items-start 2xl:gap-3 2xl:border-l 2xl:border-t-0 2xl:pl-4 2xl:pt-1">
      <div className="flex items-center gap-3">
        <span className="relative h-14 w-14 shrink-0">
          <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
            <circle cx="28" cy="28" r={R} fill="none" stroke="currentColor" strokeWidth="5" className="text-line" />
            <motion.circle cx="28" cy="28" r={R} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className="text-gold" strokeDasharray={C} initial={{ strokeDashoffset: C }} whileInView={{ strokeDashoffset: C * (1 - s.occ30 / 100) }} viewport={{ once: true }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[0.72rem] font-semibold text-navy">{s.occ30}%</span>
        </span>
        <span className="text-[0.7rem] leading-snug text-mist">
          occupata
          <br />
          nei prossimi 30 gg
        </span>
      </div>
      <div className="min-w-0 text-xs leading-relaxed text-charcoal/80">
        {s.now ? (
          <p className="flex items-center gap-1.5 font-semibold text-navy">
            <BedDouble className="h-3.5 w-3.5 text-gold-2" /> Ora: {s.now}
          </p>
        ) : (
          <p className="text-sage">Libera stanotte</p>
        )}
        <p className="truncate">{s.next ? `Prossimo: ${fmtDate(s.next.date, 'it', { day: 'numeric', month: 'short' })} · ${s.next.guest}` : 'Nessun arrivo in vista'}</p>
        <p className="text-mist">{s.month} {s.month === 1 ? 'notte venduta' : 'notti vendute'} questo mese</p>
      </div>
    </div>
  );
}
