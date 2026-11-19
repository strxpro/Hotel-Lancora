import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import type { DB, User } from '../src/lib/types';

/**
 * The code from the phone (two-step login): the codes match the apps, a code works once, the key
 * is never stored readable, the emergency codes work once, and sessions die when the code changes.
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-2fa-'));
process.env.DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('codes are the ones of RFC 6238 (what Google Authenticator shows)', async () => {
  const { base32Encode, base32Decode, codeAt } = await import('../src/server/auth/totp');
  // RFC 6238 appendix B, SHA-1, key "12345678901234567890" (8 digits there: the last 6 here)
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  const at = (seconds: number) => codeAt(secret, Math.floor(seconds / 30));
  assert.equal(at(59), '287082');
  assert.equal(at(1111111109), '081804');
  assert.equal(at(1234567890), '005924');
  assert.equal(at(2000000000), '279037');
  // the same computation done independently
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(1n);
  const h = createHmac('sha1', Buffer.from('12345678901234567890')).update(msg).digest();
  const o = h[19]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  assert.equal(at(59), String(n % 1_000_000).padStart(6, '0'));
});

test('a code is accepted 30 s early or late, and only once', async () => {
  const { checkCode, codeAt, newSecret, stepOf } = await import('../src/server/auth/totp');
  const secret = newSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const now = Date.UTC(2026, 10, 18, 9, 0, 10);
  const step = stepOf(now);
  assert.equal(checkCode(secret, codeAt(secret, step), { now }), step);
  assert.equal(checkCode(secret, codeAt(secret, step - 1), { now }), step - 1, 'the phone a little behind');
  assert.equal(checkCode(secret, codeAt(secret, step + 1), { now }), step + 1, 'the phone a little ahead');
  assert.equal(checkCode(secret, codeAt(secret, step - 3), { now }), null, 'too old');
  assert.equal(checkCode(secret, codeAt(secret, step), { now, lastStep: step }), null, 'already used');
  assert.equal(checkCode(secret, `${codeAt(secret, step).slice(0, 3)} ${codeAt(secret, step).slice(3)}`, { now }), step, 'spaces are fine');
  assert.equal(checkCode(secret, '12345', { now }), null);
  assert.equal(checkCode(secret, 'abcdef', { now }), null);
});

test('the key is sealed with the site secret, and a move to another secret is recognised', async () => {
  const { openSecret, sealSecret, secretReadable, newSecret, openNote, sealNote, SealError } = await import('../src/server/auth/totp');
  const secret = newSecret();
  const sealed = sealSecret(secret);
  assert.ok(!sealed.includes(secret), 'never stored readable');
  assert.equal(openSecret(sealed), secret);
  assert.notEqual(sealSecret(secret), sealed, 'a new random IV each time');
  // a byte changed: refused
  const parts = sealed.split('.');
  parts[4] = parts[4]!.slice(0, -2) + (parts[4]!.endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => openSecret(parts.join('.')));
  // another server with another SESSION_SECRET
  const before = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'x'.repeat(40);
  assert.throws(() => openSecret(sealed), SealError);
  assert.equal(secretReadable(sealed), false);
  process.env.SESSION_SECRET = before;
  assert.equal(secretReadable(sealed), true);
  // the note used while setting up: bound in time
  assert.deepEqual(openNote<{ a: number }>(sealNote({ a: 1 }, 60_000))?.a, 1);
  assert.equal(openNote(sealNote({ a: 1 }, -1)), null, 'expired');
  assert.equal(openNote('v1.junk'), null);
});

test('second step: app code, emergency code once, wrong code, moved server', async () => {
  const { checkSecondStep, codeAt, hashRecovery, newRecoveryCodes, newSecret, sealSecret, stepOf } = await import('../src/server/auth/totp');
  const secret = newSecret();
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const c of codes) assert.match(c, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
  const tf = { secret: sealSecret(secret), enabledAt: new Date().toISOString(), recovery: codes.slice(0, 3).map(hashRecovery) };
  const now = Date.now();
  const ok = checkSecondStep(tf, codeAt(secret, stepOf(now)), now);
  assert.equal(ok.ok && ok.via, 'app');
  const valid = new Set([-1, 0, 1].map((d) => codeAt(secret, stepOf(now) + d)));
  let bad = 0;
  while (valid.has(String(bad).padStart(6, '0'))) bad++;
  assert.deepEqual(checkSecondStep(tf, String(bad).padStart(6, '0'), now), { ok: false, reason: 'wrong' });
  // an emergency code typed in capitals and without the dash still works
  const r = checkSecondStep(tf, codes[1]!.toUpperCase().replace('-', ' '));
  assert.deepEqual(r, { ok: true, via: 'recovery', index: 1 });
  assert.deepEqual(checkSecondStep(tf, codes[5]!), { ok: false, reason: 'wrong' }, 'not one of the stored ones');
  const before = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'y'.repeat(40);
  assert.deepEqual(checkSecondStep(tf, '123456'), { ok: false, reason: 'moved' });
  assert.equal(checkSecondStep(tf, codes[0]!).ok, true, 'after a move the emergency codes still open');
  process.env.SESSION_SECRET = before;
});

test('sessions carry a fingerprint: a new password or the code turned on ends them; other notes are never sessions', async () => {
  const { signSession, verifySession, signStep, verifyStep } = await import('../src/server/auth/session');
  const { stampOf } = await import('../src/server/auth/login');
  const { hashPassword } = await import('../src/server/auth/password');
  const u: Pick<User, 'passwordHash' | 'twoFactor'> = { passwordHash: hashPassword('una-password-lunga') };
  const st = stampOf(u);
  assert.equal(st, stampOf({ ...u }), 'stable');
  assert.notEqual(stampOf({ passwordHash: hashPassword('una-password-lunga') }), st, 'a new password (new salt) changes it');
  assert.notEqual(stampOf({ ...u, twoFactor: { secret: 'x', enabledAt: '2026-11-18T09:00:00.000Z', recovery: [] } }), st, 'turning the code on changes it');

  const session = await signSession({ uid: 'u-1', role: 'admin', name: 'Titolare', st });
  assert.equal((await verifySession(session))?.st, st);
  const pending = await signStep('login2fa', 'u-1', st);
  assert.equal(await verifySession(pending), null, 'the step before the code is not a session');
  assert.equal((await verifyStep('login2fa', pending))?.uid, 'u-1');
  assert.equal(await verifyStep('trust', pending), null, 'nor a trusted device');
  assert.equal(await verifyStep('login2fa', session), null, 'a session is not a step note');
  assert.equal(await verifySession(`${session}x`), null, 'tampered');
  assert.equal(await verifySession(`${session}.extra`), null);
});

test('the key is stored in the table column and comes back the same', async () => {
  const { buildSeed } = await import('../src/server/db/seed');
  const { toTables } = await import('../src/server/db/tables');
  const { fromTables } = await import('../src/server/db/tables-read');
  const db: DB = buildSeed(new Date());
  db.users[0]!.twoFactor = { secret: 'v1.ab.cd.ef.gh', enabledAt: '2026-11-18T09:00:00.000Z', recovery: ['scrypt$a$b'], lastStep: 59_000_000 };
  const rows = toTables(db);
  const row = rows.staff_users.find((r) => r.id === db.users[0]!.id)!;
  assert.deepEqual(row.two_factor, db.users[0]!.twoFactor);
  assert.equal(rows.staff_users.find((r) => r.id === db.users[1]!.id)!.two_factor, null);
  const back = fromTables(rows);
  assert.deepEqual(back.users[0]!.twoFactor, db.users[0]!.twoFactor);
  assert.ok(!('twoFactor' in back.users[1]!), 'no empty field for the others');
});
