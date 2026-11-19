import type { FloorKey, Locale, RoomText, RoomType } from '@/lib/types';

type Archetype = 'singola' | 'twin' | 'matrimoniale' | 'superior' | 'vista' | 'family' | 'suite';

/** Demo room texts per archetype, in all six languages (title = room name, set per room). */
const TEXT: Record<Archetype, Record<Locale, { short: string; description: string }>> = {
  singola: {
    it: { short: 'Una singola raccolta e luminosa, ideale per chi viaggia da solo.', description: 'Una camera essenziale e accogliente, pensata per chi viaggia da solo e cerca una base comoda a pochi passi dal centro. Letto singolo, bagno privato con doccia e una finestra che lascia entrare la luce del mattino.' },
    en: { short: 'A bright, compact single room, ideal for solo travellers.', description: 'A simple, welcoming room for solo travellers looking for a comfortable base a few steps from the town centre. Single bed, private bathroom with shower and a window that lets in the morning light.' },
    pl: { short: 'Kameralny, jasny pokój jednoosobowy dla osób podróżujących solo.', description: 'Prosty i przytulny pokój dla osób podróżujących w pojedynkę, które szukają wygodnej bazy kilka kroków od centrum. Pojedyncze łóżko, prywatna łazienka z prysznicem i okno wpuszczające poranne światło.' },
    de: { short: 'Ein helles, kompaktes Einzelzimmer für Alleinreisende.', description: 'Ein schlichtes, einladendes Zimmer für Alleinreisende, die eine bequeme Basis wenige Schritte vom Ortskern suchen. Einzelbett, eigenes Bad mit Dusche und ein Fenster, durch das das Morgenlicht fällt.' },
    fr: { short: 'Une chambre simple lumineuse et intime, idéale pour voyager seul.', description: 'Une chambre essentielle et accueillante, pensée pour ceux qui voyagent seuls et cherchent une base confortable à deux pas du centre. Lit simple, salle de bain privée avec douche et une fenêtre ouverte sur la lumière du matin.' },
    es: { short: 'Una individual luminosa y recogida, ideal para viajar solo.', description: 'Una habitación sencilla y acogedora para quien viaja solo y busca una base cómoda a pocos pasos del centro. Cama individual, baño privado con ducha y una ventana por la que entra la luz de la mañana.' },
  },
  twin: {
    it: { short: 'Due letti separati, spazio ordinato e luce naturale.', description: 'Perfetta per amici o colleghi in viaggio: due letti singoli, un piano d’appoggio e bagno privato con doccia. Toni chiari e tessuti naturali per un riposo senza pensieri.' },
    en: { short: 'Two separate beds, a tidy layout and natural light.', description: 'Perfect for friends or colleagues travelling together: two single beds, a small desk and a private bathroom with shower. Light tones and natural fabrics for carefree rest.' },
    pl: { short: 'Dwa oddzielne łóżka, uporządkowana przestrzeń i naturalne światło.', description: 'Idealny dla przyjaciół lub współpracowników: dwa pojedyncze łóżka, blat do pracy i prywatna łazienka z prysznicem. Jasne kolory i naturalne tkaniny dla beztroskiego odpoczynku.' },
    de: { short: 'Zwei getrennte Betten, klare Aufteilung und Tageslicht.', description: 'Ideal für Freunde oder Kollegen auf Reisen: zwei Einzelbetten, eine kleine Ablage und eigenes Bad mit Dusche. Helle Töne und natürliche Stoffe für sorglose Erholung.' },
    fr: { short: 'Deux lits séparés, un espace ordonné et la lumière naturelle.', description: 'Parfaite pour des amis ou collègues en voyage : deux lits simples, un plan de travail et une salle de bain privée avec douche. Tons clairs et tissus naturels pour un repos serein.' },
    es: { short: 'Dos camas separadas, espacio ordenado y luz natural.', description: 'Perfecta para amigos o compañeros de viaje: dos camas individuales, una superficie de apoyo y baño privado con ducha. Tonos claros y tejidos naturales para un descanso sin preocupaciones.' },
  },
  matrimoniale: {
    it: { short: 'Letto matrimoniale, tessuti naturali e un’atmosfera tranquilla.', description: 'Una camera matrimoniale semplice e curata, con colori che richiamano la sabbia e il mare di Gallura. Il punto di partenza ideale per giornate tra spiagge e sentieri.' },
    en: { short: 'A double bed, natural fabrics and a peaceful atmosphere.', description: 'A simple, well-kept double room in colours that recall the sand and sea of Gallura. The ideal starting point for days spent between beaches and trails.' },
    pl: { short: 'Podwójne łóżko, naturalne tkaniny i spokojna atmosfera.', description: 'Prosty, zadbany pokój dwuosobowy w kolorach przywodzących na myśl piasek i morze Gallury. Idealny punkt wyjścia na dni spędzane między plażami a szlakami.' },
    de: { short: 'Doppelbett, natürliche Stoffe und eine ruhige Atmosphäre.', description: 'Ein schlichtes, gepflegtes Doppelzimmer in Farben, die an Sand und Meer der Gallura erinnern. Der ideale Ausgangspunkt für Tage zwischen Stränden und Wanderwegen.' },
    fr: { short: 'Un lit double, des tissus naturels et une atmosphère paisible.', description: 'Une chambre double simple et soignée, aux couleurs qui rappellent le sable et la mer de Gallura. Le point de départ idéal pour des journées entre plages et sentiers.' },
    es: { short: 'Cama de matrimonio, tejidos naturales y un ambiente tranquilo.', description: 'Una habitación doble sencilla y cuidada, con colores que evocan la arena y el mar de Gallura. El punto de partida ideal para días entre playas y senderos.' },
  },
  superior: {
    it: { short: 'Più spazio, materiali naturali e un angolo per rallentare.', description: 'Al piano superiore, una matrimoniale più ampia con scrivania e angolo tè. Luce morbida durante il giorno e silenzio la sera, per chi ama prendersi il proprio tempo.' },
    en: { short: 'More space, natural materials and a corner to slow down.', description: 'On the upper floor, a larger double room with a desk and tea corner. Soft light during the day and quiet in the evening, for those who like to take their time.' },
    pl: { short: 'Więcej przestrzeni, naturalne materiały i kącik do zwolnienia tempa.', description: 'Na piętrze — większy pokój dwuosobowy z biurkiem i kącikiem herbacianym. Miękkie światło w ciągu dnia i cisza wieczorem dla tych, którzy lubią nie spieszyć się.' },
    de: { short: 'Mehr Platz, natürliche Materialien und eine Ecke zum Entschleunigen.', description: 'Im Obergeschoss ein größeres Doppelzimmer mit Schreibtisch und Teeecke. Weiches Licht am Tag und Ruhe am Abend – für alle, die sich Zeit lassen möchten.' },
    fr: { short: 'Plus d’espace, des matériaux naturels et un coin pour ralentir.', description: 'À l’étage, une chambre double plus spacieuse avec bureau et coin thé. Lumière douce le jour et silence le soir, pour ceux qui aiment prendre leur temps.' },
    es: { short: 'Más espacio, materiales naturales y un rincón para ir despacio.', description: 'En la planta superior, una doble más amplia con escritorio y rincón de té. Luz suave durante el día y silencio por la noche, para quien disfruta tomándose su tiempo.' },
  },
  vista: {
    it: { short: 'Il mare dalla finestra e un balcone per svegliarsi lentamente.', description: 'Al piano superiore, questa camera apre lo sguardo verso il mare. Letto comodo, balcone dove leggere al tramonto e bagno privato con doccia: il ritmo di Santa Teresa entra dalla finestra.' },
    en: { short: 'The sea from the window and a balcony to wake up slowly.', description: 'On the upper floor, this room opens its view towards the sea. A comfortable bed, a balcony for reading at sunset and a private bathroom with shower: the rhythm of Santa Teresa comes in through the window.' },
    pl: { short: 'Morze za oknem i balkon, by budzić się bez pośpiechu.', description: 'Na piętrze, z widokiem w stronę morza. Wygodne łóżko, balkon do czytania o zachodzie słońca i prywatna łazienka z prysznicem: rytm Santa Teresa wpada przez okno.' },
    de: { short: 'Das Meer vor dem Fenster und ein Balkon zum langsamen Aufwachen.', description: 'Im Obergeschoss öffnet sich der Blick zum Meer. Bequemes Bett, Balkon zum Lesen bei Sonnenuntergang und eigenes Bad mit Dusche: Der Rhythmus von Santa Teresa kommt durchs Fenster herein.' },
    fr: { short: 'La mer depuis la fenêtre et un balcon pour se réveiller en douceur.', description: 'À l’étage, cette chambre ouvre le regard vers la mer. Un lit confortable, un balcon pour lire au coucher du soleil et une salle de bain privée avec douche : le rythme de Santa Teresa entre par la fenêtre.' },
    es: { short: 'El mar desde la ventana y un balcón para despertar sin prisa.', description: 'En la planta superior, esta habitación abre la mirada hacia el mar. Cama cómoda, balcón para leer al atardecer y baño privado con ducha: el ritmo de Santa Teresa entra por la ventana.' },
  },
  family: {
    it: { short: 'Spazio per tutta la famiglia, a due passi dal mare.', description: 'Una camera ampia con letto matrimoniale e letti aggiuntivi, pensata per famiglie e piccoli gruppi. Tutto il necessario per muoversi con calma, dalla spiaggia al paese.' },
    en: { short: 'Room for the whole family, a short walk from the sea.', description: 'A spacious room with a double bed and extra beds, designed for families and small groups. Everything you need to move at an easy pace, from the beach to the town.' },
    pl: { short: 'Miejsce dla całej rodziny, blisko morza.', description: 'Przestronny pokój z podwójnym łóżkiem i dodatkowymi miejscami do spania, pomyślany dla rodzin i małych grup. Wszystko, czego potrzeba, by spokojnie przemieszczać się między plażą a miasteczkiem.' },
    de: { short: 'Platz für die ganze Familie, nur wenige Schritte vom Meer.', description: 'Ein geräumiges Zimmer mit Doppelbett und Zusatzbetten für Familien und kleine Gruppen. Alles, was man braucht, um entspannt zwischen Strand und Ort unterwegs zu sein.' },
    fr: { short: 'De la place pour toute la famille, à deux pas de la mer.', description: 'Une chambre spacieuse avec lit double et couchages supplémentaires, pensée pour les familles et les petits groupes. Tout le nécessaire pour vivre sans hâte, de la plage au village.' },
    es: { short: 'Espacio para toda la familia, a dos pasos del mar.', description: 'Una habitación amplia con cama de matrimonio y camas adicionales, pensada para familias y grupos pequeños. Todo lo necesario para moverse con calma, de la playa al pueblo.' },
  },
  suite: {
    it: { short: 'La camera più ampia, con zona salotto e balcone.', description: 'La nostra junior suite unisce camera matrimoniale e zona salotto con divano letto. Luce, spazio e silenzio per chi desidera concedersi qualche comodità in più durante il soggiorno.' },
    en: { short: 'Our largest room, with a seating area and balcony.', description: 'Our junior suite combines a double bedroom with a seating area and sofa bed. Light, space and quiet for those who want a little extra comfort during their stay.' },
    pl: { short: 'Nasz największy pokój, z kącikiem wypoczynkowym i balkonem.', description: 'Junior suite łączy sypialnię z podwójnym łóżkiem i część wypoczynkową z sofą rozkładaną. Światło, przestrzeń i cisza dla tych, którzy chcą odrobiny więcej komfortu.' },
    de: { short: 'Unser größtes Zimmer, mit Sitzbereich und Balkon.', description: 'Unsere Junior Suite verbindet ein Doppelzimmer mit einem Sitzbereich samt Schlafsofa. Licht, Raum und Ruhe für alle, die sich etwas mehr Komfort gönnen möchten.' },
    fr: { short: 'Notre plus grande chambre, avec coin salon et balcon.', description: 'Notre junior suite associe une chambre double et un coin salon avec canapé-lit. Lumière, espace et calme pour qui souhaite un peu plus de confort pendant le séjour.' },
    es: { short: 'Nuestra habitación más amplia, con zona de estar y balcón.', description: 'Nuestra junior suite combina dormitorio doble y zona de estar con sofá cama. Luz, espacio y silencio para quien desea un poco más de comodidad durante la estancia.' },
  },
};

const P = (file: string, width: number, height: number, alt: string) => ({ file, width, height, alt });

export interface SeedRoom {
  number: string;
  name: string;
  type: RoomType;
  archetype: Archetype;
  maxGuests: number;
  beds: string;
  bedsCount: number;
  size: number;
  floor: FloorKey;
  basePrice: number;
  amenities: string[];
  photos: { file: string; width: number; height: number; alt: string }[];
}

const base = ['wifi', 'aria_condizionata', 'tv', 'bagno_privato', 'asciugacapelli'];

export const SEED_ROOMS: SeedRoom[] = [
  { number: '101', name: 'Maestrale', type: 'singola', archetype: 'singola', maxGuests: 1, beds: '1 letto singolo', bedsCount: 1, size: 14, floor: 'terra', basePrice: 69, amenities: [...base, 'scrivania'], photos: [P('room-04', 1800, 1200, 'Camera singola luminosa'), P('detail-bagno-2', 1600, 1060, 'Bagno con lavabo sospeso'), P('detail-mattino', 1600, 1066, 'Colazione del mattino'), P('angolo-lettura', 1800, 1339, 'Angolo lettura negli spazi comuni'), P('hall-lounge', 1800, 1200, 'Hall e zona relax')] },
  { number: '102', name: 'Libeccio', type: 'doppia', archetype: 'twin', maxGuests: 2, beds: '2 letti singoli', bedsCount: 2, size: 18, floor: 'terra', basePrice: 89, amenities: [...base, 'cassaforte'], photos: [P('room-11', 1800, 1350, 'Camera con due letti singoli'), P('detail-bagno-1', 1600, 2398, 'Bagno bianco con piante'), P('detail-mattino', 1600, 1066, 'Colazione del mattino'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale'), P('hall-lounge', 1800, 1200, 'Hall e zona relax')] },
  { number: '103', name: 'Scirocco', type: 'matrimoniale', archetype: 'matrimoniale', maxGuests: 2, beds: '1 letto matrimoniale', bedsCount: 1, size: 18, floor: 'terra', basePrice: 95, amenities: [...base, 'frigobar'], photos: [P('room-12', 1800, 1200, 'Camera matrimoniale con testiera imbottita'), P('detail-bagno-2', 1600, 1060, 'Bagno'), P('detail-mattino', 1600, 1066, 'Caffè del mattino'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale'), P('angolo-lettura', 1800, 1339, 'Angolo lettura negli spazi comuni')] },
  { number: '104', name: 'Granito', type: 'matrimoniale', archetype: 'matrimoniale', maxGuests: 2, beds: '1 letto matrimoniale', bedsCount: 1, size: 20, floor: 'terra', basePrice: 105, amenities: [...base, 'patio', 'bollitore'], photos: [P('room-05', 1800, 1219, 'Camera matrimoniale con panche ai piedi del letto'), P('detail-bagno-1', 1600, 2398, 'Bagno'), P('detail-casa-bianca', 1800, 1800, 'Architettura mediterranea bianca'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale'), P('hall-lounge', 1800, 1200, 'Hall e zona relax')] },
  { number: '105', name: 'Ginepro', type: 'tripla', archetype: 'family', maxGuests: 3, beds: '1 matrimoniale + 1 singolo', bedsCount: 2, size: 24, floor: 'terra', basePrice: 125, amenities: [...base, 'cassaforte', 'culla'], photos: [P('room-03', 1800, 1350, 'Camera tripla con divanetto'), P('detail-bagno-2', 1600, 1060, 'Bagno'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale'), P('angolo-lettura', 1800, 1339, 'Angolo lettura negli spazi comuni'), P('hall-lounge', 1800, 1200, 'Hall e zona relax')] },
  { number: '106', name: 'Mirto', type: 'family', archetype: 'family', maxGuests: 4, beds: '1 matrimoniale + divano letto', bedsCount: 2, size: 28, floor: 'terra', basePrice: 149, amenities: [...base, 'divano_letto', 'culla', 'frigobar'], photos: [P('room-07', 1800, 1800, 'Camera family con piante e luce naturale'), P('detail-salotto', 1800, 1200, 'Zona salotto'), P('detail-bagno-1', 1600, 2398, 'Bagno'), P('angolo-lettura', 1800, 1339, 'Angolo lettura negli spazi comuni'), P('hall-lounge', 1800, 1200, 'Hall e zona relax')] },
  { number: '107', name: 'Rena Bianca', type: 'matrimoniale', archetype: 'vista', maxGuests: 2, beds: '1 letto matrimoniale', bedsCount: 1, size: 20, floor: 'superiore', basePrice: 135, amenities: [...base, 'balcone', 'vista_mare', 'cassaforte'], photos: [P('room-01', 1800, 1200, 'Camera matrimoniale con luce del mattino'), P('detail-vista-mare', 1800, 1200, 'Vista mare dalla finestra'), P('detail-bagno-1', 1600, 2398, 'Bagno'), P('detail-mattino', 1600, 1066, 'Caffè sul balcone'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale')] },
  { number: '108', name: 'Capo Testa', type: 'matrimoniale', archetype: 'superior', maxGuests: 2, beds: '1 letto matrimoniale king', bedsCount: 1, size: 22, floor: 'superiore', basePrice: 129, amenities: [...base, 'frigobar', 'scrivania', 'bollitore'], photos: [P('room-09', 1800, 1200, 'Camera superior chiara con boiserie'), P('detail-bagno-2', 1600, 1060, 'Bagno'), P('detail-mattino', 1600, 1066, 'Colazione del mattino'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale'), P('angolo-lettura', 1800, 1339, 'Angolo lettura negli spazi comuni')] },
  { number: '109', name: 'Corallo', type: 'matrimoniale', archetype: 'matrimoniale', maxGuests: 2, beds: '1 letto matrimoniale', bedsCount: 1, size: 18, floor: 'superiore', basePrice: 99, amenities: [...base], photos: [P('room-10', 1800, 1589, 'Camera matrimoniale con stampe alle pareti'), P('detail-bagno-1', 1600, 2398, 'Bagno'), P('detail-mattino', 1600, 1066, 'Colazione del mattino'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale'), P('hall-lounge', 1800, 1200, 'Hall e zona relax')] },
  { number: '110', name: 'Longonsardo', type: 'tripla', archetype: 'vista', maxGuests: 3, beds: '1 matrimoniale + 1 singolo', bedsCount: 2, size: 24, floor: 'superiore', basePrice: 145, amenities: [...base, 'balcone', 'vista_mare', 'cassaforte'], photos: [P('room-06', 1800, 1200, 'Camera tripla con testiera capitonné'), P('detail-vista-mare', 1800, 1200, 'Vista mare'), P('detail-bagno-2', 1600, 1060, 'Bagno'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale'), P('hall-lounge', 1800, 1200, 'Hall e zona relax')] },
  { number: '111', name: 'Bocche di Bonifacio', type: 'suite', archetype: 'suite', maxGuests: 3, beds: '1 matrimoniale + divano letto', bedsCount: 2, size: 32, floor: 'superiore', basePrice: 189, amenities: [...base, 'salotto', 'divano_letto', 'balcone', 'cassaforte', 'frigobar', 'bollitore'], photos: [P('room-13', 1800, 1800, 'Junior suite con letto imbottito'), P('detail-salotto', 1800, 1200, 'Zona salotto della suite'), P('detail-vista-mare', 1800, 1200, 'Vista dalla suite'), P('detail-bagno-1', 1600, 2398, 'Bagno'), P('suite-vista', 1800, 1200, 'Suite open space con vista'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale')] },
  { number: '112', name: 'Posidonia', type: 'matrimoniale', archetype: 'matrimoniale', maxGuests: 2, beds: '1 letto matrimoniale', bedsCount: 1, size: 17, floor: 'superiore', basePrice: 109, amenities: [...base, 'insonorizzata'], photos: [P('room-08', 1800, 3200, 'Camera con tende in lino e luce soffusa'), P('room-02', 1800, 1200, 'Camera matrimoniale con lampade calde'), P('detail-bagno-2', 1600, 1060, 'Bagno'), P('lounge-luce', 1800, 1350, 'Lounge comune con luce naturale'), P('hall-lounge', 1800, 1200, 'Hall e zona relax')] },
];

export function seedText(r: SeedRoom, locale: Locale): RoomText {
  const t = TEXT[r.archetype][locale];
  return { title: r.name, short: t.short, description: t.description };
}
