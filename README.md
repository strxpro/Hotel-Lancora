# Hotel L’Ancora — strona, rezerwacje, panel i asystent (demo pakietu PREMIUM)

Kompletny, działający projekt demonstracyjny dla Hotel L’Ancora w Santa Teresa Gallura (Sardynia):
publiczna strona w 6 językach z rezerwacją, panel właściciela z cyfrowym „arkuszem X”, asystent
(panel + Telegram), chatbot na stronie, e-maile, płatności (Stripe test / uczciwa symulacja) i
architektura pod channel managera.

> Wszystkie dane, zdjęcia wnętrz i opinie są **demonstracyjne**. Adres, telefon, e-mail, godziny
> i usługi hotelu są oznaczone jako „do potwierdzenia” i edytowalne w panelu.

---

## 1. Szybki start (Windows / macOS / Linux, Node 22+)

```bash
npm install
npm run dev
```

- Strona: http://localhost:3000 (IT bez prefiksu, pozostałe języki: `/en`, `/pl`, `/de`, `/fr`, `/es`)
- Panel: http://localhost:3000/admin/login → w trybie demo przyciski **Proprietario** (admin) i **Reception** (staff)
- Dane logowania kont demo: patrz `.env.example` (`DEMO_ADMIN_*`, `DEMO_STAFF_*`). Zmień je przed jakimkolwiek wdrożeniem.
- `.env.local` z losowym `SESSION_SECRET` został wygenerowany automatycznie. Pozostałe zmienne opisuje `.env.example`.

Inne polecenia:

| Polecenie | Opis |
|---|---|
| `npm run build && npm start` | wersja produkcyjna |
| `npm test` | testy jednostkowe (logika nocy, konflikty, ceny, daty po włosku, integralność danych demo) |
| `npm run typecheck` | TypeScript |
| `npm run db:reset` | usuwa bazę demo — przy następnym żądaniu powstaje nowa, **względem dzisiejszej daty** |
| `npm run telegram:poll` | lokalny Telegram bez publicznego HTTPS (long polling → lokalny webhook) |

Dane demo (JSON + przesłane zdjęcia) są w `data/` (poza repozytorium). W panelu: *Impostazioni → Ripristina dati demo*.

---

## 2. Ścieżka prezentacji dla właściciela (≈10 minut)

1. **Strona główna** — preloader (tylko 1. wizyta), hero z fotografią Capo Testa.
2. **Przewiń** — wyszukiwarka „magnetycznie” zjeżdża z centrum do dolnej krawędzi i zostaje tam (w wersji kompaktowej) przez całą stronę; parkuje tuż nad stopką. Na stronie `/camere` wyszukiwarka przykleja się pod nagłówkiem.
3. **Arrivo / Partenza** — własny kalendarz (2 miesiące, podgląd zakresu na hover, liczba nocy, blokada przeszłości), **Ospiti** (dorośli/dzieci + wiek).
4. **Cerca disponibilità** — morph przycisku, płynny scroll, licznik wyników, wszystkie dostępne pokoje w boksach (siatka 3/2/1 kolumny) z szybkimi filtrami: Per due, Famiglie, Vista mare, Piano terra (tylko pokoje wolne przez cały pobyt i o wystarczającej pojemności; brak wyników → propozycje sąsiednich terminów). Bez wyszukiwania strona główna pokazuje wszystkie pokoje.
5. **Scopri la camera** — przejście zdjęcia z karty do strony pokoju, galeria + pełnoekranowy lightbox (klawiatura, swipe), kalendarz z zajętymi nocami tego pokoju.
6. **Prenota ora** — Ricerca → Camera → Dati ospite → Pagamento (**SIMULAZIONE** bez Stripe, Stripe test z kluczami) → Conferma + strefa gościa.
7. **Panel** → *Oggi*: liczby dnia, przyjazdy, ostatnie rezerwacje, pasek obłożenia, zadania, szybka zmiana ceny.
8. **Prenotazioni** — nowa rezerwacja jest na liście (źródło „Sito web”).
9. **Planning camere** — X w odpowiednich nocach; dzień wyjazdu wolny. Przełącznik **Planning | Calendario** (miesiąc / tydzień / lista).
10. **Camere → + Aggiungi camera** — kreator 6 kroków (Piano terra (0) / Piano superiore, drag & drop zdjęć, „Migliora con AI”, języki, publikacja).
11. **Prezzi** albo asystent: „Cambia il prezzo della camera 101 a 85 euro” → **Conferma**.
12. Odśwież stronę publiczną (otwarta w drugim oknie odświeża się sama co kilka sekund) — nowy pokój i nowa cena są widoczne.
13. **Assistente** — pytania tekstem lub głosem; zmiany zawsze z potwierdzeniem.
14. **Automazioni** — Telegram (kod połączenia, przełączniki powiadomień, podgląd), **SIMULAZIONE** rezerwacji z Booking.com → przypisanie pokoju → X w planningu.
15. **Statistiche** — okresy, przychody/obłożenie, źródła, najpopularniejsze pokoje, pytanie głosowe.

---

## 3. Architektura

| Warstwa | Technologia |
|---|---|
| Front | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4 |
| Animacje | GSAP 3 (ScrollTrigger, SplitText, timeline), Lenis (smooth scroll, wyłączony przy `prefers-reduced-motion`), Motion (komponenty) |
| Ikony / typografia | lucide-react · Instrument Serif + Manrope (next/font) |
| Backend | Server Actions + Route Handlers, walidacja Zod |
| Dane (demo) | `src/server/db/store.ts` — dokument JSON z atomowym zapisem (tmp + rename), synchroniczny read-modify-write = brak podwójnych rezerwacji w jednym procesie |
| Dane (produkcja) | Ten sam dokument + tabele Supabase z `supabase/hotel-tables.sql` (jeden plik do edytora SQL): 27 tabel, RLS, `EXCLUDE USING gist` na `daterange` (podwójna rezerwacja niemożliwa na poziomie bazy). Po każdym zapisie dane trafiają do tabel, a przy starcie strona wczytuje się z nich, gdy są nowsze (`src/server/db/tables-sync.ts`, opis w `JAK-PODLACZYC.md` §7) |
| Mapy | Leaflet + OpenStreetMap/CARTO, ładowane dopiero po zgodzie |

```
src/
  app/[locale]/…          strona publiczna (IT domyślnie, routing przez src/proxy.ts)
  app/admin/(panel)/…     panel (15 sekcji) · app/admin/login
  app/admin/actions/…     Server Actions panelu (kontrola uprawnień po stronie serwera)
  app/api/…               availability, quote, chat, version, media, upload, stripe/webhook, telegram/webhook, transcribe
  components/site|admin   komponenty UI (własne, bez bibliotek UI)
  lib/                    logika współdzielona: daty, dostępność/ceny, i18n (6 słowników), typy
  server/                 baza, auth, rezerwacje, pokoje, statystyki, e-maile, AI, asystent, Telegram, kanały
  content/                lokalizacje, udogodnienia, rejestr zdjęć z licencjami
supabase/hotel-tables.sql schemat bazy (stare supabase/migrations/ są nieaktualne, nie uruchamiać)
scripts/                  reset bazy demo, Telegram polling
tests/                    testy jednostkowe
```

**Logika noclegowa** (`src/lib/availability.ts`): noc przyjazdu zajęta, dzień wyjazdu wolny; anulowane rezerwacje i wygasłe blokady płatności zwalniają pokój; rezerwacje OTA „da assegnare” zużywają pulę pokoi, żeby strona nie sprzedała hotelu ponad stan.

**Zamiana zdjęć demo**: zdjęcia pokoi — w panelu (kreator, krok 3). Zdjęcia sekcji strony — `src/content/media.ts` (jedno miejsce, z autorem i licencją; lista kredytów generuje się na stronie Privacy). Zdjęcia okolicy pochodzą z Wikimedia Commons (CC BY / CC BY-SA / domena publiczna), wnętrza z Unsplash (nie przedstawiają L’Ancora).

---

## 4. Podłączenie prawdziwych integracji

Najprostsze integracje (AI Groq, e-mail Brevo/Gmail, tłumaczenia, Telegram) właściciel podłącza sam w **Impostazioni → Collegamenti**: karty z instrukcją krok po kroku i przyciskami *Collega / Scollega*. Klucze są sprawdzane i zapisywane tylko na serwerze (`data/integrations.json`), panel pokazuje jedynie końcówkę „…abcd”. Zmienne w `.env.local` mają pierwszeństwo.

Wszystkie klucze trafiają wyłącznie do `.env.local` (lub `data/integrations.json`) na serwerze — nigdy do przeglądarki (wyjątek: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, który z definicji jest publiczny). Po zmianie `.env.local` serwer deweloperski przeładowuje się sam.

### 4.1 AI za darmo — krok po kroku

AI jest opcjonalne: bez niego wszystko działa (asystent rozumie najczęstsze polecenia po włosku na regułach, „Aiutami con AI” w kreatorze pokoju wypełnia pola z danych, opisy powstają w trybie „Composizione guidata”). Z AI asystent rozumie swobodne zdania, a opisy są ładniejsze.

| Opcja | Koszt | Jak podłączyć (w `.env.local`) |
|---|---|---|
| **Ollama** (na własnym komputerze/serwerze) | 0 zł, bez limitów, dane nie wychodzą | Zainstaluj ze strony ollama.com → w terminalu `ollama pull llama3.1:8b` → `AI_PROVIDER=ollama`. Wymaga ok. 8 GB RAM. |
| **Groq** (chmura) — **polecane** | darmowy plan z limitami | console.groq.com → *API Keys* → *Create API Key* (zaczyna się od `gsk_`) → wklej w **Impostazioni → Collegamenti → AI gratuita → Collega** albo `GROQ_API_KEY=` w `.env.local`. Jeden klucz = czat (Llama 3.3 70B), e-maile, tłumaczenia **i głosówki** (Whisper, każdy język). |
| **Google Gemini** (chmura) | darmowy plan z limitami | Klucz w Google AI Studio → `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `OPENAI_API_KEY=…`, `OPENAI_MODEL=` (model z listy). |
| **OpenRouter** (chmura) | modele z dopiskiem `:free` | Klucz na openrouter.ai → `AI_PROVIDER=openai`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, model kończący się na `:free`. |
| Claude API | płatne | `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`. |

Darmowe plany mają limity i mogą się zmienić — przy większym ruchu lepszy jest płatny plan lub Ollama. Liczby (dostępność, ceny, przychody) asystent i chatbot **zawsze** biorą z bazy; model tylko rozumie pytanie. Prompt nie zawiera danych gości.

### 4.2 Tłumaczenia automatyczne

Właściciel pisze opis pokoju tylko po włosku. Przy zapisie pokoju tekst jest automatycznie tłumaczony na EN/PL/DE/FR/ES i publikowany (ręcznie poprawione wersje nie są nadpisywane).
- Bez AI: `TRANSLATION_PROVIDER=mymemory` (darmowe, bez klucza; ok. 5 000 znaków dziennie, ok. 50 000 po dodaniu `MYMEMORY_EMAIL`). **W tej instalacji jest już włączone.**
- Z AI (4.1) tłumaczy model — lepsza jakość.
- Bez żadnego dostawcy strona w innych językach pokazuje tekst włoski pokoju (reszta strony jest przetłumaczona na stałe).

### 4.3 Płatności: Stripe, Stripe Connect i gotówka

**Tryb testowy (demo)** — wystarczą klucze testowe z dashboard.stripe.com (*Developers → API keys*):
```
STRIPE_SECRET_KEY=sk_test_…
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
```
- Z kluczem publicznym formularz karty Stripe (Embedded Checkout) otwiera się **wewnątrz strony**; bez niego — przekierowanie na stronę Stripe. Bez kluczy — wyraźnie oznaczona SIMULAZIONE.
- Lokalnie: `stripe listen --forward-to localhost:3000/api/stripe/webhook --forward-connect-to localhost:3000/api/stripe/webhook`.
- Rezerwację potwierdza **wyłącznie zweryfikowany webhook**. Klucze `sk_live_` są odrzucane, dopóki `DEMO_MODE=false` i `ALLOW_LIVE_PAYMENTS=true`.

**Najprościej — własne konto Stripe hotelu (Impostazioni → Collegamenti → Pagamenti con carta):** właściciel zakłada darmowe konto na dashboard.stripe.com (e-mail, dane firmy, IBAN), wchodzi w *Sviluppatori → Chiavi API*, kopiuje „Chiave pubblicabile” (pk_test_…) i „Chiave segreta” (sk_test_…) i klika **Collega Stripe**. Panel sprawdza klucze w Stripe, a gdy strona działa pod adresem https, sam tworzy webhook (potwierdzanie rezerwacji). Klucze live działają dopiero po wyłączeniu trybu demo.

**„Collega Stripe” (Pagamenti)** — konto hotelu podłączane jednym kliknięciem (Stripe Connect Express):
1. Na koncie platformy (agencja/wdrożeniowiec) włącz *Connect* w dashboardzie Stripe.
2. Właściciel klika **Collega Stripe** → Stripe prowadzi go przez założenie konta, weryfikację tożsamości i IBAN (strony Stripe, po włosku).
3. Po powrocie panel pokazuje status (płatności kartą, wypłaty, dane) i przycisk **Dashboard Stripe**.
4. **Kiedy chcesz dostawać pieniądze**: codziennie / co tydzień (dzień) / co miesiąc (dzień) — zapisywane bezpośrednio w Stripe; panel pokazuje najbliższe daty przelewów.
5. Od tej chwili płatności kartą z rezerwacji trafiają na konto hotelu (destination charges). Opcjonalna prowizja platformy: `STRIPE_PLATFORM_FEE_PERCENT`.
6. Webhook musi obsługiwać też zdarzenia Connect (`account.updated`).
Bez klucza platformy przycisk „Simula collegamento” pokazuje cały proces jako SIMULAZIONE.

**Gotówka na miejscu i dwie ceny** (*Pagamenti → Condizioni*): włącz „Permetti di pagare in contanti all’arrivo” i ustaw rabat (np. 5%). Na stronie każda karta pokoju pokazuje cenę kartą i gotówką, a w kroku płatności gość wybiera „Carta online” albo „In contanti, in struttura” (rezerwacja potwierdzona od razu, do zapłaty przy check-in). We Włoszech nie wolno doliczać opłaty za płatność kartą — dlatego różnica jest zawsze **rabatem za gotówkę**, w granicach limitu płatności gotówkowych.

### 4.4 E-mail i kampanie, które naprawdę docierają

Bez SMTP wszystko trafia do *Messaggi → Demo Outbox* (z podglądem). Żeby wiadomości (potwierdzenia, przypomnienia, kampanie) docierały do gości, wystarczy darmowy SMTP:
- **Brevo** (darmowo ok. 300 maili/dzień): konto → *SMTP & API* → `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS` (klucz SMTP), `SMTP_FROM="Hotel L'Ancora <prenotazioni@twojadomena.it>"`.
- **Gmail** (małe ilości): włącz weryfikację dwuetapową → *Hasła do aplikacji* → `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=adres@gmail.com`, `SMTP_PASS=hasło-aplikacji`.
- Dla dostarczalności dodaj w DNS domeny rekordy SPF i DKIM (podaje je Brevo) oraz DMARC.

**Email ai clienti** (*Recensioni e Marketing*): właściciel pisze swoimi słowami (w dowolnym języku), AI układa gotowy e-mail; „Messaggio personalizzato” otwiera edytor z pastylkami (Nome, Cognome, Camera, Arrivo, Partenza, Codice) zamiast `{nome}`; zdjęcie z galerii, własne albo wygenerowane AI (Pollinations, za darmo, zapisywane na serwerze); styl z 8 gotowych albo „4 proposte” z opisu; odbiorcy: wszyscy / byli / przyjeżdżający / wybrani ręcznie, filtr języka, automatyczne tłumaczenie na język każdego gościa (język ze strony rezerwacji albo z kraju). Wcześniej: gotowe szablony, zdjęcie na górze, personalizacja, podgląd desktop/telefon na żywo, wysyłka próbna na swój adres. Odbiorcy to **tylko goście, którzy zaznaczyli zgodę marketingową** i się nie wypisali (odbiorcy: wszyscy / byli goście / przyjeżdżający). Każdy mail ma link „Non voglio più ricevere queste email” oraz nagłówek List-Unsubscribe (one-click, wymagany przez Gmail/Yahoo); wypisanie działa od razu (`/api/unsubscribe`). Zdjęcia w prawdziwych skrzynkach widać, gdy strona jest online (`APP_URL` publiczny).

### 4.4b Opinie o pokojach

- Każdy pokój ma średnią i opinie (gwiazdki na kartach, filtr „4★ i więcej”, sekcja opinii na stronie pokoju i na stronie głównej nad mapą).
- **Dzień po wymeldowaniu** (do ustawienia: 0–3 dni) gość, który rezerwował przez stronę, dostaje e-mail w swoim języku z linkiem `/recensione/<token>`: gwiazdki, tekst, do 3 zdjęć. Taka opinia jest „zweryfikowana” i od razu online (jeśli gość się zgodził).
- Opinie pisane na stronie bez pobytu czekają na zatwierdzenie w panelu. Każdy może odpowiedzieć na opinię (bez linków); hotel odpowiada z panelu.
- Opinie i odpowiedzi są tłumaczone automatycznie na wszystkie języki strony (AI albo darmowy MyMemory), z przyciskiem „pokaż oryginał”.
- Panel: *Camere* → gwiazdki przy pokoju otwierają wszystkie jego opinie; *Recensioni e Marketing → Recensioni*: zatwierdzanie, ukrywanie, edycja, usuwanie, usuwanie zdjęć, odpowiedzi, ustawienia automatycznej prośby i „Invia ora”.

### 4.4c Mapa i trasy

Trasy z hotelu do miejsc (pieszo do ~1,8 km, dalej samochodem, do Bonifacio z promem) liczy serwer raz przez darmowy routing OpenStreetMap (routing.openstreetmap.de) i zapisuje w `data/routes-cache.json` — przeglądarka gościa nie łączy się z zewnętrznymi serwisami. Po zmianie współrzędnych hotelu trasy przeliczą się same.

- **„Scopri Santa Teresa”**: najpierw same zdjęcia miejsc; „Mostra sulla mappa” zamienia (morph) kartę w pełną mapę z trasą, zdjęciami i przyciskiem „Portami lì” (Google Maps pieszo/autem). Kafelek „Tutti i luoghi sulla mappa” otwiera mapę wszystkich miejsc.
- **Makieta 3D („Dove siamo”)**: three.js, ładowany dopiero przy zbliżeniu do sekcji; rysuje tylko, gdy jest widoczna. Dane (≈950 budynków, ulice, plaże, linia brzegowa) są w `public/geo/santa-teresa.json` (© OpenStreetMap, ODbL). Po zmianie adresu hotelu: ustaw `CENTER` w `scripts/fetch-osm.mjs` i uruchom `node scripts/fetch-osm.mjs --refresh` (pobiera z Overpass, cache w `.cache/osm`).

### 4.5 Telegram

1. @BotFather → token → `TELEGRAM_BOT_TOKEN`; losowy `TELEGRAM_WEBHOOK_SECRET` (≥16 znaków). **W tej instalacji token jest już wpisany.**
2. Online (HTTPS w `APP_URL`): *Automazioni → Imposta webhook*. Lokalnie: `npm run telegram:poll` (przy działającym `npm run dev`).
3. *Automazioni → Genera codice*, w Telegramie wyślij do bota `/collega 123456`. Tylko połączone czaty mogą używać bota.
4. Wiadomości głosowe: działają same po podłączeniu Groq (4.1) — bot odpisuje „🎙 Ho capito: …” i wykonuje polecenie. Alternatywa bez chmury: lokalny faster-whisper → `WHISPER_URL`.
5. **Ta sama rozmowa co w panelu**: wiadomości z Telegrama widać w czacie asystenta w panelu (z ikonką Telegram) i odwrotnie; potwierdzenie można kliknąć w dowolnym miejscu.
6. Przykłady: „LA-7Q24N ha pagato 200 euro in contanti” (lub „con carta”), „camera 101 a 85 euro, 80 in contanti”, „scrivi ai clienti tedeschi che a dicembre siamo aperti”, „manda un’email a Giulia Rossi: la camera è pronta dalle 12” — asystent przygotowuje e-mail, pokazuje do kogo i w jakich językach, a wysyła dopiero po „Conferma”.

### 4.6 Pozostałe

**Booking.com / Expedia**: przez PMS/channel managera, którego hotel już używa (nazwa i API do potwierdzenia). Interfejs adaptera: `src/server/channels/adapter.ts`. Do czasu implementacji dostępny jest tylko symulator, wszędzie oznaczony jako SIMULAZIONE; status integracji nigdy nie pokazuje „collegato” bez prawdziwego połączenia.

**Supabase (produkcja)**: tabele z `supabase/hotel-tables.sql` już działają. Dokument jest do nich kopiowany po każdej zmianie, a przy starcie strona wczytuje się z nich, gdy są nowsze od kopii na komputerze (instrukcja i polecenia `npm run db:tables` / `db:shadow` / `db:start-test` w `JAK-PODLACZYC.md` §7). Na później: zapis rezerwacji i płatności najpierw do bazy (funkcja SQL, potrzebna przy kilku instancjach), bucket `room-photos`, Supabase Realtime zamiast pollingu `/api/version`, Supabase Auth zamiast własnego logowania.

---

## 5. Bezpieczeństwo (zaimplementowane)

- Logowanie: hasła scrypt, ciasteczko sesji podpisane HMAC (httpOnly, SameSite=Lax, Secure w produkcji), ochrona `/admin` w `proxy.ts` + ponowna weryfikacja w każdej akcji serwerowej.
- Role **admin / staff** z mapą uprawnień po stronie serwera (np. ceny, płatności, ustawienia, RODO tylko admin).
- Walidacja Zod wszystkich wejść, rate limiting (logowanie, rezerwacje, chat, upload, kontakt, Telegram), honeypot w formularzu kontaktowym.
- CSRF: Server Actions (kontrola Origin w Next.js) + sprawdzanie Origin w route handlerach; bezpieczne przekierowania (`safeRedirect`).
- Upload: weryfikacja typu i rozmiaru, ponowne kodowanie przez sharp (usuwa EXIF/GPS), pliki poza `public/`.
- Telegram: nagłówek `X-Telegram-Bot-Api-Secret-Token` (porównanie stałoczasowe), czaty łączone kodem jednorazowym (15 min), polecenia zmieniające dane wymagają „Conferma”. Asystent wywołuje wyłącznie zdefiniowane funkcje z walidacją argumentów — nigdy kodu ani SQL z modelu.
- Audit log ważnych zmian (*Impostazioni → Registro attività*), RODO: eksport i anonimizacja gościa, minimalna zgoda na cookies (mapa jako treść zewnętrzna).
- Publiczny chatbot nie ma dostępu do danych gości; strefa gościa wymaga niezgadywalnego tokenu.

---

## 6. Testy

### Wykonane (7 listopada 2026, Chrome headless na Windows)

| Test | Wynik |
|---|---|
| Testy jednostkowe `npm test` (12) — logika nocy, konflikty, blokady, pojemność, OTA, ceny/promocje, parser dat po włosku, brak nakładających się rezerwacji w danych demo | ✅ 12/12 |
| **A** Wyszukiwarka: tylko wolne pokoje z odpowiednią pojemnością | ✅ |
| **B** Rezerwacja ze strony (symulowana płatność) → zapis, e-mail w Outbox, pokój znika z wyszukiwania, X w planningu | ✅ |
| **C** Admin dodaje pokój ze zdjęciem, ceną i *Piano terra (0)* → widoczny na stronie bez restartu | ✅ |
| **D** Blokada pokoju na 3 noce (asystent + Conferma) → wykluczony z wyszukiwania, wolny w dniu końca | ✅ |
| **E** Zmiana ceny → nowa cena w karcie, szczegółach i wycenie rezerwacji | ✅ |
| **F** Zatwierdzone tłumaczenie EN widoczne tylko w wersji EN | ✅ |
| **G** X na noce, dzień wyjazdu wolny (planning + test jednostkowy) | ✅ |
| **H** Chatbot: dostępność z bazy, nie wymyśla usług, wykrywa język, plaże z treści; asystent liczy przychody | ✅ |
| **I** Webhook Telegram odrzuca żądania bez sekretu | ✅ (częściowo — patrz niżej) |
| **J** Cały proces na telefonie 390 px (wyszukiwarka → rezerwacja → potwierdzenie), bez poziomego scrolla | ✅ |
| Brak poziomego scrolla: 7 stron publicznych × 375/390/430/768/1280/1440/1920 px oraz 14 stron panelu na 390 px | ✅ |
| `next build` (produkcja) + `tsc` | ✅ |

### Niewykonane (wymagają kluczy / sprzętu / usług)

- Prawdziwe wysyłanie na Telegram, wiadomości głosowe (brak tokenu i serwera Whisper).
- Stripe Checkout w trybie testowym i webhook (brak kluczy testowych) — testowana była ścieżka symulowana.
- Wysyłka SMTP (brak serwera) — testowana Demo Outbox.
- Generowanie opisów i tłumaczeń przez LLM (brak skonfigurowanego providera) — testowany tryb bez AI i ręczne tłumaczenie.
- Backend Supabase (schemat przygotowany, adapter nie zaimplementowany) — od 12 listopada zrobione, patrz §4.6.
- Pomiar Lighthouse/Core Web Vitals, testy z czytnikiem ekranu, prawdziwe urządzenia iOS/Safari.

---

## 7. Założenia i ograniczenia

- Strona działa jako jeden proces Node na lokalnym dokumencie JSON, z kopią w tabelach Supabase (§4.6). Kilka instancji naraz wymagałoby zapisu rezerwacji najpierw do bazy.
- Adres hotelu nie jest zweryfikowany: mapa pokazuje przybliżoną pozycję w Santa Teresa Gallura (oznaczoną), do ustawienia w *Impostazioni*.
- Usługi (śniadanie, parking, zwierzęta itp.) mają status „Da confermare” — chatbot odsyła do recepcji, dopóki właściciel ich nie potwierdzi.
- Teksty i tłumaczenia pokoi demo napisano ręcznie; przed publikacją warto, by sprawdził je native speaker.
- „Realtime” w demo = lekki polling wersji danych co 4–5 s (w Supabase: Realtime).
- GSAP (łącznie z SplitText) jest darmowy do użytku komercyjnego od 2025 r.; kafelki CARTO mają limity darmowego użycia — dla dużego ruchu użyj własnego dostawcy kafelków.

## 8. Możliwe rozszerzenia (nie budowane teraz)

Moduł QR/PIN do samodzielnego zameldowania, skrytki na klucze, integracja zamków, płatność salda w strefie gościa, synchronizacja cen do channel managera, wiele cenników/planów taryfowych.
