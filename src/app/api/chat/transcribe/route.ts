import { NextResponse } from 'next/server';
import { audioName, polishTranscript, transcribe, transcriptionConfigured, voiceGlossary } from '@/server/ai/transcribe';
import { readDb } from '@/server/db/store';
import { ipOf, rateLimit, sameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Website chat microphone (guests). Same flow as the panel — live words while speaking, a cleaned-up
 * text at the end — with tighter limits: short recordings, per-visitor rate limits, nothing stored.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!transcriptionConfigured()) return NextResponse.json({ error: 'off' }, { status: 501 });
  const ip = ipOf(req.headers);
  const form = await req.formData().catch(() => null);
  const file = form?.get('audio');
  const final = form?.get('mode') !== 'partial';
  if (!rateLimit(`gstt:${ip}`, final ? 8 : 14, 60_000) || !rateLimit(`gstt-h:${ip}`, 120, 3_600_000)) return NextResponse.json({ error: 'rate' }, { status: 429 });
  // site-wide ceiling: the owner's voice messages use the same free quota and must always work
  if (!rateLimit('gstt:all', 400, 3_600_000)) return NextResponse.json({ error: 'rate' }, { status: 429 });
  if (!(file instanceof Blob) || file.size < 200 || file.size > 3 * 1024 * 1024) return NextResponse.json({ error: 'size' }, { status: 400 });
  try {
    const raw = await transcribe(file, audioName(file.type, file instanceof File && file.name ? file.name : 'voce.webm'));
    if (!final) return NextResponse.json({ text: raw });
    return NextResponse.json({ text: await polishTranscript(raw, voiceGlossary(readDb())) });
  } catch (e) {
    console.error('[voice] guest transcription failed:', (e as Error).message);
    return NextResponse.json({ error: 'stt' }, { status: 502 });
  }
}
