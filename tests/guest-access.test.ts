import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Booking } from '../src/lib/types';
import { normalizeEmail, readGuest, signGuest, verifyAccessCode } from '../src/server/guest-access';
import { abandonedLeads } from '../src/server/bookings';

const codes = (globalThis as unknown as { __lancoraGuestCodes: Map<string, { hash: string; exp: number; tries: number; sentAt: number }> }).__lancoraGuestCodes;
const put = (email: string, code: string) => codes.set(email, { hash: createHash('sha256').update(`${email}:${code}`).digest('hex'), exp: Date.now() + 60_000, tries: 0, sentAt: Date.now() });

test('e-mail addresses are compared in one form', () => {
  assert.equal(normalizeEmail('  Mario.Rossi@Gmail.COM '), 'mario.rossi@gmail.com');
  assert.equal(normalizeEmail('mario@'), null);
  assert.equal(normalizeEmail('not an email'), null);
  assert.equal(normalizeEmail(42), null);
});

test('the right code signs in once, wrong codes count down and then lock', () => {
  put('ospite@example.com', '123456');
  assert.deepEqual(verifyAccessCode('ospite@example.com', '000000'), { ok: false, reason: 'wrong', left: 4 });
  assert.deepEqual(verifyAccessCode('ospite@example.com', '123 456'), { ok: true });
  assert.deepEqual(verifyAccessCode('ospite@example.com', '123456'), { ok: false, reason: 'expired' }); // used up

  put('altro@example.com', '654321');
  for (let i = 0; i < 4; i++) verifyAccessCode('altro@example.com', '111111');
  assert.deepEqual(verifyAccessCode('altro@example.com', '111111'), { ok: false, reason: 'locked' });
  assert.deepEqual(verifyAccessCode('altro@example.com', '654321'), { ok: false, reason: 'locked' }); // even the right one, after 5 tries
  assert.deepEqual(verifyAccessCode('nessuno@example.com', '123456'), { ok: false, reason: 'expired' });
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
