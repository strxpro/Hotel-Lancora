import 'server-only';
import { GoogleGenAI, Modality, Type, type LiveConnectConfig } from '@google/genai';
import { geminiKey } from '../integrations';

/**
 * The live voice conversation with the assistant (Gemini Live, Google AI Studio free tier).
 * Gemini only listens and speaks, always in Italian; every fact and every action goes through the
 * hotel's own assistant (assistant/engine.ts) with its permissions and its confirmations, called
 * by the two functions declared here. The browser never sees the key: it gets a one-use token,
 * valid for one conversation, with this exact set-up locked in (instructions, voice, tools).
 */

export const liveConfigured = (): boolean => Boolean(geminiKey());

/** Natural Italian voices of Gemini (the first is the default). */
export const LIVE_VOICES = ['Aoede', 'Kore', 'Leda', 'Charon', 'Orus'] as const;

const g = globalThis as typeof globalThis & { __laLiveModel?: { at: number; name: string } };

/** The newest model that can hold a live audio conversation for this key (asked to Google, kept 6 hours). */
export async function pickLiveModel(ai: GoogleGenAI): Promise<string> {
  if (g.__laLiveModel && Date.now() - g.__laLiveModel.at < 6 * 3_600_000) return g.__laLiveModel.name;
  const live: string[] = [];
  try {
    const pager = await ai.models.list({ config: { pageSize: 200 } });
    for await (const m of pager) {
      if (m.name && m.supportedActions?.includes('bidiGenerateContent')) live.push(m.name.replace(/^models\//, ''));
    }
  } catch {
    /* fall back to the documented name */
  }
  const rank = (n: string) => (/native-audio|-live(\b|-)/.test(n) ? 10 : 0) + (/(\d+)\.(\d+)/.test(n) ? Number(n.match(/(\d+)\.(\d+)/)![1]) * 10 + Number(n.match(/(\d+)\.(\d+)/)![2]) : 0) - (/thinking|lite/.test(n) ? 5 : 0) - (/preview|exp/.test(n) ? 1 : 0);
  const name = live.sort((a, b) => rank(b) - rank(a))[0] ?? 'gemini-3.8-live';
  g.__laLiveModel = { at: Date.now(), name };
  return name;
}

export function liveConfig(p: { hotel: string; person: string; voice?: string }): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: p.voice ?? LIVE_VOICES[0] } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: {
      parts: [
        {
          text: `Sei la voce del gestionale di ${p.hotel}, un piccolo hotel a Santa Teresa Gallura. Stai parlando con ${p.person || 'il proprietario'} che usa il pannello.
Parli SEMPRE e SOLO in italiano, anche se ti parlano in un'altra lingua. Tono caldo e naturale, come una receptionist esperta: frasi brevi (una o due), niente elenchi lunghi, niente simboli.
Per QUALSIASI informazione o azione sull'hotel (prenotazioni, arrivi, partenze, camere, prezzi, disponibilità, incassi, ospiti, messaggi, email, recensioni) usa SEMPRE lo strumento chiedi_al_gestionale passando la richiesta completa in italiano, con date e nomi. Non inventare mai numeri, nomi o date: dici solo quello che risponde il gestionale.
Prima di usare lo strumento di' una brevissima frase naturale, per esempio "Un attimo, controllo" oppure "Vedo subito".
Se il gestionale risponde che serve una conferma, riassumi in una frase cosa farà e chiedi "Confermi?". Quando l'utente dice sì o no, chiama conferma_azione con "conferma" o "annulla". Non confermare mai al posto suo.
Leggi gli importi in euro con parole naturali (per esempio "centoventi euro"). I codici di prenotazione leggili solo se richiesti.
Se non capisci, chiedi di ripetere in modo gentile.`,
        },
      ],
    },
    tools: [
      {
        functionDeclarations: [
          {
            name: 'chiedi_al_gestionale',
            description: 'Chiede o fa qualcosa nel gestionale dell’hotel: prenotazioni, arrivi e partenze, camere libere, prezzi, incassi, ospiti, messaggi, email, recensioni, foto. Restituisce la risposta da dire all’utente, oppure un riepilogo da confermare.',
            parameters: { type: Type.OBJECT, properties: { richiesta: { type: Type.STRING, description: 'La richiesta dell’utente, completa e in italiano (con date, nomi, camere).' } }, required: ['richiesta'] },
          },
          {
            name: 'conferma_azione',
            description: 'Conferma o annulla l’ultima azione che il gestionale ha chiesto di confermare.',
            parameters: { type: Type.OBJECT, properties: { decisione: { type: Type.STRING, enum: ['conferma', 'annulla'], description: '"conferma" se l’utente ha detto sì, "annulla" se ha detto no.' } }, required: ['decisione'] },
          },
        ],
      },
    ],
  };
}

/** A one-use token for one conversation (max 30 minutes, must start within 2 minutes). */
export async function createLiveToken(p: { hotel: string; person: string }): Promise<{ token: string; model: string }> {
  const key = geminiKey();
  if (!key) throw new Error('not-configured');
  const ai = new GoogleGenAI({ apiKey: key });
  const model = await pickLiveModel(ai);
  const now = Date.now();
  const t = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
      liveConnectConstraints: { model, config: liveConfig(p) },
      // ephemeral tokens live on v1beta (Google AI Studio docs, live-api/ephemeral-tokens)
      httpOptions: { apiVersion: 'v1beta' },
    },
  });
  if (!t.name) throw new Error('no-token');
  return { token: t.name, model };
}

/** Checks a key before saving it: true when Google accepts it. */
export async function checkGeminiKey(key: string): Promise<'ok' | 'invalid' | 'unreachable'> {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r) return 'unreachable';
  if (r.status === 400 || r.status === 401 || r.status === 403) return 'invalid';
  return r.ok ? 'ok' : 'unreachable';
}
