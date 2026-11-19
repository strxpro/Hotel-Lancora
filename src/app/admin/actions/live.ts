'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { readDb, mutate } from '@/server/db/store';
import { audit } from '@/server/events';
import { rateLimit } from '@/server/security';
import { writeIntegrations } from '@/server/integrations';
import { checkGeminiKey, createLiveToken, liveConfigured } from '@/server/ai/live';
import { converse, resolveAndLog } from '@/server/assistant/engine';

/** Starts a live voice conversation: a one-use token for the browser (the key stays on the server). */
export async function liveStartAction() {
  return act('assistant.use', async (u) => {
    if (!liveConfigured()) throw new UserError('La conversazione dal vivo non è ancora collegata (Impostazioni → Collegamenti).');
    if (!rateLimit(`live:${u.id}`, 12, 60 * 60_000)) throw new UserError('Troppe conversazioni in poco tempo: riprova tra un po’.');
    try {
      const db = readDb();
      return await createLiveToken({ hotel: db.settings.hotel.name, person: u.name });
    } catch (e) {
      const m = (e as Error).message;
      if (/API key|PERMISSION|401|403/i.test(m)) throw new UserError('Google non accetta la chiave: ricollegala in Impostazioni → Collegamenti.');
      if (/quota|429|RESOURCE_EXHAUSTED/i.test(m)) throw new UserError('Per oggi la conversazione gratuita ha finito i minuti: riprova domani, oppure scrivi all’assistente.');
      console.error('[live]', m);
      throw new UserError('Non riesco ad aprire la conversazione adesso: riprova tra un attimo.');
    }
  });
}

const Tool = z.discriminatedUnion('name', [
  z.object({ name: z.literal('chiedi_al_gestionale'), args: z.object({ richiesta: z.string().trim().min(1).max(600) }) }),
  z.object({ name: z.literal('conferma_azione'), args: z.object({ decisione: z.enum(['conferma', 'annulla']) }) }),
]);

/**
 * What Gemini asks the hotel during the conversation. Everything goes through the assistant the
 * owner already uses in writing: same permissions, same confirmations, same history.
 */
export async function liveToolAction(raw: unknown) {
  return act('assistant.use', async (u) => {
    if (!rateLimit(`live-tool:${u.id}`, 60, 10 * 60_000)) throw new UserError('Troppe richieste, un attimo.');
    const t = Tool.parse(raw);
    const ctx = { user: u, channel: 'panel' as const };
    if (t.name === 'chiedi_al_gestionale') {
      const r = await converse(t.args.richiesta, ctx, { voice: true });
      return { risposta: r.text, conferma_richiesta: r.pending ? r.pending.summary : null };
    }
    const now = Date.now();
    const pending = readDb()
      .pendingActions.filter((p) => p.userId === u.id && p.channel === 'panel' && new Date(p.expiresAt).getTime() > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!pending) return { risposta: 'Non c’è nessuna azione in attesa di conferma.' };
    const out = await resolveAndLog(pending.id, t.args.decisione === 'conferma' ? 'confirm' : 'cancel', ctx);
    return { risposta: out.text };
  });
}

/** Connects the Google AI Studio key (checked first). */
export async function saveGeminiKeyAction(key: string) {
  return act('settings.edit', async (u) => {
    const k = z.string().trim().min(20).max(200).parse(key);
    const r = await checkGeminiKey(k);
    if (r === 'invalid') throw new UserError('Chiave non valida: copiala di nuovo da aistudio.google.com → Get API key.');
    if (r === 'unreachable') throw new UserError('Google non risponde adesso: riprova tra un minuto.');
    writeIntegrations({ geminiKey: k });
    mutate((db) => audit(db, u.name, 'integration', 'gemini', null, 'Conversazione dal vivo collegata (Google AI Studio)'));
  }, 'Collegata: nell’assistente trovi “Parla dal vivo”.');
}

export async function removeGeminiKeyAction() {
  return act('settings.edit', (u) => {
    writeIntegrations({ geminiKey: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'gemini', null, 'Conversazione dal vivo scollegata'));
  }, 'Conversazione dal vivo scollegata.');
}
