import type { Locale } from '../types';

const it = {
  title: 'Recensioni',
  leave: 'Lascia una recensione',
  count: '{n} recensioni',
  one: '1 recensione',
  verified: 'Soggiorno verificato',
  translated: 'Tradotta automaticamente',
  showOriginal: 'Mostra originale',
  showTranslation: 'Mostra traduzione',
  reply: 'Rispondi',
  replies: '{n} risposte',
  replyPh: 'Scrivi una risposta…',
  send: 'Invia',
  yourName: 'Il tuo nome',
  yourReview: 'Racconta il tuo soggiorno',
  reviewPh: 'Cosa ti è piaciuto? Cosa possiamo migliorare?',
  stars: 'Il tuo voto',
  photos: 'Foto (fino a 3)',
  addPhoto: 'Aggiungi foto',
  publish: 'Pubblica la mia recensione sul sito',
  thanks: 'Grazie!',
  thanksPending: 'La tua recensione sarà visibile dopo una rapida verifica.',
  thanksVerified: 'La tua recensione è già online, tradotta nelle altre lingue.',
  hotelReply: 'Risposta della struttura',
  room: 'Camera',
  allRooms: 'Tutte le camere',
  general: 'L’hotel in generale',
  chooseRoom: 'Di cosa vuoi parlare?',
  empty: 'Ancora nessuna recensione: sii il primo!',
  error: 'Qualcosa non va, riprova tra poco.',
  links: 'Per sicurezza i link non sono ammessi.',
  already: 'Hai già lasciato una recensione per questo soggiorno. Grazie!',
  rate: 'Troppi invii: riprova tra qualche minuto.',
  more: 'Mostra tutte',
  less: 'Mostra meno',
  close: 'Chiudi',
  words: 'Pessima|Così così|Buona|Molto buona|Eccellente',
  pageTitle: 'Com’è andato il soggiorno?',
  pageIntro: 'Bastano 30 secondi: stelle, due righe e, se vuoi, qualche foto.',
  minRating: '4★ e più',
  of5: 'su 5',
};
type Dict = typeof it;

const en: Dict = {
  title: 'Reviews', leave: 'Write a review', count: '{n} reviews', one: '1 review', verified: 'Verified stay', translated: 'Automatically translated', showOriginal: 'Show original', showTranslation: 'Show translation', reply: 'Reply', replies: '{n} replies', replyPh: 'Write a reply…', send: 'Send', yourName: 'Your name', yourReview: 'Tell us about your stay', reviewPh: 'What did you like? What could we do better?', stars: 'Your rating', photos: 'Photos (up to 3)', addPhoto: 'Add photo', publish: 'Publish my review on the website', thanks: 'Thank you!', thanksPending: 'Your review will appear after a quick check.', thanksVerified: 'Your review is already online, translated into the other languages.', hotelReply: 'Reply from the hotel', room: 'Room', allRooms: 'All rooms', general: 'The hotel in general', chooseRoom: 'What is it about?', empty: 'No reviews yet: be the first!', error: 'Something went wrong, please try again.', links: 'For safety, links are not allowed.', already: 'You have already reviewed this stay. Thank you!', rate: 'Too many attempts: try again in a few minutes.', more: 'Show all', less: 'Show less', close: 'Close', words: 'Poor|Fair|Good|Very good|Excellent', pageTitle: 'How was your stay?', pageIntro: 'It takes 30 seconds: stars, a couple of lines and, if you like, a few photos.', minRating: '4★ and up', of5: 'out of 5',
};
const pl: Dict = {
  title: 'Opinie', leave: 'Dodaj opinię', count: '{n} opinii', one: '1 opinia', verified: 'Potwierdzony pobyt', translated: 'Przetłumaczono automatycznie', showOriginal: 'Pokaż oryginał', showTranslation: 'Pokaż tłumaczenie', reply: 'Odpowiedz', replies: 'Odpowiedzi: {n}', replyPh: 'Napisz odpowiedź…', send: 'Wyślij', yourName: 'Twoje imię', yourReview: 'Opowiedz o pobycie', reviewPh: 'Co Ci się podobało? Co możemy poprawić?', stars: 'Twoja ocena', photos: 'Zdjęcia (do 3)', addPhoto: 'Dodaj zdjęcie', publish: 'Opublikuj moją opinię na stronie', thanks: 'Dziękujemy!', thanksPending: 'Opinia pojawi się po krótkiej weryfikacji.', thanksVerified: 'Twoja opinia jest już na stronie, przetłumaczona na inne języki.', hotelReply: 'Odpowiedź hotelu', room: 'Pokój', allRooms: 'Wszystkie pokoje', general: 'Hotel ogólnie', chooseRoom: 'Czego dotyczy opinia?', empty: 'Brak opinii: bądź pierwszy!', error: 'Coś poszło nie tak, spróbuj ponownie.', links: 'Ze względów bezpieczeństwa linki są niedozwolone.', already: 'Ten pobyt został już oceniony. Dziękujemy!', rate: 'Zbyt wiele prób: spróbuj za kilka minut.', more: 'Pokaż wszystkie', less: 'Pokaż mniej', close: 'Zamknij', words: 'Słabo|Tak sobie|Dobrze|Bardzo dobrze|Wspaniale', pageTitle: 'Jak minął pobyt?', pageIntro: 'To tylko 30 sekund: gwiazdki, dwa zdania i, jeśli chcesz, kilka zdjęć.', minRating: '4★ i więcej', of5: 'na 5',
};
const de: Dict = {
  title: 'Bewertungen', leave: 'Bewertung schreiben', count: '{n} Bewertungen', one: '1 Bewertung', verified: 'Bestätigter Aufenthalt', translated: 'Automatisch übersetzt', showOriginal: 'Original anzeigen', showTranslation: 'Übersetzung anzeigen', reply: 'Antworten', replies: '{n} Antworten', replyPh: 'Antwort schreiben…', send: 'Senden', yourName: 'Ihr Name', yourReview: 'Erzählen Sie von Ihrem Aufenthalt', reviewPh: 'Was hat Ihnen gefallen? Was können wir besser machen?', stars: 'Ihre Bewertung', photos: 'Fotos (bis zu 3)', addPhoto: 'Foto hinzufügen', publish: 'Meine Bewertung auf der Website veröffentlichen', thanks: 'Danke!', thanksPending: 'Ihre Bewertung erscheint nach einer kurzen Prüfung.', thanksVerified: 'Ihre Bewertung ist schon online, übersetzt in die anderen Sprachen.', hotelReply: 'Antwort des Hotels', room: 'Zimmer', allRooms: 'Alle Zimmer', general: 'Das Hotel allgemein', chooseRoom: 'Worum geht es?', empty: 'Noch keine Bewertungen: Seien Sie der Erste!', error: 'Etwas ist schiefgelaufen, bitte erneut versuchen.', links: 'Aus Sicherheitsgründen sind Links nicht erlaubt.', already: 'Sie haben diesen Aufenthalt bereits bewertet. Danke!', rate: 'Zu viele Versuche: bitte in ein paar Minuten erneut.', more: 'Alle anzeigen', less: 'Weniger anzeigen', close: 'Schließen', words: 'Schlecht|Mittelmäßig|Gut|Sehr gut|Ausgezeichnet', pageTitle: 'Wie war Ihr Aufenthalt?', pageIntro: 'Nur 30 Sekunden: Sterne, zwei Zeilen und, wenn Sie möchten, ein paar Fotos.', minRating: 'ab 4★', of5: 'von 5',
};
const fr: Dict = {
  title: 'Avis', leave: 'Laisser un avis', count: '{n} avis', one: '1 avis', verified: 'Séjour vérifié', translated: 'Traduit automatiquement', showOriginal: 'Voir l’original', showTranslation: 'Voir la traduction', reply: 'Répondre', replies: '{n} réponses', replyPh: 'Écrire une réponse…', send: 'Envoyer', yourName: 'Votre prénom', yourReview: 'Racontez votre séjour', reviewPh: 'Qu’avez-vous aimé ? Que pouvons-nous améliorer ?', stars: 'Votre note', photos: 'Photos (jusqu’à 3)', addPhoto: 'Ajouter une photo', publish: 'Publier mon avis sur le site', thanks: 'Merci !', thanksPending: 'Votre avis sera visible après une rapide vérification.', thanksVerified: 'Votre avis est déjà en ligne, traduit dans les autres langues.', hotelReply: 'Réponse de l’hôtel', room: 'Chambre', allRooms: 'Toutes les chambres', general: 'L’hôtel en général', chooseRoom: 'De quoi s’agit-il ?', empty: 'Pas encore d’avis : soyez le premier !', error: 'Un problème est survenu, réessayez.', links: 'Par sécurité, les liens ne sont pas autorisés.', already: 'Vous avez déjà donné votre avis sur ce séjour. Merci !', rate: 'Trop de tentatives : réessayez dans quelques minutes.', more: 'Tout afficher', less: 'Afficher moins', close: 'Fermer', words: 'Décevant|Moyen|Bien|Très bien|Excellent', pageTitle: 'Comment s’est passé votre séjour ?', pageIntro: '30 secondes suffisent : des étoiles, deux lignes et, si vous voulez, quelques photos.', minRating: '4★ et plus', of5: 'sur 5',
};
const es: Dict = {
  title: 'Reseñas', leave: 'Escribir una reseña', count: '{n} reseñas', one: '1 reseña', verified: 'Estancia verificada', translated: 'Traducida automáticamente', showOriginal: 'Ver original', showTranslation: 'Ver traducción', reply: 'Responder', replies: '{n} respuestas', replyPh: 'Escribe una respuesta…', send: 'Enviar', yourName: 'Tu nombre', yourReview: 'Cuéntanos tu estancia', reviewPh: '¿Qué te gustó? ¿Qué podemos mejorar?', stars: 'Tu valoración', photos: 'Fotos (hasta 3)', addPhoto: 'Añadir foto', publish: 'Publicar mi reseña en la web', thanks: '¡Gracias!', thanksPending: 'Tu reseña será visible tras una breve revisión.', thanksVerified: 'Tu reseña ya está online, traducida a los otros idiomas.', hotelReply: 'Respuesta del hotel', room: 'Habitación', allRooms: 'Todas las habitaciones', general: 'El hotel en general', chooseRoom: '¿Sobre qué es?', empty: 'Aún no hay reseñas: ¡sé el primero!', error: 'Algo ha fallado, inténtalo de nuevo.', links: 'Por seguridad no se permiten enlaces.', already: 'Ya has valorado esta estancia. ¡Gracias!', rate: 'Demasiados intentos: vuelve a probar en unos minutos.', more: 'Ver todas', less: 'Ver menos', close: 'Cerrar', words: 'Mala|Regular|Buena|Muy buena|Excelente', pageTitle: '¿Qué tal tu estancia?', pageIntro: 'Solo 30 segundos: estrellas, dos líneas y, si quieres, algunas fotos.', minRating: '4★ o más', of5: 'de 5',
};

export const REVIEWS_T: Record<Locale, Dict> = { it, en, pl, de, fr, es };
export type ReviewsDict = Dict;

export const MAP_T: Record<Locale, { hint: string; ferry: string; photos: string; road: string }> = {
  it: { hint: 'Tocca un luogo: vedi la strada, i minuti e le foto', ferry: 'auto + traghetto', photos: 'Tocca una foto per ingrandirla', road: 'percorso reale' },
  en: { hint: 'Tap a place: see the road, the minutes and the photos', ferry: 'car + ferry', photos: 'Tap a photo to enlarge it', road: 'real route' },
  pl: { hint: 'Dotknij miejsca: zobaczysz drogę, czas i zdjęcia', ferry: 'auto + prom', photos: 'Dotknij zdjęcia, aby je powiększyć', road: 'prawdziwa trasa' },
  de: { hint: 'Tippen Sie auf einen Ort: Weg, Minuten und Fotos', ferry: 'Auto + Fähre', photos: 'Foto antippen zum Vergrößern', road: 'echte Route' },
  fr: { hint: 'Touchez un lieu : la route, les minutes et les photos', ferry: 'voiture + ferry', photos: 'Touchez une photo pour l’agrandir', road: 'itinéraire réel' },
  es: { hint: 'Toca un lugar: el camino, los minutos y las fotos', ferry: 'coche + ferry', photos: 'Toca una foto para ampliarla', road: 'ruta real' },
};

type Finale = { eyebrow: string; title: string; text: string; drag: string; airport: string; airportTime: string; ferry: string; ferryTime: string; beach: string; beachTime: string; address: string; pending: string; write: string };
export const FINALE_T: Record<Locale, Finale> = {
  it: { eyebrow: 'Dove siamo', title: 'Nel cuore di Santa Teresa, a due passi dal mare', text: 'Il paese, il porto per la Corsica e la spiaggia di Rena Bianca si raggiungono a piedi. Ecco la costa intorno a noi, in 3D.', drag: 'Trascina per ruotare', airport: 'Aeroporto di Olbia', airportTime: '≈ 65 km · circa 1 ora in auto', ferry: 'Traghetto per Bonifacio (Corsica)', ferryTime: '≈ 1 km dal porto · 50 min di navigazione', beach: 'Spiaggia Rena Bianca', beachTime: '≈ 10 minuti a piedi', address: 'Indirizzo', pending: 'indirizzo esatto da confermare', write: 'Scrivici' },
  en: { eyebrow: 'Where we are', title: 'In the heart of Santa Teresa, steps from the sea', text: 'The town, the port for Corsica and Rena Bianca beach are all within walking distance. Here is the coast around us, in 3D.', drag: 'Drag to rotate', airport: 'Olbia airport', airportTime: '≈ 65 km · about 1 hour by car', ferry: 'Ferry to Bonifacio (Corsica)', ferryTime: '≈ 1 km from the port · 50 min crossing', beach: 'Rena Bianca beach', beachTime: '≈ 10 minutes on foot', address: 'Address', pending: 'exact address to be confirmed', write: 'Write to us' },
  pl: { eyebrow: 'Gdzie jesteśmy', title: 'W sercu Santa Teresa, kilka kroków od morza', text: 'Do miasteczka, portu na Korsykę i plaży Rena Bianca dojdziesz pieszo. Oto wybrzeże wokół nas w 3D.', drag: 'Przeciągnij, aby obrócić', airport: 'Lotnisko Olbia', airportTime: '≈ 65 km · ok. 1 godziny samochodem', ferry: 'Prom do Bonifacio (Korsyka)', ferryTime: '≈ 1 km od portu · 50 min rejsu', beach: 'Plaża Rena Bianca', beachTime: '≈ 10 minut pieszo', address: 'Adres', pending: 'dokładny adres do potwierdzenia', write: 'Napisz do nas' },
  de: { eyebrow: 'Wo wir sind', title: 'Im Herzen von Santa Teresa, nur Schritte vom Meer', text: 'Ort, Fährhafen nach Korsika und der Strand Rena Bianca sind zu Fuß erreichbar. Hier die Küste um uns herum, in 3D.', drag: 'Zum Drehen ziehen', airport: 'Flughafen Olbia', airportTime: '≈ 65 km · ca. 1 Stunde mit dem Auto', ferry: 'Fähre nach Bonifacio (Korsika)', ferryTime: '≈ 1 km zum Hafen · 50 Min. Überfahrt', beach: 'Strand Rena Bianca', beachTime: '≈ 10 Minuten zu Fuß', address: 'Adresse', pending: 'genaue Adresse noch zu bestätigen', write: 'Schreiben Sie uns' },
  fr: { eyebrow: 'Où nous sommes', title: 'Au cœur de Santa Teresa, à deux pas de la mer', text: 'Le village, le port vers la Corse et la plage de Rena Bianca se rejoignent à pied. Voici la côte autour de nous, en 3D.', drag: 'Glissez pour tourner', airport: 'Aéroport d’Olbia', airportTime: '≈ 65 km · environ 1 heure en voiture', ferry: 'Ferry pour Bonifacio (Corse)', ferryTime: '≈ 1 km du port · 50 min de traversée', beach: 'Plage de Rena Bianca', beachTime: '≈ 10 minutes à pied', address: 'Adresse', pending: 'adresse exacte à confirmer', write: 'Écrivez-nous' },
  es: { eyebrow: 'Dónde estamos', title: 'En el corazón de Santa Teresa, a dos pasos del mar', text: 'El pueblo, el puerto hacia Córcega y la playa de Rena Bianca están a un paseo. Aquí la costa que nos rodea, en 3D.', drag: 'Arrastra para girar', airport: 'Aeropuerto de Olbia', airportTime: '≈ 65 km · alrededor de 1 hora en coche', ferry: 'Ferry a Bonifacio (Córcega)', ferryTime: '≈ 1 km del puerto · 50 min de travesía', beach: 'Playa Rena Bianca', beachTime: '≈ 10 minutos a pie', address: 'Dirección', pending: 'dirección exacta por confirmar', write: 'Escríbenos' },
};

/** Reviews section (home), explore "photos first" and the 3D town. */
type Extra = {
  withPhotos: string; latest: string; read: string; seeAll: string; recommend: string; prev: string; next: string; all: string; filtered: string;
  onMap: string; backPhotos: string; wholeMap: string; wholeMapSub: string; route: string;
  loading3d: string; street: string; tallest: string; zoom: string; reset: string;
  email: string; emailNote: string;
};
export const EXTRA_T: Record<Locale, Extra> = {
  it: { withPhotos: 'Con foto', latest: 'Le più recenti', read: 'Leggi tutto', seeAll: 'Tutte le {n} recensioni', recommend: '{p}% ci consiglierebbe', prev: 'Recensione precedente', next: 'Recensione successiva', all: 'Tutte', filtered: '{n} su {t}', onMap: 'Mostra sulla mappa', backPhotos: 'Torna alle foto', wholeMap: 'Tutti i luoghi sulla mappa', wholeMapSub: 'Strade vere, minuti a piedi e in auto', route: 'Percorso dall’hotel', loading3d: 'Costruiamo il paese in 3D…', street: 'Le vie del paese, dai dati OpenStreetMap', tallest: 'L’Ancora', zoom: 'Avvicina', reset: 'Vista iniziale', email: "La tua email", emailNote: "L’email non viene pubblicata: serve solo all’hotel per risponderti." },
  en: { withPhotos: 'With photos', latest: 'Latest', read: 'Read more', seeAll: 'All {n} reviews', recommend: '{p}% would recommend us', prev: 'Previous review', next: 'Next review', all: 'All', filtered: '{n} of {t}', onMap: 'Show on the map', backPhotos: 'Back to photos', wholeMap: 'Every place on the map', wholeMapSub: 'Real roads, minutes on foot and by car', route: 'Route from the hotel', loading3d: 'Building the town in 3D…', street: 'The town’s streets, from OpenStreetMap data', tallest: 'L’Ancora', zoom: 'Zoom in', reset: 'Reset view', email: "Your email", emailNote: "Your email is never published: the hotel only uses it to answer you." },
  pl: { withPhotos: 'Ze zdjęciami', latest: 'Najnowsze', read: 'Czytaj dalej', seeAll: 'Wszystkie opinie ({n})', recommend: '{p}% poleca nas', prev: 'Poprzednia opinia', next: 'Następna opinia', all: 'Wszystkie', filtered: '{n} z {t}', onMap: 'Pokaż na mapie', backPhotos: 'Wróć do zdjęć', wholeMap: 'Wszystkie miejsca na mapie', wholeMapSub: 'Prawdziwe drogi, minuty pieszo i autem', route: 'Trasa z hotelu', loading3d: 'Budujemy miasteczko w 3D…', street: 'Ulice miasteczka z danych OpenStreetMap', tallest: 'L’Ancora', zoom: 'Przybliż', reset: 'Widok początkowy', email: "Twój e-mail", emailNote: "E-mail nie jest publikowany: hotel użyje go tylko, aby Ci odpowiedzieć." },
  de: { withPhotos: 'Mit Fotos', latest: 'Neueste', read: 'Weiterlesen', seeAll: 'Alle {n} Bewertungen', recommend: '{p}% empfehlen uns', prev: 'Vorherige Bewertung', next: 'Nächste Bewertung', all: 'Alle', filtered: '{n} von {t}', onMap: 'Auf der Karte zeigen', backPhotos: 'Zurück zu den Fotos', wholeMap: 'Alle Orte auf der Karte', wholeMapSub: 'Echte Straßen, Minuten zu Fuß und mit dem Auto', route: 'Weg vom Hotel', loading3d: 'Wir bauen den Ort in 3D…', street: 'Die Straßen des Ortes, aus OpenStreetMap-Daten', tallest: 'L’Ancora', zoom: 'Vergrößern', reset: 'Ausgangsansicht', email: "Ihre E-Mail", emailNote: "Ihre E-Mail wird nicht veröffentlicht: das Hotel nutzt sie nur für die Antwort." },
  fr: { withPhotos: 'Avec photos', latest: 'Les plus récents', read: 'Lire la suite', seeAll: 'Les {n} avis', recommend: '{p}% nous recommandent', prev: 'Avis précédent', next: 'Avis suivant', all: 'Tous', filtered: '{n} sur {t}', onMap: 'Voir sur la carte', backPhotos: 'Retour aux photos', wholeMap: 'Tous les lieux sur la carte', wholeMapSub: 'Vraies routes, minutes à pied et en voiture', route: 'Trajet depuis l’hôtel', loading3d: 'Nous construisons le village en 3D…', street: 'Les rues du village, d’après OpenStreetMap', tallest: 'L’Ancora', zoom: 'Zoomer', reset: 'Vue initiale', email: "Votre e-mail", emailNote: "Votre e-mail n’est jamais publié : l’hôtel ne l’utilise que pour vous répondre." },
  es: { withPhotos: 'Con fotos', latest: 'Las más recientes', read: 'Leer más', seeAll: 'Las {n} reseñas', recommend: 'El {p}% nos recomienda', prev: 'Reseña anterior', next: 'Reseña siguiente', all: 'Todas', filtered: '{n} de {t}', onMap: 'Ver en el mapa', backPhotos: 'Volver a las fotos', wholeMap: 'Todos los lugares en el mapa', wholeMapSub: 'Carreteras reales, minutos a pie y en coche', route: 'Ruta desde el hotel', loading3d: 'Construimos el pueblo en 3D…', street: 'Las calles del pueblo, con datos de OpenStreetMap', tallest: 'L’Ancora', zoom: 'Acercar', reset: 'Vista inicial', email: "Tu email", emailNote: "Tu email no se publica: el hotel solo lo usa para responderte." },
};

/** Home intro: the hotel at a glance (facts from www.hotellancora.it). */
type Intro = {
  title: string; text: string; direct: string; call: string; whatsapp: string; email: string;
  s1: string; s2: string; s3: string; s4: string; inRoom: string; inHotel: string;
  room: string[]; hotel: string[]; beach: string;
};
export const INTRO_T: Record<Locale, Intro> = {
  it: { title: 'Nel centro del paese, a 300 metri dal mare.', text: '26 camere arredate in stile marino, aperte tutto l’anno. Intorno ristoranti, pizzerie, bar per la colazione e un ampio parcheggio pubblico gratuito; la spiaggia di Rena Bianca è a due passi.', direct: 'Prenota direttamente: risparmi tempo e denaro', call: 'Chiama', whatsapp: 'WhatsApp', email: 'Email', s1: 'dalla spiaggia di Rena Bianca', s2: 'camere in stile marino', s3: 'giorni l’anno aperti', s4: 'dal sito archeologico Lu Brandali', inRoom: 'In camera', inHotel: 'In hotel', room: ['Wi-Fi gratuito', 'Aria condizionata', 'Riscaldamento', 'TV satellitare', 'Telefono diretto', 'Mini-frigo', 'Asciugacapelli', 'Doccia'], hotel: ['Ascensore', 'Cassaforte', 'Sala TV', 'Sala lettura e internet point', 'Parcheggio pubblico gratuito', 'Diving nei dintorni'], beach: 'Rena Bianca · pochi minuti a piedi' },
  en: { title: 'In the town centre, 300 metres from the sea.', text: '26 rooms in a modern seaside style, open all year round. Around us: restaurants, pizzerias, cafés for breakfast and a large free public car park; Rena Bianca beach is just steps away.', direct: 'Book direct: save time and money', call: 'Call', whatsapp: 'WhatsApp', email: 'Email', s1: 'from Rena Bianca beach', s2: 'seaside-style rooms', s3: 'days a year open', s4: 'from the Lu Brandali archaeological site', inRoom: 'In your room', inHotel: 'In the hotel', room: ['Free Wi-Fi', 'Air conditioning', 'Heating', 'Satellite TV', 'Direct phone', 'Mini-fridge', 'Hairdryer', 'Shower'], hotel: ['Lift', 'Safe', 'TV lounge', 'Reading room with internet point', 'Free public parking', 'Diving nearby'], beach: 'Rena Bianca · a few minutes on foot' },
  pl: { title: 'W centrum miasteczka, 300 metrów od morza.', text: '26 pokoi urządzonych w nowoczesnym, morskim stylu, otwartych przez cały rok. Wokół restauracje, pizzerie, bary na śniadanie i duży bezpłatny parking publiczny; plaża Rena Bianca jest tuż obok.', direct: 'Rezerwuj bezpośrednio: oszczędzasz czas i pieniądze', call: 'Zadzwoń', whatsapp: 'WhatsApp', email: 'E-mail', s1: 'od plaży Rena Bianca', s2: 'pokoi w morskim stylu', s3: 'dni w roku otwarte', s4: 'od stanowiska archeologicznego Lu Brandali', inRoom: 'W pokoju', inHotel: 'W hotelu', room: ['Bezpłatne Wi-Fi', 'Klimatyzacja', 'Ogrzewanie', 'Telewizja satelitarna', 'Telefon bezpośredni', 'Minilodówka', 'Suszarka do włosów', 'Prysznic'], hotel: ['Winda', 'Sejf', 'Sala telewizyjna', 'Czytelnia z dostępem do internetu', 'Bezpłatny parking publiczny', 'Nurkowanie w okolicy'], beach: 'Rena Bianca · kilka minut pieszo' },
  de: { title: 'Im Ortszentrum, 300 Meter vom Meer.', text: '26 Zimmer im modernen maritimen Stil, das ganze Jahr geöffnet. Rundherum Restaurants, Pizzerien, Bars fürs Frühstück und ein großer kostenloser öffentlicher Parkplatz; der Strand Rena Bianca liegt nur wenige Schritte entfernt.', direct: 'Direkt buchen: Zeit und Geld sparen', call: 'Anrufen', whatsapp: 'WhatsApp', email: 'E-Mail', s1: 'zum Strand Rena Bianca', s2: 'Zimmer im maritimen Stil', s3: 'Tage im Jahr geöffnet', s4: 'zur Ausgrabungsstätte Lu Brandali', inRoom: 'Im Zimmer', inHotel: 'Im Hotel', room: ['Kostenloses WLAN', 'Klimaanlage', 'Heizung', 'Sat-TV', 'Direktwahltelefon', 'Minikühlschrank', 'Haartrockner', 'Dusche'], hotel: ['Aufzug', 'Safe', 'TV-Raum', 'Leseraum mit Internetplatz', 'Kostenloser öffentlicher Parkplatz', 'Tauchen in der Nähe'], beach: 'Rena Bianca · wenige Gehminuten' },
  fr: { title: 'Au centre du village, à 300 mètres de la mer.', text: '26 chambres au style marin moderne, ouvertes toute l’année. Tout autour, restaurants, pizzerias, bars pour le petit-déjeuner et un grand parking public gratuit ; la plage de Rena Bianca est à deux pas.', direct: 'Réservez en direct : gagnez du temps et de l’argent', call: 'Appeler', whatsapp: 'WhatsApp', email: 'E-mail', s1: 'de la plage de Rena Bianca', s2: 'chambres au style marin', s3: 'jours par an ouverts', s4: 'du site archéologique Lu Brandali', inRoom: 'En chambre', inHotel: 'À l’hôtel', room: ['Wi-Fi gratuit', 'Climatisation', 'Chauffage', 'TV satellite', 'Téléphone direct', 'Mini-réfrigérateur', 'Sèche-cheveux', 'Douche'], hotel: ['Ascenseur', 'Coffre-fort', 'Salon TV', 'Salle de lecture avec point internet', 'Parking public gratuit', 'Plongée à proximité'], beach: 'Rena Bianca · quelques minutes à pied' },
  es: { title: 'En el centro del pueblo, a 300 metros del mar.', text: '26 habitaciones de estilo marinero moderno, abiertas todo el año. Alrededor, restaurantes, pizzerías, bares para desayunar y un amplio aparcamiento público gratuito; la playa de Rena Bianca está a dos pasos.', direct: 'Reserva directamente: ahorra tiempo y dinero', call: 'Llamar', whatsapp: 'WhatsApp', email: 'Email', s1: 'de la playa de Rena Bianca', s2: 'habitaciones de estilo marinero', s3: 'días al año abiertos', s4: 'del yacimiento arqueológico Lu Brandali', inRoom: 'En la habitación', inHotel: 'En el hotel', room: ['Wi-Fi gratuito', 'Aire acondicionado', 'Calefacción', 'TV por satélite', 'Teléfono directo', 'Mininevera', 'Secador de pelo', 'Ducha'], hotel: ['Ascensor', 'Caja fuerte', 'Sala de TV', 'Sala de lectura con punto de internet', 'Aparcamiento público gratuito', 'Buceo en la zona'], beach: 'Rena Bianca · a pocos minutos a pie' },
};

type Contact = { eyebrow: string; title: string; text: string; reply: string; or: string; open: string };
export const CONTACT_T: Record<Locale, Contact> = {
  it: { eyebrow: 'Reception · tutto l’anno', title: 'Scrivici', text: 'Una domanda sulle camere, un arrivo in tarda serata, una richiesta speciale? Scrivici: risponde la reception, non un call center.', reply: 'Di solito rispondiamo entro poche ore.', or: 'oppure', open: 'Aperti 365 giorni l’anno' },
  en: { eyebrow: 'Reception · all year round', title: 'Write to us', text: 'A question about the rooms, a late arrival, a special request? Write to us: the reception answers, not a call centre.', reply: 'We usually reply within a few hours.', or: 'or', open: 'Open 365 days a year' },
  pl: { eyebrow: 'Recepcja · cały rok', title: 'Napisz do nas', text: 'Pytanie o pokoje, późny przyjazd, specjalna prośba? Napisz do nas: odpowiada recepcja hotelu, a nie call center.', reply: 'Zwykle odpowiadamy w ciągu kilku godzin.', or: 'albo', open: 'Otwarte 365 dni w roku' },
  de: { eyebrow: 'Rezeption · ganzjährig', title: 'Schreiben Sie uns', text: 'Eine Frage zu den Zimmern, eine späte Ankunft, ein besonderer Wunsch? Schreiben Sie uns: Es antwortet die Rezeption, kein Callcenter.', reply: 'Wir antworten meist innerhalb weniger Stunden.', or: 'oder', open: '365 Tage im Jahr geöffnet' },
  fr: { eyebrow: 'Réception · toute l’année', title: 'Écrivez-nous', text: 'Une question sur les chambres, une arrivée tardive, une demande particulière ? Écrivez-nous : c’est la réception qui répond, pas un centre d’appels.', reply: 'Nous répondons généralement en quelques heures.', or: 'ou', open: 'Ouvert 365 jours par an' },
  es: { eyebrow: 'Recepción · todo el año', title: 'Escríbenos', text: '¿Una pregunta sobre las habitaciones, una llegada tarde, una petición especial? Escríbenos: responde la recepción, no un call center.', reply: 'Solemos responder en pocas horas.', or: 'o', open: 'Abierto los 365 días del año' },
};

type Wall = { sort: string; newest: string; best: string; lowest: string; less: string; oneReply: string; noMatch: string; clear: string; filters: string; hotel: string };
export const WALL_T: Record<Locale, Wall> = {
  it: { sort: 'Ordina', newest: 'Più recenti', best: 'Più positive', lowest: 'Più critiche', less: 'Mostra meno', oneReply: '1 risposta', noMatch: 'Nessuna recensione con questi filtri.', clear: 'Azzera i filtri', filters: 'Filtra', hotel: 'Hotel L’Ancora' },
  en: { sort: 'Sort', newest: 'Newest', best: 'Most positive', lowest: 'Most critical', less: 'Show less', oneReply: '1 reply', noMatch: 'No reviews match these filters.', clear: 'Clear filters', filters: 'Filter', hotel: 'Hotel L’Ancora' },
  pl: { sort: 'Sortuj', newest: 'Najnowsze', best: 'Najlepsze', lowest: 'Najbardziej krytyczne', less: 'Pokaż mniej', oneReply: '1 odpowiedź', noMatch: 'Brak opinii dla tych filtrów.', clear: 'Wyczyść filtry', filters: 'Filtruj', hotel: 'Hotel L’Ancora' },
  de: { sort: 'Sortieren', newest: 'Neueste', best: 'Positivste', lowest: 'Kritischste', less: 'Weniger anzeigen', oneReply: '1 Antwort', noMatch: 'Keine Bewertungen mit diesen Filtern.', clear: 'Filter zurücksetzen', filters: 'Filtern', hotel: 'Hotel L’Ancora' },
  fr: { sort: 'Trier', newest: 'Les plus récents', best: 'Les plus positifs', lowest: 'Les plus critiques', less: 'Afficher moins', oneReply: '1 réponse', noMatch: 'Aucun avis avec ces filtres.', clear: 'Effacer les filtres', filters: 'Filtrer', hotel: 'Hotel L’Ancora' },
  es: { sort: 'Ordenar', newest: 'Más recientes', best: 'Más positivas', lowest: 'Más críticas', less: 'Mostrar menos', oneReply: '1 respuesta', noMatch: 'No hay reseñas con estos filtros.', clear: 'Quitar filtros', filters: 'Filtrar', hotel: 'Hotel L’Ancora' },
};

type Rates = { singleUse: string; roomOnly: string; breakfast: string };
export const RATES_T: Record<Locale, Rates> = {
  it: { singleUse: 'Uso singola −{p}%', roomOnly: 'solo pernottamento', breakfast: 'colazione inclusa' },
  en: { singleUse: 'Single use −{p}%', roomOnly: 'room only', breakfast: 'breakfast included' },
  pl: { singleUse: 'Dla 1 osoby −{p}%', roomOnly: 'sam nocleg', breakfast: 'śniadanie w cenie' },
  de: { singleUse: 'Einzelnutzung −{p}%', roomOnly: 'nur Übernachtung', breakfast: 'Frühstück inklusive' },
  fr: { singleUse: 'Usage individuel −{p}%', roomOnly: 'nuit seule', breakfast: 'petit-déjeuner inclus' },
  es: { singleUse: 'Uso individual −{p}%', roomOnly: 'solo alojamiento', breakfast: 'desayuno incluido' },
};
