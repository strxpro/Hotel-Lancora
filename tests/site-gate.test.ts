import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatePasswordOk, gateToken, gatePage, safeNext } from '../src/lib/site-gate';

test('the site lock: the right password only, a signed cookie, a way back to the same page', async () => {
  delete process.env.SITE_PASSWORD;
  assert.equal(await gatePasswordOk('lancora123'), true);
  assert.equal(await gatePasswordOk(' lancora123 '), true);
  assert.equal(await gatePasswordOk('Lancora123'), false);
  assert.equal(await gatePasswordOk(''), false);
  const t = await gateToken();
  assert.match(t, /^[0-9a-f]{64}$/);
  // another password = the old cookies stop working
  process.env.SITE_PASSWORD = 'altra-password';
  assert.notEqual(await gateToken(), t);
  assert.equal(await gatePasswordOk('lancora123'), false);
  delete process.env.SITE_PASSWORD;
  assert.equal(safeNext('/camere?x=1'), '/camere?x=1');
  assert.equal(safeNext('//evil.example'), '/');
  assert.equal(safeNext('https://evil.example'), '/');
  assert.match(gatePage('/camere"><script>', true), /value="\/camere&quot;&gt;&lt;script&gt;"/);
  assert.match(gatePage('/', true), /Password non corretta/);
});
