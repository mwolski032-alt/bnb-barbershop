# BNB Barbershop

Aplikacja rezerwacji wizyt dla klientów, barberów i właściciela salonu. Produkcja działa na Netlify, Firebase Authentication i Realtime Database, a wiadomości e-mail są wysyłane przez Resend.

## Uruchomienie

```bash
npm install
npm run dev
```

## Kontrola jakości

```bash
npm run lint
npm run typecheck
npm test
npm run verify
npm run verify:lighthouse
npm run build:netlify
```

`verify` uruchamia kontrolę TypeScript, lint, produkcyjny build oraz wszystkie testy aplikacji.
`build:netlify` korzysta z tej samej pełnej bramki, więc nieudany test zatrzymuje publikację.

Workflow `BNB Quality Gate` uruchamia się automatycznie przy każdej zmianie wysłanej do
gałęzi `main` oraz przy każdym pull requeście. Oprócz pełnej bramki sprawdza wydajność,
dostępność i stabilność układu w Lighthouse oraz prawdziwe reguły dostępu w emulatorze
Firebase. Raport Lighthouse jest zachowywany przez 7 dni tylko wtedy, gdy kontrola się nie powiedzie.

## Konfiguracja Netlify

Zmienne środowiskowe są opisane w `.env.example`. Funkcje `appointments` i `send-push` wymagają konta serwisowego Firebase:

- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_DATABASE_URL`
- `NEXT_PUBLIC_FIREBASE_API_KEY`

Powiadomienia e-mail wymagają również `RESEND_API_KEY`, `RESEND_FROM_EMAIL` oraz adresów właściwych barberów.

## Reguły Firebase

Plik `database.rules.json` ogranicza dane wizyt do właściciela i aktywnych barberów. Klient pobiera własne wizyty przez uwierzytelnioną funkcję Netlify oraz otrzymuje wyłącznie anonimowe informacje o zajętych terminach.

Po zmianie reguł należy opublikować je niezależnie od wdrożenia Netlify:

```bash
firebase deploy --only database
```

Nie publikuj aplikacji produkcyjnej z testowymi lub otwartymi regułami Realtime Database.

## Kopie danych i historia działań

Każda operacja zmieniająca wizytę zapisuje w `appointmentAudit/{operationId}` prywatny,
nieusuwalny przez aplikację kliencką stan wizyty przed i po zmianie, rodzaj działania,
czas oraz rolę osoby wykonującej operację. Zapis historii jest częścią tego samego
atomowego zatwierdzenia co wizyta, dlatego nie może powstać zmiana bez odpowiadającego
jej śladu. Dane kontaktowe pozostają w chronionym zapisie odzyskiwania i nie są wysyłane
do interfejsu historii.

`backup-worker` raz dziennie tworzy kopię wizyt, kartoteki klientów, listy rezerwowej,
zespołu, usług, dostępności i ustawień salonu. Przechowywanych jest 14 ostatnich kopii,
każda z sumą kontrolną integralności. Właściciel widzi status w zakładce „Historia”
i może utworzyć dzisiejszą kopię ręcznie. `appointmentAudit`, `businessBackups` oraz
`businessBackupIndex` nie są dostępne bezpośrednio dla klientów ani barberów.

## Zatwierdzane scalanie klientów

Zgodny telefon lub ręcznie wpisany e-mail nie przenosi automatycznie historii na konto Google.
W kartotece zgodne telefony oznaczane są jako „Możliwe scalenie”. W karcie klienta można
wybrać ręczną kartę źródłową i zalogowane konto docelowe, sprawdzić podgląd oraz potwierdzić
tożsamość klienta. Zmiana danych po podglądzie wymaga jego ponownego pobrania.

Scalanie wymaga uprawnień do klientów i terminarza. Barber obsługuje własne karty;
ręczne karty współdzielone przez kilku barberów może scalać właściciel. Nie można
scalać dwóch różnych kont logowania. Ceny, terminy i rozliczenia pozostają bez zmian.

Kopia źródłowej karty, poprzedniej karty docelowej i przenoszonych rekordów jest zapisywana
w chronionym `appointmentOperations/{operationId}/clientMergeAudit` wraz z osobą zatwierdzającą.
Nie jest udostępniana klientom. Cofnięcie wymaga kontrolowanej operacji administracyjnej;
aplikacja nie ma przycisku automatycznego cofania scalenia.

Wizyty zapisuje wyłącznie uwierzytelnione API serwerowe. Przy wdrożeniu tej zmiany trzeba
opublikować również `database.rules.json`, aby zamknąć dawną możliwość bezpośredniego
zapisu wizyty z przeglądarki z pominięciem zatwierdzenia.

## Rezerwacje i ceny: ochrona opóźnionych zapisów

Zapisy wizyt, klientów, listy rezerwowej, operacji i sygnałów realtime korzystają z krótkich
blokad opisanych poniżej. Każdy końcowy zapis wykonuje atomowy PATCH z ograniczonymi uprawnieniami
serwera (`auth_variable_override`). Reguły Firebase sprawdzają właściciela blokady i jej
ważność **w chwili zatwierdzania całego zapisu**. Stary proces nie zapisze zmian po
wygaśnięciu blokady lub przejęciu jej przez inny proces, nawet gdy żądanie HTTP już wysłano.
Blokada jest odnawiana warunkowo przed zapisem; nie ma awaryjnego zapisu omijającego reguły.
Przerwany proces nie blokuje terminarza bezterminowo. Błąd `write_lease_expired` (409)
wymaga odświeżenia i ponowienia operacji. Identyfikator operacji chroni ponowienie po
utracie odpowiedzi przed powieleniem wizyty i zadania powiadomienia.

Reguły dają temu wewnętrznemu zapisowi dostęp tylko do sześciu kolekcji związanych
z rezerwacjami, nie do kont zespołu, tokenów urządzeń ani samych blokad.
Przy wdrażaniu **najpierw opublikuj reguły Firebase, potem funkcje Netlify**.
Nie cofaj reguł do wersji bez obsługi ograniczonego zapisu przy działającej nowej aplikacji.
Wdrożenie nie migruje istniejących danych; zapis nie pobiera ani nie nadpisuje całego korzenia bazy.

Przesuwanie wizyty przez klienta lub barbera zachowuje jej uzgodnioną cenę (w tym 0 zł),
pierwotną cenę i informację o rabacie. Zmiana cennika nie zmienia ceny istniejącej wizyty.
Nowe rezerwacje nadal otrzymują cenę z serwera, a nie z danych przesłanych przez klienta.

Testy opóźnień i wyścigów: `node --test tests/reservation-safety.test.mjs`.
Testy faktycznych reguł i transportu REST w lokalnym emulatorze: `npm run test:rules`
(Java 21 lub nowsza; projekt demonstracyjny, bez danych produkcyjnych).

## Synchronizacja, PWA i ograniczenie kosztu odczytów

Odpowiedź terminarza zawiera osobne rewizje użytkownika i barbera oraz identyfikatory
zakresu. Zmiana barbera lub konta unieważnia wcześniejsze odpowiedzi, także przy
przełączeniu A → B → A. Odświeżenia tego samego zakresu są łączone, a zmiana otrzymana
w trakcie pobierania powoduje dodatkowy odczyt. Katalog i dostępność muszą pochodzić
od bieżącego barbera przed udostępnieniem godzin rezerwacji.

Odczyt terminarza nie zapisuje danych ani nie próbuje łączyć kont. Powtarzające się
zapytania w jednym żądaniu są współdzielone. Typowe operacje pobierają terminarz danego
barbera i potrzebną historię klienta zamiast wszystkich wizyt, operacji i powiadomień.
Scalanie i usuwanie klientów nadal wymagają szerszego wglądu dla zachowania historii.

Edycja, przesunięcie, potwierdzenie i rozliczenie wizyty używają blokady barbera.
Tworzenie, anulowanie oraz operacje zmieniające wspólne kartoteki zachowują blokadę
globalną. Każde jej przejęcie zwiększa trwały `epoch`, co unieważnia wcześniejsze
obliczenia wykonywane pod blokadą barbera. Reguły sprawdzają również unikalność operacji.
Sygnały realtime korzystają z atomowego przyrostu, więc równoległe zapisy nie gubią zmian.
Przy współistnieniu starszego wdrożenia brak epoki bezpiecznie wymusza blokadę globalną.

Cache PWA v17 zapisuje tylko zweryfikowany dokument aplikacji z oznaczeniem
`data-bnb-app-shell`. Nie przechwytuje tras logowania, callbacków ani API i nie zapisuje
przekierowań logowania zamiast aplikacji. Usuwane są wyłącznie stare cache BNB.

Logika synchronizacji, katalogu barbera, kartoteki i kalendarza znajduje się w osobnych
hookach. Selektory i typy są wydzielone do `app/lib`. Analityka jest obliczana dopiero
wewnątrz otwartej, leniwie ładowanej zakładki. Główny ekran nadal koordynuje interfejs.

Testy obejmują wyścigi odczytów/zapisów, cache PWA, ograniczenie zapytań przy dużej
bazie testowej, ceny 0 zł, rabaty i agregaty analityki. Testy automatyczne nie zastępują
sprawdzenia na fizycznych telefonach Android/iOS.

## Szybsze potwierdzanie akcji

Nowy klient wysyła `responseMode: "minimal"`. Udana mutacja zwraca wynik zapisu i zadania
powiadomień bez ponownego pobierania całego zestawu danych ekranu. `refreshRequired`
uruchamia odświeżenie w tle; jego błąd nie zamienia już zatwierdzonego zapisu w błąd akcji.
Starsze PWA nadal dostają pełną odpowiedź. Błędy mutacji zachowują dotychczasową obsługę.
W teście odwołania pominięto 8 odczytów danych przed potwierdzeniem; nie oznacza to
stałego czasu odpowiedzi na urządzeniu ani pominięcia późniejszej synchronizacji.

Niezależne odczyty w obrębie blokady są równoległe. Przed zapisem nadal sprawdzany jest
jej właściciel i termin ważności; odnowienie jest potrzebne tylko przy mniej niż 5 s
pozostałego czasu. Reguły sprawdzają całą operację atomowo również w momencie zapisu.
Pierwsze sygnały realtime nie wywołują dodatkowego odczytu, jeśli pobrany właśnie
terminarz już obejmuje ich rewizję. Nowszy sygnał nadal wymusza aktualizację.

Odpowiedzi API mają nagłówek `Server-Timing` z czasami auth, credentials, permissions
i total, bez tokenów lub danych klientów. Pozwala on oddzielić czas serwera od sieci
i renderowania podczas kolejnych pomiarów na telefonie.

## Monitoring błędów na telefonach

Globalny monitor zapisuje błędy JavaScript i React, odrzucone operacje w tle, problemy
z ładowaniem zasobów oraz odpowiedzi API 5xx. Raport zawiera ekran, wersję wdrożenia,
system, przeglądarkę, rozmiar ekranu, tryb PWA i rodzaj połączenia. Nie wysyła identyfikatora
konta, nazwiska, telefonu, e-maila ani wartości pól formularzy. Wiadomości i stosy błędów
są dodatkowo czyszczone po stronie telefonu i serwera.

Brak sieci nie blokuje aplikacji: maksymalnie 20 raportów czeka lokalnie i jest wysyłanych
po odzyskaniu połączenia. Powtarzające się błędy są grupowane według wersji aplikacji,
a endpoint ma limit żądań na adres IP oraz drugi limit urządzenia. Dane nie są dostępne
bezpośrednio przez reguły Firebase. Tylko aktywny właściciel może je odczytać i oznaczyć
jako rozwiązane w zakładce `Panel właściciela → Błędy`.
