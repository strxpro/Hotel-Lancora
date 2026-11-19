import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The AI must keep answering when the best free Groq model has used up its daily quota, and what
 * the owner writes to a guest must reach them in their language (or unchanged when translation fails).
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-ai-'));
process.env.DATA_DIR = dataDir;
process.env.GROQ_API_KEY = 'gsk_test_key_for_the_fake_api';
delete process.env.AI_PROVIDER;
delete process.env.GROQ_MODEL;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
let script: (model: string, call: number) => Reply = () => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } });
let calls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/models')) return Response.json({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-20b' }, { id: 'whisper-large-v3' }, { id: 'meta-llama/llama-guard-4-12b' }] });
  const body = JSON.parse(String(init?.body)) as { model: string };
  calls.push(body.model);
  const r = script(body.model, calls.length);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
}) as typeof fetch;
after(() => void (globalThis.fetch = realFetch));
beforeEach(() => {
  calls = [];
  (globalThis as { __groqRest?: unknown }).__groqRest = undefined;
});

const answer = (content: string): Reply => ({ status: 200, body: { choices: [{ message: { content } }] } });

test('a model out of quota rests and the next one answers; other errors are not hidden', async () => {
  const { getProvider, groqChatModels } = await import('../src/server/ai/provider');
  assert.deepEqual(await groqChatModels(), ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'], 'chat models only, best first');

  script = (m) => (m === 'openai/gpt-oss-120b' ? { status: 429, body: { error: { message: 'Rate limit reached for tokens per day' } }, headers: { 'retry-after': '3600' } } : answer(`risposta da ${m}`));
  const p = getProvider()!;
  assert.equal(await p.complete([{ role: 'user', content: 'ciao' }]), 'risposta da llama-3.3-70b-versatile');
  assert.deepEqual(calls, ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile']);

  // the tired model is not asked again while it rests
  calls = [];
  assert.equal(await p.complete([{ role: 'user', content: 'ancora' }]), 'risposta da llama-3.3-70b-versatile');
  assert.deepEqual(calls, ['llama-3.3-70b-versatile']);
  assert.deepEqual(await groqChatModels(Date.now() + 2 * 3600_000), ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'], 'back after the quota resets');

  // a wrong request is a real error: no point asking the other models
  (globalThis as { __groqRest?: unknown }).__groqRest = undefined;
  calls = [];
  script = () => ({ status: 400, body: { error: { message: 'bad request' } } });
  await assert.rejects(p.complete([{ role: 'user', content: 'x' }]), /Provider 400/);
  assert.equal(calls.length, 1);

  // every model out of quota: the error comes back (the assistant then answers with its rules)
  calls = [];
  script = () => ({ status: 429, body: { error: { message: 'limit' } } });
  await assert.rejects(p.complete([{ role: 'user', content: 'x' }]), /Provider 429/);
  assert.equal(calls.length, 3);
});

test('what the owner writes reaches the guest in the guest’s language, or unchanged when translation fails', async () => {
  const { translateForGuest } = await import('../src/server/ai/content');
  script = () => answer(JSON.stringify({ body: 'Ihr Zimmer ist ab 12 Uhr bereit.' }));
  const de = await translateForGuest({ body: 'La camera è pronta dalle 12.' }, 'de');
  assert.deepEqual(de, { fields: { body: 'Ihr Zimmer ist ab 12 Uhr bereit.' }, translated: true });

  calls = [];
  const it = await translateForGuest({ body: 'La camera è pronta dalle 12.' }, 'it');
  assert.deepEqual(it, { fields: { body: 'La camera è pronta dalle 12.' }, translated: false });
  assert.equal(calls.length, 0, 'an Italian guest needs no translation');

  script = () => ({ status: 429, body: { error: { message: 'limit' } } });
  const failed = await translateForGuest({ body: 'La camera è pronta dalle 12.' }, 'en');
  assert.deepEqual(failed, { fields: { body: 'La camera è pronta dalle 12.' }, translated: false }, 'never an empty or broken e-mail');
});
