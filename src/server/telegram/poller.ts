import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { telegramConfigured, tg } from './api';
import { handleTelegramUpdate, type Update } from './handle';

/**
 * Telegram without a public address.
 *
 * Telegram can only "call" a site that is on the internet (webhook). On the hotel's own computer
 * the site listens by itself instead: it keeps one long request open to Telegram and receives
 * every message the moment it is sent. No tunnel, no second program, nothing to start by hand —
 * if the site is running, the bot answers.
 *
 *  · stable public https address in APP_URL  → webhook (Telegram calls us);
 *  · anything else (localhost, a temporary tunnel) → this listener. A webhook left behind by an old
 *    tunnel is removed, otherwise Telegram would keep sending messages to a dead address.
 * Only one process listens at a time (lock file with a heartbeat), so a dev server and a production
 * server on the same machine never fight over the messages.
 */
type State = { started: boolean; mode: 'off' | 'listening' | 'webhook' | 'standby'; since: string | null; lastUpdateAt: string | null; lastError: string | null; handled: number; bot: string | null };
const g = globalThis as typeof globalThis & { __lancoraTg?: State };
const state: State = (g.__lancoraTg ??= { started: false, mode: 'off', since: null, lastUpdateAt: null, lastError: null, handled: 0, bot: null });

const LOCK = path.join(process.cwd(), 'data', '.telegram-listener.lock');
// When the server is told to stop, the listener must let go at once: an open long request would keep
// the old process alive (still answering Telegram with old code) after the site has been restarted.
const stop = new AbortController();
const sleep = (ms: number) =>
  new Promise<void>((r) => {
    if (stop.signal.aborted) return r();
    const t = setTimeout(r, ms);
    t.unref?.();
    stop.signal.addEventListener('abort', () => (clearTimeout(t), r()), { once: true });
  });
function shutdown() {
  if (stop.signal.aborted) return;
  stop.abort();
  try {
    const l = JSON.parse(fs.readFileSync(LOCK, 'utf8')) as { pid: number };
    if (l.pid === process.pid) fs.unlinkSync(LOCK); // the next server can take over immediately
  } catch {
    /* no lock of ours */
  }
}

/** A real, lasting public address (not localhost, not a throw-away tunnel). */
export function stablePublicUrl(): string | null {
  const u = (process.env.APP_URL ?? '').trim();
  if (!/^https:\/\//i.test(u)) return null;
  try {
    const host = new URL(u).hostname;
    if (host === 'localhost' || /^127\.|^192\.168\.|^10\./.test(host) || /trycloudflare\.com$|ngrok|loca\.lt$|localhost\.run$/i.test(host)) return null;
    return u.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function telegramRuntime(): State & { wanted: 'webhook' | 'listening' | 'off' } {
  // the lock file tells the truth across processes (the panel may be served by another one)
  let other: Partial<State> = {};
  try {
    const l = JSON.parse(fs.readFileSync(LOCK, 'utf8')) as { pid: number; at: number; state?: Partial<State> };
    if (l.pid !== process.pid && Date.now() - l.at < 60_000) other = l.state ?? {};
  } catch {
    /* no lock */
  }
  return { ...state, ...(state.mode === 'standby' || !state.started ? other : {}), wanted: !telegramConfigured() ? 'off' : stablePublicUrl() ? 'webhook' : 'listening' };
}

function holdLock(): boolean {
  try {
    if (fs.existsSync(LOCK)) {
      const l = JSON.parse(fs.readFileSync(LOCK, 'utf8')) as { pid: number; at: number };
      if (l.pid !== process.pid && Date.now() - l.at < 45_000) {
        try {
          process.kill(l.pid, 0); // alive?
          return false;
        } catch {
          /* owner is gone: take over */
        }
      }
    }
    fs.mkdirSync(path.dirname(LOCK), { recursive: true });
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now(), state: { mode: state.mode, since: state.since, lastUpdateAt: state.lastUpdateAt, lastError: state.lastError, handled: state.handled, bot: state.bot } }));
    return true;
  } catch {
    return true; // no disk access: better to listen than to stay silent
  }
}

async function loop() {
  let offset = 0;
  let first = true;
  let beat: ReturnType<typeof setInterval> | null = null;
  for (;;) {
    if (stop.signal.aborted) return;
    if (!telegramConfigured()) {
      state.mode = 'off';
      await sleep(30_000);
      continue;
    }
    if (stablePublicUrl()) {
      state.mode = 'webhook';
      await sleep(60_000);
      continue;
    }
    if (!holdLock()) {
      state.mode = 'standby';
      await sleep(15_000);
      continue;
    }
    if (!beat) {
      beat = setInterval(() => state.mode === 'listening' && !stop.signal.aborted && holdLock(), 15_000);
      beat.unref?.();
    }
    try {
      if (state.mode !== 'listening') {
        const info = await tg<{ url?: string }>('getWebhookInfo');
        if (info.url) await tg('deleteWebhook', { drop_pending_updates: false });
        state.bot ??= (await tg<{ username: string }>('getMe')).username;
        state.mode = 'listening';
        state.since = new Date().toISOString();
        state.lastError = null;
        console.log(`[telegram] in ascolto diretto per @${state.bot}`);
      }
      const updates = await tg<(Update & { update_id: number })[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 40_000, stop.signal);
      for (const u of updates) {
        offset = u.update_id + 1;
        // after a long silence do not answer yesterday's messages one by one
        if (first && u.message?.date && Date.now() / 1000 - u.message.date > 900) continue;
        state.lastUpdateAt = new Date().toISOString();
        state.handled += 1;
        await handleTelegramUpdate(u).catch((e) => console.error('[telegram] update failed:', (e as Error).message));
      }
      first = false;
    } catch (e) {
      if (stop.signal.aborted) return;
      const err = e as Error & { code?: number };
      state.lastError = err.message;
      // 409: a webhook was set again (old tunnel script) or another listener is active → re-check from scratch
      if (err.code === 409 || /webhook|terminated by other/i.test(err.message)) state.mode = 'standby';
      if (err.name !== 'TimeoutError') await sleep(err.code === 409 ? 6000 : 3000);
    }
  }
}

/** Called once when the server starts (instrumentation). */
export function startTelegramListener() {
  if (state.started) return;
  // `npm run dev` next to the real site never listens to the bot (the two kept kicking each other
  // off and every message was answered twice); DEV_JOBS=on allows it on purpose
  if (process.env.NODE_ENV === 'development' && process.env.DEV_JOBS !== 'on') return;
  state.started = true;
  // a listener on a signal replaces Node's default 'exit': if nothing else ends the process within a
  // moment (the web server closing normally does), end it here so no old copy stays behind
  const onSignal = () => {
    shutdown();
    const t = setTimeout(() => process.exit(0), 1500);
    t.unref?.();
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.once(sig, onSignal);
  process.once('beforeExit', shutdown);
  void loop();
}
