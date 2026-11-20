import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db/store';

export interface PlaceRoute {
  mode: 'foot' | 'car';
  /** [lat, lng] along the real road / path */
  coords: [number, number][];
  km: number;
  min: number;
}

type Cache = Record<string, Record<string, PlaceRoute | null>>;
const FILE = path.join(DATA_DIR, 'routes-cache.json');
const g = globalThis as unknown as { __lancoraRoutes?: Cache; __lancoraRoutesBusy?: Promise<unknown> | null };

function load(): Cache {
  if (g.__lancoraRoutes) return g.__lancoraRoutes;
  try {
    g.__lancoraRoutes = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Cache;
  } catch {
    g.__lancoraRoutes = {};
  }
  return g.__lancoraRoutes;
}

function save(c: Cache) {
  g.__lancoraRoutes = c;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(c), 'utf8');
}

/** Douglas–Peucker on [lat,lng] pairs (good enough at this scale). */
function simplify(pts: [number, number][], eps = 0.00004): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0]!, pts[pts.length - 1]!];
  let max = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const dx = b[1] - a[1];
    const dy = b[0] - a[0];
    const d = Math.abs(dy * p[1] - dx * p[0] + b[1] * a[0] - b[0] * a[1]) / (Math.hypot(dx, dy) || 1e-9);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

const straightKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function fetchRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'foot' | 'car'): Promise<PlaceRoute | null> {
  // free OpenStreetMap routing (FOSSGIS); called from the server only, results cached on disk
  const url = `https://routing.openstreetmap.de/routed-${mode}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'HotelLAncora/1.0 (hotel website)' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
    const best = j.routes?.[0];
    if (j.code !== 'Ok' || !best) return null;
    const coords = simplify(best.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]));
    return { mode, coords, km: Math.round(best.distance / 100) / 10, min: Math.max(1, Math.round(best.duration / 60)) };
  } catch {
    return null;
  }
}

type Spot = { id: string; lat: number; lng: number };
/** a place is cached with its position: a pin the owner moves gets its new road */
const spotKey = (p: Spot) => `${p.id}@${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const byId = (spots: Spot[], all: Record<string, PlaceRoute | null>) => Object.fromEntries(spots.map((p) => [p.id, all[spotKey(p)] ?? null]));

/** Road / footpath from the hotel to every place on the site (also the ones the owner added): walking under ~1.8 km, otherwise by car. */
export async function placeRoutes(hotel: { lat: number; lng: number }, spots: Spot[]): Promise<Record<string, PlaceRoute | null>> {
  const key = `${hotel.lat.toFixed(5)},${hotel.lng.toFixed(5)}`;
  const cache = load();
  if (cache[key] && spots.every((p) => spotKey(p) in cache[key]!)) return byId(spots, cache[key]!);
  if (g.__lancoraRoutesBusy) await g.__lancoraRoutesBusy;
  const run = (async () => {
    const out: Record<string, PlaceRoute | null> = { ...(cache[key] ?? {}) };
    await Promise.all(
      spots.filter((p) => !(spotKey(p) in out)).map(async (p) => {
        const mode = straightKm(hotel, p) < 1.8 ? 'foot' : 'car';
        out[spotKey(p)] = await fetchRoute(hotel, p, mode);
      }),
    );
    // keep failures out of the cache so they are retried next time
    const keep = Object.fromEntries(Object.entries(out).filter(([, v]) => v));
    save({ ...load(), [key]: keep });
    return out;
  })();
  g.__lancoraRoutesBusy = run;
  try {
    return byId(spots, await run);
  } finally {
    g.__lancoraRoutesBusy = null;
  }
}
