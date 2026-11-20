import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Booking, DB } from '../src/lib/types';
import { codeFor, codeMatches, maskEmail, readCashCookie, recentCashBookings, writeCashCookie } from '../src/server/email-code';
import { normalizeEmail, readGuest, signGuest, verifyAccessCode } from '../src/server/guest-access';
import { abandonedLeads } from '../src/server/bookings';

test('e-mail addresses are compared in one form', () => {
  assert.equal(normalizeEmail('  Mario.Rossi@Gmail.COM '), 'mario.rossi@gmail.com');
  assert.equal(normalizeEmail('mario@'), null);
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail(42), null);
});

test('the right code signs in once, wrong codes count down and then lock', () => {
  const right = codeFor('guest', 'ospite@example.com');
  const wrong = right === '000000' ? '000001' : '000000';
  assert.deepEqual(verifyAccessCode('ospite@example.com', wrong), { ok: false, reason: 'wrong', left: 4 });
  assert.deepEqual(verifyAccessCode('ospite@example.com', `${right.slice(0, 3)} ${right.slice(3)}`), { ok: true });
  assert.deepEqual(verifyAccessCode('ospite@example.com', right), { ok: false, reason: 'expired' }); // used up

  const other = codeFor('guest', 'altro@example.com');
  const bad = other === '111111' ? '111112' : '111111';
  for (let i = 0; i < 4; i++) verifyAccessCode('altro@example.com', bad);
  assert.deepEqual(verifyAccessCode('altro@example.com', bad), { ok: false, reason: 'locked' });
  assert.deepEqual(verifyAccessCode('altro@example.com', other), { ok: false, reason: 'locked' }); // even the right one, after 5 tries
  // another address's code opens nothing
  assert.equal(verifyAccessCode('nessuno@example.com', codeFor('guest', 'ospite@example.com')).ok, codeFor('guest', 'nessuno@example.com') === codeFor('guest', 'ospite@example.com'));
});

test('codes: recognised by any server for 10–20 minutes, bound to what they open', () => {
  const t = Date.UTC(2027, 6, 1, 10, 3);
  const c = codeFor('cash', 'tok|a@b.it', t);
  assert.match(c, /^[0-9]{6}$/);
  assert.ok(codeMatches('cash', 'tok|a@b.it', c, t + 5 * 60_000));
  assert.ok(codeMatches('cash', 'TOK|A@B.IT', c, t), 'case does not matter');
  assert.ok(!codeMatches('cash', 'tok|a@b.it', c, t + 25 * 60_000), 'too old');
  assert.ok(!codeMatches('guest', 'tok|a@b.it', c, t), 'a cash code is not a sign-in code');
  assert.ok(!codeMatches('cash', 'other|a@b.it', c, t) || codeFor('cash', 'other|a@b.it', t) === c);
  assert.ok(!codeMatches('cash', 'tok|a@b.it', '12345', t), 'six digits');
  assert.equal(maskEmail('mario.rossi@gmail.com'), 'm•••••@gmail.com');
});

test('pay at the hotel: the device list is signed and only counts the last 24 hours', () => {
  const now = Date.now();
  const cookie = writeCashCookie([now - 25 * 3600_000, now - 3600_000, now]);
  assert.deepEqual(readCashCookie(cookie, now), [now - 3600_000, now]);
  const [body, sig] = cookie.split('.');
  const forged = Buffer.from(JSON.stringify([])).toString('base64url');
  assert.deepEqual(readCashCookie(`${forged}.${sig}`, now), [], 'an edited list is ignored');
  assert.deepEqual(readCashCookie(`${body}.x`, now), []);
  assert.deepEqual(readCashCookie(undefined, now), []);
  const db = { bookings: [
    { guest: { email: 'A@b.it' }, paymentMethod: 'cash', source: 'sito', status: 'confirmed', createdAt: new Date(now - 3600_000).toISOString() },
    { guest: { email: 'a@b.it' }, paymentMethod: 'cash', source: 'sito', status: 'cancelled', createdAt: new Date(now).toISOString() },
    { guest: { email: 'a@b.it' }, paymentMethod: 'card', source: 'sito', status: 'confirmed', createdAt: new Date(now).toISOString() },
    { guest: { email: 'a@b.it' }, paymentMethod: 'cash', source: 'sito', status: 'confirmed', createdAt: new Date(now - 30 * 3600_000).toISOString() },
  ] } as unknown as DB;
  assert.equal(recentCashBookings(db, 'a@b.it', now), 1);
});

test('the remember-me cookie cannot be forged or edited', () => {
  const tok = signGuest('ospite@example.com');
  assert.equal(readGuest(tok), 'ospite@example.com');
  const [body, sig] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ e: 'altro@example.com', x: 9999999999 })).toString('base64url');
  assert.equal(readGuest(`${forged}.${sig}`), null);
  assert.equal(readGuest(`${body}.${sig!.slice(0, -2)}xx`), null);
  assert.equal(readGuest(undefined), null);
});

test('an abandoned checkout is reported once, never when the guest booked again', () => {
  const b = (id: string, email: string, at: string, status: Booking['status']) => ({ id, guest: { email }, createdAt: at, status }) as unknown as Booking;
  const a1 = b('a1', 'Test@Gmail.com', '2026-11-12T20:00:00Z', 'pending_payment');
  const a2 = b('a2', 'test@gmail.com', '2026-11-12T20:05:00Z', 'pending_payment');
  const other = b('o1', 'other@gmail.com', '2026-11-12T20:01:00Z', 'pending_payment');
  // three expire together: the guest's latest attempt and the other guest
  assert.deepEqual(abandonedLeads([a1, a2, other], [a1, a2, other]).map((x) => x.id), ['a2', 'o1']);
  // the guest paid on a third try: nothing to report for them
  const paid = b('p1', 'test@gmail.com', '2026-11-12T20:09:00Z', 'confirmed');
  assert.deepEqual(abandonedLeads([a1, a2, other, paid], [a1, a2, other]).map((x) => x.id), ['o1']);
  // a later booking that was already cancelled does not hide the lead
  const gone = b('g1', 'other@gmail.com', '2026-11-12T20:02:00Z', 'cancelled');
  assert.deepEqual(abandonedLeads([other, gone], [other]).map((x) => x.id), ['o1']);
});
