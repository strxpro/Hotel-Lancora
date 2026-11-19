import 'server-only';

/**
 * Pluggable LLM provider layer. Nothing here is required to run the demo: when no provider is
 * configured every AI feature falls back to a deterministic, clearly-labelled mode.
 *
 *  AI_PROVIDER=ollama     → local model via Ollama (OLLAMA_URL, OLLAMA_MODEL)
 *  AI_PROVIDER=openai     → any OpenAI-compatible endpoint, incl. free tiers (OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL)
 *  AI_PROVIDER=anthropic  → Claude API (ANTHROPIC_API_KEY, ANTHROPIC_MODEL)
 *  GROQ_API_KEY (or "Collega" in Impostazioni) → free Groq tier: Llama for chat + Whisper for voice
 */
import { groqKey } from '../integrations';
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface AIProvider {
  id: 'ollama' | 'openai' | 'anthropic' | 'groq';
  model: string;
  label: string;
  complete(messages: ChatMessage[], opts?: { json?: boolean; maxTokens?: number; temperature?: number }): Promise<string>;
  stream(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): AsyncGenerator<string>;
}

const TIMEOUT = Number(process.env.AI_TIMEOUT_MS || 45000);

async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const l of lines) if (l.trim()) yield l.trim();
  }
  if (buf.trim()) yield buf.trim();
}

function ollama(): AIProvider {
  const base = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
  const body = (messages: ChatMessage[], stream: boolean, o: { json?: boolean; temperature?: number } = {}) =>
    JSON.stringify({ model, messages, stream, ...(o.json ? { format: 'json' } : {}), options: { temperature: o.temperature ?? 0.4 } });
  return {
    id: 'ollama',
    model,
    label: `Ollama (locale) · ${model}`,
    async complete(messages, o = {}) {
      const r = await fetch(`${base}/api/chat`, { method: 'POST', body: body(messages, false, o), signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok) throw new Error(`Ollama ${r.status}`);
      const j = (await r.json()) as { message?: { content: string } };
      return j.message?.content ?? '';
    },
    async *stream(messages, o = {}) {
      const r = await fetch(`${base}/api/chat`, { method: 'POST', body: body(messages, true, o), signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok || !r.body) throw new Error(`Ollama ${r.status}`);
      for await (const line of readLines(r.body)) {
        const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        if (j.message?.content) yield j.message.content;
      }
    },
  };
}

function openaiCompatible(o: { base?: string; model?: string; key?: string; id?: 'openai' | 'groq'; label?: string } = {}): AIProvider {
  const base = (o.base || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = o.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${o.key ?? process.env.OPENAI_API_KEY}` };
  return {
    id: o.id ?? 'openai',
    model,
    label: o.label ?? `${new URL(base).host} · ${model}`,
    async complete(messages, o = {}) {
      // Groq: when a model has used up its free quota (or is overloaded) the next one answers
      const models = model === 'groq-auto' ? await groqChatModels() : [model];
      let last: Error | null = null;
      for (const m of models) {
        const reasoning = /gpt-oss/.test(m);
        const r = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: m, messages, temperature: o.temperature ?? 0.4, max_tokens: (o.maxTokens ?? 900) + (reasoning ? 500 : 0), ...(reasoning ? { reasoning_effort: 'low' } : {}), ...(o.json ? { response_format: { type: 'json_object' } } : {}) }),
          signal: AbortSignal.timeout(TIMEOUT),
        });
        if (r.ok) {
          const j = (await r.json()) as { choices: { message: { content: string } }[] };
          return j.choices[0]?.message.content ?? '';
        }
        last = new Error(`Provider ${r.status}: ${(await r.text()).slice(0, 200)}`);
        if (model !== 'groq-auto' || !TRY_NEXT.has(r.status)) throw last;
        restModel(m, r);
      }
      throw last ?? new Error('Provider: nessun modello disponibile');
    },
    async *stream(messages, o = {}) {
      const models = model === 'groq-auto' ? await groqChatModels() : [model];
      let r: Response | null = null;
      for (const m of models) {
        r = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model: m, ...(/gpt-oss/.test(m) ? { reasoning_effort: 'low' } : {}), messages, stream: true, temperature: o.temperature ?? 0.4, max_tokens: o.maxTokens ?? 700 }), signal: AbortSignal.timeout(TIMEOUT) });
        if (r.ok || model !== 'groq-auto' || !TRY_NEXT.has(r.status)) break;
        restModel(m, r);
        void r.body?.cancel().catch(() => {});
      }
      if (!r || !r.ok || !r.body) throw new Error(`Provider ${r?.status ?? 0}`);
      for await (const line of readLines(r.body)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const c = j.choices?.[0]?.delta?.content;
        if (c) yield c;
      }
    },
  };
}

function anthropic(): AIProvider {
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
  const headers = { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' };
  const split = (messages: ChatMessage[]) => ({
    system: messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'),
    messages: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
  });
  return {
    id: 'anthropic',
    model,
    label: `Anthropic · ${model}`,
    async complete(messages, o = {}) {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model, max_tokens: o.maxTokens ?? 900, temperature: o.temperature ?? 0.4, ...split(messages) }), signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as { content: { type: string; text?: string }[] };
      return j.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    },
    async *stream(messages, o = {}) {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model, max_tokens: o.maxTokens ?? 700, temperature: o.temperature ?? 0.4, stream: true, ...split(messages) }), signal: AbortSignal.timeout(TIMEOUT) });
      if (!r.ok || !r.body) throw new Error(`Anthropic ${r.status}`);
      for await (const line of readLines(r.body)) {
        if (!line.startsWith('data:')) continue;
        const j = JSON.parse(line.slice(5)) as { type: string; delta?: { type: string; text?: string } };
        if (j.type === 'content_block_delta' && j.delta?.text) yield j.delta.text;
      }
    },
  };
}

/**
 * Groq changes its free catalogue from time to time: instead of a fixed name we pick the best model
 * that the key can use right now (list cached for 6 hours). GROQ_MODEL / GROQ_VISION_MODEL win.
 */
const CHAT_PREF = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
const VISION_PREF = ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3.8-27b'];
const gm = globalThis as unknown as { __groqCat?: { at: number; ids: string[] } };

async function groqCatalogue(): Promise<string[]> {
  const key = groqKey();
  if (!key) return [];
  if (gm.__groqCat && Date.now() - gm.__groqCat.at < 6 * 3600_000) return gm.__groqCat.ids;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as { data?: { id: string; active?: boolean }[] };
    const ids = (j.data ?? []).filter((m) => m.active !== false).map((m) => m.id);
    if (ids.length) gm.__groqCat = { at: Date.now(), ids };
    return ids;
  } catch {
    return gm.__groqCat?.ids ?? [];
  }
}

export async function groqModel(kind: 'chat' | 'vision'): Promise<string> {
  const env = kind === 'chat' ? process.env.GROQ_MODEL : process.env.GROQ_VISION_MODEL;
  if (env) return env;
  const ids = await groqCatalogue();
  const pref = kind === 'chat' ? CHAT_PREF : VISION_PREF;
  return pref.find((m) => ids.includes(m)) ?? ids.find((i) => (kind === 'chat' ? /gpt-oss|llama|qwen/ : /scout|maverick|vision|qwen/).test(i)) ?? pref[0]!;
}

/**
 * Every Groq model has its own free daily quota. The chat models to try, best first: a model that
 * answered "limit reached" rests until Groq says it can be used again, so the next one answers in
 * the meantime. When all of them are resting the list is tried anyway (a quota may have reset).
 */
const TRY_NEXT = new Set([413, 429, 498, 500, 502, 503]);
const MAX_TRIES = 4;
const rest = globalThis as unknown as { __groqRest?: Record<string, number> };

export async function groqChatModels(now = Date.now()): Promise<string[]> {
  const ids = await groqCatalogue();
  const env = process.env.GROQ_MODEL;
  const others = ids.filter((i) => /gpt-oss|llama|qwen|kimi|deepseek|mistral|gemma/.test(i) && !/guard|whisper|tts|prompt|scout|maverick|vision|embed|safeguard/.test(i));
  const all = [...new Set([...(env ? [env] : []), ...CHAT_PREF.filter((m) => !ids.length || ids.includes(m)), ...others])];
  const ready = all.filter((m) => (rest.__groqRest?.[m] ?? 0) <= now);
  return (ready.length ? ready : all).slice(0, MAX_TRIES);
}

/** Remembers until when a model is out of quota (Groq's retry-after; 10 minutes when it does not say). */
function restModel(m: string, r: Response) {
  const after = Number(r.headers.get('retry-after'));
  const ms = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 24 * 3600_000) : 10 * 60_000;
  (rest.__groqRest ??= {})[m] = Date.now() + Math.max(ms, 30_000);
  console.warn(`[ai] ${m}: limite raggiunto (${r.status}), uso il modello successivo per ${Math.round(Math.max(ms, 30_000) / 60_000)} min`);
}

export const GROQ_CHAT_MODEL = () => process.env.GROQ_MODEL || gm.__groqCat?.ids.find((i) => CHAT_PREF.includes(i)) || 'automatico';

export function getProvider(): AIProvider | null {
  const p = (process.env.AI_PROVIDER || 'none').toLowerCase();
  if (p === 'ollama') return ollama();
  if (p === 'openai' && process.env.OPENAI_API_KEY) return openaiCompatible();
  if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) return anthropic();
  const groq = groqKey();
  if (groq && (p === 'none' || p === 'groq' || p === '')) return openaiCompatible({ base: 'https://api.groq.com/openai/v1', model: 'groq-auto', key: groq, id: 'groq', label: 'Groq (gratuito)' });
  return null;
}

export function providerStatus(): { configured: boolean; label: string } {
  const p = getProvider();
  return p ? { configured: true, label: p.label } : { configured: false, label: 'Nessun provider AI configurato (modalità dimostrativa senza AI)' };
}

/** Extract the first JSON object from a model answer (models sometimes wrap it in prose). */
export function parseJsonLoose<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
