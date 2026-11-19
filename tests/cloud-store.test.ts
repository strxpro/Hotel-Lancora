import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { DB } from '../src/lib/types';

/**
 * Hosting without a disk (STORE_MODE=cloud): the hotel's document lives in Supabase. The site keeps
 * its synchronous readDb()/mutate(); every write is a compare-and-set on the version, so a change
 * made at the same moment by someone else is never overwritten: the change is made again on top.
 * Checked against a stand-in for Supabase running in its own process.
 */
let mock: ChildProcess;
let base = '';

const wait = (child: ChildProcess, word: string) =>
  new Promise<string>((resolve) => {
    let buf = '';
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      const line = buf.split('\n').find((l) => l.startsWith(word));
      if (line) resolve(line);
    });
  });

before(async () => {
  mock = spawn(process.execPath, [path.join(process.cwd(), 'tests/helpers/mock-supabase.mjs')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const line = await wait(mock, 'PORT');
  base = `http://127.0.0.1:${line.split(' ')[1]!.trim()}`;
  process.env.STORE_MODE = 'cloud';
  process.env.STORE_ROW = 'test';
  process.env.STORE_TTL_MS = '0';
  process.env.SUPABASE_URL = base;
  process.env.SUPABASE_SECRET_KEY = 'test-key-test-key-test-key';
  for (const k of ['GROQ_API_KEY', 'AI_PROVIDER', 'TELEGRAM_BOT_TOKEN']) delete process.env[k];
  // the document of a fresh demo, version 10, in the row "test"
  const { buildSeed } = await import('../src/server/db/seed');
  const seed = { ...buildSeed(), version: 10 };
  mock.stdin!.write(JSON.stringify({ test: { version: 10, data: seed } }) + '\n');
  await wait(mock, 'SEEDED');
});
after(() => mock?.kill());

const rows = async () => (await (await fetch(`${base}/__rows`)).json()) as Record<string, { version: number; data: DB & Record<string, unknown> }>;

test('reads the document from Supabase and saves with the next version', async () => {
  const { readDb, mutate } = await import('../src/server/db/store');
  const db = readDb();
  assert.equal(db.version, 10);
  assert.ok(db.rooms.length > 0);
  mutate((d) => {
    d.settings.hotel.tagline = 'Dal cloud';
  });
  const r = (await rows()).test!;
  assert.equal(r.version, 11);
  assert.equal(r.data.settings.hotel.tagline, 'Dal cloud');
  assert.equal(readDb().settings.hotel.tagline, 'Dal cloud');
});

test('a change saved at the same moment by someone else is kept: ours is made again on top', async () => {
  const { readDb, mutate } = await import('../src/server/db/store');
  const before = readDb();
  // another server instance saves first (version + 1, different field)
  const res = await fetch(`${base}/__bump`, { method: 'POST', body: JSON.stringify({ id: 'test', patch: { settings: { ...before.settings, hotel: { ...before.settings.hotel, phone: '+39 000 111' } } } }) });
  const theirs = ((await res.json()) as { version: number }).version;
  let runs = 0;
  mutate((d) => {
    runs += 1;
    d.settings.hotel.email = 'nuova@hotel.test';
  });
  const r = (await rows()).test!;
  assert.equal(runs, 1, 'the cache was checked first (TTL 0): one run on the fresh data');
  assert.equal(r.version, theirs + 1);
  assert.equal(r.data.settings.hotel.phone, '+39 000 111', 'their change is still there');
  assert.equal(r.data.settings.hotel.email, 'nuova@hotel.test', 'and ours too');
});

test('when the other save lands between our read and our write, the change runs again on their data', async () => {
  const { readDb, mutate } = await import('../src/server/db/store');
  const start = readDb();
  let runs = 0;
  mutate((d) => {
    runs += 1;
    if (runs === 1) {
      // while we work, someone saves (a synchronous request from here would block: use a child process)
      const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
      execFileSync(process.execPath, ['-e', `fetch(${JSON.stringify(`${base}/__bump`)}, { method: 'POST', body: JSON.stringify({ id: 'test', patch: { notes: 'loro' } }) }).then(r => r.text())`]);
    }
    d.settings.hotel.city = 'Santa Teresa (bis)';
  });
  const r = (await rows()).test!;
  assert.equal(runs, 2, 'the first save was refused, the change ran again');
  assert.equal(r.version, start.version + 2);
  assert.equal((r.data as unknown as { notes: string }).notes, 'loro');
  assert.equal(r.data.settings.hotel.city, 'Santa Teresa (bis)');
});

test('panel keys and the visit counter live in rows next to the document', async () => {
  const { writeIntegrations, readIntegrations } = await import('../src/server/integrations');
  writeIntegrations({ groqKey: 'gsk_test_cloud' });
  assert.equal(readIntegrations().groqKey, 'gsk_test_cloud');
  const all = await rows();
  assert.equal((all['test:integrations']!.data as { groqKey?: string }).groqKey, 'gsk_test_cloud');
  const { recordVisit, visitsOn } = await import('../src/server/visits');
  const { todayISO } = await import('../src/lib/dates');
  recordVisit('1.2.3.4', 'Mozilla/5.0 Firefox', '/camere/101');
  recordVisit('1.2.3.4', 'Mozilla/5.0 Firefox', '/prenotazione');
  const v = visitsOn(todayISO());
  assert.deepEqual([v.visitors, v.views, v.roomViews, v.bookingViews], [1, 2, 1, 1]);
});

test('photos go to Storage and come back', async () => {
  const { putMedia, getMedia } = await import('../src/server/media-store');
  const src = await putMedia('abcdef12-3456.webp', Buffer.from('foto'));
  assert.equal(src, '/api/media/abcdef12-3456.webp');
  assert.equal((await getMedia('abcdef12-3456.webp'))?.toString(), 'foto');
  assert.equal(await getMedia('../../etc/passwd'), null);
});
