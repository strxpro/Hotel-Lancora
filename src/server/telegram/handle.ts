import 'server-only';
import { mutate, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { answerCallback, downloadFile, editMessage, escapeHtml, getMe, sendMessage, sendText, sendPhoto, type InlineButton, type ReplyKeyboard } from './api';
import { telegramAudio, type TelegramAudioFile } from './media';
import { readAnyImage } from '@/server/ai/images';
import { converse, resolveAndLog } from '@/server/assistant/engine';
import { audioName, polishTranscript, transcribe, transcriptionConfigured, voiceGlossary } from '@/server/ai/transcribe';
import { rateLimit } from '@/server/security';
import type { SafeUser } from '@/server/auth/guard';
import { detectLang } from '../assistant/extras';

type TgUser = { id?: number; is_bot?: boolean; first_name?: string; username?: string };
export type Update = {
  update_id?: number;
  message?: {
    message_id: number;
    date?: number;
    chat: { id: number; type?: 'private' | 'group' | 'supergroup' | 'channel'; title?: string };
    from?: TgUser;
    text?: string;
    caption?: string;
    reply_to_message?: { text?: string; caption?: string; from?: TgUser };
    voice?: TelegramAudioFile;
    audio?: TelegramAudioFile;
    photo?: { file_id: string; width: number; height: number; file_size?: number }[];
    document?: TelegramAudioFile;
  };
  callback_query?: { id: string; data?: string; from?: TgUser; message?: { message_id: number; chat: { id: number; type?: string } } };
};

/**
 * Who is writing: every person links their OWN Telegram once (private chat with the bot, code from
 * the panel). A private chat's id is the person's Telegram id, so the same link recognises them in
 * a group too: in a group the bot acts for the person who wrote, never for the group.
 */
function linkedUser(telegramId: string): SafeUser | null {
  const db = readDb();
  const link = db.telegram.linkedChats.find((c) => c.chatId === telegramId);
  const u = link && db.users.find((x) => x.id === link.userId);
  if (!u) return null;
  const { passwordHash: _p, twoFactor, ...safe } = u;
  void _p;
  return { ...safe, twoFactorOn: Boolean(twoFactor) };
}

const HEARD: Record<string, string> = { it: 'Ho capito', en: 'I understood', pl: 'Zrozumiałem', de: 'Verstanden', fr: 'J’ai compris', es: 'He entendido' };

/** The quick buttons: what each one asks. Same words in the keyboard (private) and in the menu (groups). */
const QUICK: { key: string; label: string; ask: string }[] = [
  { key: 'oggi', label: '📅 Oggi', ask: 'oggi' },
  { key: 'libere', label: '🛏 Camere libere', ask: 'quali camere sono libere stanotte' },
  { key: 'arrivi', label: '🛎 Arrivi', ask: 'chi arriva oggi' },
  { key: 'partenze', label: '👋 Partenze', ask: 'chi parte oggi' },
  { key: 'incassi', label: '💶 Incassi', ask: 'quanto abbiamo incassato questo mese' },
  { key: 'pagamenti', label: '💳 Pagamenti', ask: 'pagamenti' },
  { key: 'prezzi', label: '🏷 Prezzi', ask: 'prezzi' },
  { key: 'aiuto', label: '❓ Aiuto', ask: 'aiuto' },
];
const KEYBOARD: ReplyKeyboard = {
  keyboard: [0, 2, 4, 6].map((i) => QUICK.slice(i, i + 2).map((q) => ({ text: q.label }))),
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Scrivi o manda un vocale…',
};
const MENU: InlineButton[][] = [0, 2, 4, 6].map((i) => QUICK.slice(i, i + 2).map((q) => ({ text: q.label, callback_data: `q:${q.key}` })));
const quickAsk = (text: string) => {
  const plain = text.replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase();
  return QUICK.find((q) => q.label.replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase() === plain)?.ask ?? null;
};

/** The bot's own @name (asked once per server instance), to know when a group message is for it. */
let botName: string | null = null;
async function botUsername(): Promise<string> {
  if (!botName) botName = (await getMe().catch(() => null))?.username?.toLowerCase() ?? '';
  return botName;
}

/** Words that call the assistant at the start of a group message: "Bot, chi arriva oggi?" */
const WAKE = /^(?:bot|ancora|l\s*['’]?\s*ancora|lancora|assistente|asystent(?:ka)?|asystencie|hotel)\b[\s,.:;!?-]*/i;

const WELCOME =
  '✅ Collegato a Hotel L’Ancora.\nUsa i pulsanti qui sotto, oppure scrivimi o mandami un vocale come a una persona: “chi arriva domani?”, “prezzo di agosto 150 euro, 140 in contanti”.\n\nIn un gruppo: aggiungimi al gruppo e chiamami con “Bot, …” oppure rispondendo a un mio messaggio.';

/**
 * One Telegram update, start to finish (text, voice, photo, confirm and quick buttons), in a private
 * chat or in a group. Used by the webhook route and by the in-process poller. Security: the person
 * must have linked their Telegram to a panel user via a one-time code, per-chat rate limit, every
 * change goes through confirm buttons that only the person who asked can press.
 */
export async function handleTelegramUpdate(update: Update): Promise<void> {
  try {
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = String(cq.message?.chat.id ?? '');
      const user = linkedUser(String(cq.from?.id ?? chatId));
      if (!user) {
        await answerCallback(cq.id, 'Prima collega il tuo Telegram (pannello → Automazioni → Telegram)');
        return;
      }
      const data = cq.data ?? '';
      // a quick button of the menu: the same as typing its question
      if (data.startsWith('q:')) {
        const q = QUICK.find((x) => `q:${x.key}` === data);
        await answerCallback(cq.id, q?.label);
        if (q) await answer(chatId, q.ask, user, { group: cq.message?.chat.type !== 'private' });
        return;
      }
      const [decision, id] = data.split(':');
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
    if (!msg || msg.from?.is_bot) return;
    const chatId = String(msg.chat.id);
    const group = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    let text = (msg.text ?? msg.caption ?? '').trim();
    let voice = false;

    // in a group the bot speaks only when called: @name, a reply to one of its messages, a command
    // (/oggi@bot), or a wake word at the start ("Bot, …"). Everything else stays between people.
    if (group) {
      const me = await botUsername();
      const mention = me ? new RegExp(`@${me}\\b`, 'i') : null;
      const toBot = Boolean(msg.reply_to_message?.from?.is_bot && (!me || msg.reply_to_message.from.username?.toLowerCase() === me));
      const called = toBot || (mention?.test(text) ?? false) || text.startsWith('/') || WAKE.test(text);
      if (!called) return;
      text = text.replace(mention ?? /$^/, ' ').replace(WAKE, '').replace(/^\/(\w+)@\w+/, '/$1').replace(/\s+/g, ' ').trim();
      // a voice note or a photo in a group: only as an answer to the bot (or a photo with a caption that calls it)
      if (!toBot && telegramAudio(msg)) return;
    }
    if (!rateLimit(`tg:${chatId}`, 20, 60_000)) return;

    // one-time linking: /collega 123456 (code generated in the panel, valid 15 minutes). In a group the
    // code links the group for the hotel's notices; commands always come from linked people.
    const link = text.match(/^(?:\/(?:collega|start)(?:@\w+)?\s+)?(\d{6})$/i);
    if (link) {
      const ok = mutate((db) => {
        const c = db.telegram.linkCode;
        if (!c || c.code !== link[1] || new Date(c.expiresAt) < new Date()) return false;
        db.telegram.linkedChats = db.telegram.linkedChats.filter((x) => x.chatId !== chatId);
        db.telegram.linkedChats.push({ chatId, userId: c.userId, name: group ? `Gruppo ${msg.chat.title ?? ''}`.trim() : msg.from?.username ? `@${msg.from.username}` : (msg.from?.first_name ?? 'Telegram'), linkedAt: new Date().toISOString() });
        db.telegram.linkCode = null;
        audit(db, 'Telegram', 'link', 'telegram', chatId, group ? `Gruppo “${msg.chat.title ?? ''}” collegato: riceve gli avvisi dell’hotel` : 'Chat collegata al pannello');
        return true;
      });
      if (!ok) await sendMessage(chatId, 'Codice non valido o scaduto. Generane uno nuovo dal pannello (Automazioni → Telegram).');
      else if (group) await sendText(chatId, '✅ Gruppo collegato: qui arriveranno anche gli avvisi dell’hotel.\nPer darmi comandi nel gruppo, ognuno collega prima il proprio Telegram in privato con me. Poi chiamatemi con “Bot, …” oppure rispondendo a un mio messaggio.', MENU);
      else await sendText(chatId, WELCOME, undefined, { keyboard: KEYBOARD });
      return;
    }

    const user = linkedUser(String(msg.from?.id ?? chatId));
    if (!user) {
      await sendMessage(
        chatId,
        group
          ? `Non ti conosco ancora, ${escapeHtml(msg.from?.first_name ?? '')}. Scrivimi in privato e collega il tuo Telegram dal pannello (Automazioni → Telegram): poi ti rispondo anche qui.`
          : 'Questo bot è riservato allo staff di Hotel L’Ancora. Collega la chat dal pannello: Automazioni → Telegram.',
        undefined,
        group ? { replyTo: msg.message_id } : {},
      );
      return;
    }

    // the menu with the quick buttons
    if (/^\/?(start|menu|menù|pulsanti|przyciski|buttons)$/i.test(text) || (group && !text && !msg.photo && !telegramAudio(msg))) {
      if (group) await sendText(chatId, `Eccomi, ${user.name.split(' ')[0]}. Cosa ti serve?`, MENU, { replyTo: msg.message_id });
      else await sendText(chatId, 'Eccomi. Tocca un pulsante o scrivimi quello che ti serve.', undefined, { keyboard: KEYBOARD });
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
      text = text.replace(WAKE, '').trim();
      await sendText(chatId, `🎙 ${HEARD[detectLang(text)] ?? HEARD.it}: “${text}”`, undefined, group ? { replyTo: msg.message_id } : {});
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
    await answer(chatId, quickAsk(text) ?? text.replace(/^\/(?=\p{L})/u, ''), user, { group, replyTo: msg.message_id, voice, image, quoted: (msg.reply_to_message?.text ?? msg.reply_to_message?.caption)?.slice(0, 1600) });
  } catch (e) {
    console.error('[telegram] processing failed:', e instanceof Error ? e.name : 'unknown');
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) await sendMessage(String(chatId), 'Non sono riuscito a completare la richiesta. Riprova tra poco; prima di ripetere una modifica, controlla nel pannello se è già stata eseguita.').catch(() => null);
  }
}

/** Asks the assistant and sends the answer: pictures first, then the text with its confirm buttons. */
async function answer(chatId: string, text: string, user: SafeUser, o: { group: boolean; replyTo?: number; voice?: boolean; image?: Buffer; quoted?: string }): Promise<void> {
  const reply = await converse(text, { user, channel: 'telegram', chatId, replyTo: o.quoted }, { voice: o.voice ?? false, image: o.image });
  for (const src of (reply.intent === 'add_room_photo' ? [] : (reply.images ?? [])).slice(0, 4)) {
    const buf = await readAnyImage(src);
    if (buf) await sendPhoto(chatId, buf).catch(() => null);
  }
  const confirm: InlineButton[][] | undefined = reply.pending
    ? [
        [
          { text: '✅ Conferma', callback_data: `ok:${reply.pending.id}` },
          { text: '✖️ Annulla', callback_data: `no:${reply.pending.id}` },
        ],
      ]
    : undefined;
  // after the help, the menu again (in a group: the buttons under the answer)
  const buttons = confirm ?? (reply.intent === 'help' && o.group ? MENU : undefined);
  await sendText(chatId, reply.text, buttons, { ...(o.group && o.replyTo ? { replyTo: o.replyTo } : {}), ...(!o.group && !buttons ? { keyboard: KEYBOARD } : {}) });
}
