import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The Make scenario answers after Gmail: the site must tell "sent" from "refused" (and never take a
 * refused e-mail, or Cloudflare's error page in front of Make, for a sent one).
 */
test('the answer of the Make scenario is read right', async () => {
  const { webhookAnswer } = await import('../src/server/email/transport');
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  assert.equal(await webhookAnswer(json(200, { ok: true })), 'sent');
  assert.equal(await webhookAnswer(new Response('Accepted', { status: 200 })), 'accepted', 'an older scenario without a reply step');
  await assert.rejects(webhookAnswer(json(422, { ok: false, error: 'Gmail non ha inviato l’email' })), /Make\.com: Gmail non ha inviato/);
  await assert.rejects(webhookAnswer(json(200, { ok: false, error: 'quota' })), /Make\.com: quota/, 'ok:false is a failure whatever the status');
  await assert.rejects(webhookAnswer(json(403, { ok: false })), /chiave del sito/);
  await assert.rejects(webhookAnswer(new Response('<!DOCTYPE html><html>Bad gateway</html>', { status: 502 })), /Make\.com: errore 502$/, 'no HTML page in the message');
  await assert.rejects(webhookAnswer(new Response('There is no scenario listening for this webhook.', { status: 410 })), /no scenario listening/);
});
