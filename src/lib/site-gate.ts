/**
 * A password in front of the whole site while it is being prepared ("lancora123"): every page asks
 * for it once, then a cookie lets the browser in for 30 days. The webhooks, scheduled jobs, photos
 * and other /api calls stay open (Stripe, Telegram and cron-job.org must reach them).
 *
 * Only the SHA-256 of the password is kept here. SITE_PASSWORD (env) replaces it; SITE_LOCK=off turns
 * the lock off without a new version of the code.
 */
import { visitorLang } from './visitor-lang';

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

type GateLang = 'it' | 'en' | 'pl' | 'de' | 'fr' | 'es';
const LANGS: GateLang[] = ['it', 'en', 'pl', 'de', 'fr', 'es'];

const GATE_T: Record<GateLang, { title: string; text: string; ph: string; go: string; wrong: string; meanwhile: string; book: string }> = {
  it: { title: 'Sito in preparazione', text: 'Inserisci la password per entrare.', ph: 'Password', go: 'Entra', wrong: 'Password non corretta, riprova.', meanwhile: 'Nel frattempo puoi prenotare la tua camera su', book: 'Prenota su Booking.com' },
  en: { title: 'Website coming soon', text: 'Enter the password to continue.', ph: 'Password', go: 'Enter', wrong: 'Wrong password, please try again.', meanwhile: 'In the meantime you can book your room on', book: 'Book on Booking.com' },
  pl: { title: 'Strona w przygotowaniu', text: 'Wpisz hasło, aby wejść.', ph: 'Hasło', go: 'Wejdź', wrong: 'Nieprawidłowe hasło, spróbuj ponownie.', meanwhile: 'W międzyczasie możesz zarezerwować pokój na', book: 'Zarezerwuj na Booking.com' },
  de: { title: 'Website in Vorbereitung', text: 'Geben Sie das Passwort ein, um fortzufahren.', ph: 'Passwort', go: 'Eintreten', wrong: 'Falsches Passwort, bitte erneut versuchen.', meanwhile: 'In der Zwischenzeit können Sie Ihr Zimmer buchen auf', book: 'Auf Booking.com buchen' },
  fr: { title: 'Site en préparation', text: 'Saisissez le mot de passe pour entrer.', ph: 'Mot de passe', go: 'Entrer', wrong: 'Mot de passe incorrect, réessayez.', meanwhile: 'En attendant, vous pouvez réserver votre chambre sur', book: 'Réserver sur Booking.com' },
  es: { title: 'Sitio en preparación', text: 'Introduce la contraseña para entrar.', ph: 'Contraseña', go: 'Entrar', wrong: 'Contraseña incorrecta, inténtalo de nuevo.', meanwhile: 'Mientras tanto puedes reservar tu habitación en', book: 'Reservar en Booking.com' },
};

/** The hotel's page on Booking.com in the visitor's language (BOOKING_URL replaces it; "off" hides the link). */
const BOOKING_SUFFIX: Record<GateLang, string> = { it: 'it', en: 'en-gb', pl: 'pl', de: 'de', fr: 'fr', es: 'es' };
export function bookingUrl(lang: GateLang): string | null {
  const own = (process.env.BOOKING_URL ?? '').trim();
  if (own.toLowerCase() === 'off') return null;
  if (own.startsWith('https://')) return own;
  return `https://www.booking.com/hotel/it/lancorasantateresagallura.${BOOKING_SUFFIX[lang]}.html`;
}

/**
 * The visitor's language: the address first (/en/…, /pl/…), then the language chosen earlier on the
 * site, then the browser and the country the visit comes from (lib/visitor-lang.ts).
 */
export function gateLang(pathname: string, acceptLanguage: string | null, country: string | null = null, chosen: string | null = null): GateLang {
  const seg = pathname.split('/')[1]?.toLowerCase();
  if (seg && (LANGS as string[]).includes(seg)) return seg as GateLang;
  if (chosen && (LANGS as string[]).includes(chosen)) return chosen as GateLang;
  return visitorLang(acceptLanguage, country);
}

/** The page that asks for the password (plain HTML: it works before anything else of the site loads). */
export function gatePage(next: string, wrong: boolean, lang: GateLang = 'it'): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const t = GATE_T[lang];
  const booking = bookingUrl(lang);
  // the same page in another language: the address with that language's prefix (Italian has none)
  const bare = next.replace(/^\/(en|pl|de|fr|es)(?=\/|$|\?)/, '') || '/';
  const langHref = (l: GateLang) => (l === 'it' ? bare : `/${l}${bare === '/' ? '' : bare}`);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Hotel L’Ancora</title>
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
.langs{display:flex;justify-content:center;gap:4px;margin:0 0 22px}
.langs a{font:600 11px/1 system-ui,sans-serif;letter-spacing:.14em;color:#9fb0bc;text-decoration:none;padding:7px 9px;border-radius:999px;transition:background .2s,color .2s}
.langs a:hover{color:var(--ivory);background:rgba(247,243,236,.08)}.langs a[aria-current]{color:var(--navy);background:var(--gold)}
.sep{display:flex;align-items:center;gap:12px;margin:30px 0 14px;font:13px/1.4 system-ui,sans-serif;color:#9fb0bc}
.sep:before,.sep:after{content:"";flex:1;height:1px;background:rgba(247,243,236,.16)}
.bk{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-radius:999px;background:#fff;color:#003580;text-decoration:none;box-shadow:0 18px 40px -22px rgba(0,0,0,.7);transition:transform .2s,box-shadow .2s}
.bk:hover{transform:translateY(-2px);box-shadow:0 24px 48px -22px rgba(0,0,0,.8)}
.bk .logo{font:800 19px/1 system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:-.02em;color:#003580}.bk .logo i{font-style:normal;color:#009fe3}
.bk .lbl{flex:1;text-align:left;font:600 12px/1.3 system-ui,sans-serif;color:#33475b}
.bk .arr{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#003580;color:#fff;flex:none;transition:transform .2s}.bk:hover .arr{transform:translateX(3px)}
</style></head><body><main class="card">
<svg class="anchor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2"/><path d="M12 7v14M5 12H2a10 10 0 0 0 20 0h-3M8 11h8"/></svg>
<nav class="langs" aria-label="Lingua / Language">${LANGS.map((l) => `<a href="${esc(langHref(l))}" hreflang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`).join('')}</nav>
<div class="eyebrow">Hotel L’Ancora</div>
<h1>${esc(t.title)}</h1>
<p>${esc(t.text)}</p>
<form method="post" action="/api/gate">
<input type="hidden" name="next" value="${esc(next)}">
<input type="password" name="password" placeholder="${esc(t.ph)}" autocomplete="current-password" autofocus required aria-label="${esc(t.ph)}">
<button type="submit">${esc(t.go)}</button>
${wrong ? `<div class="err" role="alert">${esc(t.wrong)}</div>` : ''}
</form>
${booking ? `<div class="sep">${esc(t.meanwhile)}</div>
<a class="bk" href="${esc(booking)}" target="_blank" rel="noopener noreferrer"><span class="logo">Booking<i>.com</i></span><span class="lbl">${esc(t.book)}</span><span class="arr" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></a>` : ''}
<div class="foot">Santa Teresa Gallura · Sardegna</div>
</main></body></html>`;
}
