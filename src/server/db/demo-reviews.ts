import type { Feedback, Locale, Room } from '@/lib/types';

type T = Record<Locale, string>;

/** Demo room reviews, already written in every language (no translation calls needed). */
const COMMENTS: { rating: number; text: T; reply?: T }[] = [
  {
    rating: 5,
    text: {
      it: 'Camera luminosa e silenziosa, letto comodissimo. La mattina il sole entra piano dalla finestra: ci siamo sentiti a casa.',
      en: 'Bright, quiet room and a very comfortable bed. In the morning the sun slowly comes in through the window: we felt at home.',
      pl: 'Jasny, cichy pokój i bardzo wygodne łóżko. Rano słońce powoli wpada przez okno: czuliśmy się jak w domu.',
      de: 'Helles, ruhiges Zimmer und ein sehr bequemes Bett. Morgens kommt langsam die Sonne herein: Wir haben uns wie zu Hause gefühlt.',
      fr: 'Chambre lumineuse et calme, lit très confortable. Le matin, le soleil entre doucement par la fenêtre : nous nous sommes sentis chez nous.',
      es: 'Habitación luminosa y tranquila, cama comodísima. Por la mañana el sol entra despacio por la ventana: nos sentimos en casa.',
    },
    reply: {
      it: 'Grazie di cuore! Vi aspettiamo per un’altra colazione al sole.',
      en: 'Thank you so much! We look forward to another sunny breakfast with you.',
      pl: 'Serdecznie dziękujemy! Czekamy na kolejne śniadanie w słońcu.',
      de: 'Herzlichen Dank! Wir freuen uns auf ein weiteres Frühstück in der Sonne.',
      fr: 'Merci de tout cœur ! Nous vous attendons pour un autre petit-déjeuner au soleil.',
      es: '¡Muchísimas gracias! Os esperamos para otro desayuno al sol.',
    },
  },
  {
    rating: 5,
    text: {
      it: 'Pulizia impeccabile e posizione perfetta: Rena Bianca a pochi minuti a piedi. Personale gentilissimo.',
      en: 'Spotless and perfectly located: Rena Bianca beach is a few minutes’ walk away. Lovely staff.',
      pl: 'Nieskazitelnie czysto i idealna lokalizacja: plaża Rena Bianca kilka minut pieszo. Przemiła obsługa.',
      de: 'Makellos sauber und perfekt gelegen: Rena Bianca ist nur wenige Gehminuten entfernt. Sehr nettes Personal.',
      fr: 'Propreté impeccable et emplacement parfait : Rena Bianca à quelques minutes à pied. Personnel adorable.',
      es: 'Limpieza impecable y ubicación perfecta: Rena Bianca a pocos minutos a pie. Personal amabilísimo.',
    },
  },
  {
    rating: 4,
    text: {
      it: 'Bella camera e bagno moderno. Un po’ di rumore la sera dalla strada, ma con le finestre chiuse si dorme benissimo.',
      en: 'Nice room and modern bathroom. A bit of street noise in the evening, but with the windows closed you sleep very well.',
      pl: 'Ładny pokój i nowoczesna łazienka. Wieczorem trochę hałasu z ulicy, ale przy zamkniętych oknach śpi się świetnie.',
      de: 'Schönes Zimmer und modernes Bad. Abends etwas Straßenlärm, aber mit geschlossenen Fenstern schläft man sehr gut.',
      fr: 'Belle chambre et salle de bain moderne. Un peu de bruit de la rue le soir, mais fenêtres fermées on dort très bien.',
      es: 'Bonita habitación y baño moderno. Algo de ruido de la calle por la noche, pero con las ventanas cerradas se duerme muy bien.',
    },
    reply: {
      it: 'Grazie per il consiglio: abbiamo aggiunto tende più pesanti in questa camera.',
      en: 'Thanks for the tip: we have added heavier curtains to this room.',
      pl: 'Dziękujemy za wskazówkę: w tym pokoju dodaliśmy grubsze zasłony.',
      de: 'Danke für den Hinweis: Wir haben in diesem Zimmer dickere Vorhänge angebracht.',
      fr: 'Merci du conseil : nous avons ajouté des rideaux plus épais dans cette chambre.',
      es: 'Gracias por el consejo: hemos puesto cortinas más gruesas en esta habitación.',
    },
  },
  {
    rating: 5,
    text: {
      it: 'Siamo tornati per il terzo anno. Camera curata nei dettagli e consigli preziosi su calette poco conosciute.',
      en: 'Our third year back. A room cared for in every detail and precious tips on little-known coves.',
      pl: 'Wróciliśmy już trzeci rok z rzędu. Pokój dopracowany w szczegółach i cenne wskazówki o mało znanych zatoczkach.',
      de: 'Wir waren zum dritten Mal hier. Liebevoll gestaltetes Zimmer und wertvolle Tipps zu wenig bekannten Buchten.',
      fr: 'Nous sommes revenus pour la troisième année. Chambre soignée dans les détails et précieux conseils sur des criques peu connues.',
      es: 'Volvimos por tercer año. Habitación cuidada al detalle y consejos valiosos sobre calas poco conocidas.',
    },
  },
  {
    rating: 4,
    text: {
      it: 'Ottimo rapporto qualità-prezzo. Camera un po’ piccola per quattro, ma pratica e molto pulita.',
      en: 'Great value for money. The room is a little small for four, but practical and very clean.',
      pl: 'Świetny stosunek jakości do ceny. Pokój trochę mały dla czterech osób, ale praktyczny i bardzo czysty.',
      de: 'Sehr gutes Preis-Leistungs-Verhältnis. Für vier etwas klein, aber praktisch und sehr sauber.',
      fr: 'Excellent rapport qualité-prix. Chambre un peu petite pour quatre, mais pratique et très propre.',
      es: 'Muy buena relación calidad-precio. Habitación algo pequeña para cuatro, pero práctica y muy limpia.',
    },
  },
  {
    rating: 5,
    text: {
      it: 'Il balcone al tramonto vale il viaggio. Check-in veloce e tante attenzioni per i bambini.',
      en: 'The balcony at sunset is worth the trip. Quick check-in and lots of attention for the children.',
      pl: 'Balkon o zachodzie słońca jest wart podróży. Szybkie zameldowanie i dużo uwagi dla dzieci.',
      de: 'Der Balkon bei Sonnenuntergang ist die Reise wert. Schneller Check-in und viel Aufmerksamkeit für die Kinder.',
      fr: 'Le balcon au coucher du soleil vaut le voyage. Enregistrement rapide et beaucoup d’attentions pour les enfants.',
      es: 'El balcón al atardecer vale el viaje. Check-in rápido y muchas atenciones para los niños.',
    },
  },
  {
    rating: 3,
    text: {
      it: 'Camera semplice e pulita. Il Wi-Fi a volte era lento, ma lo staff ha cercato subito di aiutarci.',
      en: 'Simple, clean room. The Wi-Fi was sometimes slow, but the staff immediately tried to help.',
      pl: 'Prosty, czysty pokój. Wi-Fi czasem działało wolno, ale obsługa od razu próbowała pomóc.',
      de: 'Einfaches, sauberes Zimmer. Das WLAN war manchmal langsam, aber das Personal hat sofort versucht zu helfen.',
      fr: 'Chambre simple et propre. Le Wi-Fi était parfois lent, mais le personnel a tout de suite essayé de nous aider.',
      es: 'Habitación sencilla y limpia. El Wi-Fi a veces iba lento, pero el personal intentó ayudarnos enseguida.',
    },
    reply: {
      it: 'Grazie per la segnalazione: abbiamo installato un nuovo ripetitore al piano.',
      en: 'Thank you for letting us know: we have installed a new repeater on the floor.',
      pl: 'Dziękujemy za zgłoszenie: zainstalowaliśmy nowy wzmacniacz sygnału na piętrze.',
      de: 'Danke für den Hinweis: Wir haben einen neuen Repeater auf der Etage installiert.',
      fr: 'Merci du signalement : nous avons installé un nouveau répéteur à l’étage.',
      es: 'Gracias por avisarnos: hemos instalado un nuevo repetidor en la planta.',
    },
  },
  {
    rating: 5,
    text: {
      it: 'Tutto perfetto, dalla prenotazione online al saluto finale. Torneremo di sicuro.',
      en: 'Everything was perfect, from booking online to the final goodbye. We will definitely be back.',
      pl: 'Wszystko idealnie, od rezerwacji online po pożegnanie. Na pewno wrócimy.',
      de: 'Alles perfekt, von der Online-Buchung bis zum Abschied. Wir kommen bestimmt wieder.',
      fr: 'Tout était parfait, de la réservation en ligne au dernier au revoir. Nous reviendrons sans faute.',
      es: 'Todo perfecto, desde la reserva online hasta la despedida. Volveremos seguro.',
    },
  },
];

const NAMES: { name: string; lang: Locale }[] = [
  { name: 'Francesca M.', lang: 'it' },
  { name: 'Lukas W.', lang: 'de' },
  { name: 'Marta Z.', lang: 'pl' },
  { name: 'Emma H.', lang: 'en' },
  { name: 'Camille D.', lang: 'fr' },
  { name: 'Javier R.', lang: 'es' },
  { name: 'Davide P.', lang: 'it' },
  { name: 'Hannah S.', lang: 'de' },
  { name: 'Piotr K.', lang: 'pl' },
  { name: 'Chiara L.', lang: 'it' },
];

const dayBefore = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
};

/** 2–4 reviews per room, deterministic (same story after every reset). */
export function demoRoomReviews(rooms: Room[], today: string): Feedback[] {
  const out: Feedback[] = [];
  rooms.forEach((room, ri) => {
    const n = 2 + (ri % 3);
    for (let k = 0; k < n; k++) {
      const c = COMMENTS[(ri * 3 + k * 5) % COMMENTS.length]!;
      const who = NAMES[(ri * 7 + k * 3) % NAMES.length]!;
      const created = dayBefore(today, 6 + ri * 5 + k * 17);
      const translations: Partial<Record<Locale, string>> = { ...c.text };
      delete translations[who.lang];
      out.push({
        id: `fb-room-${room.id}-${k}`,
        bookingId: null,
        roomId: room.id,
        name: who.name,
        rating: c.rating,
        comment: c.text[who.lang],
        lang: who.lang,
        translations,
        photos: [],
        replies: c.reply && k === 0 ? [{ id: `rp-${room.id}-${k}`, author: 'hotel', name: 'Hotel L’Ancora', text: c.reply.it, lang: 'it', translations: (({ it: _it, ...rest }) => (void _it, rest))(c.reply), createdAt: dayBefore(today, 4 + ri * 5 + k * 17) }] : [],
        verified: true,
        pending: false,
        publishConsent: true,
        showOnSite: true,
        demo: true,
        createdAt: created,
      });
    }
  });
  return out;
}
