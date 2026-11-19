/**
 * Demo media registry. Every image used by the public site sections is listed here so the
 * owner's real photos can replace them in one place (room photos are managed in the admin).
 * Location photos: Wikimedia Commons (licences below, attribution required).
 * Interior photos: Unsplash (Unsplash License) — generic stock, NOT the real Hotel L'Ancora.
 */
export interface MediaItem {
  src: string;
  width: number;
  height: number;
  alt: string;
  credit: string;
  license: string;
  sourceUrl: string;
  demo: boolean;
}

const wm = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

export const MEDIA = {
  hero: { src: '/media/demo/hero-capo-testa.jpg', width: 2600, height: 1463, alt: 'Acqua turchese e graniti sulla costa di Capo Testa, Santa Teresa Gallura', credit: 'Rosalena.disalvo', license: 'CC BY-SA 4.0', sourceUrl: wm('Valle_della_Luna_in_Gallura,_Sardegna.jpg'), demo: true },
  torreTramonto: { src: '/media/demo/torre-longonsardo-tramonto.jpg', width: 1900, height: 1267, alt: 'Torre di Longonsardo al tramonto', credit: 'Antonio Menchi', license: 'Pubblico dominio', sourceUrl: wm('Torre_di_Longonsardo.jpg'), demo: true },
  renaBianca: { src: '/media/demo/rena-bianca.jpg', width: 1900, height: 1425, alt: 'Spiaggia di Rena Bianca a Santa Teresa Gallura', credit: 'Or kriminal', license: 'CC BY-SA 3.0', sourceUrl: wm('Rena_Bianca_Beach,_Santa_Teresa_Gallura.jpg'), demo: true },
  capoTestaCala: { src: '/media/demo/capo-testa-cala.jpg', width: 1900, height: 1267, alt: 'Cala tra i graniti di Capo Testa', credit: 'Gianni Careddu', license: 'CC BY-SA 3.0', sourceUrl: wm('Santa_Teresa_Gallura_-_Capo_Testa_(04).JPG'), demo: true },
  capoTestaFaro: { src: '/media/demo/capo-testa-faro.jpg', width: 1900, height: 1262, alt: 'Il faro di Capo Testa tra le rocce', credit: 'Isiwal', license: 'CC BY-SA 3.0', sourceUrl: wm('Sardinien_Capo_Testa_lighthouse_2010.jpg'), demo: true },
  capoTestaGraniti: { src: '/media/demo/capo-testa-graniti.jpg', width: 1900, height: 1425, alt: 'Graniti modellati dal vento a Capo Testa', credit: 'Photo2023', license: 'CC BY 4.0', sourceUrl: wm('Rocce_Capo_Testa.jpg'), demo: true },
  valleDellaLuna: { src: '/media/demo/valle-della-luna.jpg', width: 1900, height: 1425, alt: 'Sentiero della Valle della Luna verso il mare', credit: 'Gianf84', license: 'Pubblico dominio', sourceUrl: wm('Valle_della_Luna_santa_teresa_gallura.JPG'), demo: true },
  paese: { src: '/media/demo/santa-teresa-paese.jpg', width: 1900, height: 927, alt: 'Panorama di Santa Teresa Gallura e del porto', credit: 'Gianni Careddu', license: 'CC BY-SA 3.0', sourceUrl: wm('Santa_Teresa_Gallura_-_Panorama_(01).JPG'), demo: true },
  torre: { src: '/media/demo/torre-longonsardo.jpg', width: 1900, height: 1431, alt: 'La Torre di Longonsardo sul promontorio', credit: 'Basilicofresco', license: 'CC BY-SA 4.0', sourceUrl: wm('Torre_di_Longonsardo,_Santa_Teresa_di_Gallura.jpg'), demo: true },
  bonifacio: { src: '/media/demo/bonifacio-falesie.jpg', width: 1900, height: 1425, alt: 'Le falesie calcaree di Bonifacio, in Corsica', credit: 'Pierre Bona', license: 'CC BY 3.0', sourceUrl: wm('Bonifacio_les_falaises.jpg'), demo: true },
  paeseMare: { src: '/media/demo/santa-teresa-mare.jpg', width: 1900, height: 1030, alt: 'Santa Teresa Gallura vista dal mare', credit: 'Pierre Bona', license: 'CC BY-SA 4.0', sourceUrl: wm('Santa_Teresa_Gallura_panorama.jpg'), demo: true },
  vistaMare: { src: '/media/demo/detail-vista-mare.jpg', width: 1800, height: 1200, alt: 'Finestra aperta sul mare con tende leggere', credit: 'Unsplash', license: 'Unsplash License', sourceUrl: 'https://unsplash.com/license', demo: true },
  mattino: { src: '/media/demo/detail-mattino.jpg', width: 1600, height: 1066, alt: 'Due cappuccini al mattino', credit: 'Unsplash', license: 'Unsplash License', sourceUrl: 'https://unsplash.com/license', demo: true },
  casaBianca: { src: '/media/demo/detail-casa-bianca.jpg', width: 1800, height: 1800, alt: 'Architettura mediterranea bianca', credit: 'Unsplash', license: 'Unsplash License', sourceUrl: 'https://unsplash.com/license', demo: true },
  mareProfondo: { src: '/media/demo/detail-mare-profondo.jpg', width: 1800, height: 1350, alt: 'Luce nel mare profondo', credit: 'Unsplash', license: 'Unsplash License', sourceUrl: 'https://unsplash.com/license', demo: true },
} satisfies Record<string, MediaItem>;

export const MEDIA_CREDITS: MediaItem[] = Object.values(MEDIA);
