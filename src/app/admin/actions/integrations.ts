'use server';
import { z } from 'zod';
import { act, UserError } from '@/server/action';
import { mutate, readDb } from '@/server/db/store';
import { sendEmail } from '@/server/email/transport';
import { audit } from '@/server/events';
import { emailTransport, readIntegrations, writeIntegrations } from '@/server/integrations';
import { accountGone, clearConnect } from '@/server/payments/stripe';

/**
 * "Collega / Scollega" buttons in Impostazioni. Keys are checked against the real service before
 * being saved on the server; the browser never receives them back.
 */
export async function connectGroqAction(key: string) {
  return act('settings.edit', async (u) => {
    const k = z.string().trim().regex(/^gsk_[A-Za-z0-9]{20,}$/, 'La chiave Groq inizia con gsk_').parse(key);
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r) throw new UserError('Groq non risponde: controlla la connessione internet e riprova.');
    if (r.status === 401 || r.status === 403) throw new UserError('Chiave non valida: copiala di nuovo da console.groq.com → API Keys.');
    if (!r.ok) throw new UserError(`Groq ha risposto con errore ${r.status}. Riprova tra poco.`);
    writeIntegrations({ groqKey: k });
    mutate((db) => audit(db, u.name, 'integration', 'groq', null, 'AI gratuita Groq collegata'));
  }, 'Groq collegato: assistente, vocali, email e traduzioni ora usano l’AI.');
}

export async function disconnectGroqAction() {
  return act('settings.edit', (u) => {
    writeIntegrations({ groqKey: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'groq', null, 'Groq scollegato'));
  }, 'Groq scollegato.');
}

const PRESETS = {
  brevo: { host: 'smtp-relay.brevo.com', port: 587, secure: false },
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
} as const;

export async function connectSmtpAction(raw: unknown) {
  return act('settings.edit', async (u) => {
    const p = z
      .object({
        preset: z.enum(['brevo', 'gmail', 'altro']),
        host: z.string().trim().max(120).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        user: z.string().trim().min(3).max(160),
        pass: z.string().min(4).max(200),
        fromName: z.string().trim().min(2).max(60),
        fromEmail: z.email(),
      })
      .parse(raw);
    const base = p.preset === 'altro' ? { host: p.host ?? '', port: p.port ?? 587, secure: (p.port ?? 587) === 465 } : PRESETS[p.preset];
    if (!base.host) throw new UserError('Indica il server SMTP.');
    const cfg = { ...base, user: p.user, pass: p.pass, from: `${p.fromName.replace(/[<>"]/g, '')} <${p.fromEmail}>` };
    const nodemailer = await import('nodemailer');
    try {
      await nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, connectionTimeout: 12000 }).verify();
    } catch (e) {
      throw new UserError(`Il server email ha rifiutato l’accesso: ${(e as Error).message.slice(0, 140)}`);
    }
    writeIntegrations({ smtp: cfg, cloudflareEmail: undefined, emailWebhook: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'smtp', null, `Email collegata (${cfg.host})`));
  }, 'Email collegata: da ora le email arrivano davvero agli ospiti.');
}

export async function disconnectSmtpAction() {
  return act('settings.edit', (u) => {
    writeIntegrations({ smtp: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'smtp', null, 'Email scollegata'));
  }, 'Email scollegata: i messaggi restano nella Outbox.');
}

export async function setTranslationsAction(on: boolean) {
  return act('settings.edit', (u) => {
    writeIntegrations({ translations: on ? 'mymemory' : 'off' });
    mutate((db) => audit(db, u.name, 'integration', 'translations', null, on ? 'Traduzioni gratuite attive' : 'Traduzioni gratuite spente'));
  }, on ? 'Traduzioni automatiche attive.' : 'Traduzioni automatiche spente.');
}

export async function integrationsSnapshot() {
  return act('settings.edit', () => {
    const i = readIntegrations();
    return { groq: Boolean(i.groqKey), smtp: Boolean(i.smtp) };
  });
}

/**
 * The hotel's own Stripe account: the owner pastes the two keys from dashboard.stripe.com →
 * Developers → API keys. We check them with Stripe and, when the site is online (https), create
 * the webhook automatically so bookings are confirmed by Stripe itself.
 */
export async function connectStripeAction(secretKey: string, publishableKey: string) {
  return act('settings.edit', async (u) => {
    const sk = z.string().trim().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{20,}$/, 'La chiave segreta inizia con sk_test_ (prova) o sk_live_').parse(secretKey);
    const pk = z.string().trim().regex(/^pk_(test|live)_[A-Za-z0-9]{20,}$/, 'La chiave pubblicabile inizia con pk_test_ o pk_live_').parse(publishableKey);
    const live = sk.includes('_live_');
    if (live !== pk.startsWith('pk_live_')) throw new UserError('Le due chiavi devono essere entrambe di prova (test) o entrambe reali (live).');
    if (live && !(process.env.DEMO_MODE === 'false' && process.env.ALLOW_LIVE_PAYMENTS === 'true')) throw new UserError('Il sito è in modalità demo: per ora collega le chiavi di prova (sk_test_ / pk_test_). I pagamenti reali si attivano quando il sito va online.');
    const Stripe = (await import('stripe')).default;
    const client = new Stripe(sk);
    let accountName = '';
    try {
      const acc = await client.accounts.retrieveCurrent();
      accountName = acc.business_profile?.name || acc.settings?.dashboard?.display_name || acc.email || acc.id;
    } catch (e) {
      throw new UserError(`Stripe non accetta questa chiave: ${(e as Error).message.slice(0, 120)}`);
    }
    // the hotel's account made with the test keys does not exist with the real ones (two separate
    // worlds on Stripe): the panel goes back to "Collega il mio conto" instead of a broken account
    const linked = readDb().settings.stripeConnect;
    const linkedId = linked.accountId && !linked.simulated ? linked.accountId : null;
    const gone = linkedId ? await client.accounts.retrieve(linkedId).then(() => false, (e) => accountGone(e)) : false;
    const prev = readIntegrations().stripe;
    writeIntegrations({ stripe: { secretKey: sk, publishableKey: pk, accountName, ...(prev?.secretKey === sk ? { webhookId: prev.webhookId, connectWebhookId: prev.connectWebhookId } : {}) } });
    if (gone)
      mutate((db) => {
        if (db.settings.stripeConnect.accountId !== linkedId) return;
        clearConnect(db);
        audit(db, u.name, 'stripe_disconnect', 'settings', null, `Conto ${linkedId} creato con le chiavi di prova: con le nuove chiavi va collegato di nuovo`);
      });
    // Stripe's notifications (payments + the hotel's account) to this site's address, set up by itself
    const { ensureStripeWebhook } = await import('@/server/payments/webhook-setup');
    const webhookId = (await ensureStripeWebhook(true).catch(() => false)) ? readIntegrations().stripe?.webhookId : undefined;
    mutate((db) => audit(db, u.name, 'integration', 'stripe', null, `Stripe collegato (${live ? 'live' : 'test'}) · ${accountName}${webhookId ? ' · webhook creato' : ''}`));
    return { accountName, webhook: Boolean(webhookId), live };
  });
}

export async function disconnectStripeAction() {
  return act('settings.edit', async (u) => {
    const prev = readIntegrations().stripe;
    if (prev?.webhookId) {
      const Stripe = (await import('stripe')).default;
      await new Stripe(prev.secretKey).webhookEndpoints.del(prev.webhookId).catch(() => null);
    }
    writeIntegrations({ stripe: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'stripe', null, 'Stripe scollegato'));
  }, 'Stripe scollegato: i pagamenti tornano in simulazione.');
}

/* ---------------- e-mail: Cloudflare Email Service or a Make.com webhook ---------------- */

async function testMail(kind: 'cloudflare' | 'webhook', t: Parameters<typeof sendEmail>[1], to: string) {
  const db = readDb();
  try {
    await sendEmail(
      {
        to,
        subject: `Prova · le email di ${db.settings.hotel.name} sono collegate`,
        html: `<p>Ciao! Questa è un’email di prova inviata dal pannello di <b>${db.settings.hotel.name}</b> tramite ${t?.kind === 'cloudflare' ? 'Cloudflare Email Service' : t?.kind === 'smtp' ? 'SMTP' : 'Make.com'}.</p><p>Da ora conferme, promemoria e richieste di recensione arrivano davvero agli ospiti.</p>`,
        text: `Email di prova dal pannello di ${db.settings.hotel.name}: le email sono collegate.`,
        replyTo: db.settings.hotel.email,
      },
      t,
    );
  } catch (e) {
    throw new UserError((e as Error).message);
  }
}

export async function connectCloudflareEmailAction(raw: unknown) {
  return act('settings.edit', async (u) => {
    const p = z
      .object({
        accountId: z.string().trim().regex(/^[a-f0-9]{32}$/i, 'L’Account ID è di 32 caratteri (Cloudflare → pagina del dominio, a destra).'),
        apiToken: z.string().trim().min(30, 'Token non valido: crealo in My Profile → API Tokens con il permesso “Email Sending: Edit”.'),
        fromAddress: z.email('Indirizzo mittente non valido'),
        fromName: z.string().trim().min(2).max(60),
        testTo: z.email('Indirizzo per la prova non valido'),
      })
      .parse(raw);
    const cf = { accountId: p.accountId, apiToken: p.apiToken, fromAddress: p.fromAddress.toLowerCase(), fromName: p.fromName.replace(/[<>"]/g, '') };
    await testMail('cloudflare', { kind: 'cloudflare', source: 'panel', cf }, p.testTo);
    writeIntegrations({ cloudflareEmail: cf, smtp: undefined, emailWebhook: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'email', null, `Email collegate con Cloudflare (${cf.fromAddress})`));
  }, 'Cloudflare collegato: ti ho mandato un’email di prova.');
}

export async function connectEmailWebhookAction(raw: unknown) {
  return act('settings.edit', async (u) => {
    const p = z
      .object({
        url: z.url('Incolla l’indirizzo del webhook di Make').refine((v) => v.startsWith('https://'), 'Il webhook deve iniziare con https://'),
        secret: z.string().trim().max(80).optional(),
        testTo: z.email('Indirizzo per la prova non valido'),
      })
      .parse(raw);
    // the same webhook saved again without the key keeps the key it had (the scenario checks it)
    const before = readIntegrations().emailWebhook;
    const secret = p.secret || (before?.url === p.url.trim() ? before.secret : undefined);
    const hook = { url: p.url.trim(), ...(secret ? { secret } : {}) };
    await testMail('webhook', { kind: 'webhook', source: 'panel', hook }, p.testTo);
    writeIntegrations({ emailWebhook: hook, smtp: undefined, cloudflareEmail: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'email', null, `Email collegate con Make.com (${new URL(hook.url).host})`));
  }, 'Make.com collegato: ho mandato un’email di prova attraverso lo scenario.');
}

/** Disconnects whichever e-mail service was connected from the panel. */
export async function disconnectEmailAction() {
  return act('settings.edit', (u) => {
    writeIntegrations({ smtp: undefined, cloudflareEmail: undefined, emailWebhook: undefined });
    mutate((db) => audit(db, u.name, 'integration', 'email', null, 'Email scollegate'));
  }, 'Email scollegate: i messaggi restano nella Outbox.');
}

/** "Send a test" with whatever e-mail service is connected now (also from .env). */
export async function sendTestEmailAction(to: string) {
  return act('settings.edit', async () => {
    const addr = z.email('Indirizzo non valido').parse(to);
    const t = emailTransport();
    if (!t) throw new UserError('Nessun servizio email collegato.');
    await testMail(t.kind === 'cloudflare' ? 'cloudflare' : 'webhook', t, addr);
  }, 'Email di prova inviata: controlla la casella (anche lo spam).');
}

export type SetupCheck = { id: 'ai' | 'voice' | 'telegram' | 'email' | 'stripe' | 'db' | 'site'; label: string; state: 'ok' | 'todo' | 'error'; detail: string; todo?: string; sql?: string; link?: string };

/**
 * "Controlla e collega tutto": tries every service for real (a tiny AI call, Telegram getMe, the
 * database…), repairs what it can on its own (Telegram listening mode, first copy of the data to
 * Supabase) and returns a plain list: what works, what is missing and the one step to finish it.
 */
export async function autoSetupAction() {
  return act('settings.edit', async (u) => {
    const { getProvider, providerStatus } = await import('@/server/ai/provider');
    const { transcriptionConfigured, transcriptionLabel } = await import('@/server/ai/transcribe');
    const { telegramConfigured, tg, setWebhook } = await import('@/server/telegram/api');
    const { stablePublicUrl, telegramRuntime, startTelegramListener } = await import('@/server/telegram/poller');
    const { cloudConfigured, cloudFetch, cloudPushNow, cloudStatus, CLOUD_TABLE_SQL } = await import('@/server/db/cloud');
    const { stripeMode } = await import('@/server/payments/stripe');
    const { transportLabel } = await import('@/server/email/transport');
    const out: SetupCheck[] = [];
    const db = readDb();

    // AI
    const provider = getProvider();
    if (!provider) out.push({ id: 'ai', label: 'Assistente AI', state: 'todo', detail: 'Nessuna chiave collegata: l’assistente risponde solo con le regole di base.', todo: 'Apri “Assistente AI” qui sotto e incolla la chiave gratuita di Groq.' });
    else {
      try {
        await Promise.race([provider.complete([{ role: 'user', content: 'Rispondi solo: ok' }], { maxTokens: 8, temperature: 0 }), new Promise((_, j) => setTimeout(() => j(new Error('nessuna risposta in 10 secondi')), 10000))]);
        out.push({ id: 'ai', label: 'Assistente AI', state: 'ok', detail: 'Risponde ed è pronto.' });
      } catch (e) {
        out.push({ id: 'ai', label: 'Assistente AI', state: 'error', detail: `La chiave c’è ma il servizio non risponde: ${(e as Error).message}`, todo: 'Controlla la chiave in “Assistente AI” (scollega e ricollega).' });
      }
    }
    // voice
    out.push(transcriptionConfigured() ? { id: 'voice', label: 'Messaggi vocali', state: 'ok', detail: 'I vocali vengono capiti.' } : { id: 'voice', label: 'Messaggi vocali', state: 'todo', detail: 'Usano la stessa chiave gratuita dell’assistente.', todo: 'Collega Groq in “Assistente AI”: i vocali si attivano da soli.' });

    // Telegram
    if (!telegramConfigured()) out.push({ id: 'telegram', label: 'Telegram', state: 'todo', detail: 'Manca il token del bot.', todo: 'Crea il bot con @BotFather e scrivi il token in .env.local (TELEGRAM_BOT_TOKEN).' });
    else {
      try {
        const me = await tg<{ username: string }>('getMe');
        const base = stablePublicUrl();
        const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
        let how = '';
        if (base && secret.length >= 16) {
          await setWebhook(`${base}/api/telegram/webhook`, secret);
          how = 'collegato all’indirizzo pubblico del sito';
        } else {
          startTelegramListener();
          const info = await tg<{ url?: string }>('getWebhookInfo');
          if (info.url) await tg('deleteWebhook', { drop_pending_updates: false }); // an old tunnel address: messages were going nowhere
          const rt = telegramRuntime();
          how = rt.mode === 'listening' || rt.mode === 'standby' ? 'il sito ascolta il bot direttamente (nessun tunnel)' : 'ascolto in avvio: riprova tra qualche secondo';
        }
        const chats = db.telegram.linkedChats.length;
        out.push(chats ? { id: 'telegram', label: 'Telegram', state: 'ok', detail: `@${me.username} · ${how} · ${chats} chat collegat${chats === 1 ? 'a' : 'e'}` } : { id: 'telegram', label: 'Telegram', state: 'todo', detail: `@${me.username} · ${how}`, todo: 'Manca solo la tua chat: apri “Telegram” qui sotto, genera il codice e invialo al bot.' });
      } catch (e) {
        out.push({ id: 'telegram', label: 'Telegram', state: 'error', detail: `Il bot non risponde: ${(e as Error).message}`, todo: 'Controlla TELEGRAM_BOT_TOKEN in .env.local.' });
      }
    }

    // email
    const mail = emailTransport();
    out.push(mail ? { id: 'email', label: 'Email agli ospiti', state: 'ok', detail: 'Partono dalla casella dell’hotel.' } : { id: 'email', label: 'Email agli ospiti', state: 'todo', detail: 'Conferme e richieste di recensione non partono ancora.', todo: 'Apri “Email” qui sotto e scegli Make.com, Cloudflare o Gmail.' });

    // payments
    const sm = stripeMode();
    const pay = db.settings.payments;
    out.push(
      pay.allowOnline === false
        ? { id: 'stripe', label: 'Pagamenti', state: 'ok', detail: 'Solo in hotel all’arrivo: non serve Stripe.' }
        : sm === 'off'
          ? { id: 'stripe', label: 'Pagamenti con carta', state: 'todo', detail: 'Per ora il pagamento è simulato (nessun addebito reale).', todo: process.env.DEMO_MODE !== 'false' ? 'Per le prove: incolla le due chiavi di test in “Pagamenti con carta”. Sul sito consegnato le chiavi stanno sul server e il proprietario usa solo “Collega Stripe”.' : 'Chi gestisce il sito deve attivare Stripe sul server; poi in Pagamenti compare “Collega Stripe”. In alternativa scegli “Solo in hotel” in Pagamenti.' }
          : { id: 'stripe', label: 'Pagamenti con carta', state: 'ok', detail: sm === 'test' ? 'Stripe in modalità test' : 'Stripe attivo' },
    );

    // database copy
    const { CLOUD } = await import('@/server/db/cloud-row');
    // hosting without a disk (Vercel): Supabase IS the archive, every change is saved there directly;
    // the tables are refreshed by the hourly job. Nothing to copy here (and no second writer).
    if (CLOUD) out.push({ id: 'db', label: 'Archivio dati', state: 'ok', detail: 'I dati sono al sicuro nel cloud e si aggiornano a ogni modifica.' });
    else if (!cloudConfigured()) out.push({ id: 'db', label: 'Archivio dati', state: 'todo', detail: 'I dati vivono solo su questo computer.', todo: 'Scrivi SUPABASE_URL e SUPABASE_SECRET_KEY in .env.local e riavvia.' });
    else {
      const { syncTables, verifyTables, shadowRead, tablesSql, tablesStatus } = await import('@/server/db/tables-sync');
      const remote = await cloudFetch().catch(() => null);
      const st = cloudStatus();
      const link = `https://supabase.com/dashboard/project/${st.project}/sql/new`;
      const paste = 'Apri l’editor SQL di Supabase, incolla queste righe, premi Run e poi di nuovo questo pulsante.';
      // one file creates everything: the copy of the document (hotel_state) and the real tables
      if (st.table === false) out.push({ id: 'db', label: 'Archivio dati', state: 'todo', detail: `Progetto ${st.project} raggiunto, mancano solo le tabelle.`, todo: paste, sql: tablesSql() ?? CLOUD_TABLE_SQL, link });
      else if (st.ok === false) out.push({ id: 'db', label: 'Archivio dati', state: 'error', detail: `Supabase non risponde: ${st.lastError ?? 'errore'}`, todo: 'Controlla le chiavi in .env.local.' });
      else {
        const pushed = !remote || remote.version < db.version ? await cloudPushNow(db) : true;
        if (!pushed) out.push({ id: 'db', label: 'Archivio dati', state: 'error', detail: `Salvataggio non riuscito: ${cloudStatus().lastError ?? 'errore'}` });
        else {
          // the same data as rows of real tables (one-way export, see server/db/tables-sync.ts)
          // the document as it is now (the checks above take a while and a guest may have booked meanwhile)
          const cur = readDb();
          const copy = `Copia dei dati salvata su Supabase (versione ${cur.version})`;
          let t = await syncTables(cur);
          let check = t.ok ? await verifyTables(cur).catch(() => null) : null;
          if (t.ok && check && check.mismatches.length) {
            // the tables drifted from the document (edited by hand, an interrupted copy): write everything again
            t = await syncTables(cur, { full: true });
            check = t.ok ? await verifyTables(cur).catch(() => null) : null;
          }
          // stage 3a: read the tables back, rebuild the document from them and compare (the site does not use the result)
          const trial = t.ok && check?.ok ? await shadowRead(readDb()).catch(() => null) : null;
          if (!t.ok && t.missing) out.push({ id: 'db', label: 'Archivio dati', state: 'todo', detail: `${copy}. Mancano ancora le tabelle vere (camere, prenotazioni, pagamenti…).`, todo: tablesSql() ? paste : 'Apri l’editor SQL di Supabase, incolla il file supabase/hotel-tables.sql, premi Run e poi di nuovo questo pulsante.', sql: tablesSql() ?? undefined, link });
          else if (!t.ok) out.push({ id: 'db', label: 'Archivio dati', state: 'error', detail: `${copy}, ma le tabelle hanno rifiutato l’aggiornamento: ${t.error}` });
          // a column added to the site after the SQL file was run: the tables would quietly miss it
          else if (check && check.columns.length) out.push({ id: 'db', label: 'Archivio dati', state: 'todo', detail: `${copy}, ma al database mancano ${check.columns.length} colonne nuove (${check.columns.slice(0, 4).join(', ')}): finché non ci sono, quei dati non arrivano nelle tabelle e il sito non parte dalle tabelle.`, todo: 'Aggiornamento del database: incolla di nuovo queste righe nell’editor SQL di Supabase e premi Run. Aggiunge solo ciò che manca; i dati non vengono toccati.', sql: tablesSql() ?? undefined, link });
          else if (check && check.mismatches.length) out.push({ id: 'db', label: 'Archivio dati', state: 'error', detail: `${copy}, ma il numero di righe non coincide: ${check.mismatches.map((m) => `${m.table} ${m.database ?? '—'}/${m.document}`).join(', ')}` });
          else if (trial && !trial.ok && !trial.error) out.push({ id: 'db', label: 'Archivio dati', state: 'error', detail: `${copy}, ma rileggendo le tabelle ${trial.real} valori non coincidono col documento (elenco in data/shadow-read.json). Il sito continua a usare il documento.` });
          else {
            // a table added to the SQL file later (the order of the lists) is not in this database yet: everything
            // works without it, the owner only has to run the same file once more
            const upgrade = check?.missing.length ? { todo: 'Aggiornamento del database: incolla di nuovo queste righe nell’editor SQL di Supabase e premi Run. Aggiunge la tabella che conserva l’ordine delle liste; i dati non vengono toccati.', sql: tablesSql() ?? undefined, link } : {};
            // stage 3b: where the data came from when the site started
            const start = tablesStatus().start;
            const started = !start ? '' : start.source === 'tables' ? ` All’avvio il sito ha caricato i dati dalle tabelle (v${start.version}).` : start.source === 'local' ? ' All’avvio il sito parte dalle tabelle quando sono più recenti di questo computer (all’ultimo avvio non lo erano).' : start.source === 'rejected' || start.source === 'error' ? ` All’ultimo avvio le tabelle non sono state usate: ${start.detail}` : start.source === 'disabled' ? ' Avvio dalle tabelle disattivato (TABLES_START=off).' : '';
            // the owner reads one plain line; the technical detail goes to the server log for whoever maintains the site
            console.info('[collega tutto] database:', `${copy}${check ? ` e ${check.tables} tabelle allineate (${check.rows} righe)` : ''}; si aggiorna a ogni modifica.${trial?.ok ? ` Lettura di prova dalle tabelle: identica al documento${trial.order.length ? '' : ', ordine delle liste compreso'}.` : ''}${started}`);
            out.push({ id: 'db', label: 'Archivio dati', state: 'ok', detail: 'I dati sono al sicuro nel cloud e si aggiornano a ogni modifica.', ...upgrade });
          }
        }
      }
    }

    // where the site lives
    const pub = stablePublicUrl();
    out.push(pub ? { id: 'site', label: 'Sito online', state: 'ok', detail: pub } : { id: 'site', label: 'Sito online', state: 'todo', detail: 'Il sito gira su questo computer: è visibile solo da qui (o finché resta acceso un tunnel).', todo: 'Per averlo sempre online serve un hosting e un dominio: quando vuoi lo pubblichiamo e si imposta APP_URL.' });

    mutate((d) => audit(d, u.name, 'setup_check', 'settings', null, `Controllo collegamenti: ${out.filter((c) => c.state === 'ok').length}/${out.length} attivi`));
    return out;
  });
}
