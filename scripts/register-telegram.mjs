const { APP_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;
if (!APP_URL?.startsWith('https://') || !TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
  throw new Error('Brak konfiguracji HTTPS / Telegram w .env.local');
}
const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url: `${APP_URL.replace(/\/$/, '')}/api/telegram/webhook`, secret_token: TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false }),
  signal: AbortSignal.timeout(15000),
});
const result = await response.json();
if (!result.ok) throw new Error('Telegram odrzucil konfiguracje webhooka. Sprawdz token i publiczny adres.');
console.log('Webhook Telegram zostal podlaczony.');
