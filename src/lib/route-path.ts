type Pt = { x: number; y: number };

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

/**
 * A road drawn like a road: the polyline of the route with every bend rounded (a quadratic curve
 * that starts and ends on the two streets, never wider than `radius` nor than half a street), so
 * the line follows the real streets without sharp elbows. Points closer than `minStep` are merged.
 */
export function roundedPath(points: Pt[], radius: number, minStep = 0): string {
  const p: Pt[] = [];
  for (const q of points) {
    const last = p[p.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) > minStep) p.push(q);
  }
  // keep the real end even when it was merged into the point before
  const end = points[points.length - 1];
  if (end && p.length && p[p.length - 1] !== end) p[p.length - 1] = end;
  if (!p.length) return '';
  if (p.length < 3) return p.map((q, i) => `${i ? 'L' : 'M'}${f(q.x)} ${f(q.y)}`).join('');
  let d = `M${f(p[0]!.x)} ${f(p[0]!.y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const c = p[i + 1]!;
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (!(r > 0)) {
      d += `L${f(b.x)} ${f(b.y)}`;
      continue;
    }
    const s = { x: b.x + ((a.x - b.x) * r) / l1, y: b.y + ((a.y - b.y) * r) / l1 };
    const e = { x: b.x + ((c.x - b.x) * r) / l2, y: b.y + ((c.y - b.y) * r) / l2 };
    d += `L${f(s.x)} ${f(s.y)}Q${f(b.x)} ${f(b.y)} ${f(e.x)} ${f(e.y)}`;
  }
  const z = p[p.length - 1]!;
  return `${d}L${f(z.x)} ${f(z.y)}`;
}
