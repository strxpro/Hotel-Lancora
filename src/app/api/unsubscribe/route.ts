import { NextResponse } from 'next/server';
import { mutate, readDb } from '@/server/db/store';
import { audit } from '@/server/events';
import { verifyUnsubscribe } from '@/server/email/campaign';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string) =>
  new NextResponse(
    `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8F5EE;font-family:Arial,Helvetica,sans-serif;color:#242B2D;padding:24px;box-sizing:border-box">
<main style="max-width:440px;text-align:center"><div style="font-family:Georgia,serif;letter-spacing:4px;color:#10283D;font-size:22px">L’ANCORA</div>
<h1 style="font-family:Georgia,serif;font-weight:normal;color:#10283D;font-size:28px;margin:28px 0 12px">${title}</h1>${body}</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

function params(req: Request) {
  const u = new URL(req.url);
  return { email: (u.searchParams.get('e') ?? '').trim().toLowerCase(), token: u.searchParams.get('t') ?? '' };
}

/** Link in the email: asks for confirmation (mail scanners that pre-open links must not unsubscribe anyone). */
export async function GET(req: Request) {
  const { email, token } = params(req);
  if (!email || !verifyUnsubscribe(email, token)) return page('Link non valido', '<p>Il link di disiscrizione non è valido o è incompleto.</p>');
  if (readDb().unsubscribed.includes(email)) return page('Sei già disiscritto', `<p>${esc(email)} non riceverà più comunicazioni promozionali.</p>`);
  return page(
    'Vuoi disiscriverti?',
    `<p style="line-height:1.6">${esc(email)} non riceverà più offerte e novità. Le email sulle tue prenotazioni continueranno ad arrivare.</p>
<form method="post"><button style="margin-top:20px;background:#10283D;color:#F8F5EE;border:0;border-radius:999px;padding:14px 28px;font-size:13px;letter-spacing:2px;text-transform:uppercase;cursor:pointer">Conferma la disiscrizione</button></form>`,
  );
}

/** Confirmation button and RFC 8058 one-click unsubscribe from the mail client. */
export async function POST(req: Request) {
  const { email, token } = params(req);
  if (!email || !verifyUnsubscribe(email, token)) return page('Link non valido', '<p>Il link di disiscrizione non è valido.</p>');
  mutate((db) => {
    if (!db.unsubscribed.includes(email)) {
      db.unsubscribed.push(email);
      audit(db, 'Ospite', 'unsubscribe', 'marketing', null, email);
    }
  });
  return page('Fatto, sei disiscritto', `<p>${esc(email)} non riceverà più comunicazioni promozionali.</p>`);
}
