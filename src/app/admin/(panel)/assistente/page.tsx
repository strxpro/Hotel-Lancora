import { requirePageUser } from '@/server/auth/guard';
import { providerStatus } from '@/server/ai/provider';
import { transcriptionConfigured, transcriptionLabel } from '@/server/ai/transcribe';
import { telegramConfigured } from '@/server/telegram/api';
import { PageHeader, Badge } from '@/components/admin/ui';
import { AssistantChat } from '@/components/admin/assistant-chat';

export const metadata = { title: 'Assistente' };

export default async function AssistantPage() {
  await requirePageUser('assistant.use');
  const ai = providerStatus();
  return (
    <div>
      <PageHeader
        eyebrow="Assistente del proprietario"
        title="Chiedi all’assistente"
        description="Domande sui numeri e comandi rapidi, anche a voce. Le stesse funzioni sono disponibili su Telegram."
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge tone={ai.configured ? 'green' : 'gray'}>{ai.configured ? 'AI attiva' : 'Regole senza AI'}</Badge>
            <Badge tone={transcriptionConfigured() ? 'green' : 'gray'}>{transcriptionConfigured() ? 'Vocali: attivi' : 'Vocali: collega Groq'}</Badge>
            <Badge tone={telegramConfigured() ? 'green' : 'gray'}>{telegramConfigured() ? 'Telegram configurato' : 'Telegram da configurare'}</Badge>
          </div>
        }
      />
      <AssistantChat whisper={transcriptionConfigured()} />
      <p className="mt-3 text-xs text-mist">{ai.configured ? `AI: ${ai.label}. Voce: ${transcriptionLabel()}.` : 'Senza AI l’assistente capisce le frasi più comuni in italiano. Collega Groq gratis in Impostazioni → Collegamenti: capirà qualsiasi frase e i vocali in ogni lingua.'}</p>
    </div>
  );
}
