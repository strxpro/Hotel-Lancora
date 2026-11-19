/**
 * A password in front of the whole site while it is being prepared ("lancora123"): every page asks
 * for it once, then a cookie lets the browser in for 30 days. The webhooks, scheduled jobs, photos
 * and other /api calls stay open (Stripe, Telegram and cron-job.org must reach them).
 *
 * Only the SHA-256 of the password is kept here. SITE_PASSWORD (env) replaces it; SITE_LOCK=off turns
 * the lock off without a new version of the code.
 */
export const GATE_COOKIE = 'lancora_gate';
const DEFAULT_HASH = '0367755d635831726ad67e0bb015e633ed6f27b7f5399868704cd1f52bf65d07';

export const gateOn = () => (process.env.SITE_LOCK ?? '').trim().toLowerCase() !== 'off';

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

async function passwordHash(): Promise<string> {
  const own = (process.env.SITE_PASSWORD ?? '').trim();
  return own ? sha256(own) : DEFAULT_HASH;
}

export async function gatePasswordOk(input: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(input.trim()), passwordHash()]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The cookie's value: signed with the site secret and tied to the password (a new password = log in again). */
export async function gateToken(): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(process.env.SESSION_SECRET || 'lancora-gate'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`site-gate:${await passwordHash()}`)));
}

/** Where to go after the password: only a path of this site. */
export function safeNext(next: string | null | undefined): string {
  const n = (next ?? '/').trim();
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n.slice(0, 500) : '/';
}

/** The page that asks for the password (plain HTML: it works before anything else of the site loads). */
export function gatePage(next: string, wrong: boolean): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Hotel L’Ancora</title>
<style>
:root{--navy:#0d2233;--ivory:#f7f3ec;--gold:#b8955a;--mist:#6b7a86}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 0%,#16344a 0%,var(--navy) 60%);font-family:Georgia,'Times New Roman',serif;color:var(--ivory);padding:24px}
.card{width:100%;max-width:380px;text-align:center;animation:in .9s cubic-bezier(.2,.7,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.anchor{width:46px;height:46px;margin:0 auto 18px;color:var(--gold)}
.eyebrow{font:600 11px/1 system-ui,sans-serif;letter-spacing:.32em;text-transform:uppercase;color:var(--gold)}
h1{font-weight:400;font-size:34px;margin:10px 0 6px}
p{font:15px/1.5 system-ui,sans-serif;color:#c9d2d9;margin:0 0 26px}
form{display:flex;flex-direction:column;gap:12px}
input{width:100%;padding:14px 16px;border-radius:999px;border:1px solid rgba(247,243,236,.25);background:rgba(247,243,236,.06);color:var(--ivory);font:16px system-ui,sans-serif;text-align:center;outline:none;transition:border-color .2s}
input:focus{border-color:var(--gold)}
button{padding:14px 16px;border-radius:999px;border:0;background:var(--gold);color:var(--navy);font:600 13px system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:transform .15s,filter .2s}
button:hover{filter:brightness(1.06)}button:active{transform:scale(.98)}
.err{font:14px system-ui,sans-serif;color:#f3b4a2;margin-top:4px}
.foot{margin-top:28px;font:12px system-ui,sans-serif;color:var(--mist)}
</style></head><body><main class="card">
<svg class="anchor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 12H2a10 10 0 0 0 20 0h-3M8 11h8"/></svg>
<div class="eyebrow">Hotel L’Ancora</div>
<h1>Sito in preparazione</h1>
<p>Inserisci la password per entrare.<br><span style="opacity:.75">Enter the password to continue.</span></p>
<form method="post" action="/api/gate">
<input type="hidden" name="next" value="${esc(next)}">
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required aria-label="Password">
<button type="submit">Entra</button>
${wrong ? '<div class="err" role="alert">Password non corretta, riprova.</div>' : ''}
</form>
<div class="foot">Santa Teresa Gallura · Sardegna</div>
</main></body></html>`;
}
