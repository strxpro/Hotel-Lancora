import 'server-only';
import { groqKey } from '../integrations';

/**
 * Speech-to-text through any OpenAI-compatible transcription endpoint:
 *  - WHISPER_URL → a local faster-whisper server (audio never leaves the hotel)
 *    WHISPER_URL=http://127.0.0.1:8000  WHISPER_MODEL=Systran/faster-whisper-small
 *  - otherwise the free Groq key (same key as the chat): whisper-large-v3-turbo, any language
 */
export function transcriptionConfigured(): boolean {
  return Boolean(process.env.WHISPER_URL || groqKey());
}

export function transcriptionLabel(): string {
  if (process.env.WHISPER_URL) return `Whisper locale · ${process.env.WHISPER_MODEL || 'faster-whisper-small'}`;
  if (groqKey()) return 'Groq Whisper (gratuito) · capisce italiano, polacco, inglese, tedesco…';
  return 'Non collegata';
}

/** `language` omitted = automatic detection (the owner may speak Italian, Polish, English…). */
export async function transcribe(audio: Blob, filename = 'audio.ogg', language?: string): Promise<string> {
  const local = process.env.WHISPER_URL;
  const groq = groqKey();
  if (!local && !groq) throw new Error('Trascrizione vocale non collegata. Collega Groq (gratis) in Impostazioni → Collegamenti.');
  const fd = new FormData();
  fd.append('file', audio, filename);
  fd.append('model', local ? process.env.WHISPER_MODEL || 'Systran/faster-whisper-small' : process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo');
  if (language) fd.append('language', language);
  fd.append('response_format', 'json');
  const url = local ? `${local.replace(/\/$/, '')}/v1/audio/transcriptions` : 'https://api.groq.com/openai/v1/audio/transcriptions';
  const key = local ? process.env.WHISPER_API_KEY : groq;
  const res = await fetch(url, { method: 'POST', body: fd, headers: key ? { authorization: `Bearer ${key}` } : undefined, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(res.status === 401 ? 'Chiave Groq non valida: ricollegala in Impostazioni.' : `Trascrizione non riuscita (${res.status})`);
  const j = (await res.json()) as { text?: string };
  return (j.text ?? '').trim();
}

/** Audio file name the transcription API understands (Safari records mp4, Chrome webm, Telegram ogg). */
export function audioName(type: string | undefined, fallback = 'voce.webm'): string {
  const t = (type ?? '').toLowerCase();
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'voce.m4a';
  if (t.includes('ogg') || t.includes('opus')) return t.includes('webm') ? 'voce.webm' : 'voce.ogg';
  if (t.includes('wav')) return 'voce.wav';
  if (t.includes('mpeg') || t.includes('mp3')) return 'voce.mp3';
  if (t.includes('webm')) return 'voce.webm';
  return fallback;
}

/**
 * Clean-up of what was heard: words the recogniser got wrong (with the hotel's own names as a
 * glossary), punctuation, fillers ("ehm"), and self-corrections ("lunedì… no, martedì" → "martedì").
 * Same language, same meaning, nothing added. Falls back to the raw text if the AI is slow or absent.
 */
export async function polishTranscript(raw: string, glossary: string[] = []): Promise<string> {
  const text = raw.trim();
  if (text.length < 4) return text;
  const { getProvider } = await import('./provider');
  const provider = getProvider();
  if (!provider) return text;
  const sys = [
    'You correct speech-to-text transcripts written by a hotel owner or a hotel guest.',
    'Fix misheard words, grammar, capitalisation and punctuation. Remove filler words (ehm, uh, cioè, no dobra…) and false starts.',
    'When the speaker corrects themselves ("Monday… no, Tuesday", "camera 104, anzi 105"), keep only the corrected version.',
    'Keep the SAME language as the transcript and the same meaning. Never add, answer or translate anything. Keep numbers, dates, prices and names.',
    glossary.length ? `Names that may appear (spell them exactly like this): ${glossary.slice(0, 60).join(', ')}.` : '',
    'Reply with the corrected text only, no quotes, no comments.',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const out = await Promise.race([
      provider.complete(
        [
          { role: 'system', content: sys },
          { role: 'user', content: text },
        ],
        { maxTokens: Math.min(600, 80 + text.length), temperature: 0 },
      ),
      new Promise<null>((r) => setTimeout(() => r(null), 5000)),
    ]);
    const clean = (out ?? '').trim().replace(/^["“”«»']+|["“”«»']+$/g, '').trim();
    // a "correction" that changed the message wholesale is not a correction: keep what was said
    if (!clean || clean.length > text.length * 1.6 + 20 || clean.length < text.length * 0.35) return text;
    return clean;
  } catch {
    return text;
  }
}

/** The hotel's own words (rooms, places) so the clean-up spells them right. */
export function voiceGlossary(db: { rooms: { name: string; number: string }[]; settings: { hotel: { name: string; city: string } } }): string[] {
  return [db.settings.hotel.name, db.settings.hotel.city, 'Rena Bianca', 'Capo Testa', 'Santa Teresa Gallura', 'Telegram', 'WhatsApp', ...db.rooms.map((r) => `${r.name} (${r.number})`)];
}
