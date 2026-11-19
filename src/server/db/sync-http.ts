import 'server-only';
import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';

/**
 * A synchronous HTTP call, for the few places that must stay synchronous on serverless hosting
 * (the data store: readDb()/mutate() are called synchronously in hundreds of places).
 *
 * A small worker thread does the real fetch; this thread waits for it (Atomics.wait) and reads the
 * answer synchronously (receiveMessageOnPort). One worker per server instance, created on first use.
 */
const WORKER = `
const { parentPort } = require('node:worker_threads');
parentPort.on('message', async ({ port, flag, url, init, timeoutMs }) => {
  let out;
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    out = { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) {
    out = { ok: false, status: 0, text: String((e && e.message) || e) };
  }
  port.postMessage(out);
  port.close();
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
`;

export interface SyncResponse {
  ok: boolean;
  status: number;
  text: string;
}

const g = globalThis as unknown as { __lancoraSyncWorker?: Worker };

function worker(): Worker {
  if (!g.__lancoraSyncWorker) {
    const w = new Worker(WORKER, { eval: true });
    w.unref();
    w.on('error', (e) => {
      console.error('[sync-http] worker:', e.message);
      g.__lancoraSyncWorker = undefined;
    });
    g.__lancoraSyncWorker = w;
  }
  return g.__lancoraSyncWorker;
}

export function syncFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, timeoutMs = 15000): SyncResponse {
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const { port1, port2 } = new MessageChannel();
  worker().postMessage({ port: port2, flag, url, init, timeoutMs }, [port2]);
  // a little more than the fetch's own timeout, so the worker always answers first
  const waited = Atomics.wait(flag, 0, 0, timeoutMs + 2000);
  const msg = receiveMessageOnPort(port1);
  port1.close();
  if (waited === 'timed-out' || !msg) return { ok: false, status: 0, text: 'timeout' };
  return msg.message as SyncResponse;
}
