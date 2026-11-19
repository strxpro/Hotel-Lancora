import 'server-only';
import { mutate, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { answerCallback, downloadFile, editMessage, escapeHtml, sendMessage, sendText, sendPhoto, telegramConfigured } from './api';
import { telegramAudio, type TelegramAudioFile } from './media';
import { readAnyImage } from '@/server/ai/images';
import { converse, resolveAndLog } from '@/server/assistant/engine';
import { audioName, polishTranscript, transcribe, transcriptionConfigured, voiceGlossary } from '@/server/ai/transcribe';
import { rateLimit } from '@/server/security';
import type { SafeUser } from '@/server/auth/guard';
import { detectLang } from '../assistant/extras';

export type Update = {
  update_id?: number;
  message?: { message_id: number; date?: number; chat: { id: number }; from?: { first_name?: string; username?: string }; text?: string; caption?: string; reply_to_message?: { text?: string; caption?: string }; voice?: TelegramAudioFile; audio?: TelegramAudioFile; photo?: { file_id: string; width: number; height: number; file_size?: number }[]; document?: TelegramAudioFile };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
};

function linkedUser(chatId: string): SafeUser | null {
  const db = readDb();
  const link = db.telegram.linkedChats.find((c) => c.chatId === chatId);
  const u = link && db.users.find((x) => x.id === link.userId);
  if (!u) return null;
  const { passwordHash: _p, twoFactor, ...safe } = u;
  void _p;
  return { ...safe, twoFactorOn: Boolean(twoFactor) };
}

const HEARD: Record<string, string> = { it: 'Ho capito', en: 'I understood', pl: 'Zrozumiałem', de: 'Verstanden', fr: 'J’ai compris', es: 'He entendido' };

/**
 * One Telegram update, start to finish (text, voice, photo, confirm buttons). Used by the webhook
 * route and by the in-process poller. Security: the chat must be linked to a panel user via a
 * one-time code, per-chat rate limit, every change goes through confirm buttons.
 */
export async function handleTelegramUpdate(update: Update): Promise<void> {
  try {
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = String(cq.message?.chat.id ?? '');
      const user = linkedUser(chatId);
      if (!user) {
        await answerCallback(cq.id, 'Chat non collegata');
        return;
      }
      const [decision, id] = (cq.data ?? '').split(':');
      if (!id || !['ok', 'no'].includes(decision ?? '')) {
        await answerCallback(cq.id, 'Comando non valido');
        return;
      }
      // Acknowledge immediately: executing an AI-assisted action may outlive Telegram's callback window.
      await answerCallback(cq.id, 'Elaborazione…');
      const result = await resolveAndLog(id ?? '', decision === 'ok' ? 'confirm' : 'cancel', { user, channel: 'telegram', chatId });
      if (cq.message) await editMessage(chatId, cq.message.message_id, escapeHtml(result.text));
      return;
    }

    const msg = update.message;
    if (!msg) return;
    const chatId = String(msg.chat.id);
    if (!rateLimit(`tg:${chatId}`, 20, 60_000)) return;
    let text = (msg.text ?? msg.caption ?? '').trim();
    let voice = false;

    // one-time linking: /collega 123456 (code generated in the panel, valid 15 minutes)
    const link = text.match(/^(?:\/(?:collega|start)(?:@\w+)?\s+)?(\d{6})$/i);
    if (link) {
      const ok = mutate((db) => {
        const c = db.telegram.linkCode;
        if (!c || c.code !== link[1] || new Date(c.expiresAt) < new Date()) return false;
        db.telegram.linkedChats = db.telegram.linkedChats.filter((x) => x.chatId !== chatId);
        db.telegram.linkedChats.push({ chatId, userId: c.userId, name: msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? 'Telegram'), linkedAt: new Date().toISOString() });
        db.telegram.linkCode = null;
        audit(db, 'Telegram', 'link', 'telegram', chatId, 'Chat collegata al pannello');
        return true;
      });
      await sendMessage(chatId, ok ? '✅ Collegato a Hotel L’Ancora. Scrivi “aiuto” per vedere cosa posso fare.' : 'Codice non valido o scaduto. Generane uno nuovo dal pannello (Automazioni → Telegram).');
      return;
    }

    const user = linkedUser(chatId);
    if (!user) {
      await sendMessage(chatId, 'Questo bot è riservato allo staff di Hotel L’Ancora. Collega la chat dal pannello: Automazioni → Telegram.');
      return;
    }

    const audio = telegramAudio(msg);
    if (audio) {
      if (!transcriptionConfigured()) {
        await sendMessage(chatId, 'Ho ricevuto un vocale, ma la trascrizione non è ancora collegata. Nel pannello: Impostazioni → Collegamenti → Groq (gratis). Intanto scrivimi il messaggio in testo.');
        return;
      }
      if ((audio.duration ?? 0) > 120) {
        await sendMessage(chatId, 'Vocale troppo lungo: massimo 2 minuti.');
        return;
      }
      if ((audio.file_size ?? 0) > 19_000_000) {
        await sendMessage(chatId, 'Audio troppo grande: massimo 19 MB. Invia una registrazione più breve.');
        return;
      }
      const file = await downloadFile(audio.file_id);
      try {
        // heard, then cleaned up (misheard words, "no, I mean…") before the assistant reads it
        text = await polishTranscript(await transcribe(new Blob([file.data], { type: audio.mime_type || 'application/octet-stream' }), audio.file_name || audioName(audio.mime_type, file.path.split('/').pop() || 'voce.ogg')), voiceGlossary(readDb()));
      } catch (e) {
        await sendMessage(chatId, escapeHtml(`Non sono riuscito a capire il vocale: ${(e as Error).message}`));
        return;
      }
      if (!text) {
        await sendMessage(chatId, 'Non ho sentito parole nel vocale, riprova un po’ più vicino al telefono.');
        return;
      }
      await sendText(chatId, `🎙 ${HEARD[detectLang(text)] ?? HEARD.it}: “${text}”`);
      if (text.length > 600) {
        await sendMessage(chatId, 'La richiesta è troppo lunga. Invia un comando più breve (massimo 600 caratteri trascritti), così non perdo una parte delle istruzioni.');
        return;
      }
      voice = true;
    }
    // a photo (or an image sent as a file): understood, or added to a room on request
    let image: Buffer | undefined;
    const pic = msg.photo?.length ? msg.photo[msg.photo.length - 1] : msg.document?.mime_type?.startsWith('image/') ? msg.document : undefined;
    if (pic) {
      if ((pic.file_size ?? 0) > 12_000_000) {
        await sendMessage(chatId, 'Foto troppo grande (massimo 12 MB).');
        return;
      }
      image = Buffer.from((await downloadFile(pic.file_id)).data);
    }
    if (!text && !image) {
      await sendMessage(chatId, 'Posso leggere testo, vocali, file audio e foto. Per PDF, video o altri allegati, incolla il testo oppure invia una foto.');
      return;
    }

    const reply = await converse(text, { user, channel: 'telegram', chatId, replyTo: (msg.reply_to_message?.text ?? msg.reply_to_message?.caption)?.slice(0, 1600) }, { voice, image });
    for (const src of (reply.intent === 'add_room_photo' ? [] : (reply.images ?? [])).slice(0, 4)) {
      const buf = readAnyImage(src);
      if (buf) await sendPhoto(chatId, buf).catch(() => null);
    }
    await sendText(
      chatId,
      reply.text,
      reply.pending
        ? [
            [
              { text: '✅ Conferma', callback_data: `ok:${reply.pending.id}` },
              { text: '✖️ Annulla', callback_data: `no:${reply.pending.id}` },
            ],
          ]
        : undefined,
    );
  } catch (e) {
    console.error('[telegram] processing failed:', e instanceof Error ? e.name : 'unknown');
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) await sendMessage(String(chatId), 'Non sono riuscito a completare la richiesta. Riprova tra poco; prima di ripetere una modifica, controlla nel pannello se è già stata eseguita.').catch(() => null);
  }
}
