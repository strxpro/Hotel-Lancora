import type { Locale } from '../types';

/** Room page: the calendar with the price under each day. */
export const PRICE_T: Record<Locale, { title: string; hint: string; bookThis: string }> = {
  it: { title: 'Le tue date', hint: 'Sotto ogni giorno vedi il prezzo per notte.', bookThis: 'Prenota questa camera' },
  en: { title: 'Your dates', hint: 'Under each day you see the price per night.', bookThis: 'Book this room' },
  pl: { title: 'Twoje daty', hint: 'Pod każdym dniem widzisz cenę za noc.', bookThis: 'Zarezerwuj ten pokój' },
  de: { title: 'Ihre Reisedaten', hint: 'Unter jedem Tag sehen Sie den Preis pro Nacht.', bookThis: 'Dieses Zimmer buchen' },
  fr: { title: 'Vos dates', hint: 'Sous chaque jour, le prix par nuit.', bookThis: 'Réserver cette chambre' },
  es: { title: 'Tus fechas', hint: 'Debajo de cada día ves el precio por noche.', bookThis: 'Reservar esta habitación' },
};
