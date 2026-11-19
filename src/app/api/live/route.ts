import { dataVersion, liveListeners } from '@/server/db/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Live updates pushed to the browser (Server-Sent Events): every change saved by the panel,
 * the assistant, Telegram or a booking is announced at once, and the page refreshes its data
 * without reloading. A slow check also catches changes written by other processes.
 */
export function GET(req: Request) {
  const enc = new TextEncoder();
  let last = -1;
  let cleanup = () => undefined as void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (v: number) => {
        if (v === last) return;
        last = v;
        controller.enqueue(enc.encode(`data: ${v}\n\n`));
      };
      send(dataVersion());
      const listeners = liveListeners();
      listeners.add(send);
      const check = setInterval(() => {
        try {
          send(dataVersion());
        } catch {
          /* store busy */
        }
      }, 3000);
      const ping = setInterval(() => controller.enqueue(enc.encode(': ping\n\n')), 20000);
      cleanup = () => {
        listeners.delete(send);
        clearInterval(check);
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener('abort', () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}
