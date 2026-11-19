'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { BedDouble, CalendarCheck2, CornerDownLeft, LayoutGrid, Loader2, Mail, Search, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { panelSearchAction, type SearchHit } from '@/app/admin/actions/search';

/** What the box suggests, written and erased by itself while it is empty. */
const IDEAS = ['un ospite… «Rossi»', 'una prenotazione… «LA-7K2P»', 'una camera… «104»', 'una sezione… «Pagamenti»', 'un messaggio… «orario di arrivo»', 'un telefono o una e-mail…'];

function useTypewriter(active: boolean) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!active) return;
    let i = 0;
    let n = 0;
    let dir: 1 | -1 = 1;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = IDEAS[i % IDEAS.length]!;
      n += dir;
      setText(full.slice(0, n));
      if (dir === 1 && n >= full.length) {
        dir = -1;
        t = setTimeout(tick, 1700);
        return;
      }
      if (dir === -1 && n <= 0) {
        dir = 1;
        i++;
        t = setTimeout(tick, 350);
        return;
      }
      t = setTimeout(tick, dir === 1 ? 55 + Math.random() * 45 : 28);
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [active]);
  return text;
}

const ICON: Record<SearchHit['group'], React.ComponentType<{ className?: string }>> = { Prenotazioni: CalendarCheck2, Ospiti: UserRound, Camere: BedDouble, Messaggi: Mail, Pagine: LayoutGrid };

export function PanelSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const typed = useTypewriter(!q);

  // Ctrl+K / ⌘K / "/" from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA')) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const n = ++seq.current;
    if (q.trim().length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await panelSearchAction(q).catch(() => []);
      if (n !== seq.current) return;
      setHits(r);
      setHi(0);
      setLoading(false);
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const groups = useMemo(() => {
    const out: { g: SearchHit['group']; items: (SearchHit & { i: number })[] }[] = [];
    hits.forEach((h, i) => {
      const last = out.at(-1);
      if (last?.g === h.group) last.items.push({ ...h, i });
      else out.push({ g: h.group, items: [{ ...h, i }] });
    });
    return out;
  }, [hits]);

  const go = (h: SearchHit) => {
    setQ('');
    setHits([]);
    input.current?.blur();
    router.push(h.href);
  };
  const open = focus && q.trim().length >= 2;

  return (
    <div className="relative hidden w-full max-w-md md:block">
      <motion.div animate={{ boxShadow: focus ? '0 0 0 3px rgba(182,149,98,0.25)' : '0 0 0 0px rgba(0,0,0,0)' }} className={cn('flex h-10 items-center gap-2 rounded-full border bg-white px-3.5 transition-colors', focus ? 'border-navy/40' : 'border-line')}>
        <Search className={cn('h-4 w-4 shrink-0 transition-colors', focus ? 'text-navy' : 'text-mist')} />
        <span className="relative min-w-0 flex-1">
          <label htmlFor="panel-search" className="sr-only">
            Cerca nel pannello
          </label>
          <input
            id="panel-search"
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setTimeout(() => setFocus(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHi((i) => Math.min(hits.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHi((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && hits[hi]) go(hits[hi]!);
              else if (e.key === 'Escape') input.current?.blur();
            }}
            autoComplete="off"
            className="w-full bg-transparent text-sm text-navy outline-none"
          />
          {!q && (
            <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center truncate text-sm text-mist">
              Cerca {typed}
              <motion.span className="ml-px inline-block h-4 w-px bg-mist" animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.9, repeat: Infinity }} />
            </span>
          )}
        </span>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-mist" /> : <kbd className="hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[0.6rem] font-semibold text-mist xl:inline">Ctrl K</kbd>}
      </motion.div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} className="thin-scroll absolute left-0 right-0 top-12 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-white p-2 shadow-[0_30px_70px_-24px_rgba(10,28,43,0.5)]">
            {!loading && hits.length === 0 && <p className="px-3 py-6 text-center text-sm text-mist">Nessun risultato per «{q}».</p>}
            {groups.map((g) => {
              const Icon = ICON[g.g];
              return (
                <div key={g.g} className="py-1">
                  <p className="px-3 pb-1 pt-2 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-mist">{g.g}</p>
                  {g.items.map((h) => (
                    <button key={`${h.href}-${h.i}`} type="button" onMouseEnter={() => setHi(h.i)} onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} className={cn('relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', h.i === hi && 'bg-ivory')}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy/[0.06] text-navy">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-navy">{h.title}</span>
                        <span className="block truncate text-xs text-mist">{h.sub}</span>
                      </span>
                      {h.i === hi && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-mist" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
