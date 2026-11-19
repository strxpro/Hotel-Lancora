// Builds public/geo/santa-teresa.json: streets, buildings, beaches and green areas around the hotel,
// from OpenStreetMap (© OpenStreetMap contributors, ODbL). Run once: `node scripts/fetch-osm.mjs`.
// Coordinates are metres from the centre (x = east, y = south), rounded to 0.1 m.
import fs from 'node:fs';
import path from 'node:path';

const CENTER = { lat: 41.2394, lng: 9.1894 };
const HALF_X = 1500; // metres east/west
const HALF_Y = 1250; // metres north/south
const M_LAT = 111_320;
const M_LNG = 111_320 * Math.cos((CENTER.lat * Math.PI) / 180);
const bbox = [CENTER.lat - (HALF_Y + 150) / M_LAT, CENTER.lng - (HALF_X + 150) / M_LNG, CENTER.lat + (HALF_Y + 150) / M_LAT, CENTER.lng + (HALF_X + 150) / M_LNG].map((n) => n.toFixed(5)).join(',');

const query = `[out:json][timeout:90];(
way["building"](${bbox});
way["highway"](${bbox});
way["natural"="beach"](${bbox});
way["leisure"~"park|garden|pitch|playground"](${bbox});
way["landuse"~"grass|meadow|recreation_ground|village_green|forest"](${bbox});
way["natural"~"scrub|wood|heath"](${bbox});
way["man_made"~"pier|breakwater"](${bbox});
way["natural"="coastline"](${bbox});
);out geom;`;

const cache = path.join(process.cwd(), '.cache', 'osm', 'raw.json');
let raw;
if (fs.existsSync(cache) && !process.argv.includes('--refresh')) {
  raw = JSON.parse(fs.readFileSync(cache, 'utf8'));
} else {
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'hotel-lancora-demo/1.0' }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(String(r.status));
      raw = await r.json();
      break;
    } catch (e) {
      console.warn('overpass failed', url, e.message);
    }
  }
  if (!raw) throw new Error('No Overpass endpoint answered');
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(raw));
}

const xy = (p) => [Math.round((p.lon - CENTER.lng) * M_LNG * 10) / 10, Math.round((CENTER.lat - p.lat) * M_LAT * 10) / 10];
const inside = ([x, y], pad = 0) => Math.abs(x) <= HALF_X + pad && Math.abs(y) <= HALF_Y + pad;

/** Douglas–Peucker in metres */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const area = (pts) => {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return Math.abs(s / 2);
};

const ROAD = {
  primary: 1, trunk: 1, secondary: 1, tertiary: 2, unclassified: 3, residential: 3, living_street: 3, service: 4,
  pedestrian: 5, footway: 6, path: 6, steps: 6, track: 6, cycleway: 6,
};

const out = { center: CENTER, half: [HALF_X, HALF_Y], buildings: [], roads: [], beaches: [], green: [], piers: [], coast: [] };
for (const e of raw.elements) {
  if (!e.geometry) continue;
  const pts = e.geometry.map(xy);
  const t = e.tags || {};
  if (t.building) {
    if (!pts.some((p) => inside(p))) continue;
    const ring = simplify(pts.slice(0, -1), 0.4);
    if (ring.length < 3 || area(ring) < 12) continue;
    const lv = Number.parseFloat(t['building:levels']);
    const h = Number.parseFloat(t.height);
    out.buildings.push({ p: ring.flat(), ...(Number.isFinite(h) ? { h } : Number.isFinite(lv) ? { l: lv } : {}) });
  } else if (t.highway) {
    const k = ROAD[t.highway];
    if (!k || !pts.some((p) => inside(p, 100))) continue;
    out.roads.push({ k, p: simplify(pts, 0.8).flat() });
  } else if (t.natural === 'beach') {
    out.beaches.push(simplify(pts, 0.8).flat());
  } else if (t.man_made) {
    out.piers.push({ w: t.man_made === 'breakwater' ? 6 : 4, p: simplify(pts, 0.6).flat() });
  } else if (t.natural === 'coastline') {
    out.coast.push(simplify(pts, 1).flat());
  } else {
    out.green.push(simplify(pts, 1).flat());
  }
}

/* ---- land polygons: OSM coastlines (land on the left) stitched along the map border ---- */
function buildLand(ways, HX, HY) {
  // work in y-up coordinates (north up) so "left of travel" is the land side
  const up = (p) => [p[0], -p[1]];
  const key = (p) => `${p[0]},${p[1]}`;
  let chains = ways.map((w) => {
    const a = [];
    for (let i = 0; i < w.length; i += 2) a.push(up([w[i], w[i + 1]]));
    return a;
  });
  // merge ways that continue each other
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i++) {
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        const a = chains[i];
        const b = chains[j];
        if (key(a[a.length - 1]) === key(b[0]) && key(a[0]) !== key(a[a.length - 1])) {
          chains[i] = [...a, ...b.slice(1)];
          chains.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  const inR = ([x, y]) => x >= -HX && x <= HX && y >= -HY && y <= HY;
  // Liang–Barsky: portion [t0,t1] of p→q inside the rectangle
  const clipSeg = (p, q) => {
    let t0 = 0;
    let t1 = 1;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    for (const [pp, qq] of [[-dx, p[0] + HX], [dx, HX - p[0]], [-dy, p[1] + HY], [dy, HY - p[1]]]) {
      if (pp === 0) {
        if (qq < 0) return null;
      } else {
        const r = qq / pp;
        if (pp < 0) {
          if (r > t1) return null;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return null;
          if (r < t1) t1 = r;
        }
      }
    }
    return [t0, t1];
  };
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const rings = [];
  const pieces = [];
  for (let c of chains) {
    const closed = c.length > 3 && key(c[0]) === key(c[c.length - 1]);
    if (closed && c.every(inR)) {
      rings.push(c);
      continue;
    }
    if (closed) {
      const k = c.findIndex((p) => !inR(p));
      c = [...c.slice(k, -1), ...c.slice(0, k + 1)];
    }
    let cur = inR(c[0]) ? [c[0]] : null;
    for (let i = 0; i < c.length - 1; i++) {
      const p = c[i];
      const q = c[i + 1];
      const r = clipSeg(p, q);
      if (!r) continue;
      const [t0, t1] = r;
      if (t0 > 0 || !cur) cur = [lerp(p, q, t0)];
      if (t1 < 1) {
        cur.push(lerp(p, q, t1));
        pieces.push(cur);
        cur = null;
      } else cur.push(q);
    }
    if (cur && cur.length > 1) console.warn('coastline ends inside the map, skipped', cur.length);
  }
  const L = 4 * HX + 4 * HY;
  const s = ([x, y]) => {
    const e = 1e-6;
    if (Math.abs(y + HY) < e) return x + HX;
    if (Math.abs(x - HX) < e) return 2 * HX + (y + HY);
    if (Math.abs(y - HY) < e) return 2 * HX + 2 * HY + (HX - x);
    return 4 * HX + 2 * HY + (HY - y);
  };
  const corners = [[HX, -HY, 2 * HX], [HX, HY, 2 * HX + 2 * HY], [-HX, HY, 4 * HX + 2 * HY], [-HX, -HY, 0]];
  const used = new Set();
  for (let i = 0; i < pieces.length; i++) {
    if (used.has(i)) continue;
    const ring = [];
    let k = i;
    for (let guard = 0; guard < 500; guard++) {
      used.add(k);
      ring.push(...pieces[k]);
      const exit = s(pieces[k][pieces[k].length - 1]);
      // next entry going counter-clockwise along the border (land stays on the left)
      let best = -1;
      let bestD = Infinity;
      pieces.forEach((pc, j) => {
        const d = (s(pc[0]) - exit + L) % L;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      const passed = corners
        .map(([cx, cy, cs]) => ({ p: [cx, cy], d: (cs - exit + L) % L }))
        .filter((c) => c.d > 0 && c.d < bestD)
        .sort((a, b) => a.d - b.d);
      for (const c of passed) ring.push(c.p);
      if (best === i || used.has(best)) break;
      k = best;
    }
    rings.push(ring);
  }
  // back to y-down metres
  return rings.map((r) => r.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(-y * 10) / 10]).flat());
}
out.land = buildLand(out.coast, HALF_X + 30, HALF_Y + 30);
delete out.coast;

const file = path.join(process.cwd(), 'public', 'geo', 'santa-teresa.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log({ buildings: out.buildings.length, roads: out.roads.length, beaches: out.beaches.length, green: out.green.length, piers: out.piers.length, land: out.land.length, kb: Math.round(fs.statSync(file).size / 1024) });
