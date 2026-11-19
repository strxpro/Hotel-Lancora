import 'server-only';
import { splitTelegramText } from './media';
import { cleanMarkdown } from '@/lib/plain-text';

/** Minimal Telegram Bot API client. The token never leaves the server. */
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && /^\d+:[\w-]{30,}$/.test(process.env.TELEGRAM_BOT_TOKEN));
}

/** Any Bot API method (the poller needs long timeouts for getUpdates). */
export async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}, timeoutMs = 15000, signal?: AbortSignal): Promise<T> {
  return call<T>(method, body, timeoutMs, signal);
}

async function call<T = unknown>(method: string, body: Record<string, unknown>, timeoutMs = 15000, signal?: AbortSignal): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram non configurato (TELEGRAM_BOT_TOKEN)');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };
  if (!json.ok) throw Object.assign(new Error(json.description || `Telegram ${method} failed`), { code: json.error_code });
  return json.result as T;
}

export type InlineButton = { text: string; callback_data: string };
/** Buttons under the typing field (private chats): each one sends its own text. */
export type ReplyKeyboard = { keyboard: { text: string }[][]; resize_keyboard?: boolean; is_persistent?: boolean; input_field_placeholder?: string };
export type SendOpts = { replyTo?: number; keyboard?: ReplyKeyboard };

/**
 * Plain assistant output, split without breaking emoji or HTML entities, made easier to read: no
 * markdown (raw asterisks or hashes), and the first line becomes a bold title when more follows.
 */
export async function sendText(chatId: string, text: string, buttons?: InlineButton[][], opts: SendOpts = {}): Promise<void> {
  const chunks = splitTelegramText(cleanMarkdown(text));
  for (const [index, chunk] of chunks.entries()) {
    let html = escapeHtml(chunk);
    if (index === 0) {
      const nl = html.indexOf('\n');
      if (nl > 0 && nl <= 90 && !html.slice(0, nl).includes('<b>')) html = `<b>${html.slice(0, nl)}</b>${html.slice(nl)}`;
    }
    const last = index === chunks.length - 1;
    await sendMessage(chatId, html, last ? buttons : undefined, { ...(index === 0 && opts.replyTo ? { replyTo: opts.replyTo } : {}), ...(last && opts.keyboard ? { keyboard: opts.keyboard } : {}) });
  }
}

export function sendMessage(chatId: string, text: string, buttons?: InlineButton[][], opts: SendOpts = {}): Promise<unknown> {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : opts.keyboard ? { reply_markup: opts.keyboard } : {}),
  });
}

export function editMessage(chatId: string, messageId: number, text: string): Promise<unknown> {
  return call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' });
}

export function answerCallback(id: string, text?: string): Promise<unknown> {
  return call('answerCallbackQuery', { callback_query_id: id, text });
}

/** Telegram's "Menu" button next to the typing field, with the bot's quick commands (private chats and groups). */
export async function setMenu(commands: { command: string; description: string }[]): Promise<void> {
  await call('setMyCommands', { commands });
  await call('setMyCommands', { commands, scope: { type: 'all_group_chats' } });
  await call('setChatMenuButton', { menu_button: { type: 'commands' } });
}

export async function setWebhook(url: string, secret: string): Promise<unknown> {
  return call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
}

export async function getMe(): Promise<{ username: string; first_name: string }> {
  return call('getMe', {});
}

export async function downloadFile(fileId: string): Promise<{ data: ArrayBuffer; path: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const info = await call<{ file_path: string }>('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${info.file_path}`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('Download file Telegram non riuscito');
  return { data: await res.arrayBuffer(), path: info.file_path };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/** Sends a picture from our server (works locally too: the file is uploaded, not linked). */
export async function sendPhoto(chatId: string, data: Buffer, caption?: string): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Telegram non configurato (TELEGRAM_BOT_TOKEN)');
  const sharp = (await import('sharp')).default;
  const jpg = await sharp(data).jpeg({ quality: 85 }).toBuffer();
  const fd = new FormData();
  fd.append('chat_id', chatId);
  fd.append('photo', new Blob([new Uint8Array(jpg)], { type: 'image/jpeg' }), 'foto.jpg');
  if (caption) fd.append('caption', caption.slice(0, 1000));
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(json.description || 'sendPhoto failed');
  return json;
}
