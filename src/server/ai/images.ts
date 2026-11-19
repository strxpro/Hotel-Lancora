import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { getMedia, putMedia } from '../media-store';
import { groqKey } from '../integrations';
import { groqModel } from './provider';

/** Any picture → webp in data/uploads, served by /api/media/<name>. */
export async function saveImage(buf: Buffer, maxSide = 1600): Promise<string> {
  const sharp = (await import('sharp')).default;
  const out = await sharp(buf, { failOn: 'error' }).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return putMedia(`${crypto.randomUUID()}.webp`, out);
}

export async function readSavedImage(src: string): Promise<Buffer | null> {
  const m = src.match(/^\/api\/media\/([\w-]+\.(?:webp|jpe?g|png))$/);
  return m ? getMedia(m[1]!) : null;
}

/**
 * Pollinations image generation requires a server-side API key and provider balance.
 * The result is downloaded and kept on our server.
 */
export async function generateImage(prompt: string, size: { w: number; h: number } = { w: 1200, h: 800 }): Promise<string> {
  const token = process.env.POLLINATIONS_TOKEN;
  if (!token) throw new Error('Generazione immagini non collegata: configura POLLINATIONS_TOKEN con una chiave segreta di enter.pollinations.ai e credito disponibile. Puoi comunque caricare le tue foto.');
  const full = `${prompt}, Santa Teresa Gallura, Sardinia, mediterranean boutique hotel, natural light, editorial travel photography, no text, no watermark`;
  const url = `https://gen.pollinations.ai/image/${encodeURIComponent(full)}?width=${size.w}&height=${size.h}&seed=${Math.floor(Math.random() * 100000)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(70000) }).catch(() => null);
  if (!res || !res.ok) throw new Error(`Generazione immagini non riuscita${res ? ` (${res.status})` : ''}. Controlla la chiave e il credito Pollinations, poi riprova.`);
  return saveImage(Buffer.from(await res.arrayBuffer()), 1400);
}

export const visionConfigured = () => Boolean(groqKey());

/**
 * Looks at a picture (Groq vision model, same free key as the chat) and answers about it, in the
 * language asked. GROQ_VISION_MODEL overrides the model.
 */
export async function lookAt(buf: Buffer, question: string, langName: string): Promise<string> {
  return lookAtMany([buf], question, langName);
}

/** Up to 4 pictures in one question (the vision model reads them together). */
export async function lookAtMany(bufs: Buffer[], question: string, langName: string): Promise<string> {
  const key = groqKey();
  if (!key) throw new Error('no-vision');
  const sharp = (await import('sharp')).default;
  const jpgs = await Promise.all(bufs.slice(0, 4).map((b) => sharp(b).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()));
  const n = jpgs.length;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: await groqModel('vision'),
      temperature: 0.3,
      max_tokens: n > 1 ? 800 : 500,
      messages: [
        { role: 'system', content: `Sei l'assistente di un piccolo hotel (Hotel L'Ancora, Santa Teresa Gallura). Guardi le immagini che ti manda il proprietario e rispondi in ${langName}, breve e concreto (massimo 5 righe). ${n === 1 ? 'Ricevi UNA sola foto: parla solo di quella' : `Ricevi ${n} foto, numerate nell’ordine: parla di ognuna (Foto 1, Foto 2…) o confrontale se te lo chiede`}, senza inventare dettagli. Se è una foto di una camera o del territorio, di' se è adatta al sito e perché. Se contiene testo (una nota, una ricevuta, una prenotazione), riassumilo.` },
        { role: 'user', content: [{ type: 'text', text: question || (n === 1 ? 'Cosa vedi? È adatta al sito?' : 'Cosa vedi in queste foto? Sono adatte al sito?') }, ...jpgs.map((jpg) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpg.toString('base64')}` } }))] },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Vision ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content?.trim() || '';
}

/** Our uploads or a file of the public site folder (demo photos), never outside them. */
export async function readAnyImage(src: string): Promise<Buffer | null> {
  const up = await readSavedImage(src);
  if (up) return up;
  if (!/^\/[\w\-./]+\.(?:webp|jpe?g|png|avif)$/i.test(src) || src.includes('..')) return null;
  try {
    return fs.readFileSync(path.join(process.cwd(), 'public', src));
  } catch {
    // on hosting without the project folder (Vercel) the public files are served, not on disk
    const base = (process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '');
    if (!base) return null;
    const r = await fetch(`${base}${src}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    return r?.ok ? Buffer.from(await r.arrayBuffer()) : null;
  }
}
