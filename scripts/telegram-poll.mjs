// Local development helper: Telegram cannot reach http://localhost, so this script long-polls
// getUpdates and forwards each update to the local webhook (with the secret header).
// Usage: npm run telegram:poll   (reads .env.local / .env)
import fs from 'node:fs';

for (const f of ['.env.local', '.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const target = (process.env.LOCAL_URL || 'http://localhost:3000') + '/api/telegram/webhook';
if (!token || !secret || secret.length < 16) {
  console.error('Imposta TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET (≥16 caratteri) in .env.local');
  process.exit(1);
}

const api = (m, body) => fetch(`https://api.telegram.org/bot${token}/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then((r) => r.json());

await api('deleteWebhook', { drop_pending_updates: false });
const me = await api('getMe');
console.log(`Polling attivo per @${me.result?.username} → ${target}`);
let offset = 0;
for (;;) {
  try {
    const res = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
    if (!res.ok) throw new Error(res.description || 'Telegram getUpdates failed');
    for (const u of res.result ?? []) {
      const r = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(u) });
      if (!r.ok) throw new Error(`Local webhook returned ${r.status}`);
      offset = u.update_id + 1;
      console.log(new Date().toLocaleTimeString('it-IT'), 'update', u.update_id, '→', r.status);
    }
  } catch (e) {
    console.error('errore polling:', e.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
