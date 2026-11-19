import type { Locale } from '@/lib/types';

/** Amenity catalogue. Rooms reference keys; labels are translated here. */
export const AMENITIES: Record<string, { icon: string; label: Record<Locale, string> }> = {
  wifi: { icon: 'Wifi', label: { it: 'Wi-Fi gratuito', en: 'Free Wi-Fi', pl: 'Bezpłatne Wi-Fi', de: 'Kostenloses WLAN', fr: 'Wi-Fi gratuit', es: 'Wi-Fi gratis' } },
  aria_condizionata: { icon: 'AirVent', label: { it: 'Aria condizionata', en: 'Air conditioning', pl: 'Klimatyzacja', de: 'Klimaanlage', fr: 'Climatisation', es: 'Aire acondicionado' } },
  tv: { icon: 'Tv', label: { it: 'TV a schermo piatto', en: 'Flat-screen TV', pl: 'Telewizor', de: 'Flachbild-TV', fr: 'TV écran plat', es: 'TV de pantalla plana' } },
  bagno_privato: { icon: 'Bath', label: { it: 'Bagno privato con doccia', en: 'Private bathroom with shower', pl: 'Łazienka z prysznicem', de: 'Eigenes Bad mit Dusche', fr: 'Salle de bain privée avec douche', es: 'Baño privado con ducha' } },
  asciugacapelli: { icon: 'Wind', label: { it: 'Asciugacapelli', en: 'Hairdryer', pl: 'Suszarka do włosów', de: 'Haartrockner', fr: 'Sèche-cheveux', es: 'Secador de pelo' } },
  cassaforte: { icon: 'LockKeyhole', label: { it: 'Cassaforte', en: 'Safe', pl: 'Sejf', de: 'Safe', fr: 'Coffre-fort', es: 'Caja fuerte' } },
  frigobar: { icon: 'Refrigerator', label: { it: 'Frigobar', en: 'Mini fridge', pl: 'Minilodówka', de: 'Minikühlschrank', fr: 'Mini-réfrigérateur', es: 'Mininevera' } },
  balcone: { icon: 'Fence', label: { it: 'Balcone', en: 'Balcony', pl: 'Balkon', de: 'Balkon', fr: 'Balcon', es: 'Balcón' } },
  patio: { icon: 'Trees', label: { it: 'Patio privato', en: 'Private patio', pl: 'Prywatne patio', de: 'Private Terrasse', fr: 'Patio privé', es: 'Patio privado' } },
  vista_mare: { icon: 'Waves', label: { it: 'Vista mare', en: 'Sea view', pl: 'Widok na morze', de: 'Meerblick', fr: 'Vue mer', es: 'Vistas al mar' } },
  scrivania: { icon: 'PenLine', label: { it: 'Scrivania', en: 'Desk', pl: 'Biurko', de: 'Schreibtisch', fr: 'Bureau', es: 'Escritorio' } },
  divano_letto: { icon: 'Sofa', label: { it: 'Divano letto', en: 'Sofa bed', pl: 'Sofa z funkcją spania', de: 'Schlafsofa', fr: 'Canapé-lit', es: 'Sofá cama' } },
  salotto: { icon: 'Armchair', label: { it: 'Zona salotto', en: 'Seating area', pl: 'Kącik wypoczynkowy', de: 'Sitzbereich', fr: 'Coin salon', es: 'Zona de estar' } },
  bollitore: { icon: 'Coffee', label: { it: 'Bollitore e tisane', en: 'Kettle and herbal teas', pl: 'Czajnik i herbaty', de: 'Wasserkocher und Tee', fr: 'Bouilloire et tisanes', es: 'Hervidor e infusiones' } },
  insonorizzata: { icon: 'VolumeX', label: { it: 'Insonorizzata', en: 'Soundproofed', pl: 'Wyciszony', de: 'Schallisoliert', fr: 'Insonorisée', es: 'Insonorizada' } },
  culla: { icon: 'Baby', label: { it: 'Culla su richiesta', en: 'Cot on request', pl: 'Łóżeczko na życzenie', de: 'Kinderbett auf Anfrage', fr: 'Lit bébé sur demande', es: 'Cuna bajo petición' } },
  accessibile: { icon: 'Accessibility', label: { it: 'Accessibile', en: 'Accessible', pl: 'Dostosowany dla niepełnosprawnych', de: 'Barrierefrei', fr: 'Accessible', es: 'Accesible' } },
};

export const AMENITY_KEYS = Object.keys(AMENITIES);

export function amenityLabel(key: string, locale: Locale): string {
  // custom amenities added by the owner arrive already translated as "custom:<label>"
  if (key.startsWith('custom:')) return key.slice(7);
  if (key.startsWith('x_')) {
    const s = key.slice(2).replace(/[-_]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return AMENITIES[key]?.label[locale] ?? key;
}
