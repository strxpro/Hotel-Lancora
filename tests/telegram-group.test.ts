import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The bot in a group: it answers only when called ("Bot, …", @name, a reply to it), acts for the
 * person who wrote (their own linked Telegram), and never for someone it does not know. In a
 * private chat the quick buttons work like typing their question. Telegram itself is faked here.
 */
const dataDir = fs.mkdtempSync(path.join(process.cwd(), '.test-tg-group-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BOT_TOKEN = '123456:test-token-test-token-test-token-xx';
for (const k of ['GROQ_API_KEY', 'AI_PROVIDER', 'STORE_MODE']) delete process.env[k];
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

type Sent = { method: string; body: Record<string, unknown> };
let sent: Sent[] = [];
/** what the fake speech-to-text "hears" in the next voice note */
let heard = '';
let listened = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  const json = (x: unknown) => new Response(JSON.stringify(x), { headers: { 'content-type': 'application/json' } });
  if (u.includes('/audio/transcriptions')) {
    listened += 1;
    return json({ text: heard });
  }
  // the clean-up of a transcript gives the same words back
  if (u.includes('/chat/completions')) {
    const msgs = JSON.parse(String(init?.body)).messages as { role: string; content: string }[];
    return json({ choices: [{ message: { content: msgs[msgs.length - 1]!.content } }] });
  }
  if (u.startsWith('https://api.telegram.org/file/')) return new Response(new Uint8Array([1, 2, 3]));
  if (!u.startsWith('https://api.telegram.org/')) return realFetch(url, init);
  const method = u.split('/').pop()!;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  sent.push({ method, body });
  const result = method === 'getMe' ? { username: 'LancoraHotelBot', first_name: 'L’Ancora' } : method === 'getFile' ? { file_path: 'voice/v.oga' } : { message_id: 1 };
  return json({ ok: true, result });
}) as typeof fetch;
beforeEach(() => {
  sent = [];
});
const texts = () => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.body.text));

const GROUP = { id: -100500, type: 'supergroup' as const, title: 'Staff L’Ancora' };
const OWNER = { id: 111, first_name: 'Salvatore' };
const STRANGER = { id: 999, first_name: 'Mario' };
let n = 10;
const groupMsg = (from: typeof OWNER, text: string, extra: Record<string, unknown> = {}) => ({ message: { message_id: ++n, chat: GROUP, from, text, ...extra } });

test('setup: the owner linked his own Telegram (private chat id = his Telegram id)', async () => {
  const { mutate } = await import('../src/server/db/store');
  mutate((db) => {
    db.telegram.linkedChats = [{ chatId: String(OWNER.id), userId: db.users.find((u) => u.role === 'admin')!.id, name: 'Salvatore', linkedAt: new Date().toISOString() }];
  });
});

test('in a group, talk between people is left alone', async () => {
  const { handleTelegramUpdate } = await import('../src/server/telegram/handle');
  await handleTelegramUpdate(groupMsg(OWNER, 'Ciao, domani arrivo alle 9'));
  await handleTelegramUpdate(groupMsg(OWNER, 'quante camere libere abbiamo?'));
  assert.deepEqual(texts(), []);
});

test('“Bot, …”, @name and a reply to the bot get an answer, as a reply to that message', async () => {
  const { handleTelegramUpdate } = await import('../src/server/telegram/handle');
  await handleTelegramUpdate(groupMsg(OWNER, 'Bot, oggi'));
  assert.equal(texts().length, 1);
  assert.match(texts()[0]!, /Arrivi: \d+/);
  assert.equal((sent.find((s) => s.method === 'sendMessage')!.body.reply_parameters as { message_id: number }).message_id, n);
  sent = [];
  await handleTelegramUpdate(groupMsg(OWNER, '@LancoraHotelBot prezzi'));
  assert.match(texts()[0]!, /Prezzi base a notte/);
  sent = [];
  await handleTelegramUpdate(groupMsg(OWNER, 'e domani?', { text: 'chi arriva domani?', reply_to_message: { text: 'Arrivi…', from: { id: 1, is_bot: true, username: 'LancoraHotelBot' } } }));
  assert.match(texts()[0]!, /arriv/i);
});

test('someone the bot does not know is told how to link, and nothing is done for them', async () => {
  const { handleTelegramUpdate } = await import('../src/server/telegram/handle');
  await handleTelegramUpdate(groupMsg(STRANGER, 'Bot, pagamenti'));
  assert.equal(texts().length, 1);
  assert.match(texts()[0]!, /Non ti conosco ancora, Mario/);
});

test('the menu in a group has quick buttons; pressing one answers like the question', async () => {
  const { handleTelegramUpdate } = await import('../src/server/telegram/handle');
  await handleTelegramUpdate(groupMsg(OWNER, '@LancoraHotelBot'));
  const menu = sent.find((s) => s.method === 'sendMessage')!.body.reply_markup as { inline_keyboard: { callback_data: string }[][] };
  assert.ok(menu.inline_keyboard.flat().some((b) => b.callback_data === 'q:prezzi'));
  sent = [];
  await handleTelegramUpdate({ callback_query: { id: 'cb1', data: 'q:oggi', from: OWNER, message: { message_id: 5, chat: { id: GROUP.id, type: 'supergroup' } } } });
  assert.match(texts()[0]!, /Arrivi: \d+/);
  sent = [];
  // a stranger pressing a button gets nothing
  await handleTelegramUpdate({ callback_query: { id: 'cb2', data: 'q:pagamenti', from: STRANGER, message: { message_id: 5, chat: { id: GROUP.id, type: 'supergroup' } } } });
  assert.deepEqual(texts(), []);
});

test('in the private chat the keyboard buttons work and stay under the answers', async () => {
  const { handleTelegramUpdate } = await import('../src/server/telegram/handle');
  await handleTelegramUpdate({ message: { message_id: ++n, chat: { id: OWNER.id, type: 'private' }, from: OWNER, text: '🏷 Prezzi' } });
  const m = sent.find((s) => s.method === 'sendMessage')!;
  assert.match(String(m.body.text), /^<b>🏷 Prezzi base a notte/);
  assert.ok((m.body.reply_markup as { keyboard?: unknown[] }).keyboard, 'the quick buttons are there');
});

test('the name works with a greeting or at the end; ordinary words like “ancora” never call it', async () => {
  const { handleTelegramUpdate } = await import('../src/server/telegram/handle');
  await handleTelegramUpdate(groupMsg(OWNER, 'Ej bot, oggi'));
  assert.match(texts()[0] ?? '', /Arrivi: \d+/);
  sent = [];
  await handleTelegramUpdate(groupMsg(OWNER, 'prezzi, bot?'));
  assert.match(texts()[0] ?? '', /Prezzi base a notte/);
  sent = [];
  await handleTelegramUpdate(groupMsg(OWNER, 'Ancora niente da Booking?'));
  await handleTelegramUpdate(groupMsg(OWNER, 'Il robot della cucina è rotto'));
  await handleTelegramUpdate(groupMsg(OWNER, 'abbiamo parlato col bot ieri'));
  await handleTelegramUpdate(groupMsg(OWNER, 'ho chiesto al bot'));
  assert.deepEqual(texts(), []);
});

const voiceMsg = (from: typeof OWNER) => ({ message: { message_id: ++n, chat: GROUP, from, voice: { file_id: 'v1', duration: 4, mime_type: 'audio/ogg', file_size: 3000 } } });

test('voice notes in a group: answered when they start with its name, otherwise left alone', async () => {
  const { handleTelegramUpdate } = await import('../src/server/telegram/handle');
  // without speech-to-text the bot cannot know: it stays quiet
  await handleTelegramUpdate(voiceMsg(OWNER));
  assert.deepEqual(texts(), []);
  process.env.GROQ_API_KEY = 'gsk_test_test_test_test_test_test_test_test';
  try {
    heard = 'Domani arrivo un po’ più tardi, ci vediamo alle dieci.';
    await handleTelegramUpdate(voiceMsg(OWNER));
    assert.equal(listened, 1, 'listened to');
    assert.deepEqual(texts(), [], 'but it was not for the bot');
    heard = 'Ej bot, oggi';
    await handleTelegramUpdate(voiceMsg(OWNER));
    assert.match(texts()[0] ?? '', /🎙/);
    assert.match(texts()[1] ?? '', /Arrivi: \d+/);
    sent = [];
    // a stranger's voice notes are not even listened to
    const before = listened;
    heard = 'Bot, pagamenti';
    await handleTelegramUpdate(voiceMsg(STRANGER));
    assert.equal(listened, before);
    assert.deepEqual(texts(), []);
  } finally {
    delete process.env.GROQ_API_KEY;
  }
});
