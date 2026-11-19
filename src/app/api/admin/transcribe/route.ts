import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/guard';
import { audioName, polishTranscript, transcribe, transcriptionConfigured, voiceGlossary } from '@/server/ai/transcribe';
import { readDb } from '@/server/db/store';
import { rateLimit, sameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Panel microphone. While the owner speaks the browser sends what it has so far (`mode=partial`)
 * and gets the words back to show them live; at the end (`mode=final`) the whole recording is
 * transcribed again and cleaned up (misheard words, self-corrections) before it is used.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Origine non valida' }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 });
  if (!transcriptionConfigured()) return NextResponse.json({ error: 'Trascrizione non configurata: collega Groq (gratis) in Impostazioni → Collegamenti.' }, { status: 501 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('audio');
  const final = form?.get('mode') !== 'partial';
  if (!rateLimit(`stt:${user.id}`, final ? 30 : 24, 60_000)) return NextResponse.json({ error: 'Troppe richieste, riprova tra poco.' }, { status: 429 });
  if (!(file instanceof Blob) || file.size < 200 || file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Registrazione vuota o troppo lunga.' }, { status: 400 });
  try {
    const name = audioName(file.type, file instanceof File && file.name ? file.name : 'voce.webm');
    let raw = '';
    try {
      raw = await transcribe(file, name);
    } catch (e) {
      // the free tier allows ~20 transcriptions a minute: the final one is worth one more try
      if (!final) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      raw = await transcribe(file, name);
    }
    if (!final) return NextResponse.json({ text: raw });
    const text = await polishTranscript(raw, voiceGlossary(readDb()));
    return NextResponse.json({ text, raw });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
