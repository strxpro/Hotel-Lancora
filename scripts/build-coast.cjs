// Builds src/content/coast.ts from an Overpass coastline extract (OSM, ODbL).
// 1) POST to https://overpass-api.de/api/interpreter:
//    [out:json][timeout:90];way["natural"="coastline"](41.16,9.04,41.43,9.37);out geom;
// 2) node scripts/build-coast.cjs coast.json src/content/coast.ts
const fs = require('fs');
const src = process.argv[2];
const out = process.argv[3];
const j = JSON.parse(fs.readFileSync(src, 'utf8'));

// visible area (lat/lon) — the map viewBox
const B = { minLat: 41.17, maxLat: 41.42, minLon: 9.05, maxLon: 9.36 };
const lat0 = (B.minLat + B.maxLat) / 2;
const K = 1000 / ((B.maxLon - B.minLon) * Math.cos((lat0 * Math.PI) / 180)); // 1000 units wide
const px = (lon) => (lon - B.minLon) * Math.cos((lat0 * Math.PI) / 180) * K;
const py = (lat) => (B.maxLat - lat) * K;
const H = py(B.minLat);

// 1) chain ways by shared end nodes
const ways = j.elements.filter((e) => e.type === 'way' && e.geometry && e.nodes);
const byFirst = new Map();
for (const w of ways) byFirst.set(w.nodes[0], w);
const used = new Set();
const chains = [];
for (const w of ways) {
  if (used.has(w.id)) continue;
  used.add(w.id);
  let nodes = [...w.nodes];
  let pts = w.geometry.map((g) => [g.lon, g.lat]);
  // extend forward
  for (;;) {
    const nx = byFirst.get(nodes[nodes.length - 1]);
    if (!nx || used.has(nx.id)) break;
    used.add(nx.id);
    nodes = nodes.concat(nx.nodes.slice(1));
    pts = pts.concat(nx.geometry.slice(1).map((g) => [g.lon, g.lat]));
  }
  // extend backward
  for (;;) {
    const pv = ways.find((x) => !used.has(x.id) && x.nodes[x.nodes.length - 1] === nodes[0]);
    if (!pv) break;
    used.add(pv.id);
    nodes = pv.nodes.slice(0, -1).concat(nodes);
    pts = pv.geometry.slice(0, -1).map((g) => [g.lon, g.lat]).concat(pts);
  }
  chains.push({ closed: nodes[0] === nodes[nodes.length - 1], pts });
}

// 2) close open chains around an outer frame, counter-clockwise (land stays on the left)
let all = chains.flatMap((c) => c.pts);
const F = { minLon: Math.min(...all.map((p) => p[0])) - 0.02, maxLon: Math.max(...all.map((p) => p[0])) + 0.02, minLat: Math.min(...all.map((p) => p[1])) - 0.02, maxLat: Math.max(...all.map((p) => p[1])) + 0.02 };
const W = F.maxLon - F.minLon;
const Hh = F.maxLat - F.minLat;
const P = 2 * (W + Hh);
function toFrame([lon, lat]) {
  const d = [
    [lat - F.minLat, [lon, F.minLat]],
    [F.maxLon - lon, [F.maxLon, lat]],
    [F.maxLat - lat, [lon, F.maxLat]],
    [lon - F.minLon, [F.minLon, lat]],
  ].sort((a, b) => a[0] - b[0])[0][1];
  return d;
}
function sOf([lon, lat]) {
  const e = 1e-9;
  if (Math.abs(lat - F.minLat) < e) return lon - F.minLon;
  if (Math.abs(lon - F.maxLon) < e) return W + (lat - F.minLat);
  if (Math.abs(lat - F.maxLat) < e) return W + Hh + (F.maxLon - lon);
  return 2 * W + Hh + (F.maxLat - lat);
}
const corners = [
  [W, [F.maxLon, F.minLat]],
  [W + Hh, [F.maxLon, F.maxLat]],
  [2 * W + Hh, [F.minLon, F.maxLat]],
  [P, [F.minLon, F.minLat]],
];
const polys = [];
for (const c of chains) {
  if (c.closed) {
    polys.push(c.pts);
    continue;
  }
  const a = toFrame(c.pts[c.pts.length - 1]);
  const b = toFrame(c.pts[0]);
  let s = sOf(a);
  let t = sOf(b);
  if (t <= s) t += P;
  const extra = [a];
  for (const [cs, cp] of [...corners, ...corners.map(([x, p]) => [x + P, p])]) if (cs > s && cs < t) extra.push(cp);
  extra.push(b);
  polys.push(c.pts.concat(extra));
}

// 3) project, drop shapes outside the view, simplify (Douglas–Peucker)
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, k] = stack.pop();
    const [ax, ay] = pts[i];
    const [bx, by] = pts[k];
    const dx = bx - ax;
    const dy = by - ay;
    const L = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bi = -1;
    for (let m = i + 1; m < k; m++) {
      const d = Math.abs(dy * pts[m][0] - dx * pts[m][1] + bx * ay - by * ax) / L;
      if (d > best) {
        best = d;
        bi = m;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([i, bi], [bi, k]);
    }
  }
  return pts.filter((_, n) => keep[n]);
}
const clampPt = ([x, y]) => [Math.max(-700, Math.min(1700, x)), Math.max(-700, Math.min(H + 700, y))];
let paths = [];
let count = 0;
for (const p of polys) {
  const proj = p.map(([lon, lat]) => [px(lon), py(lat)]);
  const minX = Math.min(...proj.map((q) => q[0]));
  const maxX = Math.max(...proj.map((q) => q[0]));
  const minY = Math.min(...proj.map((q) => q[1]));
  const maxY = Math.max(...proj.map((q) => q[1]));
  if (maxX < 0 || minX > 1000 || maxY < 0 || minY > H) continue; // not visible
  if ((maxX - minX) * (maxY - minY) < 1.5) continue; // specks
  // rings: split in two halves so Douglas–Peucker has distinct endpoints
  const ring = proj.map(clampPt);
  const mid = Math.floor(ring.length / 2);
  const simp = dp(ring.slice(0, mid + 1), 0.55).concat(dp(ring.slice(mid), 0.55).slice(1));
  if (simp.length < 3) continue;
  count += simp.length;
  paths.push('M' + simp.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z');
}
const d = paths.join('');
const file = `/**
 * Coastline of the north of Sardinia, the Maddalena islands and southern Corsica, generated once
 * from OpenStreetMap data (© OpenStreetMap contributors, ODbL) — no map tiles, no third parties.
 * Projection: equirectangular, 1000 units wide. Regenerate with an Overpass "natural=coastline" extract.
 */
export const COAST = {
  bounds: ${JSON.stringify(B)},
  width: 1000,
  height: ${H.toFixed(1)},
  lat0: ${lat0},
  land: ${JSON.stringify(d)},
} as const;
`;
fs.writeFileSync(out, file, 'utf8');
console.log('chains', chains.length, 'closed', chains.filter((c) => c.closed).length, 'paths', paths.length, 'points', count, 'bytes', file.length, 'height', H.toFixed(1));
