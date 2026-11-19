import type { Locale } from '@/lib/types';
import { MEDIA } from './media';

export interface Experience {
  id: string;
  name: string;
  kind: Record<Locale, string>;
  distance: string;
  time: Record<Locale, string>;
  lat: number;
  lng: number;
  image: keyof typeof MEDIA;
  text: Record<Locale, string>;
  beach: boolean;
}

/**
 * Places around Santa Teresa Gallura. Names are verified place names; coordinates, distances
 * and times are approximate (from the town centre) and flagged as such in the UI.
 */
export const EXPERIENCES: Experience[] = [
  {
    id: 'rena-bianca',
    name: 'Rena Bianca',
    kind: { it: 'Spiaggia', en: 'Beach', pl: 'Plaża', de: 'Strand', fr: 'Plage', es: 'Playa' },
    distance: '≈ 0,6 km',
    time: { it: 'circa 10 min a piedi', en: 'about 10 min on foot', pl: 'ok. 10 min pieszo', de: 'ca. 10 Min. zu Fuß', fr: 'environ 10 min à pied', es: 'unos 10 min a pie' },
    lat: 41.2453, lng: 9.1897, image: 'renaBianca', beach: true,
    text: {
      it: 'La spiaggia del paese: sabbia chiara e fine, acqua che sfuma dal turchese al blu, e la Corsica all’orizzonte nelle giornate limpide.',
      en: 'The town beach: fine pale sand, water shading from turquoise to deep blue, and Corsica on the horizon on clear days.',
      pl: 'Plaża w miasteczku: drobny jasny piasek, woda od turkusu po głęboki błękit i Korsyka na horyzoncie w pogodne dni.',
      de: 'Der Strand des Ortes: feiner heller Sand, Wasser von Türkis bis Tiefblau und an klaren Tagen Korsika am Horizont.',
      fr: 'La plage du village : sable clair et fin, eau du turquoise au bleu profond, et la Corse à l’horizon par temps clair.',
      es: 'La playa del pueblo: arena clara y fina, agua del turquesa al azul intenso y Córcega en el horizonte los días despejados.',
    },
  },
  {
    id: 'torre-longonsardo',
    name: 'Torre di Longonsardo',
    kind: { it: 'Storia e panorama', en: 'History and views', pl: 'Historia i panorama', de: 'Geschichte und Aussicht', fr: 'Histoire et panorama', es: 'Historia y vistas' },
    distance: '≈ 0,8 km',
    time: { it: 'circa 12 min a piedi', en: 'about 12 min on foot', pl: 'ok. 12 min pieszo', de: 'ca. 12 Min. zu Fuß', fr: 'environ 12 min à pied', es: 'unos 12 min a pie' },
    lat: 41.2447, lng: 9.1958, image: 'torre', beach: false,
    text: {
      it: 'La torre aragonese che sorveglia le Bocche di Bonifacio. Al tramonto il promontorio diventa il punto più bello del paese.',
      en: 'The Aragonese tower watching over the Strait of Bonifacio. At sunset the headland becomes the most beautiful spot in town.',
      pl: 'Aragońska wieża strzegąca Cieśniny Bonifacio. O zachodzie słońca cypel staje się najpiękniejszym miejscem miasteczka.',
      de: 'Der aragonesische Turm über der Straße von Bonifacio. Bei Sonnenuntergang wird das Kap zum schönsten Ort des Städtchens.',
      fr: 'La tour aragonaise qui veille sur les Bouches de Bonifacio. Au coucher du soleil, le promontoire devient le plus bel endroit du village.',
      es: 'La torre aragonesa que vigila las Bocas de Bonifacio. Al atardecer, el promontorio se convierte en el rincón más bonito del pueblo.',
    },
  },
  {
    id: 'capo-testa',
    name: 'Capo Testa',
    kind: { it: 'Promontorio', en: 'Headland', pl: 'Przylądek', de: 'Landzunge', fr: 'Promontoire', es: 'Promontorio' },
    distance: '≈ 4 km',
    time: { it: 'circa 10 min in auto', en: 'about 10 min by car', pl: 'ok. 10 min samochodem', de: 'ca. 10 Min. mit dem Auto', fr: 'environ 10 min en voiture', es: 'unos 10 min en coche' },
    lat: 41.2453, lng: 9.1414, image: 'capoTestaCala', beach: true,
    text: {
      it: 'Un’isola di granito unita alla terraferma da un istmo sottile: calette, il faro e rocce scolpite dal vento in forme sorprendenti.',
      en: 'A granite island joined to the mainland by a narrow isthmus: coves, the lighthouse and rocks carved by the wind into surprising shapes.',
      pl: 'Granitowa wyspa połączona z lądem wąskim przesmykiem: zatoczki, latarnia i skały wyrzeźbione przez wiatr w zaskakujące kształty.',
      de: 'Eine Granitinsel, durch eine schmale Landenge mit dem Festland verbunden: Buchten, der Leuchtturm und vom Wind geformte Felsen.',
      fr: 'Une île de granit reliée à la terre par un isthme étroit : criques, phare et rochers sculptés par le vent en formes étonnantes.',
      es: 'Una isla de granito unida a tierra por un istmo estrecho: calas, el faro y rocas esculpidas por el viento en formas sorprendentes.',
    },
  },
  {
    id: 'valle-della-luna',
    name: 'Valle della Luna',
    kind: { it: 'Sentiero', en: 'Trail', pl: 'Szlak', de: 'Wanderweg', fr: 'Sentier', es: 'Sendero' },
    distance: '≈ 4,5 km',
    time: { it: 'auto + 20 min a piedi', en: 'car + 20 min walk', pl: 'auto + 20 min pieszo', de: 'Auto + 20 Min. zu Fuß', fr: 'voiture + 20 min à pied', es: 'coche + 20 min a pie' },
    lat: 41.2393, lng: 9.144, image: 'valleDellaLuna', beach: true,
    text: {
      it: 'Una valle di granito che scende verso il mare a Capo Testa. Scarpe comode, acqua e calma: è un luogo da attraversare lentamente.',
      en: 'A granite valley running down to the sea at Capo Testa. Comfortable shoes, water and patience: a place to cross slowly.',
      pl: 'Granitowa dolina schodząca do morza na Capo Testa. Wygodne buty, woda i spokój: to miejsce, które przemierza się powoli.',
      de: 'Ein Granittal, das bei Capo Testa zum Meer hinabführt. Bequeme Schuhe, Wasser und Ruhe: ein Ort zum langsamen Durchqueren.',
      fr: 'Une vallée de granit qui descend vers la mer à Capo Testa. Bonnes chaussures, eau et calme : un lieu à traverser lentement.',
      es: 'Un valle de granito que baja hacia el mar en Capo Testa. Calzado cómodo, agua y calma: un lugar para recorrer despacio.',
    },
  },
  {
    id: 'paese-porto',
    name: 'Santa Teresa Gallura',
    kind: { it: 'Il paese e il porto', en: 'Town and harbour', pl: 'Miasteczko i port', de: 'Ort und Hafen', fr: 'Village et port', es: 'Pueblo y puerto' },
    distance: '—',
    time: { it: 'a pochi passi', en: 'a short walk', pl: 'kilka kroków', de: 'wenige Schritte', fr: 'à quelques pas', es: 'a pocos pasos' },
    lat: 41.2394, lng: 9.1894, image: 'paese', beach: false,
    text: {
      it: 'Piazza Vittorio Emanuele, le vie a griglia e il porto nell’insenatura di Porto Longone: la vita del paese si vive a piedi.',
      en: 'Piazza Vittorio Emanuele, the grid of streets and the harbour in the Porto Longone inlet: town life is best enjoyed on foot.',
      pl: 'Piazza Vittorio Emanuele, prostopadłe uliczki i port w zatoce Porto Longone: życie miasteczka najlepiej poznać pieszo.',
      de: 'Piazza Vittorio Emanuele, das Straßenraster und der Hafen in der Bucht von Porto Longone: Das Ortsleben erlebt man zu Fuß.',
      fr: 'La Piazza Vittorio Emanuele, les rues en damier et le port dans l’anse de Porto Longone : la vie du village se vit à pied.',
      es: 'La Piazza Vittorio Emanuele, las calles en cuadrícula y el puerto en la ensenada de Porto Longone: el pueblo se vive a pie.',
    },
  },
  {
    id: 'bonifacio',
    name: 'Bonifacio (Corsica)',
    kind: { it: 'Escursione in traghetto', en: 'Ferry day trip', pl: 'Wycieczka promem', de: 'Tagesausflug per Fähre', fr: 'Excursion en ferry', es: 'Excursión en ferry' },
    distance: '≈ 16 km via mare',
    time: { it: 'traversata di circa 1 ora (verificare orari)', en: 'crossing of about 1 hour (check timetables)', pl: 'przeprawa ok. 1 godz. (sprawdź rozkład)', de: 'Überfahrt ca. 1 Std. (Fahrplan prüfen)', fr: 'traversée d’environ 1 h (vérifier les horaires)', es: 'travesía de aprox. 1 h (consultar horarios)' },
    lat: 41.3871, lng: 9.1594, image: 'bonifacio', beach: false,
    text: {
      it: 'Dal porto di Santa Teresa i traghetti attraversano le Bocche fino alla città alta di Bonifacio, sospesa sulle falesie bianche.',
      en: 'From Santa Teresa harbour, ferries cross the strait to Bonifacio’s old town, perched on white limestone cliffs.',
      pl: 'Z portu w Santa Teresa promy przepływają cieśninę do starego miasta Bonifacio, zawieszonego na białych klifach.',
      de: 'Vom Hafen in Santa Teresa fahren Fähren über die Meerenge zur Oberstadt von Bonifacio auf den weißen Kalkfelsen.',
      fr: 'Depuis le port de Santa Teresa, les ferries traversent les Bouches jusqu’à la ville haute de Bonifacio, perchée sur ses falaises blanches.',
      es: 'Desde el puerto de Santa Teresa, los ferris cruzan el estrecho hasta el casco antiguo de Bonifacio, sobre acantilados blancos.',
    },
  },
];

/** More photos per place, for the gallery on the map card (first = cover). */
export const PLACE_GALLERY: Record<string, (keyof typeof MEDIA)[]> = {
  'rena-bianca': ['renaBianca', 'paeseMare', 'mareProfondo'],
  'torre-longonsardo': ['torre', 'torreTramonto', 'mattino'],
  'capo-testa': ['capoTestaCala', 'capoTestaFaro', 'capoTestaGraniti'],
  'valle-della-luna': ['valleDellaLuna', 'capoTestaGraniti', 'mareProfondo'],
  'paese-porto': ['paese', 'casaBianca', 'paeseMare'],
  bonifacio: ['bonifacio', 'mareProfondo', 'torreTramonto'],
};
