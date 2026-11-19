'use server';
import { z } from 'zod';
import { act } from '@/server/action';
import { assistantHistory, clearAssistantHistory, converse, resolveAndLog } from '@/server/assistant/engine';
import { rateLimit } from '@/server/security';
import { UserError } from '@/server/action';
import { requireUser } from '@/server/auth/guard';

/** A picture from the chat arrives as a data URL (already shrunk in the browser). */
function decodeImage(dataUrl: string | null | undefined): Buffer | undefined {
  if (!dataUrl) return undefined;
  const m = dataUrl.match(/^data:image\/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new UserError('Formato immagine non supportato (usa JPG, PNG o WebP).');
  const buf = Buffer.from(m[2]!, 'base64');
  if (buf.length > 6_000_000) throw new UserError('Immagine troppo grande.');
  return buf;
}

export async function askAssistant(text: string, voice = false, image?: string | string[] | null) {
  return act('assistant.use', async (u) => {
    if (!rateLimit(`assistant:${u.id}`, 30, 60_000)) throw new UserError('Troppe richieste, attendi un momento.');
    const list = (Array.isArray(image) ? image : image ? [image] : []).slice(0, 4);
    const images = list.map((x) => decodeImage(x)).filter((b): b is Buffer => Boolean(b));
    return converse(z.string().max(600).parse(text), { user: u, channel: 'panel' }, { voice: Boolean(voice), images });
  });
}

export async function resolveAssistant(id: string, decision: 'confirm' | 'cancel') {
  return act('assistant.use', async (u) => resolveAndLog(z.string().parse(id), z.enum(['confirm', 'cancel']).parse(decision), { user: u, channel: 'panel' }));
}

/** The shared conversation (panel + Telegram) of the signed-in user. Read-only: no revalidation. */
export async function loadAssistantHistory() {
  const u = await requireUser('assistant.use').catch(() => null);
  return u ? assistantHistory(u.id) : [];
}

export async function clearAssistantAction() {
  return act('assistant.use', async (u) => clearAssistantHistory(u.id));
}
