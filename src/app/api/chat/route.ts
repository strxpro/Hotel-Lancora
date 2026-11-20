import { z } from 'zod';
import type { Locale } from '@/lib/types';
import { readDb } from '@/server/db/store';
import { answerKB, buildSystemPrompt, detectLang, languageRule } from '@/server/chat/engine';
import { answerStay, extractStay, isStayTurn } from '@/server/chat/stay';
import { asksForRoom, guestsIn, roomsNamedIn, topRooms } from '@/server/chat/room-cards';
import { getProvider } from '@/server/ai/provider';
import { localize } from '@/server/assistant/extras';
import { isLocale } from '@/lib/i18n/config';
import { todayISO } from '@/lib/dates';
import { ipOf, rateLimit, sameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

const Body = z.object({
  locale: z.string().optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(1200) })).min(1).max(12),
});

const CHECKING: Record<Locale, string> = {
  it: 'Controllo la disponibilità in tempo reale…',
  en: 'Checking live availability…',
  pl: 'Sprawdzam dostępność na żywo…',
  de: 'Prüfe die Verfügbarkeit live…',
  fr: 'Je vérifie les disponibilités en direct…',
  es: 'Compruebo la disponibilidad en directo…',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Public website chat. Streams NDJSON:
 * {t:'meta'} → {t:'status'}? → {t:'delta'}… → {t:'rooms'}? → {t:'actions'} → {t:'suggest'}? → {t:'done'}.
 * Public data only: the prompt never contains guests or bookings.
 * The rooms a reply names (or, when the guest asks for a suggestion, the best ones) come as cards with photos.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
  const ip = ipOf(req.headers);
  if (!rateLimit(`chat:${ip}`, 12, 60_000) || !rateLimit(`chat-h:${ip}`, 80, 3_600_000)) return new Response('Too many requests', { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response('Bad request', { status: 400 });

  const db = readDb();
  const today = todayISO();
  const fallbackLocale = isLocale(parsed.data.locale) ? parsed.data.locale : 'it';
  const userTurns = parsed.data.messages.filter((m) => m.role === 'user').map((m) => m.content.slice(0, 500));
  const last = userTurns.at(-1) ?? '';
  const lang = detectLang(last, fallbackLocale);
  const kb = answerKB(db, last, lang, today);
  // the public chat shares the free AI quota with the owner's assistant: past a site-wide hourly
  // ceiling (far above a real hotel's traffic) it answers from the hotel's own data only, so a flood
  // of visitors or a script can never leave the owner's Telegram bot without AI
  const provider = rateLimit('chat-ai:all', 300, 3_600_000) ? getProvider() : null;
  const enc = new TextEncoder();

  // a precise answer from the knowledge base (a service, a FAQ, check-in times…) wins over the stay check
  const kbSpecific = kb.intent.startsWith('service:') || kb.intent.startsWith('faq:') || ['times', 'location', 'modify', 'contact', 'beaches'].includes(kb.intent);
  const stayTurn = !kbSpecific && isStayTurn(userTurns.slice(-4));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      // answers from the database are complete at once: let them flow in like a reply being typed
      const pace = async (text: string) => {
        const parts = text.match(/\S+\s*/g) ?? [text];
        for (let i = 0; i < parts.length; i += 3) {
          send({ t: 'delta', text: parts.slice(i, i + 3).join('') });
          await sleep(14);
        }
      };
      const finish = () => {
        send({ t: 'done' });
        controller.close();
      };
      // photos of the rooms the answer talks about; "which room do you suggest?" without a name → the best ones
      const roomCards = (text: string) => {
        const named = roomsNamedIn(db, text, lang);
        const rooms = named.length ? named : asksForRoom(last) ? topRooms(db, lang, guestsIn(last)) : [];
        if (rooms.length) send({ t: 'rooms', rooms });
      };

      if (stayTurn) {
        send({ t: 'meta', mode: provider ? 'ai' : 'kb', lang });
        send({ t: 'status', text: CHECKING[lang] });
        const stay = await extractStay(userTurns.slice(-4), today, provider).catch(() => null);
        if (stay && (stay.checkIn || kb.intent === 'availability')) {
          // live: the inventory is read again right now, not the copy loaded with the request
          const r = answerStay(readDb(), stay, lang, today);
          if (r.stay) send({ t: 'stay', stay: r.stay });
          await pace(r.text);
          if (r.rooms?.length) send({ t: 'rooms', rooms: r.rooms });
          if (r.actions.length) send({ t: 'actions', actions: r.actions });
          if (r.suggest?.length) send({ t: 'suggest', items: r.suggest });
          finish();
          return;
        }
      }

      // deterministic intents (prices, unknown services) stay in KB mode even with AI:
      // the numbers come straight from the database, so they cannot be hallucinated.
      // a service answer carries the owner's note, written in Italian: in another language the AI words it
      // (same facts), or without AI the note alone is translated — never two languages in one sentence
      const svc = kb.intent.startsWith('service:') ? db.settings.services.find((x) => x.key === kb.intent.slice(8)) : null;
      const italianNote = lang !== 'it' && svc?.note && svc.status !== 'da_confermare' && kb.text.includes(svc.note) ? svc.note : null;
      if (italianNote && !provider) kb.text = kb.text.replace(italianNote, (await localize({ note: italianNote }, lang)).note ?? italianNote);
      const exact = ['availability', 'price'].includes(kb.intent) || (kb.intent.startsWith('service:') && !(italianNote && provider));
      if (provider && !exact) {
        send({ t: 'meta', mode: 'ai', lang });
        try {
          const messages = [{ role: 'system' as const, content: buildSystemPrompt(db, lang, today) }, ...parsed.data.messages.slice(-8).map((m) => ({ role: m.role, content: m.content.slice(0, 800) })), { role: 'system' as const, content: languageRule(lang) }];
          let full = '';
          for await (const chunk of provider.stream(messages, { maxTokens: 450, temperature: 0.3 })) {
            full += chunk;
            send({ t: 'delta', text: chunk });
          }
          roomCards(full);
          if (kb.actions.length) send({ t: 'actions', actions: kb.actions });
          finish();
          return;
        } catch (e) {
          console.error('[chat] provider failed, falling back to KB:', (e as Error).message);
        }
      }
      send({ t: 'meta', mode: 'kb', lang });
      await pace(kb.text);
      roomCards(kb.text);
      if (kb.actions.length) send({ t: 'actions', actions: kb.actions });
      finish();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}
