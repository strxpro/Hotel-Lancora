export type TelegramAudioFile = { file_id: string; duration?: number; file_size?: number; mime_type?: string; file_name?: string };

/** Telegram distinguishes microphone notes, music/audio, and files sent as documents. */
export function telegramAudio(message: { voice?: TelegramAudioFile; audio?: TelegramAudioFile; document?: TelegramAudioFile }): TelegramAudioFile | undefined {
  if (message.voice) return { ...message.voice, mime_type: message.voice.mime_type || 'audio/ogg', file_name: 'voce.ogg' };
  if (message.audio) return message.audio;
  const doc = message.document;
  if (doc && (doc.mime_type?.startsWith('audio/') || /\.(ogg|opus|mp3|m4a|wav|webm|flac|aac)$/i.test(doc.file_name ?? ''))) return doc;
}

export function splitTelegramText(text: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  for (const char of text) {
    if (chunk.length + char.length > 3500) { chunks.push(chunk); chunk = ''; }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
