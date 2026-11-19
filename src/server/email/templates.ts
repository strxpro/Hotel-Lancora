import type { Booking, EmailTemplate, Locale, Room, Settings } from '@/lib/types';
import { diffDays, fmtDateLong, HOTEL_TZ, intlLocale } from '@/lib/dates';
import { money } from '@/lib/utils';
import { cancelText } from '@/lib/cancellation';
import { TAX_T, taxDetail, touristTaxFor } from '@/lib/tourist-tax';
import { guestLang, isLocaleCode } from '@/lib/guest-lang';

export interface EmailContext {
  booking: Booking | null;
  room: Room | null;
  settings: Settings;
  extra?: {
    amount?: number; message?: string; promoCode?: string; reviewUrl?: string; changes?: string; lang?: string; code?: string;
    /** cancellation without fee (the hotel granted it) */
    waived?: boolean;
    /** no-show: what happened to the fee */
    outcome?: 'charged' | 'waived' | 'due';
    /** card request: deadline (ISO), whether the booking is cancelled after it, whether the bank refused the card */
    deadline?: string; cancelOnExpiry?: boolean; declined?: boolean;
    /** change of dates proposed / answered */
    checkIn?: string; checkOut?: string; total?: number; kind?: 'dates' | 'free_cancel';
    /** refund: back on the card it was paid with, given back by hand (cash, transfer), or both; and which card */
    refundVia?: 'card' | 'hand' | 'mixed'; card?: string;
  };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** language the e-mail is written in (the guest's) */
  lang: Locale;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fillIn = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/** A page of the site in the guest's language (Italian has no prefix). */
const siteUrl = (lang: Locale, path: string) => `${appUrl()}${lang === 'it' ? '' : `/${lang}`}${path}`;

type Mail = { subject: string; title: string; body: string; cta?: string };
type Copy = {
  dear: string;
  pendingAddress: string;
  demo: string;
  sum: { code: string; room: string; arrival: string; departure: string; nights: string; guests: string; total: string; paid: string; toAssign: string; from: string; by: string; adults: [string, string]; children: [string, string]; no: string };
  conferma: Mail;
  promemoria: Mail;
  modifica: Mail;
  cancellazione: Mail & { bye: string };
  rimborso: Mail & { card: string; anyCard: string; when: string; hand: string };
  ringraziamento: Mail & { google: string; link: string };
  offerta: Mail & { code: string; consent: string };
};

/**
 * Every e-mail to guests, in their language (the one they used on the site, else guessed from the
 * country). Free notes the owner writes in Pagamenti (Italian) are added only to Italian e-mails;
 * the cancellation rule itself is always written in the guest's language.
 */
const COPY: Record<Locale, Copy> = {
  it: {
    dear: 'Gentile ospite',
    pendingAddress: 'indirizzo da confermare',
    demo: 'Email dimostrativa generata dal sistema Hotel L’Ancora — nessun dato reale.',
    sum: { code: 'Codice', room: 'Camera', arrival: 'Arrivo', departure: 'Partenza', nights: 'Notti', guests: 'Ospiti', total: 'Totale', paid: 'Versato', toAssign: 'Da assegnare', from: 'dalle {t}', by: 'entro le {t}', adults: ['1 adulto', '{n} adulti'], children: ['1 bambino', '{n} bambini'], no: 'n. {n}' },
    conferma: { subject: 'Prenotazione confermata · {code}', title: 'Grazie, {name}. Ti aspettiamo.', body: 'La tua prenotazione è confermata. Qui sotto trovi il riepilogo del soggiorno: conservalo, ti servirà all’arrivo.', cta: 'Apri la tua area ospite' },
    promemoria: { subject: 'Ci vediamo presto · {code}', title: '{name}, il mare ti aspetta.', body: 'Manca poco al tuo arrivo. Il check-in è disponibile dalle {from} alle {to}. Se pensi di arrivare più tardi, scrivici: organizzeremo insieme l’accoglienza.', cta: 'Indicazioni e dettagli' },
    modifica: { subject: 'Prenotazione aggiornata · {code}', title: 'La tua prenotazione è stata aggiornata', body: 'Abbiamo aggiornato i dettagli del tuo soggiorno. Ecco il riepilogo aggiornato.', cta: 'Vedi i dettagli' },
    cancellazione: { subject: 'Cancellazione confermata · {code}', title: 'Cancellazione confermata', body: 'Ciao {name}, confermiamo l’annullamento della prenotazione {code}.', bye: 'Speriamo di accoglierti presto a Santa Teresa Gallura.' },
    rimborso: { subject: 'Rimborso effettuato · {code}', title: 'Il rimborso è in arrivo', body: 'Abbiamo disposto un rimborso di {amount} per la prenotazione {code}.', card: 'L’importo torna sulla stessa carta con cui hai pagato ({card}): non devi fare nulla.', anyCard: 'L’importo torna sulla stessa carta con cui hai pagato: non devi fare nulla.', when: 'Di solito lo vedi sull’estratto conto entro 5–10 giorni lavorativi, spesso prima: dipende dalla tua banca. Se il pagamento era di pochi giorni fa, l’addebito può anche semplicemente sparire dall’estratto conto.', hand: 'Ti restituiamo l’importo direttamente, in contanti o con bonifico, come concordato con noi.' },
    ringraziamento: { subject: 'Grazie per aver soggiornato da noi', title: 'Grazie, {name}.', body: 'È stato un piacere averti con noi. Se hai un momento, raccontaci com’è andata: il tuo parere ci aiuta a migliorare e arriva direttamente al proprietario.', google: 'Se lo desideri, puoi lasciare anche una recensione pubblica su Google: {link}.', link: 'scrivi una recensione', cta: 'Lascia il tuo parere' },
    offerta: { subject: 'Torna a trovarci in Sardegna', title: 'Il Nord Sardegna ti aspetta di nuovo', body: 'Per gli ospiti che tornano abbiamo riservato un vantaggio sulla prenotazione diretta', code: ': usa il codice {code}', consent: 'Offerta inviata solo a chi ha dato il consenso a ricevere comunicazioni promozionali.', cta: 'Scopri le camere' },
  },
  en: {
    dear: 'Dear guest',
    pendingAddress: 'address to be confirmed',
    demo: 'Demo e-mail generated by the Hotel L’Ancora system — no real data.',
    sum: { code: 'Booking code', room: 'Room', arrival: 'Arrival', departure: 'Departure', nights: 'Nights', guests: 'Guests', total: 'Total', paid: 'Paid', toAssign: 'To be assigned', from: 'from {t}', by: 'by {t}', adults: ['1 adult', '{n} adults'], children: ['1 child', '{n} children'], no: 'no. {n}' },
    conferma: { subject: 'Booking confirmed · {code}', title: 'Thank you, {name}. We look forward to welcoming you.', body: 'Your booking is confirmed. Below is a summary of your stay: keep it handy, you will need it on arrival.', cta: 'Open your guest area' },
    promemoria: { subject: 'See you soon · {code}', title: '{name}, the sea is waiting for you.', body: 'Your arrival is just around the corner. Check-in is from {from} to {to}. If you think you will arrive later, just write to us and we will arrange your welcome together.', cta: 'Directions and details' },
    modifica: { subject: 'Booking updated · {code}', title: 'Your booking has been updated', body: 'We have updated the details of your stay. Here is the new summary.', cta: 'See the details' },
    cancellazione: { subject: 'Cancellation confirmed · {code}', title: 'Cancellation confirmed', body: 'Hello {name}, we confirm that booking {code} has been cancelled.', bye: 'We hope to welcome you to Santa Teresa Gallura soon.' },
    rimborso: { subject: 'Refund issued · {code}', title: 'Your refund is on its way', body: 'We have issued a refund of {amount} for booking {code}.', card: 'The money goes back to the same card you paid with ({card}): you don’t need to do anything.', anyCard: 'The money goes back to the same card you paid with: you don’t need to do anything.', when: 'It usually shows on your statement within 5–10 working days, often sooner, depending on your bank. If you paid only a few days ago, the charge may simply disappear from your statement.', hand: 'We give the amount back to you directly, in cash or by bank transfer, as agreed with us.' },
    ringraziamento: { subject: 'Thank you for staying with us', title: 'Thank you, {name}.', body: 'It was a pleasure to have you with us. If you have a moment, tell us how it went: your opinion helps us improve and goes straight to the owner.', google: 'If you like, you can also leave a public review on Google: {link}.', link: 'write a review', cta: 'Share your opinion' },
    offerta: { subject: 'Come back and visit us in Sardinia', title: 'Northern Sardinia is waiting for you again', body: 'For returning guests we have set aside a special advantage when booking direct', code: ': use the code {code}', consent: 'This offer is only sent to guests who agreed to receive promotional messages.', cta: 'Discover the rooms' },
  },
  pl: {
    dear: 'Drogi Gościu',
    pendingAddress: 'adres do potwierdzenia',
    demo: 'Wiadomość demonstracyjna wygenerowana przez system Hotel L’Ancora — bez prawdziwych danych.',
    sum: { code: 'Kod rezerwacji', room: 'Pokój', arrival: 'Przyjazd', departure: 'Wyjazd', nights: 'Noce', guests: 'Goście', total: 'Razem', paid: 'Zapłacono', toAssign: 'Do przydzielenia', from: 'od {t}', by: 'do {t}', adults: ['1 dorosły', '{n} dorosłych'], children: ['1 dziecko', '{n} dzieci'], no: 'nr {n}' },
    conferma: { subject: 'Rezerwacja potwierdzona · {code}', title: 'Dziękujemy, {name}. Czekamy na Ciebie.', body: 'Twoja rezerwacja jest potwierdzona. Poniżej znajdziesz podsumowanie pobytu: zachowaj je, przyda się przy przyjeździe.', cta: 'Otwórz strefę gościa' },
    promemoria: { subject: 'Do zobaczenia wkrótce · {code}', title: '{name}, morze już na Ciebie czeka.', body: 'Twój przyjazd już niedługo. Zameldowanie jest możliwe od {from} do {to}. Jeśli przyjedziesz później, napisz do nas: wspólnie zorganizujemy powitanie.', cta: 'Dojazd i szczegóły' },
    modifica: { subject: 'Rezerwacja zaktualizowana · {code}', title: 'Twoja rezerwacja została zaktualizowana', body: 'Zaktualizowaliśmy szczegóły Twojego pobytu. Oto nowe podsumowanie.', cta: 'Zobacz szczegóły' },
    cancellazione: { subject: 'Anulowanie potwierdzone · {code}', title: 'Anulowanie potwierdzone', body: 'Cześć {name}, potwierdzamy anulowanie rezerwacji {code}.', bye: 'Mamy nadzieję, że wkrótce powitamy Cię w Santa Teresa Gallura.' },
    rimborso: { subject: 'Zwrot zlecony · {code}', title: 'Zwrot jest w drodze', body: 'Zleciliśmy zwrot w kwocie {amount} za rezerwację {code}.', card: 'Pieniądze wracają na tę samą kartę, którą opłacono rezerwację ({card}) — nie trzeba nic robić.', anyCard: 'Pieniądze wracają na tę samą kartę, którą opłacono rezerwację — nie trzeba nic robić.', when: 'Zwykle widać je na wyciągu w ciągu 5–10 dni roboczych, często szybciej — zależy to od banku. Jeśli płatność była sprzed kilku dni, obciążenie może po prostu zniknąć z wyciągu.', hand: 'Kwotę zwrócimy bezpośrednio, gotówką lub przelewem, tak jak ustaliliśmy.' },
    ringraziamento: { subject: 'Dziękujemy za pobyt u nas', title: 'Dziękujemy, {name}.', body: 'Gościć Cię u nas było prawdziwą przyjemnością. Jeśli masz chwilę, opowiedz nam, jak było: Twoja opinia pomaga nam być lepszymi i trafia bezpośrednio do właściciela.', google: 'Jeśli chcesz, możesz też zostawić publiczną opinię w Google: {link}.', link: 'napisz opinię', cta: 'Podziel się opinią' },
    offerta: { subject: 'Wróć do nas na Sardynię', title: 'Północna Sardynia znów na Ciebie czeka', body: 'Dla powracających gości przygotowaliśmy korzyść przy rezerwacji bezpośredniej', code: ': użyj kodu {code}', consent: 'Ofertę wysyłamy tylko osobom, które zgodziły się na otrzymywanie wiadomości promocyjnych.', cta: 'Zobacz pokoje' },
  },
  de: {
    dear: 'Lieber Gast',
    pendingAddress: 'Adresse wird noch bestätigt',
    demo: 'Demo-E-Mail des Systems Hotel L’Ancora — keine echten Daten.',
    sum: { code: 'Buchungscode', room: 'Zimmer', arrival: 'Anreise', departure: 'Abreise', nights: 'Nächte', guests: 'Gäste', total: 'Gesamt', paid: 'Bezahlt', toAssign: 'wird zugewiesen', from: 'ab {t} Uhr', by: 'bis {t} Uhr', adults: ['1 Erwachsener', '{n} Erwachsene'], children: ['1 Kind', '{n} Kinder'], no: 'Nr. {n}' },
    conferma: { subject: 'Buchung bestätigt · {code}', title: 'Danke, {name}. Wir freuen uns auf Sie.', body: 'Ihre Buchung ist bestätigt. Unten finden Sie die Übersicht Ihres Aufenthalts: Bewahren Sie sie bitte auf, Sie brauchen sie bei der Ankunft.', cta: 'Gästebereich öffnen' },
    promemoria: { subject: 'Bis bald · {code}', title: '{name}, das Meer wartet auf Sie.', body: 'Ihre Anreise steht kurz bevor. Der Check-in ist von {from} bis {to} Uhr möglich. Wenn Sie später ankommen, schreiben Sie uns einfach: Wir organisieren Ihren Empfang gemeinsam.', cta: 'Anfahrt und Details' },
    modifica: { subject: 'Buchung aktualisiert · {code}', title: 'Ihre Buchung wurde aktualisiert', body: 'Wir haben die Details Ihres Aufenthalts aktualisiert. Hier ist die neue Übersicht.', cta: 'Details ansehen' },
    cancellazione: { subject: 'Stornierung bestätigt · {code}', title: 'Stornierung bestätigt', body: 'Hallo {name}, wir bestätigen die Stornierung der Buchung {code}.', bye: 'Wir hoffen, Sie bald in Santa Teresa Gallura begrüßen zu dürfen.' },
    rimborso: { subject: 'Erstattung veranlasst · {code}', title: 'Ihre Erstattung ist unterwegs', body: 'Wir haben eine Erstattung von {amount} für die Buchung {code} veranlasst.', card: 'Das Geld geht auf dieselbe Karte zurück, mit der Sie bezahlt haben ({card}) – Sie müssen nichts tun.', anyCard: 'Das Geld geht auf dieselbe Karte zurück, mit der Sie bezahlt haben – Sie müssen nichts tun.', when: 'Meist erscheint es innerhalb von 5–10 Werktagen auf Ihrem Kontoauszug, oft schneller – je nach Bank. Liegt die Zahlung erst wenige Tage zurück, kann die Belastung auch einfach verschwinden.', hand: 'Den Betrag erstatten wir Ihnen direkt, bar oder per Überweisung, wie mit uns vereinbart.' },
    ringraziamento: { subject: 'Danke für Ihren Aufenthalt bei uns', title: 'Danke, {name}.', body: 'Es war uns eine Freude, Sie bei uns zu haben. Wenn Sie einen Moment Zeit haben, erzählen Sie uns, wie es war: Ihre Meinung hilft uns, besser zu werden, und geht direkt an den Inhaber.', google: 'Wenn Sie möchten, können Sie auch eine öffentliche Bewertung auf Google hinterlassen: {link}.', link: 'Bewertung schreiben', cta: 'Ihre Meinung teilen' },
    offerta: { subject: 'Besuchen Sie uns wieder auf Sardinien', title: 'Der Norden Sardiniens wartet wieder auf Sie', body: 'Für wiederkehrende Gäste haben wir einen Vorteil bei der Direktbuchung reserviert', code: ': nutzen Sie den Code {code}', consent: 'Dieses Angebot erhalten nur Gäste, die Werbenachrichten zugestimmt haben.', cta: 'Zimmer entdecken' },
  },
  fr: {
    dear: 'Cher client',
    pendingAddress: 'adresse à confirmer',
    demo: 'E-mail de démonstration généré par le système Hotel L’Ancora — aucune donnée réelle.',
    sum: { code: 'Code de réservation', room: 'Chambre', arrival: 'Arrivée', departure: 'Départ', nights: 'Nuits', guests: 'Personnes', total: 'Total', paid: 'Payé', toAssign: 'À attribuer', from: 'à partir de {t}', by: 'avant {t}', adults: ['1 adulte', '{n} adultes'], children: ['1 enfant', '{n} enfants'], no: 'n° {n}' },
    conferma: { subject: 'Réservation confirmée · {code}', title: 'Merci, {name}. Nous avons hâte de vous accueillir.', body: 'Votre réservation est confirmée. Vous trouverez ci-dessous le récapitulatif de votre séjour : conservez-le, il vous servira à l’arrivée.', cta: 'Ouvrir votre espace client' },
    promemoria: { subject: 'À très bientôt · {code}', title: '{name}, la mer vous attend.', body: 'Votre arrivée approche. L’enregistrement est possible de {from} à {to}. Si vous pensez arriver plus tard, écrivez-nous : nous organiserons ensemble votre accueil.', cta: 'Itinéraire et détails' },
    modifica: { subject: 'Réservation mise à jour · {code}', title: 'Votre réservation a été mise à jour', body: 'Nous avons mis à jour les détails de votre séjour. Voici le nouveau récapitulatif.', cta: 'Voir les détails' },
    cancellazione: { subject: 'Annulation confirmée · {code}', title: 'Annulation confirmée', body: 'Bonjour {name}, nous confirmons l’annulation de la réservation {code}.', bye: 'Nous espérons vous accueillir bientôt à Santa Teresa Gallura.' },
    rimborso: { subject: 'Remboursement effectué · {code}', title: 'Votre remboursement est en route', body: 'Nous avons effectué un remboursement de {amount} pour la réservation {code}.', card: 'L’argent revient sur la carte utilisée pour le paiement ({card}) : vous n’avez rien à faire.', anyCard: 'L’argent revient sur la carte utilisée pour le paiement : vous n’avez rien à faire.', when: 'Il apparaît en général sur votre relevé sous 5 à 10 jours ouvrés, souvent plus tôt, selon votre banque. Si vous avez payé il y a quelques jours seulement, le débit peut tout simplement disparaître du relevé.', hand: 'Nous vous rendons le montant directement, en espèces ou par virement, comme convenu.' },
    ringraziamento: { subject: 'Merci d’avoir séjourné chez nous', title: 'Merci, {name}.', body: 'Ce fut un plaisir de vous accueillir. Si vous avez un moment, racontez-nous comment s’est passé votre séjour : votre avis nous aide à nous améliorer et arrive directement au propriétaire.', google: 'Si vous le souhaitez, vous pouvez aussi laisser un avis public sur Google : {link}.', link: 'écrire un avis', cta: 'Donner votre avis' },
    offerta: { subject: 'Revenez nous voir en Sardaigne', title: 'Le nord de la Sardaigne vous attend à nouveau', body: 'Pour les clients qui reviennent, nous avons réservé un avantage sur la réservation directe', code: ' : utilisez le code {code}', consent: 'Offre envoyée uniquement aux personnes ayant accepté de recevoir des communications promotionnelles.', cta: 'Découvrir les chambres' },
  },
  es: {
    dear: 'Estimado huésped',
    pendingAddress: 'dirección por confirmar',
    demo: 'Correo de demostración generado por el sistema Hotel L’Ancora — sin datos reales.',
    sum: { code: 'Código de reserva', room: 'Habitación', arrival: 'Llegada', departure: 'Salida', nights: 'Noches', guests: 'Huéspedes', total: 'Total', paid: 'Pagado', toAssign: 'Por asignar', from: 'desde las {t}', by: 'antes de las {t}', adults: ['1 adulto', '{n} adultos'], children: ['1 niño', '{n} niños'], no: 'n.º {n}' },
    conferma: { subject: 'Reserva confirmada · {code}', title: 'Gracias, {name}. Te esperamos.', body: 'Tu reserva está confirmada. Aquí abajo tienes el resumen de tu estancia: guárdalo, lo necesitarás a la llegada.', cta: 'Abrir tu área de huésped' },
    promemoria: { subject: 'Nos vemos pronto · {code}', title: '{name}, el mar te espera.', body: 'Falta poco para tu llegada. El check-in es de {from} a {to}. Si crees que llegarás más tarde, escríbenos y organizaremos juntos tu bienvenida.', cta: 'Cómo llegar y detalles' },
    modifica: { subject: 'Reserva actualizada · {code}', title: 'Tu reserva ha sido actualizada', body: 'Hemos actualizado los detalles de tu estancia. Aquí tienes el nuevo resumen.', cta: 'Ver los detalles' },
    cancellazione: { subject: 'Cancelación confirmada · {code}', title: 'Cancelación confirmada', body: 'Hola {name}, confirmamos la cancelación de la reserva {code}.', bye: 'Esperamos recibirte pronto en Santa Teresa Gallura.' },
    rimborso: { subject: 'Reembolso realizado · {code}', title: 'Tu reembolso está en camino', body: 'Hemos realizado un reembolso de {amount} por la reserva {code}.', card: 'El dinero vuelve a la misma tarjeta con la que pagaste ({card}): no tienes que hacer nada.', anyCard: 'El dinero vuelve a la misma tarjeta con la que pagaste: no tienes que hacer nada.', when: 'Normalmente aparece en tu extracto en 5–10 días laborables, a menudo antes, según tu banco. Si pagaste hace solo unos días, el cargo puede simplemente desaparecer del extracto.', hand: 'Te devolvemos el importe directamente, en efectivo o por transferencia, como acordamos.' },
    ringraziamento: { subject: 'Gracias por alojarte con nosotros', title: 'Gracias, {name}.', body: 'Ha sido un placer tenerte con nosotros. Si tienes un momento, cuéntanos qué tal fue: tu opinión nos ayuda a mejorar y llega directamente al propietario.', google: 'Si quieres, también puedes dejar una reseña pública en Google: {link}.', link: 'escribir una reseña', cta: 'Danos tu opinión' },
    offerta: { subject: 'Vuelve a visitarnos en Cerdeña', title: 'El norte de Cerdeña te espera de nuevo', body: 'Para los huéspedes que vuelven hemos reservado una ventaja en la reserva directa', code: ': usa el código {code}', consent: 'Oferta enviada solo a quienes aceptaron recibir comunicaciones promocionales.', cta: 'Descubrir las habitaciones' },
  },
};

function layout(settings: Settings, lang: Locale, preheader: string, title: string, body: string, cta?: { label: string; href: string }): string {
  const h = settings.hotel;
  const c = COPY[lang];
  const address = h.addressVerified ? `${h.addressLine}, ${h.postalCode} ${h.city} (${h.province})` : `${h.city} (${h.province}) · ${c.pendingAddress}`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#EFE9DD;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#EFE9DD;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#F8F5EE;">
<tr><td style="background:#10283D;padding:36px 40px 30px;text-align:center;">
  <div style="font-family:Georgia,'Times New Roman',serif;color:#F8F5EE;font-size:13px;letter-spacing:6px;">HOTEL</div>
  <div style="font-family:Georgia,'Times New Roman',serif;color:#F8F5EE;font-size:30px;letter-spacing:4px;margin-top:4px;">L’ANCORA</div>
  <div style="color:#B69562;font-size:11px;letter-spacing:3px;margin-top:10px;font-family:Arial,sans-serif;">★ ★ ★ &nbsp; SANTA TERESA GALLURA</div>
</td></tr>
<tr><td style="padding:44px 40px 12px;font-family:Arial,Helvetica,sans-serif;color:#242B2D;">
  <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.25;color:#10283D;margin:0 0 18px;">${esc(title)}</h1>
  ${body}
  ${cta ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:30px 0 8px;"><tr><td style="background:#10283D;border-radius:999px;"><a href="${cta.href}" style="display:inline-block;padding:15px 28px;color:#F8F5EE;text-decoration:none;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">${esc(cta.label)}</a></td></tr></table>` : ''}
</td></tr>
<tr><td style="padding:28px 40px 36px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#6B7376;border-top:1px solid #E7D9C1;">
  ${esc(h.name)} · ${esc(address)}<br>${esc(h.phone)} · ${esc(h.email)}${settings.demoMode ? `<br>
  <span style="color:#B69562;">${esc(c.demo)}</span>` : ''}
</td></tr>
</table></td></tr></table></body></html>`;
}

function p(text: string): string {
  return `<p style="font-size:15px;line-height:1.7;margin:0 0 14px;color:#242B2D;">${text}</p>`;
}

/** The room's name as the guest sees it on the site, in their language. */
function roomTitle(room: Room, lang: Locale): string {
  const tr = lang === 'it' ? null : room.translations[lang]?.published?.title;
  return tr || room.text.title || room.name;
}

function summary(b: Booking, room: Room | null, settings: Settings, lang: Locale): string {
  const s = COPY[lang].sum;
  const nights = diffDays(b.checkIn, b.checkOut);
  const count = (n: number, [one, many]: [string, string]) => (n === 1 ? one : many.replace('{n}', String(n)));
  const rows: [string, string][] = [
    [s.code, b.code],
    [s.room, room ? roomTitle(room, lang) : s.toAssign],
    [s.arrival, `${fmtDateLong(b.checkIn, lang)} · ${s.from.replace('{t}', settings.hotel.checkInFrom)}`],
    [s.departure, `${fmtDateLong(b.checkOut, lang)} · ${s.by.replace('{t}', settings.hotel.checkOutBy)}`],
    [s.nights, String(nights)],
    [s.guests, `${count(b.adults, s.adults)}${b.children ? ` · ${count(b.children, s.children)}` : ''}`],
    [s.total, money(b.total, lang, 2)],
    [s.paid, money(b.amountPaid, lang, 2)],
  ];
  const tax = b.status === 'cancelled' ? null : touristTaxFor(settings.pricing?.touristTax, b.checkIn, b.checkOut, b.adults);
  if (tax) rows.push([TAX_T[lang].label, `${money(tax.total, lang, 2)} · ${TAX_T[lang].note} (${taxDetail(lang, tax, (n) => money(n, lang, 2))})`]);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 6px;border-top:1px solid #E7D9C1;">${rows
    .map(([k, v]) => `<tr><td style="padding:11px 0;border-bottom:1px solid #E7D9C1;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#8A8F90;width:38%;">${esc(k)}</td><td style="padding:11px 0;border-bottom:1px solid #E7D9C1;font-size:15px;color:#10283D;">${esc(v)}</td></tr>`)
    .join('')}</table>`;
}

/** "Rate your room" email, in the guest's language. */
const REVIEW_ASK = {
  it: { subject: 'Com’era la camera {room}?', title: 'Grazie, {name}!', body: 'Speriamo che il soggiorno ti sia piaciuto. Ti va di dare un voto alla camera {room}? Bastano 30 secondi e aiuti i prossimi ospiti a scegliere.', photos: 'Puoi aggiungere fino a 3 foto. La recensione viene tradotta in automatico nelle altre lingue del sito.', cta: 'Lascia il tuo voto', yourRoom: 'la tua camera' },
  en: { subject: 'How was room {room}?', title: 'Thank you, {name}!', body: 'We hope you enjoyed your stay. Would you rate room {room}? It takes 30 seconds and helps the next guests choose.', photos: 'You can add up to 3 photos. Your review is translated automatically into the other languages of the site.', cta: 'Rate your room', yourRoom: 'your room' },
  pl: { subject: 'Jak oceniasz pokój {room}?', title: 'Dziękujemy, {name}!', body: 'Mamy nadzieję, że pobyt był udany. Czy ocenisz pokój {room}? To zajmie 30 sekund i pomoże kolejnym gościom wybrać.', photos: 'Możesz dodać do 3 zdjęć. Opinia zostanie automatycznie przetłumaczona na inne języki strony.', cta: 'Oceń pokój', yourRoom: 'Twój pokój' },
  de: { subject: 'Wie war Zimmer {room}?', title: 'Danke, {name}!', body: 'Wir hoffen, Ihr Aufenthalt hat Ihnen gefallen. Möchten Sie Zimmer {room} bewerten? Es dauert 30 Sekunden und hilft den nächsten Gästen bei der Wahl.', photos: 'Sie können bis zu 3 Fotos hinzufügen. Die Bewertung wird automatisch in die anderen Sprachen der Website übersetzt.', cta: 'Zimmer bewerten', yourRoom: 'Ihr Zimmer' },
  fr: { subject: 'Comment était la chambre {room} ?', title: 'Merci, {name} !', body: 'Nous espérons que votre séjour vous a plu. Voulez-vous noter la chambre {room} ? Cela prend 30 secondes et aide les prochains voyageurs à choisir.', photos: 'Vous pouvez ajouter jusqu’à 3 photos. Votre avis est traduit automatiquement dans les autres langues du site.', cta: 'Noter la chambre', yourRoom: 'votre chambre' },
  es: { subject: '¿Qué tal la habitación {room}?', title: '¡Gracias, {name}!', body: 'Esperamos que hayas disfrutado de tu estancia. ¿Valoras la habitación {room}? Son 30 segundos y ayudas a los próximos huéspedes a elegir.', photos: 'Puedes añadir hasta 3 fotos. Tu reseña se traduce automáticamente a los otros idiomas del sitio.', cta: 'Valorar la habitación', yourRoom: 'tu habitación' },
} as const;

/** Sign-in code for the guest area, in the language of the page the guest used. */
const ACCESS_CODE = {
  it: { subject: '{code} è il tuo codice per l’area ospite', title: 'Il tuo codice di accesso', hello: 'Ciao {name},', body: 'ecco il codice per entrare nella tua area ospite e vedere le tue prenotazioni:', valid: 'Il codice vale 10 minuti e si può usare una sola volta.', ignore: 'Se non l’hai chiesto tu, ignora questa email: senza il codice nessuno può entrare.', cta: 'Apri l’area ospite' },
  en: { subject: '{code} is your guest area code', title: 'Your sign-in code', hello: 'Hello {name},', body: 'here is the code to open your guest area and see your bookings:', valid: 'The code is valid for 10 minutes and can be used once.', ignore: 'If you did not ask for it, just ignore this e-mail: nobody can sign in without the code.', cta: 'Open the guest area' },
  pl: { subject: '{code} to Twój kod do strefy gościa', title: 'Twój kod logowania', hello: 'Cześć {name},', body: 'oto kod, którym otworzysz strefę gościa i zobaczysz swoje rezerwacje:', valid: 'Kod jest ważny 10 minut i działa tylko raz.', ignore: 'Jeśli to nie Ty prosiłeś o kod, zignoruj tę wiadomość — bez kodu nikt się nie zaloguje.', cta: 'Otwórz strefę gościa' },
  de: { subject: '{code} ist Ihr Code für den Gästebereich', title: 'Ihr Anmeldecode', hello: 'Hallo {name},', body: 'hier ist der Code für Ihren Gästebereich mit Ihren Buchungen:', valid: 'Der Code ist 10 Minuten gültig und kann einmal verwendet werden.', ignore: 'Wenn Sie ihn nicht angefordert haben, ignorieren Sie diese E-Mail: Ohne den Code kann sich niemand anmelden.', cta: 'Gästebereich öffnen' },
  fr: { subject: '{code} est votre code pour l’espace client', title: 'Votre code de connexion', hello: 'Bonjour {name},', body: 'voici le code pour ouvrir votre espace client et voir vos réservations :', valid: 'Le code est valable 10 minutes et ne peut servir qu’une fois.', ignore: 'Si vous ne l’avez pas demandé, ignorez cet e-mail : personne ne peut se connecter sans le code.', cta: 'Ouvrir l’espace client' },
  es: { subject: '{code} es tu código para el área de huésped', title: 'Tu código de acceso', hello: 'Hola {name}:', body: 'este es el código para entrar en tu área de huésped y ver tus reservas:', valid: 'El código vale 10 minutos y solo se puede usar una vez.', ignore: 'Si no lo has pedido tú, ignora este correo: nadie puede entrar sin el código.', cta: 'Abrir el área de huésped' },
} as const;

/** E-mails of the booking page (messages, no-show, card, change of dates), in the guest's language. */
const CARE = {
  it: {
    msg: { subject: 'Nuovo messaggio dall’hotel · {code}', title: 'Un messaggio per te', intro: 'Ciao {name}, ti abbiamo scritto riguardo alla prenotazione {code}:', reply: 'Puoi rispondere dalla tua area ospite: il messaggio arriva direttamente a noi.', cta: 'Leggi e rispondi' },
    noShow: { subject: 'Mancato arrivo · {code}', title: 'Non ti abbiamo visto arrivare', intro: 'Ciao {name}, non risulta il tuo arrivo per la prenotazione {code} del {date}. La prenotazione è stata chiusa.', charged: 'Come previsto dalle condizioni di cancellazione, la penale per il mancato arrivo è di {amount}, addebitata sulla tua carta.', waived: 'Abbiamo deciso di non applicare nessuna penale: quanto hai pagato ti viene restituito.', waivedNothing: 'Abbiamo deciso di non applicare nessuna penale.', due: 'La penale per il mancato arrivo è di {amount}, ma il pagamento sulla tua carta non è andato a buon fine: aggiorna la carta dalla tua area ospite.', error: 'Se pensi che sia un errore, rispondi a questa email o scrivici dalla tua area ospite.', cta: 'Apri la tua area ospite' },
    card: { subject: 'Aggiorna la carta entro {deadline} · {code}', title: 'Ci serve una carta valida', declined: 'Ciao {name}, il pagamento sulla carta collegata alla prenotazione {code} non è andato a buon fine.', plain: 'Ciao {name}, per la prenotazione {code} ci serve una carta di credito valida.', ask: 'Inserisci una nuova carta entro {deadline}.', pay: 'Con la nuova carta verranno addebitati {amount}.', cancel: 'Se entro questo termine non riceviamo una carta valida, la prenotazione sarà cancellata.', safe: 'La carta si inserisce sulla pagina di pagamento sicura: l’hotel non vede mai il numero.', cta: 'Aggiorna la carta' },
    propose: { subject: 'Proposta di nuove date · {code}', title: 'Ti proponiamo nuove date', intro: 'Ciao {name}, ti proponiamo di spostare il soggiorno della prenotazione {code}:', dates: 'Nuove date: dal {from} al {to} · totale {total}.', answer: 'Puoi accettare o rifiutare dalla tua area ospite: finché non rispondi la prenotazione resta com’è.', cta: 'Rispondi alla proposta' },
    refused: { subject: 'La tua richiesta · {code}', title: 'Non possiamo accettare la richiesta', dates: 'Ciao {name}, purtroppo non possiamo spostare la prenotazione {code} alle date che ci hai chiesto.', cancel: 'Ciao {name}, purtroppo non possiamo cancellare gratuitamente la prenotazione {code}.', same: 'La prenotazione resta valida come prima.', cta: 'Apri la tua area ospite' },
    waived: 'Nessuna penale: la cancellazione è gratuita.',
  },
  en: {
    msg: { subject: 'New message from the hotel · {code}', title: 'A message for you', intro: 'Hello {name}, we wrote to you about booking {code}:', reply: 'You can reply from your guest area: the message comes straight to us.', cta: 'Read and reply' },
    noShow: { subject: 'No-show · {code}', title: 'We did not see you arrive', intro: 'Hello {name}, we did not record your arrival for booking {code} on {date}. The booking has been closed.', charged: 'As stated in the cancellation terms, the no-show fee is {amount}, charged to your card.', waived: 'We decided not to apply any fee: what you paid is being refunded.', waivedNothing: 'We decided not to apply any fee.', due: 'The no-show fee is {amount}, but the payment on your card did not go through: please update your card from your guest area.', error: 'If you think this is a mistake, reply to this e-mail or write to us from your guest area.', cta: 'Open your guest area' },
    card: { subject: 'Please update your card by {deadline} · {code}', title: 'We need a valid card', declined: 'Hello {name}, the payment on the card linked to booking {code} did not go through.', plain: 'Hello {name}, for booking {code} we need a valid credit card.', ask: 'Please add a new card by {deadline}.', pay: '{amount} will be charged to the new card.', cancel: 'If we do not receive a valid card by then, the booking will be cancelled.', safe: 'You type the card on the secure payment page: the hotel never sees the number.', cta: 'Update your card' },
    propose: { subject: 'New dates proposed · {code}', title: 'We propose new dates', intro: 'Hello {name}, we would like to move the stay of booking {code}:', dates: 'New dates: from {from} to {to} · total {total}.', answer: 'You can accept or decline from your guest area: until you answer, the booking stays as it is.', cta: 'Answer the proposal' },
    refused: { subject: 'Your request · {code}', title: 'We cannot accept the request', dates: 'Hello {name}, unfortunately we cannot move booking {code} to the dates you asked for.', cancel: 'Hello {name}, unfortunately we cannot cancel booking {code} free of charge.', same: 'The booking stays valid as before.', cta: 'Open your guest area' },
    waived: 'No fee: the cancellation is free of charge.',
  },
  pl: {
    msg: { subject: 'Nowa wiadomość od hotelu · {code}', title: 'Wiadomość dla Ciebie', intro: 'Cześć {name}, napisaliśmy w sprawie rezerwacji {code}:', reply: 'Możesz odpowiedzieć w strefie gościa: wiadomość trafi prosto do nas.', cta: 'Przeczytaj i odpowiedz' },
    noShow: { subject: 'Nieprzybycie · {code}', title: 'Nie dotarłeś do nas', intro: 'Cześć {name}, nie odnotowaliśmy Twojego przyjazdu w ramach rezerwacji {code} z dnia {date}. Rezerwacja została zamknięta.', charged: 'Zgodnie z warunkami anulowania opłata za nieprzybycie wynosi {amount} i została pobrana z Twojej karty.', waived: 'Postanowiliśmy nie naliczać żadnej opłaty: zwracamy to, co zapłaciłeś.', waivedNothing: 'Postanowiliśmy nie naliczać żadnej opłaty.', due: 'Opłata za nieprzybycie wynosi {amount}, ale płatność kartą się nie powiodła: zaktualizuj kartę w strefie gościa.', error: 'Jeśli to pomyłka, odpowiedz na tę wiadomość albo napisz do nas ze strefy gościa.', cta: 'Otwórz strefę gościa' },
    card: { subject: 'Zaktualizuj kartę do {deadline} · {code}', title: 'Potrzebujemy ważnej karty', declined: 'Cześć {name}, płatność kartą powiązaną z rezerwacją {code} się nie powiodła.', plain: 'Cześć {name}, do rezerwacji {code} potrzebujemy ważnej karty kredytowej.', ask: 'Dodaj nową kartę do {deadline}.', pay: 'Z nowej karty zostanie pobrane {amount}.', cancel: 'Jeśli do tego czasu nie otrzymamy ważnej karty, rezerwacja zostanie anulowana.', safe: 'Kartę wpisujesz na bezpiecznej stronie płatności: hotel nigdy nie widzi jej numeru.', cta: 'Zaktualizuj kartę' },
    propose: { subject: 'Propozycja nowych dat · {code}', title: 'Proponujemy nowe daty', intro: 'Cześć {name}, proponujemy przesunięcie pobytu z rezerwacji {code}:', dates: 'Nowe daty: od {from} do {to} · razem {total}.', answer: 'Możesz zaakceptować albo odrzucić w strefie gościa: dopóki nie odpowiesz, rezerwacja zostaje bez zmian.', cta: 'Odpowiedz na propozycję' },
    refused: { subject: 'Twoja prośba · {code}', title: 'Nie możemy przyjąć prośby', dates: 'Cześć {name}, niestety nie możemy przenieść rezerwacji {code} na wskazane daty.', cancel: 'Cześć {name}, niestety nie możemy bezpłatnie anulować rezerwacji {code}.', same: 'Rezerwacja pozostaje ważna jak dotąd.', cta: 'Otwórz strefę gościa' },
    waived: 'Bez opłat: anulowanie jest bezpłatne.',
  },
  de: {
    msg: { subject: 'Neue Nachricht vom Hotel · {code}', title: 'Eine Nachricht für Sie', intro: 'Hallo {name}, wir haben Ihnen zur Buchung {code} geschrieben:', reply: 'Sie können in Ihrem Gästebereich antworten: Die Nachricht kommt direkt zu uns.', cta: 'Lesen und antworten' },
    noShow: { subject: 'Nichterscheinen · {code}', title: 'Sie sind nicht angereist', intro: 'Hallo {name}, wir haben Ihre Anreise für die Buchung {code} am {date} nicht verzeichnet. Die Buchung wurde geschlossen.', charged: 'Gemäß den Stornobedingungen beträgt die Gebühr für das Nichterscheinen {amount}, die Ihrer Karte belastet wurde.', waived: 'Wir haben entschieden, keine Gebühr zu berechnen: Ihre Zahlung wird erstattet.', waivedNothing: 'Wir haben entschieden, keine Gebühr zu berechnen.', due: 'Die Gebühr für das Nichterscheinen beträgt {amount}, aber die Zahlung mit Ihrer Karte ist fehlgeschlagen: Bitte aktualisieren Sie Ihre Karte im Gästebereich.', error: 'Wenn Sie glauben, dass es sich um einen Irrtum handelt, antworten Sie auf diese E-Mail oder schreiben Sie uns aus dem Gästebereich.', cta: 'Gästebereich öffnen' },
    card: { subject: 'Bitte Karte bis {deadline} aktualisieren · {code}', title: 'Wir brauchen eine gültige Karte', declined: 'Hallo {name}, die Zahlung mit der Karte der Buchung {code} ist fehlgeschlagen.', plain: 'Hallo {name}, für die Buchung {code} brauchen wir eine gültige Kreditkarte.', ask: 'Bitte hinterlegen Sie bis {deadline} eine neue Karte.', pay: 'Der neuen Karte werden {amount} belastet.', cancel: 'Wenn wir bis dahin keine gültige Karte erhalten, wird die Buchung storniert.', safe: 'Sie geben die Karte auf der sicheren Zahlungsseite ein: Das Hotel sieht die Nummer nie.', cta: 'Karte aktualisieren' },
    propose: { subject: 'Neue Daten vorgeschlagen · {code}', title: 'Wir schlagen neue Daten vor', intro: 'Hallo {name}, wir möchten den Aufenthalt der Buchung {code} verschieben:', dates: 'Neue Daten: vom {from} bis {to} · gesamt {total}.', answer: 'Sie können im Gästebereich annehmen oder ablehnen: Bis zu Ihrer Antwort bleibt die Buchung unverändert.', cta: 'Auf den Vorschlag antworten' },
    refused: { subject: 'Ihre Anfrage · {code}', title: 'Wir können die Anfrage nicht annehmen', dates: 'Hallo {name}, leider können wir die Buchung {code} nicht auf die gewünschten Daten verschieben.', cancel: 'Hallo {name}, leider können wir die Buchung {code} nicht kostenlos stornieren.', same: 'Die Buchung bleibt wie bisher gültig.', cta: 'Gästebereich öffnen' },
    waived: 'Keine Gebühr: Die Stornierung ist kostenlos.',
  },
  fr: {
    msg: { subject: 'Nouveau message de l’hôtel · {code}', title: 'Un message pour vous', intro: 'Bonjour {name}, nous vous avons écrit au sujet de la réservation {code} :', reply: 'Vous pouvez répondre depuis votre espace client : le message nous arrive directement.', cta: 'Lire et répondre' },
    noShow: { subject: 'Non-présentation · {code}', title: 'Nous ne vous avons pas vu arriver', intro: 'Bonjour {name}, votre arrivée pour la réservation {code} du {date} n’a pas été enregistrée. La réservation a été clôturée.', charged: 'Comme prévu par les conditions d’annulation, les frais de non-présentation s’élèvent à {amount}, débités sur votre carte.', waived: 'Nous avons décidé de ne pas appliquer de frais : ce que vous avez payé vous est remboursé.', waivedNothing: 'Nous avons décidé de ne pas appliquer de frais.', due: 'Les frais de non-présentation s’élèvent à {amount}, mais le paiement sur votre carte n’a pas abouti : mettez à jour votre carte depuis votre espace client.', error: 'Si vous pensez qu’il s’agit d’une erreur, répondez à cet e-mail ou écrivez-nous depuis votre espace client.', cta: 'Ouvrir votre espace client' },
    card: { subject: 'Mettez à jour votre carte avant le {deadline} · {code}', title: 'Il nous faut une carte valide', declined: 'Bonjour {name}, le paiement sur la carte liée à la réservation {code} n’a pas abouti.', plain: 'Bonjour {name}, pour la réservation {code} il nous faut une carte de crédit valide.', ask: 'Ajoutez une nouvelle carte avant le {deadline}.', pay: '{amount} seront débités sur la nouvelle carte.', cancel: 'Sans carte valide d’ici là, la réservation sera annulée.', safe: 'Vous saisissez la carte sur la page de paiement sécurisée : l’hôtel ne voit jamais le numéro.', cta: 'Mettre à jour la carte' },
    propose: { subject: 'Nouvelles dates proposées · {code}', title: 'Nous vous proposons de nouvelles dates', intro: 'Bonjour {name}, nous vous proposons de déplacer le séjour de la réservation {code} :', dates: 'Nouvelles dates : du {from} au {to} · total {total}.', answer: 'Vous pouvez accepter ou refuser depuis votre espace client : tant que vous ne répondez pas, la réservation reste inchangée.', cta: 'Répondre à la proposition' },
    refused: { subject: 'Votre demande · {code}', title: 'Nous ne pouvons pas accepter la demande', dates: 'Bonjour {name}, nous ne pouvons malheureusement pas déplacer la réservation {code} aux dates demandées.', cancel: 'Bonjour {name}, nous ne pouvons malheureusement pas annuler gratuitement la réservation {code}.', same: 'La réservation reste valable comme avant.', cta: 'Ouvrir votre espace client' },
    waived: 'Aucuns frais : l’annulation est gratuite.',
  },
  es: {
    msg: { subject: 'Nuevo mensaje del hotel · {code}', title: 'Un mensaje para ti', intro: 'Hola {name}, te hemos escrito sobre la reserva {code}:', reply: 'Puedes responder desde tu área de huésped: el mensaje nos llega directamente.', cta: 'Leer y responder' },
    noShow: { subject: 'No presentado · {code}', title: 'No te hemos visto llegar', intro: 'Hola {name}, no consta tu llegada para la reserva {code} del {date}. La reserva se ha cerrado.', charged: 'Según las condiciones de cancelación, la penalización por no presentarse es de {amount}, cargada en tu tarjeta.', waived: 'Hemos decidido no aplicar ninguna penalización: te devolvemos lo que pagaste.', waivedNothing: 'Hemos decidido no aplicar ninguna penalización.', due: 'La penalización por no presentarse es de {amount}, pero el pago con tu tarjeta no se ha completado: actualiza la tarjeta desde tu área de huésped.', error: 'Si crees que es un error, responde a este correo o escríbenos desde tu área de huésped.', cta: 'Abrir tu área de huésped' },
    card: { subject: 'Actualiza la tarjeta antes del {deadline} · {code}', title: 'Necesitamos una tarjeta válida', declined: 'Hola {name}, el pago con la tarjeta de la reserva {code} no se ha completado.', plain: 'Hola {name}, para la reserva {code} necesitamos una tarjeta de crédito válida.', ask: 'Añade una nueva tarjeta antes del {deadline}.', pay: 'Se cargarán {amount} en la nueva tarjeta.', cancel: 'Si no recibimos una tarjeta válida antes de ese momento, la reserva se cancelará.', safe: 'Escribes la tarjeta en la página de pago segura: el hotel nunca ve el número.', cta: 'Actualizar la tarjeta' },
    propose: { subject: 'Nuevas fechas propuestas · {code}', title: 'Te proponemos nuevas fechas', intro: 'Hola {name}, te proponemos mover la estancia de la reserva {code}:', dates: 'Nuevas fechas: del {from} al {to} · total {total}.', answer: 'Puedes aceptar o rechazar desde tu área de huésped: hasta que respondas, la reserva sigue igual.', cta: 'Responder a la propuesta' },
    refused: { subject: 'Tu solicitud · {code}', title: 'No podemos aceptar la solicitud', dates: 'Hola {name}, lamentablemente no podemos mover la reserva {code} a las fechas que pediste.', cancel: 'Hola {name}, lamentablemente no podemos cancelar gratis la reserva {code}.', same: 'La reserva sigue siendo válida como antes.', cta: 'Abrir tu área de huésped' },
    waived: 'Sin penalización: la cancelación es gratuita.',
  },
} as const;

/** "Tuesday 17 November, 14:00" in the hotel's time zone. */
const fmtDeadline = (iso: string, lang: Locale) =>
  new Intl.DateTimeFormat(intlLocale(lang), { timeZone: HOTEL_TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** The owner's own words, kept as written (line breaks included). */
const quote = (text: string) => `<div style="margin:18px 0 20px;padding:16px 18px;background:#FFFFFF;border-left:3px solid #B69562;font-size:15px;line-height:1.7;color:#242B2D;">${esc(text).replace(/\n/g, '<br>')}</div>`;

export function renderEmail(template: EmailTemplate, ctx: EmailContext): RenderedEmail {
  const { booking: b, room, settings, extra } = ctx;
  // messages to the hotel stay in Italian; every guest gets their own language
  const lang: Locale = template === 'richiesta_ospite' ? 'it' : isLocaleCode(extra?.lang) ? extra.lang : b ? guestLang(b.guest) : 'it';
  const c = COPY[lang];
  const nameRaw = b?.guest.firstName || c.dear;
  const name = esc(nameRaw);
  const code = esc(b?.code ?? '');
  const guestUrl = b ? siteUrl(lang, `/soggiorno/${b.token}`) : siteUrl(lang, '/');
  // notes the owner writes in Pagamenti are in Italian: only Italian guests get them
  const ownerNote = (s: string) => (lang === 'it' && s.trim() ? esc(s.trim()) : '');
  let subject = '';
  let title = '';
  let body = '';
  let cta: { label: string; href: string } | undefined;

  switch (template) {
    case 'conferma': {
      const m = c.conferma;
      subject = fillIn(m.subject, { code: b?.code ?? '' });
      title = fillIn(m.title, { name: nameRaw });
      const rule = esc(cancelText(lang, settings.payments, b ? { checkIn: b.checkIn, total: b.total, nights: diffDays(b.checkIn, b.checkOut), bookedAt: b.createdAt } : {}));
      const note = ownerNote(settings.payments.cancellationPolicy);
      body = p(esc(m.body)) + (b ? summary(b, room, settings, lang) : '') + p(note ? `${rule} ${note}` : rule);
      cta = { label: m.cta!, href: guestUrl };
      break;
    }
    case 'promemoria': {
      const m = c.promemoria;
      subject = fillIn(m.subject, { code: b?.code ?? '' });
      title = fillIn(m.title, { name: nameRaw });
      body = p(fillIn(esc(m.body), { from: esc(settings.hotel.checkInFrom), to: esc(settings.hotel.checkInTo) })) + (b ? summary(b, room, settings, lang) : '');
      cta = { label: m.cta!, href: guestUrl };
      break;
    }
    case 'modifica': {
      const m = c.modifica;
      subject = fillIn(m.subject, { code: b?.code ?? '' });
      title = m.title;
      body = p(esc(m.body)) + (extra?.changes ? p(esc(extra.changes)) : '') + (b ? summary(b, room, settings, lang) : '');
      cta = { label: m.cta!, href: guestUrl };
      break;
    }
    case 'cancellazione': {
      const m = c.cancellazione;
      subject = fillIn(m.subject, { code: b?.code ?? '' });
      title = m.title;
      const note = ownerNote(settings.payments.refundPolicy);
      body = p(fillIn(esc(m.body), { name, code })) + (extra?.message ? quote(extra.message) : '') + (extra?.waived ? p(`<strong>${esc(CARE[lang].waived)}</strong>`) : note ? p(note) : '') + p(esc(m.bye));
      break;
    }
    case 'rimborso': {
      const m = c.rimborso;
      subject = fillIn(m.subject, { code: b?.code ?? '' });
      title = m.title;
      // where the money goes and when it arrives: back on the same card, or given back by the hotel
      const via = extra?.refundVia;
      const onCard = via === 'card' || via === 'mixed';
      body =
        p(fillIn(esc(m.body), { amount: `<strong>${esc(money(extra?.amount ?? 0, lang, 2))}</strong>`, code })) +
        (onCard ? p(extra?.card ? fillIn(esc(m.card), { card: esc(extra.card) }) : esc(m.anyCard)) : '') +
        (onCard || !via ? p(esc(m.when)) : '') +
        (via === 'hand' || via === 'mixed' ? p(esc(m.hand)) : '');
      break;
    }
    case 'ringraziamento': {
      const m = c.ringraziamento;
      subject = m.subject;
      title = fillIn(m.title, { name: nameRaw });
      body = p(esc(m.body)) + (extra?.reviewUrl ? p(fillIn(esc(m.google), { link: `<a href="${esc(extra.reviewUrl)}" style="color:#10283D;">${esc(m.link)}</a>` })) : '');
      cta = { label: m.cta!, href: `${guestUrl}#feedback` };
      break;
    }
    case 'offerta_ritorno': {
      const m = c.offerta;
      subject = m.subject;
      title = m.title;
      body = p(`${esc(m.body)}${extra?.promoCode ? fillIn(esc(m.code), { code: `<strong>${esc(extra.promoCode)}</strong>` }) : ''}.`) + p(esc(m.consent));
      cta = { label: m.cta!, href: siteUrl(lang, '/camere') };
      break;
    }
    case 'richiesta_recensione': {
      const L = REVIEW_ASK[lang] ?? REVIEW_ASK.it;
      const roomName = room ? roomTitle(room, lang) : '';
      subject = L.subject.replace('{room}', roomName || L.yourRoom);
      title = L.title.replace('{name}', nameRaw);
      body = p(esc(L.body).replace('{room}', `<strong>${esc(roomName || L.yourRoom)}</strong>`)) + p(`<span style="font-size:26px;letter-spacing:6px;color:#B69562;">★★★★★</span>`) + p(esc(L.photos));
      cta = { label: L.cta, href: extra?.reviewUrl ?? guestUrl };
      break;
    }
    case 'codice_accesso': {
      // the language of the page where the guest asked for the code (extra.lang), the code in extra.code
      const L = ACCESS_CODE[lang] ?? ACCESS_CODE.it;
      const accessCode = esc(extra?.code ?? '');
      subject = L.subject.replace('{code}', extra?.code ?? '');
      title = L.title;
      body =
        p(`${esc(L.hello).replace('{name}', name)} ${esc(L.body)}`) +
        `<div style="margin:22px 0 22px;padding:22px 10px;background:#FFFFFF;border:1px solid #E7D9C1;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:38px;letter-spacing:12px;color:#10283D;">${accessCode}</div>` +
        p(esc(L.valid)) +
        `<p style="font-size:13px;line-height:1.6;margin:0 0 14px;color:#6B7376;">${esc(L.ignore)}</p>`;
      cta = { label: L.cta, href: siteUrl(lang, '/area-ospite') };
      break;
    }
    case 'messaggio_hotel': {
      const L = CARE[lang].msg;
      subject = fillIn(L.subject, { code: b?.code ?? '' });
      title = L.title;
      body = p(fillIn(esc(L.intro), { name, code })) + quote(extra?.message ?? '') + p(esc(L.reply));
      cta = { label: L.cta, href: `${guestUrl}#messaggi` };
      break;
    }
    case 'no_show': {
      const L = CARE[lang].noShow;
      const amount = `<strong>${esc(money(extra?.amount ?? 0, lang, 2))}</strong>`;
      subject = fillIn(L.subject, { code: b?.code ?? '' });
      title = L.title;
      const what = extra?.outcome === 'waived' ? esc((extra?.amount ?? 0) > 0 ? L.waived : L.waivedNothing) : extra?.outcome === 'due' ? fillIn(esc(L.due), { amount }) : fillIn(esc(L.charged), { amount });
      body = p(fillIn(esc(L.intro), { name, code, date: esc(b ? fmtDateLong(b.checkIn, lang) : '') })) + p(what) + p(esc(L.error));
      cta = { label: L.cta, href: extra?.outcome === 'due' ? `${guestUrl}#carta` : guestUrl };
      break;
    }
    case 'carta_da_aggiornare': {
      const L = CARE[lang].card;
      const deadline = extra?.deadline ? fmtDeadline(extra.deadline, lang) : '';
      subject = fillIn(L.subject, { code: b?.code ?? '', deadline });
      title = L.title;
      body =
        p(fillIn(esc(extra?.declined ? L.declined : L.plain), { name, code })) +
        p(`<strong>${fillIn(esc(L.ask), { deadline: esc(deadline) })}</strong>${extra?.amount ? ` ${fillIn(esc(L.pay), { amount: `<strong>${esc(money(extra.amount, lang, 2))}</strong>` })}` : ''}`) +
        (extra?.cancelOnExpiry ? p(esc(L.cancel)) : '') +
        `<p style="font-size:13px;line-height:1.6;margin:0 0 14px;color:#6B7376;">${esc(L.safe)}</p>`;
      cta = { label: L.cta, href: `${guestUrl}#carta` };
      break;
    }
    case 'richiesta_modifica': {
      const L = CARE[lang].propose;
      subject = fillIn(L.subject, { code: b?.code ?? '' });
      title = L.title;
      body =
        p(fillIn(esc(L.intro), { name, code })) +
        p(`<strong>${fillIn(esc(L.dates), { from: esc(fmtDateLong(extra?.checkIn ?? '', lang)), to: esc(fmtDateLong(extra?.checkOut ?? '', lang)), total: esc(money(extra?.total ?? 0, lang, 2)) })}</strong>`) +
        (extra?.message ? quote(extra.message) : '') +
        p(esc(L.answer));
      cta = { label: L.cta, href: `${guestUrl}#modifica` };
      break;
    }
    case 'risposta_modifica': {
      const L = CARE[lang].refused;
      subject = fillIn(L.subject, { code: b?.code ?? '' });
      title = L.title;
      body = p(fillIn(esc(extra?.kind === 'free_cancel' ? L.cancel : L.dates), { name, code })) + (extra?.message ? quote(extra.message) : '') + p(esc(L.same));
      cta = { label: L.cta, href: guestUrl };
      break;
    }
    case 'richiesta_ospite':
      subject = `Nuova richiesta ospite${b ? ` · ${b.code}` : ''}`;
      title = 'Nuova richiesta dal sito';
      body = p(esc(extra?.message ?? ''));
      break;
  }

  const html = layout(settings, lang, subject, title, body, cta);
  const text = `${title}\n\n${body.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|tr)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()}${cta ? `\n\n${cta.label}: ${cta.href}` : ''}`;
  return { subject, html, text, lang };
}

export const TEMPLATE_LABELS: Record<EmailTemplate, string> = {
  conferma: 'Conferma prenotazione',
  promemoria: 'Promemoria arrivo',
  modifica: 'Modifica prenotazione',
  cancellazione: 'Conferma cancellazione',
  rimborso: 'Conferma rimborso',
  ringraziamento: 'Ringraziamento dopo il soggiorno',
  offerta_ritorno: 'Offerta di ritorno',
  richiesta_ospite: 'Richiesta ospite (interna)',
  richiesta_recensione: 'Recensione della camera (dopo la partenza)',
  codice_accesso: 'Codice di accesso all’area ospite',
  messaggio_hotel: 'Messaggio dell’hotel all’ospite',
  no_show: 'Mancato arrivo (no-show)',
  carta_da_aggiornare: 'Richiesta di una nuova carta',
  richiesta_modifica: 'Proposta di nuove date',
  risposta_modifica: 'Richiesta dell’ospite non accettata',
  campagna: 'Campagna email',
};
