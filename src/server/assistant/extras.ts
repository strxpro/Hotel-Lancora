import 'server-only';
import type { DB, Locale } from '@/lib/types';
import type { UiStep } from '@/lib/assist';
import { translateFields } from '../ai/content';
import { normIt } from './dates-it';

/* ---------------- the language the owner writes in ---------------- */

export const LANG_NAME: Record<Locale, string> = { it: 'italiano', en: 'inglese', pl: 'polacco', de: 'tedesco', fr: 'francese', es: 'spagnolo' };

/** A good-enough guess from a short message (diacritics first, then frequent words). */
export function detectLang(text: string): Locale {
  const raw = ` ${text.toLowerCase()} `;
  const t = ` ${normIt(text)} `;
  const has = (re: RegExp) => re.test(t);
  if (/[ąćęłńśźż]/.test(raw) || has(/\b(jak|czy|sie|jest|nie|pokaz|zrob|dodaj|dodac|ile|kto|dzis|dzisiaj|jutro|pokoj|pokoju|pokoje|cene|cena|zmien|prosze|mozesz|wszystk|napisz|wyslij|zaplacil|gotowk|rezerwac|goscie|gosci|jakie|ktore|wolne|wiadomosc|zdjeci)\b/)) return 'pl';
  if (/[äöüß]/.test(raw) || has(/\b(wie|ich|ist|nicht|zimmer|heute|morgen|bitte|und|der|die|das|zeig|preis|gaste)\b/)) return 'de';
  if (/[ñ¿¡]/.test(raw) || has(/\b(habitacion|hoy|manana|precio|por favor|quiero|cuanto|muestrame|cuales)\b/)) return 'es';
  if (has(/\b(chambre|aujourd|demain|prix|je veux|combien|montre|quelles|est ce)\b/)) return 'fr';
  if (has(/\b(the|how|what|who|is|are|room|rooms|today|tomorrow|please|show|change|price|can you|i want|which|paid|guests)\b/)) return 'en';
  return 'it';
}

/** Rule answers are written in Italian: translate them for an owner who wrote in another language. */
export async function localize(texts: Record<string, string>, lang: Locale): Promise<Record<string, string>> {
  if (lang === 'it' || !Object.keys(texts).length) return texts;
  try {
    return (await translateFields(texts, lang, 'it')) ?? texts;
  } catch {
    return texts;
  }
}

export async function localizeSteps(steps: UiStep[] | undefined, lang: Locale): Promise<UiStep[] | undefined> {
  if (!steps?.length || lang === 'it') return steps;
  const says: Record<string, string> = {};
  steps.forEach((s, i) => 'say' in s && s.say && (says[`s${i}`] = s.say));
  const tr = await localize(says, lang);
  return steps.map((s, i) => ('say' in s && s.say ? { ...s, say: tr[`s${i}`] ?? s.say } : s));
}

/* ---------------- "show me how" on screen ---------------- */

const PLAYBOOKS: { k: RegExp; steps: UiStep[] }[] = [
  {
    k: /((aggiung|nuova|crea|dodac|dodaj|add|new).*(camer|stanz|pokoj|room))|((camer|pokoj|room).*(aggiung|nuova|dodac|dodaj))/,
    steps: [
      { do: 'go', path: '/admin/camere', say: 'Apro “Camere”.' },
      { do: 'point', target: 'sel:[data-tour="room-add"]', say: 'Qui si aggiunge una camera.' },
      { do: 'click', target: 'sel:[data-tour="room-add"]', say: 'La apro: è una procedura in 5 passi.' },
      { do: 'point', target: 'sel:[data-tour="wizard-help"]', say: '“Aiutami con AI” scrive i testi al posto tuo. Poi letti, foto, servizi e prezzo.' },
    ],
  },
  {
    k: /(prezz|tariff|cen[aey]\b|cene|price)/,
    steps: [
      { do: 'go', path: '/admin/prezzi', say: 'Apro “Prezzi”.' },
      { do: 'point', target: 'sel:[data-tour="prices-board"]', say: 'Tocca una o più camere: diventano blu.' },
      { do: 'click', target: 'sel:[data-tour="prices-board"] >> sel:button[aria-pressed]', say: 'Scelgo la prima camera…' },
      { do: 'point', target: 'text:Applica', say: '…in basso scrivi il prezzo con carta e in contanti, poi “Applica”.' },
      { do: 'point', target: 'sel:[data-tour="prices-periods"]', say: 'Per agosto o Natale usa “Prezzo per periodo”.' },
    ],
  },
  {
    k: /(pagament|incass|contant|gotow|pos\b|platnos|zaplac|payment)/,
    steps: [
      { do: 'go', path: '/admin/prenotazioni', say: 'Apro “Prenotazioni”.' },
      { do: 'click', target: 'sel:[data-tour="bookings"] >> sel:tbody tr, [data-tour="bookings"] li button', say: 'Tocco una prenotazione…' },
      { do: 'point', target: 'text:Registra pagamento', say: '…e qui registri carta (POS), contanti o bonifico.' },
    ],
  },
  {
    k: /(prenotazion|rezerwac|booking).*(nuova|telefon|crea|aggiung|dodaj|nowa|new)|(nuova|nowa|new).*(prenotazion|rezerwac|booking)/,
    steps: [
      { do: 'go', path: '/admin/prenotazioni', say: 'Apro “Prenotazioni”.' },
      { do: 'click', target: 'text:Nuova prenotazione', say: '“Nuova prenotazione”: date, camera, ospite.' },
    ],
  },
  {
    k: /(blocc|chiud|manutenz|zablok|zamkn|planning|calendar|grafik)/,
    steps: [
      { do: 'go', path: '/admin/disponibilita', say: 'Apro il planning.' },
      { do: 'point', target: 'sel:[data-tour="planning-legend"]', say: 'Blu = confermata, oro = in attesa, grigio = camera chiusa.' },
      { do: 'say', say: 'Per chiudere una camera tocca la sua riga nei giorni giusti, oppure scrivimi “chiudi la 105 dal 12 al 15”.' },
    ],
  },
  {
    k: /(e-?mail|mail|campagn|newsletter|wiadomo|messag)/,
    steps: [
      { do: 'go', path: '/admin/marketing', say: 'Apro “Recensioni e Marketing”.' },
      { do: 'click', target: 'sel:[data-tour="mk-tabs"] >> text:Email', say: 'Scheda “Email ai clienti”.' },
      { do: 'type', target: 'sel:[data-tour="mk-words"] >> sel:textarea', text: 'Offerta di primavera: -10% per chi torna a trovarci ad aprile', say: 'Scrivi con parole tue cosa vuoi dire…' },
      { do: 'point', target: 'sel:[data-tour="mk-people"]', say: '…scegli a chi mandarla: ognuno la riceve nella sua lingua.' },
    ],
  },
  {
    k: /(recension|stell|opini|review|komentarz)/,
    steps: [
      { do: 'go', path: '/admin/marketing', say: 'Apro “Recensioni e Marketing”.' },
      { do: 'click', target: 'sel:[data-tour="mk-tabs"] >> text:Recensioni', say: 'Scheda “Recensioni”.' },
      { do: 'point', target: 'text:Aggiungi recensione', say: 'Qui ne aggiungi una a mano; sotto approvi, rispondi o elimini.' },
    ],
  },
  {
    k: /(telegram|\bbot\b|vocal|voce|glos)/,
    steps: [
      { do: 'go', path: '/admin/impostazioni', say: 'Apro “Impostazioni”.' },
      { do: 'click', target: 'sel:[data-tour="connections"] >> text:Telegram', say: 'Scheda Telegram.' },
      { do: 'point', target: 'text:Genera codice', say: 'Premi “Genera codice” e nel bot scrivi /collega con il codice.' },
    ],
  },
  {
    k: /(\bai\b|groq|intelligenz|chiave|klucz|\bkey\b|sztuczn)/,
    steps: [
      { do: 'go', path: '/admin/impostazioni', say: 'Apro “Impostazioni”.' },
      { do: 'click', target: 'sel:[data-tour="connections"] >> text:AI gratuita', say: 'Scheda “AI gratuita”.' },
      { do: 'point', target: 'sel:input[placeholder="gsk_…"]', say: 'Incolla qui la chiave gsk_ di console.groq.com e premi “Collega”.' },
    ],
  },
  {
    k: /(stripe|carta di credito|karta|card)/,
    steps: [
      { do: 'go', path: '/admin/impostazioni', say: 'Apro “Impostazioni”.' },
      { do: 'click', target: 'sel:[data-tour="connections"] >> text:Pagamenti con carta', say: 'Scheda “Pagamenti con carta”.' },
      { do: 'point', target: 'text:Collega Stripe', say: 'Incolla le due chiavi di Stripe e premi “Collega Stripe”.' },
    ],
  },
  {
    k: /(client|ospit|gosc|klient|guest)/,
    steps: [
      { do: 'go', path: '/admin/clienti', say: 'Apro “Clienti”.' },
      { do: 'type', target: 'sel:[data-tour="guests-search"] >> sel:input', text: 'Rossi', say: 'Cerca per nome, email o telefono…' },
      { do: 'point', target: 'sel:[data-tour="guests-list"]', say: '…tocca una persona per vedere soggiorni, spesa e recensioni.' },
    ],
  },
];

/** Steps to show "how" on screen for a how-to question, if we have them. */
export function playbookFor(text: string): UiStep[] | undefined {
  const t = normIt(text);
  return PLAYBOOKS.find((p) => p.k.test(t))?.steps;
}

/** After an action was done: go where it shows and point at it. */
export function replayFor(tool: string, args: Record<string, unknown>, db: DB): UiStep[] | undefined {
  const room = typeof args.room === 'string' ? args.room : null;
  const code = typeof args.code === 'string' ? args.code.toUpperCase() : null;
  switch (tool) {
    case 'set_price':
      return room
        ? [
            { do: 'go', path: '/admin/prezzi', say: 'Vado su “Prezzi”…' },
            { do: 'point', target: `sel:[data-tour="prices-board"] >> text:${room}`, say: `Ecco la camera ${room} con il nuovo prezzo.` },
          ]
        : undefined;
    case 'block_room':
    case 'unblock_room':
      return room
        ? [
            { do: 'go', path: '/admin/disponibilita', say: 'Apro il planning…' },
            { do: 'point', target: `text:${room}`, say: tool === 'block_room' ? `La camera ${room}: le righe grigie sono le notti chiuse.` : `La camera ${room} è di nuovo libera.` },
          ]
        : undefined;
    case 'set_visibility':
    case 'apply_description':
      return room
        ? [
            { do: 'go', path: '/admin/camere', say: 'Apro “Camere”…' },
            { do: 'point', target: `sel:[data-tour="rooms-list"] >> text:${room}`, say: `Ecco la camera ${room}, già aggiornata sul sito.` },
          ]
        : undefined;
    case 'record_payment':
    case 'cancel_booking':
    case 'refund':
      return code && db.bookings.some((b) => b.code.toUpperCase() === code)
        ? [
            { do: 'go', path: '/admin/prenotazioni', say: 'Apro “Prenotazioni”…' },
            { do: 'type', target: 'sel:#bk-search', text: code, say: `Cerco ${code}…` },
            { do: 'click', target: `sel:[data-tour="bookings"] >> text:${code}`, say: 'La apro: qui vedi la modifica.' },
          ]
        : undefined;
    case 'set_reports':
      return [{ do: 'go', path: '/admin/automazioni', say: 'Apro “Automazioni”: qui vedi gli orari e gli interruttori dei messaggi.' }];
    case 'send_campaign':
      return [
        { do: 'go', path: '/admin/marketing', say: 'Apro “Recensioni e Marketing”…' },
        { do: 'click', target: 'sel:[data-tour="mk-tabs"] >> text:Email', say: 'Qui trovi l’email inviata e le statistiche.' },
      ];
    default:
      return undefined;
  }
}
