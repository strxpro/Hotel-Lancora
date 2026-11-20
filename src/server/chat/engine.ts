import 'server-only';
import { cancelText } from '@/lib/cancellation';
import type { DB, Locale } from '@/lib/types';
import { isPubliclyBookable, searchAvailability } from '@/lib/availability';
import { addDays, fmtDate } from '@/lib/dates';
import { localePath } from '@/lib/i18n/config';
import { money, ospiti } from '@/lib/utils';
import { publicPlaces } from '../places';
import { houseRules, rulesForPrompt } from '@/lib/house-rules';
import { amenityLabel } from '@/content/amenities';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { localizeRoom } from '../rooms';
import { onlineRoom } from '@/lib/online-price';
import { cardPaymentsReady } from '../payments/stripe';

export interface ChatAction {
  label: string;
  href: string;
}
export interface ChatReply {
  lang: Locale;
  intent: string;
  text: string;
  actions: ChatAction[];
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

const STOP: Record<Locale, string[]> = {
  it: ['il', 'lo', 'la', 'che', 'per', 'una', 'avete', 'dove', 'quanto', 'sono', 'come', 'posso', 'della', 'del', 'camera', 'ci', 'ora', 'domani', 'grazie', 'buongiorno', 'vicinanze'],
  en: ['the', 'is', 'do', 'you', 'have', 'what', 'where', 'how', 'much', 'room', 'for', 'can', 'my', 'are', 'there', 'tomorrow', 'thanks', 'which', 'near'],
  pl: ['czy', 'jest', 'macie', 'gdzie', 'jak', 'ile', 'pokoj', 'dla', 'jutro', 'mozna', 'sie', 'na', 'dziekuje', 'jakie', 'kosztuje', 'osob', 'moge', 'rezerwacje'],
  de: ['der', 'die', 'das', 'ist', 'haben', 'sie', 'wo', 'wie', 'viel', 'zimmer', 'fur', 'morgen', 'ich', 'kann', 'danke', 'welche', 'gibt', 'es', 'meine'],
  fr: ['le', 'la', 'les', 'est', 'vous', 'avez', 'ou', 'combien', 'chambre', 'pour', 'demain', 'je', 'peux', 'merci', 'quelles', 'y', 'a', 'il', 'ma', 'des'],
  es: ['el', 'la', 'los', 'es', 'teneis', 'tienen', 'donde', 'cuanto', 'habitacion', 'para', 'manana', 'puedo', 'gracias', 'que', 'hay', 'mi', 'cerca', 'cuesta', 'hora'],
};

export function detectLang(text: string, fallback: Locale): Locale {
  const words = norm(text).split(/[^a-z]+/).filter(Boolean);
  if (/[ąćęłńśźż]/i.test(text)) return 'pl';
  if (/[ñ¿¡]/.test(text)) return 'es';
  if (/[äöüß]/i.test(text)) return 'de';
  let best: Locale = fallback;
  let score = 0;
  for (const l of Object.keys(STOP) as Locale[]) {
    const s = words.filter((w) => STOP[l].includes(w)).length;
    if (s > score) {
      score = s;
      best = l;
    }
  }
  return best;
}

const RX = {
  greet: /^(ciao|salve|buongiorno|buonasera|hello|hi|hey|good (morning|evening)|dzien dobry|czesc|witam|hallo|guten (tag|morgen|abend)|bonjour|bonsoir|salut|hola|buenas)\b/,
  thanks: /\b(grazie|thank|thx|dziekuj|danke|merci|gracias)/,
  availability: /(disponib|liber|available|availability|free|vacan|wolne|wolny|dostepn|frei|verfugbar|disponible|libre|zimmer frei)/,
  tomorrow: /(domani|tomorrow|jutro|morgen\b|demain|manana)/,
  today: /(oggi|stasera|today|tonight|dzis|dzisiaj|heute|aujourd|ce soir|hoy|esta noche)/,
  price: /(prezz|cost|quanto|price|how much|rate|tarif|cena\b|ile kosztuje|kosztuj|preis|kostet|prix|combien|precio|cuanto|cuesta)/,
  times: /(check.?in|check.?out|orari|a che ora|what time|godzin|o ktorej|zameldow|wymeldow|uhrzeit|wann|anreise|abreise|heure|arrivee|a quelle|hora|llegada|salida|entrada)/,
  location: /(dove si trova|dove siete|indirizzo|where is|where are|address|location|gdzie|adres|lokalizac|wo ist|wo liegt|wo befindet|adresse|ou se trouve|ou etes|donde|direccion|ubicacion|come arrivo|how do i get)/,
  modify: /(modific|cambia|cambiare|cancell|annull|disdire|change|modify|cancel|amend|zmien|zmian|anulow|odwol|ander|umbuchen|stornier|modifier|annuler|cambiar|cancelar|anular)/,
  booking: /(prenotazion|booking|reservation|rezerwac|buchung|reservierung|reserva)/,
  beach: /(spiagg|beach|plaz|strand|plage|playa|cala\b|calett|mare\b|swim|kapiel)/,
  contact: /(telefono|numero|phone|call|email|e-mail|contatt|kontakt|contact|contacto|telefon|zadzwon|appeler|llamar)/,
  persons: /(\d+)\s*(person|persone|people|guest|ospit|osob|osoby|personen|gaste|personnes|personas|adult)/,
  two: /(\b2\b|due persone|in due|coppia|two|couple|dwie|dwoch|dla dwojga|zwei|paar|deux|couple|dos personas|pareja|para dos)/,
};

const SERVICE_RX: Record<string, RegExp> = {
  colazione: /(colazion|breakfast|sniadan|fruhstuck|petit.?dej|desayun)/,
  parcheggio: /(parchegg|parking|parkplatz|aparcamiento|estacionamiento|garage|auto\b)/,
  animali: /(animal|cane|gatto|\bpet|dog|cat\b|pies|psa|kot|hund|katze|chien|chat\b|perro|gato|mascota|zwierz)/,
  wifi: /(wi.?fi|internet)/,
  piscina: /(piscin|pool|basen|schwimmbad|piscine)/,
  ristorante: /(ristorant|restaurant|restaurac|restaurante|cena in hotel|dinner)/,
  transfer: /(transfer|navetta|shuttle|przewoz)/,
  reception: /(reception|recepcj|rezeption|recepcion|24 ?h|24 ore)/,
};

const SERVICE_NAMES: Record<string, Record<Locale, string>> = {
  colazione: { it: 'la colazione', en: 'breakfast', pl: 'śniadanie', de: 'das Frühstück', fr: 'le petit-déjeuner', es: 'el desayuno' },
  parcheggio: { it: 'il parcheggio', en: 'parking', pl: 'parking', de: 'Parkplätze', fr: 'le parking', es: 'el aparcamiento' },
  animali: { it: 'gli animali', en: 'pets', pl: 'zwierzęta', de: 'Haustiere', fr: 'les animaux', es: 'las mascotas' },
  wifi: { it: 'il Wi-Fi', en: 'Wi-Fi', pl: 'Wi-Fi', de: 'WLAN', fr: 'le Wi-Fi', es: 'el Wi-Fi' },
  piscina: { it: 'la piscina', en: 'a pool', pl: 'basen', de: 'einen Pool', fr: 'une piscine', es: 'piscina' },
  ristorante: { it: 'il ristorante', en: 'a restaurant', pl: 'restaurację', de: 'ein Restaurant', fr: 'un restaurant', es: 'restaurante' },
  transfer: { it: 'il transfer', en: 'transfers', pl: 'transfer', de: 'Transfers', fr: 'les transferts', es: 'traslados' },
  reception: { it: 'gli orari della reception', en: 'reception hours', pl: 'godziny recepcji', de: 'die Rezeptionszeiten', fr: 'les horaires de la réception', es: 'el horario de recepción' },
};

type Ctx = { db: DB; lang: Locale; today: string; phone: string; email: string };

const T = {
  greet: { it: 'Buongiorno! Come posso aiutarti? Posso controllare la disponibilità, indicarti i prezzi o darti consigli su Santa Teresa Gallura.', en: 'Hello! How can I help? I can check availability, prices or give you tips about Santa Teresa Gallura.', pl: 'Dzień dobry! W czym mogę pomóc? Sprawdzę dostępność, ceny lub podpowiem, co zobaczyć w Santa Teresa Gallura.', de: 'Guten Tag! Wie kann ich helfen? Ich prüfe Verfügbarkeit und Preise oder gebe Tipps zu Santa Teresa Gallura.', fr: 'Bonjour ! Comment puis-je vous aider ? Disponibilités, prix ou conseils sur Santa Teresa Gallura.', es: '¡Hola! ¿En qué puedo ayudarte? Puedo consultar disponibilidad, precios o darte consejos sobre Santa Teresa Gallura.' },
  thanks: { it: 'Grazie a te! Se ti serve altro, sono qui.', en: 'Thank you! If you need anything else, I am here.', pl: 'Dziękuję! Jeśli czegoś potrzebujesz, jestem tutaj.', de: 'Danke! Wenn Sie noch etwas brauchen, bin ich da.', fr: 'Merci à vous ! Je reste à votre disposition.', es: '¡Gracias a ti! Si necesitas algo más, aquí estoy.' },
  availYes: { it: 'Sì: per {when} ({date}) risultano {n} camere libere, a partire da {price} a notte. Puoi verificare le altre date e prenotare direttamente qui sotto.', en: 'Yes: for {when} ({date}) there are {n} rooms free, from {price} per night. You can check other dates and book directly below.', pl: 'Tak: na {when} ({date}) mamy {n} wolnych pokoi, od {price} za noc. Poniżej sprawdzisz inne terminy i zarezerwujesz bezpośrednio.', de: 'Ja: für {when} ({date}) sind {n} Zimmer frei, ab {price} pro Nacht. Unten können Sie weitere Daten prüfen und direkt buchen.', fr: 'Oui : pour {when} ({date}), {n} chambres sont libres, à partir de {price} la nuit. Vous pouvez vérifier d’autres dates et réserver ci-dessous.', es: 'Sí: para {when} ({date}) hay {n} habitaciones libres, desde {price} por noche. Puedes consultar otras fechas y reservar abajo.' },
  availNo: { it: 'Per {when} ({date}) al momento non risultano camere libere online. Prova date vicine oppure contatta la reception: a volte si liberano posti.', en: 'For {when} ({date}) no rooms are currently free online. Try nearby dates or contact the reception: rooms sometimes free up.', pl: 'Na {when} ({date}) nie ma obecnie wolnych pokoi online. Spróbuj innych dat lub skontaktuj się z recepcją.', de: 'Für {when} ({date}) sind online derzeit keine Zimmer frei. Versuchen Sie andere Daten oder kontaktieren Sie die Rezeption.', fr: 'Pour {when} ({date}), aucune chambre n’est libre en ligne pour le moment. Essayez d’autres dates ou contactez la réception.', es: 'Para {when} ({date}) no hay habitaciones libres online ahora mismo. Prueba fechas cercanas o contacta con recepción.' },
  availAsk: { it: 'Per controllare la disponibilità reale inserisci le date nel modulo di ricerca: vedrai solo le camere libere per tutto il soggiorno, con il prezzo totale.', en: 'To check real availability, enter your dates in the search form: you will see only rooms free for the whole stay, with the total price.', pl: 'Aby sprawdzić faktyczną dostępność, wpisz daty w wyszukiwarce: zobaczysz tylko pokoje wolne przez cały pobyt, z ceną całkowitą.', de: 'Für die echte Verfügbarkeit geben Sie Ihre Daten in die Suche ein: Sie sehen nur Zimmer, die für den gesamten Aufenthalt frei sind, mit Gesamtpreis.', fr: 'Pour la disponibilité réelle, saisissez vos dates dans la recherche : seules les chambres libres pour tout le séjour s’affichent, avec le prix total.', es: 'Para ver la disponibilidad real, introduce tus fechas en el buscador: verás solo habitaciones libres para toda la estancia, con el precio total.' },
  tomorrow: { it: 'domani', en: 'tomorrow', pl: 'jutro', de: 'morgen', fr: 'demain', es: 'mañana' },
  tonight: { it: 'stanotte', en: 'tonight', pl: 'dzisiejszą noc', de: 'heute Nacht', fr: 'ce soir', es: 'esta noche' },
  price: { it: 'Una camera per {n} persone parte da {price} a notte (tariffa base: il prezzo esatto dipende dalle date). Alcune opzioni: {list}.', en: 'A room for {n} people starts from {price} per night (base rate: the exact price depends on dates). Some options: {list}.', pl: 'Pokój dla {n} osób kosztuje od {price} za noc (cena bazowa — dokładna zależy od terminu). Przykłady: {list}.', de: 'Ein Zimmer für {n} Personen gibt es ab {price} pro Nacht (Grundpreis – der genaue Preis hängt von den Daten ab). Beispiele: {list}.', fr: 'Une chambre pour {n} personnes commence à {price} la nuit (tarif de base : le prix exact dépend des dates). Quelques options : {list}.', es: 'Una habitación para {n} personas empieza en {price} por noche (tarifa base: el precio exacto depende de las fechas). Algunas opciones: {list}.' },
  priceNone: { it: 'Non abbiamo camere online per {n} persone. Scrivici: valuteremo una soluzione con più camere.', en: 'We have no single room online for {n} people. Write to us and we will look at a multi-room solution.', pl: 'Nie mamy online pokoju dla {n} osób. Napisz do nas — znajdziemy rozwiązanie z kilkoma pokojami.', de: 'Online gibt es kein Zimmer für {n} Personen. Schreiben Sie uns – wir finden eine Lösung mit mehreren Zimmern.', fr: 'Pas de chambre en ligne pour {n} personnes. Écrivez-nous, nous trouverons une solution avec plusieurs chambres.', es: 'No tenemos habitación online para {n} personas. Escríbenos y buscaremos una solución con varias habitaciones.' },
  times: { it: 'Il check-in è dalle {in} alle {inTo}, il check-out entro le {out}. Se arrivi più tardi, avvisa la reception.', en: 'Check-in is from {in} to {inTo}, check-out by {out}. If you arrive later, please let the reception know.', pl: 'Zameldowanie od {in} do {inTo}, wymeldowanie do {out}. Jeśli przyjedziesz później, daj znać recepcji.', de: 'Check-in von {in} bis {inTo}, Check-out bis {out}. Wenn Sie später ankommen, informieren Sie bitte die Rezeption.', fr: 'Arrivée de {in} à {inTo}, départ avant {out}. Si vous arrivez plus tard, prévenez la réception.', es: 'El check-in es de {in} a {inTo} y el check-out hasta las {out}. Si llegas más tarde, avisa a recepción.' },
  location: { it: "L'hotel si trova a Santa Teresa Gallura (SS), all'estremo nord della Sardegna, vicino al mare e al centro del paese. {address}", en: 'The hotel is in Santa Teresa Gallura (SS), at the northern tip of Sardinia, close to the sea and the town centre. {address}', pl: 'Hotel znajduje się w Santa Teresa Gallura (SS), na północnym krańcu Sardynii, blisko morza i centrum miasteczka. {address}', de: 'Das Hotel liegt in Santa Teresa Gallura (SS) an der Nordspitze Sardiniens, nahe am Meer und am Ortskern. {address}', fr: 'L’hôtel se trouve à Santa Teresa Gallura (SS), à la pointe nord de la Sardaigne, près de la mer et du centre. {address}', es: 'El hotel está en Santa Teresa Gallura (SS), en el extremo norte de Cerdeña, cerca del mar y del centro del pueblo. {address}' },
  addrPending: { it: "L'indirizzo esatto ti verrà confermato dalla reception.", en: 'The exact address will be confirmed by the reception.', pl: 'Dokładny adres potwierdzi recepcja.', de: 'Die genaue Adresse bestätigt Ihnen die Rezeption.', fr: 'L’adresse exacte vous sera confirmée par la réception.', es: 'Recepción te confirmará la dirección exacta.' },
  modify: { it: 'Puoi gestire la prenotazione dalla tua area ospite (link nell’email di conferma). Per cambiare date o camera contatta la reception: {phone} · {email}. Per la tua privacy, in chat non accedo ai dati delle prenotazioni.', en: 'You can manage your booking from your guest area (link in the confirmation email). To change dates or room, contact the reception: {phone} · {email}. For your privacy, this chat cannot access booking data.', pl: 'Rezerwacją zarządzasz w strefie gościa (link w e-mailu z potwierdzeniem). Aby zmienić daty lub pokój, skontaktuj się z recepcją: {phone} · {email}. Ze względu na prywatność czat nie ma dostępu do danych rezerwacji.', de: 'Ihre Buchung verwalten Sie im Gästebereich (Link in der Bestätigungsmail). Für Änderungen kontaktieren Sie die Rezeption: {phone} · {email}. Aus Datenschutzgründen hat der Chat keinen Zugriff auf Buchungsdaten.', fr: 'Vous gérez votre réservation depuis votre espace client (lien dans l’e-mail de confirmation). Pour changer de dates ou de chambre, contactez la réception : {phone} · {email}. Par confidentialité, ce chat n’accède pas aux réservations.', es: 'Puedes gestionar tu reserva desde tu área de huésped (enlace en el email de confirmación). Para cambiar fechas o habitación, contacta con recepción: {phone} · {email}. Por privacidad, este chat no accede a los datos de reservas.' },
  beaches: { it: 'Ecco le spiagge e le calette più vicine: {list}. Distanze indicative dal centro del paese.', en: 'Here are the nearest beaches and coves: {list}. Distances are approximate from the town centre.', pl: 'Najbliższe plaże i zatoczki: {list}. Odległości orientacyjne od centrum.', de: 'Die nächsten Strände und Buchten: {list}. Entfernungen ungefähr ab Ortsmitte.', fr: 'Les plages et criques les plus proches : {list}. Distances indicatives depuis le centre.', es: 'Las playas y calas más cercanas: {list}. Distancias orientativas desde el centro.' },
  serviceYes: { it: 'Sì, {s} è disponibile. {note}', en: 'Yes, {s} is available. {note}', pl: 'Tak, {s} jest dostępne. {note}', de: 'Ja, {s} ist verfügbar. {note}', fr: 'Oui, {s} est disponible. {note}', es: 'Sí, {s} está disponible. {note}' },
  serviceNo: { it: 'No, {s} non è disponibile in struttura. {note}', en: 'No, {s} is not available at the hotel. {note}', pl: 'Nie, {s} nie jest dostępne. {note}', de: 'Nein, {s} ist im Hotel nicht verfügbar. {note}', fr: 'Non, {s} n’est pas disponible. {note}', es: 'No, {s} no está disponible. {note}' },
  serviceUnknown: { it: 'Non ho un’informazione confermata su {s}: per non darti indicazioni sbagliate chiedi alla reception ({phone} · {email}).', en: 'I do not have confirmed information about {s}. To avoid giving you wrong details, please ask the reception ({phone} · {email}).', pl: 'Nie mam potwierdzonej informacji o: {s}. Aby nie wprowadzić Cię w błąd, zapytaj recepcję ({phone} · {email}).', de: 'Zu {s} habe ich keine bestätigte Information. Bitte fragen Sie die Rezeption ({phone} · {email}).', fr: 'Je n’ai pas d’information confirmée sur {s}. Pour éviter toute erreur, demandez à la réception ({phone} · {email}).', es: 'No tengo información confirmada sobre {s}. Para no darte datos erróneos, pregunta a recepción ({phone} · {email}).' },
  contact: { it: 'Puoi contattare la reception al {phone} o scrivere a {email}. C’è anche il modulo nella pagina Contatti.', en: 'You can reach the reception at {phone} or write to {email}. There is also a form on the Contact page.', pl: 'Recepcja: {phone}, e-mail: {email}. Możesz też skorzystać z formularza na stronie Kontakt.', de: 'Die Rezeption erreichen Sie unter {phone} oder {email}. Auf der Kontaktseite gibt es auch ein Formular.', fr: 'Joignez la réception au {phone} ou écrivez à {email}. Un formulaire est aussi disponible sur la page Contact.', es: 'Puedes llamar a recepción al {phone} o escribir a {email}. También hay un formulario en la página de Contacto.' },
  faqLead: { it: '', en: 'Here is what I can tell you (answer provided in Italian): ', pl: 'Oto informacja (odpowiedź w języku włoskim): ', de: 'Hier die Information (Antwort auf Italienisch): ', fr: 'Voici l’information (réponse en italien) : ', es: 'Esto es lo que puedo decirte (respuesta en italiano): ' },
  fallback: { it: 'Non sono sicuro di poterti rispondere con certezza e preferisco non darti informazioni sbagliate. Contatta la reception: {phone} · {email}.', en: 'I am not sure I can answer that reliably and I would rather not give you wrong information. Please contact the reception: {phone} · {email}.', pl: 'Nie jestem pewien odpowiedzi i nie chcę wprowadzić Cię w błąd. Skontaktuj się z recepcją: {phone} · {email}.', de: 'Das kann ich nicht sicher beantworten, und ich möchte Ihnen nichts Falsches sagen. Bitte kontaktieren Sie die Rezeption: {phone} · {email}.', fr: 'Je ne suis pas certain de pouvoir répondre et je préfère ne pas vous induire en erreur. Contactez la réception : {phone} · {email}.', es: 'No estoy seguro de poder responder con certeza y prefiero no darte información errónea. Contacta con recepción: {phone} · {email}.' },
  demo: { it: ' (dati dimostrativi)', en: ' (demo data)', pl: ' (dane demonstracyjne)', de: ' (Demodaten)', fr: ' (données de démonstration)', es: ' (datos de demostración)' },
};

const LANG_NAME: Record<Locale, string> = { it: 'italiano', en: 'English (inglese)', pl: 'polski (polacco)', de: 'Deutsch (tedesco)', fr: 'français (francese)', es: 'español (spagnolo)' };
/** Repeated right before the model answers: the strongest position for a language rule. */
export const languageRule = (lang: Locale) => ({ it: 'Rispondi solo in italiano.', en: 'Answer only in English. Do not use Italian.', pl: 'Odpowiedz wyłącznie po polsku. Nie używaj włoskiego.', de: 'Antworte ausschließlich auf Deutsch. Kein Italienisch.', fr: 'Réponds uniquement en français. Pas d’italien.', es: 'Responde únicamente en español. Nada de italiano.' })[lang];
const fillT = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

function persons(text: string): number | null {
  const m = text.match(RX.persons);
  if (m) return Math.min(10, Math.max(1, Number(m[1])));
  if (RX.two.test(text)) return 2;
  return null;
}

/** Deterministic answer from the hotel knowledge base (works with no AI provider). */
export function answerKB(db: DB, message: string, lang: Locale, today: string): ChatReply {
  const n = norm(message);
  const h = db.settings.hotel;
  const c: Ctx = { db, lang, today, phone: h.phone, email: h.email };
  const t = getDictionary(lang);
  const L = (p: string) => localePath(lang, p);
  const reply = (intent: string, text: string, actions: ChatAction[] = []): ChatReply => ({ lang, intent, text, actions });
  const contactAction = { label: t.nav.contact, href: L('/contatti') };

  // services first (avoid "parcheggio disponibile?" being read as room availability)
  for (const [key, rx] of Object.entries(SERVICE_RX)) {
    if (!rx.test(n)) continue;
    let s = db.settings.services.find((x) => x.key === key);
    // pets: the house rules decide (Impostazioni → Arrivo, partenza e regole)
    if (key === 'animali') {
      const p = houseRules(db.settings).pets;
      s = { key, label: 'Animali', status: p === 'no' ? 'non_disponibile' : 'confermato', note: p === 'request' ? 'su richiesta' : '' };
    }
    const name = SERVICE_NAMES[key]![lang];
    if (s?.status === 'confermato') return reply(`service:${key}`, fillT(T.serviceYes[lang], { s: name, note: s.note }));
    if (s?.status === 'non_disponibile') return reply(`service:${key}`, fillT(T.serviceNo[lang], { s: name, note: s.note }));
    return reply(`service:${key}`, fillT(T.serviceUnknown[lang], { s: name, phone: c.phone, email: c.email }), [contactAction]);
  }

  for (const f of db.settings.faq) {
    if (f.keywords.some((k) => n.includes(norm(k)))) return reply(`faq:${f.id}`, `${T.faqLead[lang]}${f.answer}`);
  }

  if (RX.availability.test(n) || ((RX.tomorrow.test(n) || RX.today.test(n)) && /(camer|room|pok|zimmer|chambr|habitac)/.test(n))) {
    const when = RX.tomorrow.test(n) ? 'tomorrow' : RX.today.test(n) ? 'today' : null;
    if (!when) return reply('availability', T.availAsk[lang], [{ label: t.search.cta, href: L('/prenotazione') }]);
    const checkIn = when === 'tomorrow' ? addDays(today, 1) : today;
    const checkOut = addDays(checkIn, 1);
    const guests = persons(n) ?? 1;
    const free = searchAvailability(db, { checkIn, checkOut, adults: guests, children: 0 }).filter((r) => r.available);
    const vars = { when: when === 'tomorrow' ? T.tomorrow[lang] : T.tonight[lang], date: fmtDate(checkIn, lang, { weekday: 'long', day: 'numeric', month: 'long' }), n: free.length, price: free.length ? money(Math.min(...free.map((r) => r.quote.averageNight)), lang) : '' };
    const href = L(`/prenotazione?checkIn=${checkIn}&checkOut=${checkOut}&adults=${Math.max(1, guests)}`);
    return free.length ? reply('availability', fillT(T.availYes[lang], vars), [{ label: t.rooms.book, href }]) : reply('availability', fillT(T.availNo[lang], vars), [contactAction]);
  }

  if (RX.price.test(n)) {
    const g = persons(n) ?? 2;
    // the prices the guests see (online increase on the card price, when it is on)
    const rooms = db.rooms.filter((r) => isPubliclyBookable(r) && r.maxGuests >= g).map((r) => onlineRoom(r, db.settings)).sort((a, b) => a.basePrice - b.basePrice);
    if (!rooms.length) return reply('price', fillT(T.priceNone[lang], { n: g }), [contactAction]);
    const list = rooms
      .slice(0, 3)
      .map((r) => `${localizeRoom(r, lang).t.title} (${money(r.basePrice, lang)})`)
      .join(', ');
    return reply('price', fillT(T.price[lang], { n: g, price: money(rooms[0]!.basePrice, lang), list }) + (db.settings.demoMode ? T.demo[lang] : ''), [{ label: t.rooms.all, href: L('/camere') }, { label: t.search.cta, href: L(`/prenotazione?adults=${g}`) }]);
  }

  if (RX.times.test(n)) return reply('times', fillT(T.times[lang], { in: h.checkInFrom, inTo: h.checkInTo, out: h.checkOutBy }) + (db.settings.demoMode && !h.factsVerified ? T.demo[lang] : ''));

  if (RX.location.test(n)) {
    const address = h.addressVerified ? `${h.addressLine}, ${h.postalCode} ${h.city}.` : T.addrPending[lang];
    return reply('location', fillT(T.location[lang], { address }), [
      { label: t.sections.directions, href: `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}` },
      { label: t.sections.mapTitle, href: L('/#posizione') },
    ]);
  }

  if (RX.modify.test(n) && (RX.booking.test(n) || n.split(' ').length < 9)) return reply('modify', fillT(T.modify[lang], { phone: c.phone, email: c.email }), [contactAction]);

  if (RX.beach.test(n)) {
    const list = publicPlaces(db).filter((x) => x.beach)
      .map((x) => `${x.name} (${x.distance}, ${x.time[lang]})`)
      .join('; ');
    return reply('beaches', fillT(T.beaches[lang], { list }), [{ label: t.nav.experiences, href: L('/esperienze') }]);
  }

  if (RX.contact.test(n)) return reply('contact', fillT(T.contact[lang], { phone: c.phone, email: c.email }), [contactAction]);
  if (RX.thanks.test(n)) return reply('thanks', T.thanks[lang]);
  if (RX.greet.test(n)) return reply('greet', T.greet[lang]);
  return reply('fallback', fillT(T.fallback[lang], { phone: c.phone, email: c.email }), [contactAction]);
}

/** How guests pay, what the price includes, the tourist tax: public facts for the chat. */
function payInfo(db: DB): string[] {
  const p = db.settings.payments;
  const card = cardPaymentsReady(db) && p.allowOnline !== false;
  const due = p.mode === 'full' ? 'tutto il soggiorno al momento della prenotazione' : p.mode === 'deposit_percent' ? `un acconto del ${p.depositPercent}% alla prenotazione, il resto in hotel` : `un acconto di € ${p.depositFixed} alla prenotazione, il resto in hotel`;
  const tax = db.settings.pricing?.touristTax;
  const md = (x: string) => `${Number(x.slice(3))}/${Number(x.slice(0, 2))}`;
  return [
    `PAGAMENTO: ${card ? `con carta sul sito (${due})` : 'non si paga online: si paga in hotel'}${p.allowCashAtHotel ? `${card ? ', oppure ' : ', '}in contanti in hotel con un prezzo più basso (circa −${p.cashDiscountPercent}%, il sito mostra entrambi i prezzi)` : ''}. I prezzi sul sito sono quelli finali per la camera.`,
    `IL PREZZO COMPRENDE: ${db.settings.pricing?.board === 'breakfast' ? 'pernottamento e colazione' : 'solo il pernottamento (colazione non inclusa)'}.`,
    tax?.enabled ? `TASSA DI SOGGIORNO: € ${tax.amount} a persona (solo adulti) a notte dal ${md(tax.from)} al ${md(tax.to)}${tax.maxNights ? `, al massimo ${tax.maxNights} notti` : ''}; non è nel prezzo, si paga in hotel.` : 'TASSA DI SOGGIORNO: non prevista.',
  ];
}

/** Grounding for generative mode. Contains ONLY public data — never guests or bookings. */
export function buildSystemPrompt(db: DB, lang: Locale, today: string): string {
  const h = db.settings.hotel;
  const rooms = db.rooms.filter(isPubliclyBookable).map((r) => {
    const l = localizeRoom(r, 'it');
    return `- ${l.t.title}: ${r.type}, max ${ospiti(r.maxGuests)}, ${r.beds}, ${r.size ?? '?'} m², ${r.floor === 'terra' ? 'piano terra' : r.floor === 'superiore' ? 'piano superiore' : 'piano inferiore'}, da € ${onlineRoom(r, db.settings).basePrice}/notte. Dotazioni: ${r.amenities.map((a) => amenityLabel(a, 'it')).join(', ')}.`;
  });
  const nights = Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((d) => {
    const free = searchAvailability(db, { checkIn: d, checkOut: addDays(d, 1), adults: 1, children: 0 }).filter((r) => r.available);
    return `${d}: ${free.length} camere libere${free.length ? `, da € ${Math.min(...free.map((r) => r.quote.total))}` : ''}`;
  });
  const services = db.settings.services.filter((s) => s.key !== 'animali').map((s) => `- ${s.label}: ${s.status === 'confermato' ? 'SÌ' : s.status === 'non_disponibile' ? 'NO' : 'NON CONFERMATO (non affermare né negare: rimanda alla reception)'}${s.note ? ` (${s.note})` : ''}`);
  return [
    `Sei l'assistente del sito di ${h.name}, hotel ${h.stars} stelle a ${h.city} (${h.province}), Sardegna. Oggi è ${today}.`,
    `LINGUA: rispondi ESCLUSIVAMENTE in ${LANG_NAME[lang]}, dall'inizio alla fine. I dati qui sotto sono in italiano: traducili, non mescolare mai le lingue (restano invariati solo nomi propri, telefono ed email).`,
    'Stile: caldo e accogliente come una brava receptionist, frasi brevi e chiare, massimo 90 parole, niente markdown. Al massimo una emoji adatta. Se serve, chiudi con un passo utile (es. scegliere le date sul sito o scrivere alla reception).',
    'REGOLE: usa solo i dati qui sotto. Non inventare servizi, prezzi, orari o disponibilità. Se un dato manca o è "non confermato", dillo e suggerisci di contattare la reception.',
    'Non hai accesso a dati di prenotazioni o ospiti e non devi chiederli. Non chiedere dati di pagamento.',
    'Quando proponi o consigli una camera, scrivi il suo nome come nell’elenco CAMERE: il sito mostra sotto la tua risposta le foto delle camere che nomini. Proponi al massimo 3 camere, adatte al numero di ospiti.',
    `Contatti reception: ${h.phone} · ${h.email}. Indirizzo: ${h.addressVerified ? `${h.addressLine}, ${h.postalCode} ${h.city}` : 'da confermare con la reception'}.`,
    `Check-in ${h.checkInFrom}–${h.checkInTo}, check-out entro ${h.checkOutBy}${h.factsVerified ? '' : db.settings.demoMode ? ' (dati dimostrativi)' : ' (da confermare con la reception)'}.`,
    `Cancellazione: ${cancelText('it', db.settings.payments)} ${db.settings.payments.cancellationPolicy}`,
    `Regole della casa: ${rulesForPrompt(houseRules(db.settings))}.`,
    ...payInfo(db),
    'CAMERE:',
    ...rooms,
    'DISPONIBILITÀ PROSSIME NOTTI (1 notte, 1 ospite):',
    ...nights,
    'SERVIZI:',
    ...services,
    'FAQ:',
    ...db.settings.faq.map((f) => `- ${f.question} → ${f.answer}`),
    'DINTORNI (distanze indicative):',
    ...publicPlaces(db).map((x) => `- ${x.name}: ${x.kind.it}, ${x.distance}, ${x.time.it}. ${x.text.it}`),
  ].join('\n');
}
