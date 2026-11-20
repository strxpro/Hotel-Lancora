'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { createPortal, flushSync } from 'react-dom';
import { animate, AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Car, Expand, Footprints, Hand, Minus, Navigation, Plus, Scan, Ship, X } from 'lucide-react';
import { COAST } from '@/content/coast';
import { MAP_T } from '@/lib/i18n/reviews-dict';
import { PhotoMorph } from './photo-morph';
import { cn } from '@/lib/utils';
import { roundedPath } from '@/lib/route-path';
import { useI18n, useLenis, usePlaces } from './providers';

const EASE = [0.22, 0.61, 0.12, 1] as const;
/** a quick, soft stop: wheel zoom and the glide after a flick */
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const COS = Math.cos((COAST.lat0 * Math.PI) / 180);
const K = COAST.width / ((COAST.bounds.maxLon - COAST.bounds.minLon) * COS);
const proj = (lat: number, lng: number) => ({ x: (lng - COAST.bounds.minLon) * COS * K, y: (COAST.bounds.maxLat - lat) * K });

export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export const fmtKm = (n: number, locale: string) => `${n < 10 ? n.toLocaleString(locale, { maximumFractionDigits: 1 }) : Math.round(n)} km`;
export const directionsUrl = (lat: number, lng: number, mode?: 'foot' | 'car') => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}${mode ? `&travelmode=${mode === 'foot' ? 'walking' : 'driving'}` : ''}`;

export type PlaceRoute = { mode: 'foot' | 'car'; coords: [number, number][]; km: number; min: number };
let routesCache: Record<string, PlaceRoute | null> | null = null;
let routesLoading: Promise<Record<string, PlaceRoute | null> | null> | null = null;

/** Real roads from the hotel (computed and cached by the server, fetched once per visit). */
export function useRoutes() {
  const [routes, setRoutes] = useState(routesCache);
  useEffect(() => {
    if (routesCache) return;
    routesLoading ??= fetch('/api/routes')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { routes?: Record<string, PlaceRoute | null> } | null) => (routesCache = j?.routes ?? null))
      .catch(() => null);
    let alive = true;
    routesLoading.then((r) => alive && r && setRoutes(r));
    return () => {
      alive = false;
    };
  }, []);
  return routes;
}

type Geo = { center: { lat: number; lng: number }; buildings: { p: number[] }[]; roads: { k: number; p: number[] }[]; beaches: number[][]; green: number[][]; land: number[][] };
type TownPaths = { land: string; green: string; beaches: string; major: string; minor: string; foot: string; buildings: string };
let townCache: TownPaths | null = null;
let townLoading: Promise<TownPaths | null> | null = null;

/** OSM data of the town (public/geo/santa-teresa.json) turned into a few SVG paths, in map units. */
export function useTown(): TownPaths | null {
  const [town, setTown] = useState(townCache);
  useEffect(() => {
    if (townCache) return;
    townLoading ??= fetch('/geo/santa-teresa.json')
      .then((r) => (r.ok ? (r.json() as Promise<Geo>) : null))
      .then((g) => {
        if (!g) return null;
        const mLng = 111320 * Math.cos((g.center.lat * Math.PI) / 180);
        const o = proj(g.center.lat, g.center.lng);
        const kx = (COS * K) / mLng;
        const ky = K / 111320;
        const d = (flat: number[], close: boolean) => {
          let out = '';
          for (let i = 0; i < flat.length; i += 2) out += `${i ? 'L' : 'M'}${(o.x + flat[i]! * kx).toFixed(2)} ${(o.y + flat[i + 1]! * ky).toFixed(2)}`;
          return close ? out + 'Z' : out;
        };
        townCache = {
          land: g.land.map((r) => d(r, true)).join(''),
          green: g.green.map((r) => d(r, true)).join(''),
          beaches: g.beaches.map((r) => d(r, true)).join(''),
          major: g.roads.filter((r) => r.k <= 3).map((r) => d(r.p, false)).join(''),
          minor: g.roads.filter((r) => r.k === 4 || r.k === 5).map((r) => d(r.p, false)).join(''),
          foot: g.roads.filter((r) => r.k >= 6).map((r) => d(r.p, false)).join(''),
          buildings: g.buildings.map((b) => d(b.p, true)).join(''),
        };
        return townCache;
      })
      .catch(() => null);
    let alive = true;
    townLoading.then((t) => alive && t && setTown(t));
    return () => {
      alive = false;
    };
  }, []);
  return town;
}

type View = { x: number; y: number; w: number };
/** widest view that still stays inside the drawn coastline, whatever the screen shape */
const maxW = (ar: number) => Math.min(COAST.width * 1.3, (COAST.height + 900) / Math.max(0.3, ar));

/**
 * Hand-drawn style map of the area (real OpenStreetMap coastline, rendered locally — instant,
 * no tiles, no cookies). Pins for the hotel and every place, distance from the hotel, a photo
 * card with "Take me there" (Google Maps), zoom, drag, pinch and full screen.
 */
export function PlaceMap({ hotel, active: activeProp, onSelect, tone = 'light', className, card = true, expandable = true, padBottom = 0, padLeft = 0 }: { hotel: { lat: number; lng: number; name: string }; active?: number | null; onSelect?: (i: number | null) => void; tone?: 'light' | 'dark'; className?: string; card?: boolean; expandable?: boolean; padBottom?: number; padLeft?: number }) {
  const { t, locale } = useI18n();
  const lenis = useLenis();
  const places = usePlaces();
  const [inner, setInner] = useState<number | null>(null);
  const active = activeProp !== undefined ? activeProp : inner;
  const select = useCallback((i: number | null) => (onSelect ? onSelect(i) : setInner(i)), [onSelect]);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const town = useTown();
  const [full, setFull] = useState(false);
  const [touched, setTouched] = useState(false);
  const routes = useRoutes();
  const still = useReducedMotion();
  const mt = MAP_T[locale];
  const H = useMemo(() => proj(hotel.lat, hotel.lng), [hotel.lat, hotel.lng]);
  const pts = useMemo(() => places.map((p) => proj(p.lat, p.lng)), [places]);

  const fit = useCallback(
    (list: { x: number; y: number }[], pad = 0.18): View => {
      const xs = list.map((p) => p.x);
      const ys = list.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const ar = size.h / Math.max(1, size.w);
      // only part of the box may be visible (a panel over the map): frame the points in that part
      const vw = Math.max(0.35, 1 - padLeft / Math.max(1, size.w));
      const vhr = Math.max(0.35, 1 - padBottom / Math.max(1, size.h));
      let w = Math.max((maxX - minX) / vw, (maxY - minY) / (ar * vhr), 36) * (1 + pad * 2);
      w = Math.min(w, maxW(ar));
      const h = w * ar;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      return { x: cx - w * (padLeft / Math.max(1, size.w) + vw / 2), y: cy - h * (vhr / 2), w };
    },
    [size, padLeft, padBottom],
  );
  const all = useMemo(() => [H, ...pts.filter((p, i) => km(hotel, places[i]!) < 12)], [H, pts, hotel, places]);
  const [view, setView] = useState<View>({ x: 0, y: 0, w: COAST.width });
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitted = useRef(false);

  // one camera move at a time: a new one (or the hand grabbing the map) stops the previous one
  const flight = useRef<{ stop: () => void } | null>(null);
  const holding = useRef(false);
  const fly = useCallback((to: View, duration = 0.9, ease: readonly [number, number, number, number] = EASE) => {
    if (holding.current) return () => {};
    flight.current?.stop();
    const from = viewRef.current;
    const anim = animate(0, 1, {
      duration,
      ease: [...ease] as [number, number, number, number],
      onUpdate: (k) => setView({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w * Math.pow(to.w / from.w, k) }),
      onComplete: () => {
        if (flight.current === anim) flight.current = null;
      },
    });
    flight.current = anim;
    return () => anim.stop();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);

  // first paint: everything, seen from above
  useEffect(() => {
    if (size.w < 10) return;
    if (!fitted.current) {
      fitted.current = true;
      setView(fit(all));
    }
  }, [size, fit, all]);

  // active place: frame it together with the hotel
  useEffect(() => {
    if (active === null || active === undefined || !fitted.current) return;
    const p = pts[active];
    const rt = routes?.[places[active]!.id];
    if (p) return fly(fit([H, p, ...(rt ? rt.coords.map(([la, ln]) => proj(la, ln)) : [])], 0.3));
  }, [active, pts, H, fit, fly, routes, places]);

  // re-fit when entering / leaving full screen
  useEffect(() => {
    if (!fitted.current) return;
    const id = window.setTimeout(() => fly(active !== null && active !== undefined && pts[active] ? fit([H, pts[active]!], 0.35) : fit(all), 0.7), 60);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  useEffect(() => {
    if (!full) return;
    lenis.current?.stop();
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => {
      lenis.current?.start();
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [full, lenis]);

  const vh = view.w * (size.h / Math.max(1, size.w));
  const zoom = (f: number) => {
    const v = viewRef.current;
    const w = Math.min(maxW(size.h / size.w), Math.max(40, v.w * f));
    fly({ x: v.x + (v.w - w) / 2, y: v.y + (vh - w * (size.h / size.w)) / 2, w }, 0.5);
  };

  /*
   * Drag + pinch, glued to the hand: the point of the map under the cursor (or between two fingers)
   * stays under it. While the hand moves, the drawn map and its pins slide as one picture (a GPU
   * transform, no redraw); the map is redrawn once, when the hand lets go, then glides to a stop.
   */
  const layer = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: View; mx: number; my: number; dist: number; left: number; top: number; cx: number; cy: number } | null>(null);
  const live = useRef<View | null>(null);
  const trail = useRef<{ t: number; x: number; y: number }[]>([]);
  const pinched = useRef(false);
  const moved = useRef(false);
  const center = () => {
    const ps = [...pointers.current.values()];
    return { ps, cx: ps.reduce((s, p) => s + p.x, 0) / ps.length, cy: ps.reduce((s, p) => s + p.y, 0) / ps.length };
  };
  const begin = () => {
    const el = box.current;
    if (!el || !size.w) return;
    const { ps, cx, cy } = center();
    const r = el.getBoundingClientRect();
    const base = live.current ?? viewRef.current;
    const u = base.w / size.w;
    gesture.current = { view: base, mx: base.x + (cx - r.left) * u, my: base.y + (cy - r.top) * u, dist: ps.length > 1 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y) : 0, left: r.left, top: r.top, cx, cy };
  };
  const paint = (lv: View) => {
    const c = viewRef.current;
    const k = c.w / lv.w;
    const tx = ((c.x - lv.x) * size.w) / lv.w;
    const ty = ((c.y - lv.y) * size.w) / lv.w;
    if (layer.current) layer.current.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${k})`;
  };
  const commit = () => {
    const lv = live.current;
    live.current = null;
    if (!lv) return;
    flushSync(() => setView(lv));
    if (layer.current) layer.current.style.transform = '';
  };
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,a')) return;
    flight.current?.stop();
    flight.current = null;
    holding.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      moved.current = false;
      pinched.current = false;
      trail.current = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    } else pinched.current = true;
    begin();
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId) || !g) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { ps, cx, cy } = center();
    let w = g.view.w;
    if (ps.length > 1 && g.dist > 0) w = Math.min(maxW(size.h / size.w), Math.max(40, g.view.w * (g.dist / Math.max(1, Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y)))));
    const u = w / size.w;
    const lv = { x: g.mx - (cx - g.left) * u, y: g.my - (cy - g.top) * u, w };
    if (Math.abs(cx - g.cx) + Math.abs(cy - g.cy) > 4) moved.current = true;
    live.current = lv;
    paint(lv);
    trail.current.push({ t: e.timeStamp, x: cx, y: cy });
    if (trail.current.length > 6) trail.current.shift();
  };
  const onUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) {
      // one finger left after a pinch: keep dragging from where it is
      begin();
      trail.current = [];
      return;
    }
    (e.currentTarget as HTMLElement).style.cursor = '';
    gesture.current = null;
    holding.current = false;
    const end = live.current;
    commit();
    // a flick keeps the map gliding a little, like paper on a table
    const tr = trail.current.filter((p) => e.timeStamp - p.t < 120);
    if (!end || pinched.current || !moved.current || tr.length < 2) return;
    const a = tr[0]!;
    const b = tr[tr.length - 1]!;
    const dt = Math.max(8, b.t - a.t);
    const vx = (b.x - a.x) / dt;
    const vy = (b.y - a.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed < 0.35) return;
    const travel = Math.min(420, speed * 240) / speed;
    const u = end.w / size.w;
    fly({ x: end.x - vx * travel * u, y: end.y - vy * travel * u, w: end.w }, 0.7, EASE_OUT);
  };

  // mouse wheel / trackpad: zoom in and out around the cursor (the map is in its own window, nothing to scroll)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (holding.current) return;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const base = viewRef.current;
      const f = Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * (e.ctrlKey ? 0.012 : 0.0035));
      const w = Math.min(maxW(r.height / r.width), Math.max(40, base.w * f));
      const mx = base.x + ((e.clientX - r.left) * base.w) / r.width;
      const my = base.y + ((e.clientY - r.top) * base.w) / r.width;
      fly({ x: mx - ((e.clientX - r.left) * w) / r.width, y: my - ((e.clientY - r.top) * w) / r.width, w }, 0.32, EASE_OUT);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fly, full]);

  const at = (p: { x: number; y: number }) => ({ left: `${((p.x - view.x) / view.w) * 100}%`, top: `${((p.y - view.y) / vh) * 100}%` });
  const dark = tone === 'dark';
  const cur = active !== null && active !== undefined ? places[active] : null;
  const curPt = active !== null && active !== undefined ? pts[active] : null;
  const dist = cur ? km(hotel, cur) : 0;
  const route = cur ? (routes?.[cur.id] ?? null) : null;
  // the real streets, with the bends rounded like a road (≈ 28 m curves) and tiny wiggles merged
  const routeD = route ? roundedPath(route.coords.map(([la, ln]) => proj(la, ln)), (28 * K) / 111320, (3 * K) / 111320) : null;
  const px = view.w / Math.max(1, size.w);
  const ferry = cur?.id === 'bonifacio';
  const gallery = cur ? cur.gallery : [];

  // screen positions → clusters (no overlapping pins) and labels only where they fit
  const sx = (p: { x: number; y: number }) => ({ x: ((p.x - view.x) / view.w) * size.w, y: ((p.y - view.y) / vh) * size.h });
  const hs = sx(H);
  const hotelGroup: number[] = [];
  const groups: number[][] = [];
  const singles = new Set<number>();
  const centers: { x: number; y: number; m: number[] }[] = [];
  pts.forEach((p, i) => {
    const q = sx(p);
    if (i === active) {
      singles.add(i);
      return;
    }
    if (Math.hypot(q.x - hs.x, q.y - hs.y) < 34) return void hotelGroup.push(i);
    const c = centers.find((k) => Math.hypot(k.x - q.x, k.y - q.y) < 36);
    if (c) c.m.push(i);
    else centers.push({ x: q.x, y: q.y, m: [i] });
  });
  for (const c of centers) {
    if (c.m.length > 1) groups.push(c.m);
    else singles.add(c.m[0]!);
  }
  const labels = new Set<number>();
  const flipped = new Set<number>();
  const taken = [{ x: hs.x - 30, y: hs.y - 22, w: 60, h: 60 }];
  for (const i of [...singles].sort((x, y) => (x === active ? -1 : y === active ? 1 : 0))) {
    const q = sx(pts[i]!);
    const w = 40 + places[i]!.name.length * 6.4;
    // the zoom buttons take the right edge: names that would end under them open to the left
    const flip = q.x - 16 + w > size.w - 64 && q.x + 16 - w > 8;
    const r = flip ? { x: q.x + 16 - w, y: q.y - 16, w, h: 32 } : { x: q.x - 16, y: q.y - 16, w, h: 32 };
    const crowded = [...singles].some((j) => {
      if (j === i) return false;
      const o = sx(pts[j]!);
      return Math.abs(o.y - q.y) < 30 && (flip ? o.x < q.x && o.x > q.x - w : o.x > q.x && o.x < q.x + w);
    });
    const hit = taken.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) || crowded;
    if (i === active || !hit) {
      labels.add(i);
      if (flip) flipped.add(i);
      taken.push(r);
    }
  }

  const mapEl = (
    <motion.div
      initial={full ? { opacity: 0, scale: 0.94 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE }}
      className={cn('overflow-hidden', full ? 'fixed inset-2 z-[96] rounded-[1.75rem] sm:inset-4' : cn('relative w-full rounded-[1.75rem]', className ?? 'h-full'), dark ? 'bg-[#0c2236] ring-1 ring-white/10' : 'bg-[#dfeaee] ring-1 ring-line')}
    >
      <div ref={box} className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}>
        <div ref={layer} className="absolute inset-0 origin-top-left will-change-transform">
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${vh}`} preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <pattern id={`dots-${tone}`} width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.6" fill={dark ? 'rgba(248,245,238,0.10)' : 'rgba(16,40,61,0.07)'} />
            </pattern>
          </defs>
          <rect x={-200} y={-200} width={COAST.width + 400} height={COAST.height + 400} fill={`url(#dots-${tone})`} />
          {/* shallow-water halo, then land */}
          <path d={COAST.land} fill="none" stroke={dark ? 'rgba(120,170,200,0.18)' : 'rgba(255,255,255,0.75)'} strokeWidth={9} strokeLinejoin="round" />
          <path d={COAST.land} fill={dark ? '#1b3a55' : '#f1e8d6'} stroke={dark ? 'rgba(248,245,238,0.25)' : 'rgba(16,40,61,0.25)'} strokeWidth={0.8} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {town && (
            <g aria-hidden="true" style={{ opacity: Math.min(1, Math.max(0, (260 - view.w) / 140)) }}>
              <path d={town.land} fill={dark ? '#1b3a55' : '#f1e8d6'} />
              <path d={town.green} fill={dark ? '#244a3f' : '#dfe5cc'} />
              <path d={town.beaches} fill={dark ? '#4a5a4e' : '#f4e2b8'} />
              <path d={town.foot} fill="none" stroke={dark ? 'rgba(248,245,238,0.18)' : '#e3d4b8'} strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              <path d={town.major} fill="none" stroke={dark ? 'rgba(0,0,0,0.35)' : '#d9c9a9'} strokeWidth={view.w < 70 ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={town.minor} fill="none" stroke={dark ? 'rgba(248,245,238,0.22)' : '#ffffff'} strokeWidth={view.w < 70 ? 2.6 : 1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={town.major} fill="none" stroke={dark ? 'rgba(248,245,238,0.4)' : '#ffffff'} strokeWidth={view.w < 70 ? 4 : 2.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={town.buildings} fill={dark ? 'rgba(248,245,238,0.22)' : '#e2cfae'} stroke={dark ? 'none' : '#cdb790'} strokeWidth={0.5} vectorEffect="non-scaling-stroke" style={{ opacity: Math.min(1, Math.max(0, (140 - view.w) / 60)) }} />
            </g>
          )}
          {cur && curPt && routeD && (
            <g key={`r-${cur.id}`}>
              {/* drawn like a real road: a soft shadow, a white edge, the colour, then (on foot) little steps walking along */}
              <motion.path d={routeD} fill="none" stroke={dark ? 'rgba(0,0,0,0.45)' : 'rgba(16,40,61,0.15)'} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1.4, ease: EASE }} />
              <motion.path d={routeD} fill="none" stroke="#ffffff" strokeWidth={8.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 1.4, ease: EASE }} />
              <motion.path id={`route-${cur.id}`} d={routeD} fill="none" stroke={route?.mode === 'foot' ? '#7A8C6E' : '#B69562'} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: EASE }} />
              {route?.mode === 'foot' && (
                <motion.path d={routeD} fill="none" stroke="#ffffff" strokeWidth={2.2 * px} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${0.01 * px} ${9 * px}`} initial={{ opacity: 0 }} animate={{ opacity: 0.95 }} transition={{ delay: 1.2, duration: 0.6 }}>
                  {!still && <animate attributeName="stroke-dashoffset" from="0" to={String(-18 * px)} dur="1.2s" repeatCount="indefinite" />}
                </motion.path>
              )}
              {/* the traveller: glides along the road, slows down at the place, rests a moment, starts again */}
              {!still && (
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.5 }}>
                  <circle r={10 * px} fill={route?.mode === 'foot' ? '#7A8C6E' : '#B69562'} opacity={0.28}>
                    <animate attributeName="r" values={`${8 * px};${13 * px};${8 * px}`} dur="1.8s" repeatCount="indefinite" />
                  </circle>
                  <circle r={5.5 * px} fill="#10283D" stroke="#ffffff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  <animateMotion dur={`${Math.min(9, 3 + (route?.km ?? 1) / 2.5).toFixed(1)}s`} repeatCount="indefinite" path={routeD} keyPoints="0;1;1" keyTimes="0;0.84;1" calcMode="spline" keySplines="0.42 0 0.35 1;0 0 1 1" />
                </motion.g>
              )}
            </g>
          )}
          {cur && curPt && !routeD && (
            <motion.line key={cur.id} x1={H.x} y1={H.y} x2={curPt.x} y2={curPt.y} stroke="#B69562" strokeWidth={2} strokeDasharray="6 6" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EASE }} />
          )}
        </svg>

        {/* hotel (+ badge with the places hidden underneath it at this zoom) */}
        <button type="button" onClick={() => !moved.current && (hotelGroup.length ? fly(fit([H, ...hotelGroup.map((i) => pts[i]!)], 0.45)) : undefined)} aria-label={t.sections.ourHotel} className="absolute z-[5] -translate-x-1/2 -translate-y-1/2" style={at(H)}>
          <span className="absolute inset-0 -m-3 animate-ping rounded-full bg-gold/25" />
          <span className="relative flex h-11 w-11 items-center justify-center rounded-full border-2 border-ivory bg-navy text-gold shadow-[0_10px_30px_-8px_rgba(16,40,61,0.7)]">
            <svg viewBox="0 0 48 56" width="17" height="21" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
              <circle cx="24" cy="7" r="4.2" />
              <path d="M24 11.2V52M15 20h18M5 34c1.6 10.5 9.4 18 19 18s17.4-7.5 19-18" />
            </svg>
            {hotelGroup.length > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-[0.62rem] font-bold text-navy-3 ring-2 ring-white">+{hotelGroup.length}</span>}
          </span>
          <span className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-navy px-2.5 py-1 text-[0.62rem] font-semibold text-ivory shadow">{t.sections.ourHotel}</span>
        </button>

        {/* clusters of places that would overlap at this zoom */}
        {groups.map((g) =>
          g.length > 1 ? (
            <button key={g.join('-')} type="button" onClick={() => !moved.current && fly(fit(g.map((i) => pts[i]!), 0.5))} aria-label={g.map((i) => places[i]!.name).join(', ')} className="absolute z-[4] -translate-x-1/2 -translate-y-1/2" style={at({ x: g.reduce((s2, i) => s2 + pts[i]!.x, 0) / g.length, y: g.reduce((s2, i) => s2 + pts[i]!.y, 0) / g.length })}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-gold text-sm font-bold text-navy-3 shadow-[0_8px_20px_-8px_rgba(16,40,61,0.6)] transition-transform hover:scale-110">{g.length}</span>
            </button>
          ) : null,
        )}

        {/* single places */}
        {places.map((p, i) => {
          if (!singles.has(i)) return null;
          const on = i === active;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                if (moved.current) return;
                setTouched(true);
                select(on ? null : i);
              }}
              aria-label={`${p.name} · ${fmtKm(km(hotel, p), locale)}`}
              aria-pressed={on}
              className={cn('absolute', on ? 'z-[6]' : 'z-[4]')}
              style={{ ...at(pts[i]!), transform: flipped.has(i) ? 'translate(calc(-100% + 16px), -50%)' : 'translate(-16px, -50%)' }}
            >
              {/* the numbered dot sits exactly on the place; no layout animation (it made the pins trail behind the map) */}
              <motion.span
                animate={{ scale: on ? 1.12 : 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                style={{ transformOrigin: flipped.has(i) ? 'calc(100% - 16px) 50%' : '16px 50%' }}
                className={cn('flex items-center gap-1.5 rounded-full border-2 p-0.5 text-xs font-semibold shadow-[0_8px_20px_-8px_rgba(16,40,61,0.6)] transition-colors', flipped.has(i) && 'flex-row-reverse', labels.has(i) && (flipped.has(i) ? 'pl-2.5' : 'pr-2.5'), on ? 'border-white bg-gold text-navy-3' : 'border-white bg-white text-navy hover:bg-ivory')}
              >
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.68rem]', on ? 'bg-navy text-ivory' : 'bg-navy/[0.08]')}>{i + 1}</span>
                {labels.has(i) && (
                  <motion.span key={flipped.has(i) ? 'l' : 'r'} initial={{ opacity: 0, x: flipped.has(i) ? 6 : -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease: EASE }} className="whitespace-nowrap">
                    {p.name}
                  </motion.span>
                )}
              </motion.span>
            </button>
          );
        })}
        </div>
      </div>

      {/* hint until the first tap */}
      <AnimatePresence>
        {!cur && !touched && (
          <motion.p initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ delay: 0.6 }} style={{ left: padLeft + 12 }} className="pointer-events-none absolute top-3 z-[5] mr-16 flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-[0.72rem] font-semibold text-navy shadow-[0_10px_30px_-14px_rgba(16,40,61,0.6)]">
            <motion.span animate={{ y: [0, -3, 0], rotate: [0, -8, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
              <Hand className="h-4 w-4 text-gold-2" />
            </motion.span>
            {mt.hint}
          </motion.p>
        )}
      </AnimatePresence>

      {/* place card */}
      <AnimatePresence>
        {card && cur && (
          <motion.div key={cur.id} initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.45, ease: EASE }} className="absolute inset-x-2 bottom-2 z-[6] rounded-[1.5rem] bg-white p-3 text-navy shadow-[0_24px_60px_-24px_rgba(16,40,61,0.6)] sm:inset-x-3 sm:bottom-3 sm:left-auto sm:w-[380px] sm:p-3.5">
            <div className="flex items-start justify-between gap-3 pr-8">
              <div className="min-w-0">
                <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-gold-2">{cur.kind[locale]}</p>
                <p className="serif truncate text-[1.5rem] leading-tight">{cur.name}</p>
              </div>
            </div>
            <button type="button" onClick={() => select(null)} aria-label={t.common.close} className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-sand-2/70 text-navy hover:bg-sand-2">
              <X className="h-4 w-4" />
            </button>
            <PhotoMorph photos={gallery} className="no-scrollbar mt-2.5 overflow-x-auto" thumbClassName="h-[4.6rem] w-[6.2rem] sm:h-20 sm:w-[6.6rem]" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 rounded-full bg-ivory px-3 py-1.5 text-xs">
                {ferry ? <Ship className="h-4 w-4 text-gold-2" /> : route?.mode === 'foot' || (!route && dist < 1.6) ? <Footprints className="h-4 w-4 text-sage" /> : <Car className="h-4 w-4 text-gold-2" />}
                {route ? (
                  <span>
                    <b>{route.km.toLocaleString(locale, { maximumFractionDigits: 1 })} km</b> · {route.min} min {ferry ? mt.ferry : route.mode === 'foot' ? t.sections.walk : t.sections.drive}
                  </span>
                ) : (
                  <span>
                    {fmtKm(dist, locale)} {t.sections.fromHotel} · ≈ {dist < 1.6 ? `${Math.max(3, Math.round(dist * 13))} min ${t.sections.walk}` : `${Math.max(4, Math.round(dist * 1.6 + 3))} min ${t.sections.drive}`}
                  </span>
                )}
              </span>
              {route && <span className="text-[0.66rem] text-mist">{mt.road}</span>}
            </div>
            <a href={directionsUrl(cur.lat, cur.lng, route?.mode ?? (dist < 1.6 ? 'foot' : 'car'))} target="_blank" rel="noopener noreferrer" className="mt-3 flex h-11 items-center justify-center gap-2 rounded-full bg-navy text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-ivory transition-transform active:scale-[0.98]">
              <Navigation className="h-4 w-4" /> {t.sections.goThere}
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      {/* controls */}
      <div className={cn('absolute right-3 z-[5] flex flex-col gap-1.5', expandable ? 'top-3' : 'top-[4.25rem] sm:top-[4.75rem]')}>
        {[
          ...(expandable ? [{ label: full ? t.sections.shrink : t.sections.expand, icon: full ? X : Expand, on: () => setFull((f) => !f) }] : []),
          { label: t.sections.zoomIn, icon: Plus, on: () => zoom(0.6) },
          { label: t.sections.zoomOut, icon: Minus, on: () => zoom(1.6) },
          { label: t.sections.fitAll, icon: Scan, on: () => { select(null); fly(fit(all)); } },
        ].map((c) => (
          <button key={c.label} type="button" onClick={c.on} aria-label={c.label} title={c.label} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-navy shadow-[0_8px_20px_-10px_rgba(16,40,61,0.6)] transition-transform hover:bg-ivory active:scale-90">
            <c.icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      <span className={cn('pointer-events-none absolute bottom-1 left-3 z-[2] text-[0.55rem]', dark ? 'text-ivory/40' : 'text-navy/40', cur && 'hidden sm:block')}>© OpenStreetMap</span>
    </motion.div>
  );

  return (
    <>
      {full && <div className={cn('w-full', className ?? 'h-full')} aria-hidden="true" />}
      {full && typeof document !== 'undefined'
        ? createPortal(
            <>
              <motion.button type="button" aria-label={t.sections.shrink} className="fixed inset-0 z-[95] bg-navy-3/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => setFull(false)} />
              {mapEl}
            </>,
            document.body,
          )
        : mapEl}
    </>
  );
}

/** Clickable list of the places, with distance from the hotel. */
export function PlaceList({ hotel, active, onSelect }: { hotel: { lat: number; lng: number }; active: number | null; onSelect: (i: number) => void }) {
  const { t, locale } = useI18n();
  const places = usePlaces();
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
      {places.map((p, i) => (
        <li key={p.id}>
          <button type="button" onClick={() => onSelect(i)} aria-pressed={active === i} className={cn('group flex w-full items-center gap-3 rounded-2xl border p-2 pr-3 text-left transition-colors', active === i ? 'border-navy bg-white' : 'border-line bg-white/60 hover:border-navy/40')}>
            <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sand">
              <Image src={p.photo.src} alt="" fill sizes="56px" className="object-cover transition-transform duration-700 group-hover:scale-110" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-navy">
                {i + 1}. {p.name}
              </span>
              <span className="block truncate text-xs text-mist">
                {p.kind[locale]} · {fmtKm(km(hotel, p), locale)} {t.sections.fromHotel}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Map + place list + directions to the hotel (contact and experiences pages). */
export function AreaMap({ hotel }: { hotel: { lat: number; lng: number; name: string; verified: boolean } }) {
  const { t } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  return (
    <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <PlaceMap hotel={hotel} active={active} onSelect={setActive} className="h-[460px] sm:h-[560px]" />
      </div>
      <div className="flex flex-col gap-4 lg:col-span-4">
        <p className="eyebrow text-gold-2">{t.sections.placesTitle}</p>
        <PlaceList hotel={hotel} active={active} onSelect={(i) => setActive(i === active ? null : i)} />
        <a href={directionsUrl(hotel.lat, hotel.lng)} target="_blank" rel="noopener noreferrer" className="btn btn-navy mt-auto">
          <Navigation className="h-4 w-4" /> {t.sections.directions} · {hotel.name}
        </a>
        {!hotel.verified && <p className="text-xs text-mist">{t.sections.addressPending} · {t.sections.approx}</p>}
      </div>
    </div>
  );
}
