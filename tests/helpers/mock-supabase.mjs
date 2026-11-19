// A tiny stand-in for Supabase's REST API on table hotel_state (GET / PATCH with version filter /
// POST upsert) and Storage (object upload/download), for the cloud-mode tests. Runs in its own
// process: the site's synchronous calls block their own thread while they wait.
import http from 'node:http';

const rows = new Map(); // id -> { version, data }
const files = new Map(); // bucket/name -> Buffer

function filters(url) {
  const out = {};
  for (const [k, v] of url.searchParams) if (/^eq\./.test(v)) out[k] = decodeURIComponent(v.slice(3));
  return out;
}
const body = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  if (url.pathname === '/__rows') return send(200, Object.fromEntries(rows));
  if (url.pathname === '/__bump' && req.method === 'POST') {
    // another writer: change the row behind the site's back
    const { id, patch } = JSON.parse((await body(req)).toString());
    const r = rows.get(id);
    r.version += 1;
    r.data = { ...r.data, ...patch, version: r.version };
    return send(200, { version: r.version });
  }
  if (url.pathname === '/rest/v1/hotel_state') {
    const f = filters(url);
    if (req.method === 'GET') {
      const r = rows.get(f.id);
      return send(200, r ? [{ version: r.version, data: r.data }] : []);
    }
    if (req.method === 'PATCH') {
      const r = rows.get(f.id);
      const b = JSON.parse((await body(req)).toString());
      if (!r || (f.version !== undefined && String(r.version) !== f.version)) return send(200, []);
      r.version = b.version;
      r.data = b.data;
      return send(200, [{ version: r.version }]);
    }
    if (req.method === 'POST') {
      const b = JSON.parse((await body(req)).toString());
      rows.set(b.id, { version: b.version, data: b.data });
      return send(201);
    }
  }
  const m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
  if (m) {
    const key = `${m[1]}/${m[2]}`;
    if (req.method === 'POST') {
      files.set(key, await body(req));
      return send(200, { Key: key });
    }
    if (req.method === 'GET') {
      const f = files.get(key);
      if (!f) return send(404, { error: 'not found' });
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(f);
    }
  }
  send(404, { error: 'unknown' });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`PORT ${server.address().port}\n`);
});
// seed rows sent on stdin as one JSON line: { id: { version, data } } (it can arrive in pieces)
let pending = '';
process.stdin.on('data', (d) => {
  pending += d.toString();
  let nl;
  while ((nl = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, nl);
    pending = pending.slice(nl + 1);
    if (!line.trim()) continue;
    for (const [id, r] of Object.entries(JSON.parse(line))) rows.set(id, r);
    process.stdout.write('SEEDED\n');
  }
});
