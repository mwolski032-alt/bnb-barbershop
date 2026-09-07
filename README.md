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
npm run build:netlify
```

`build:netlify` zawsze uruchamia kontrolę TypeScript przed przygotowaniem paczki produkcyjnej.

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

Cache PWA v7 zapisuje tylko zweryfikowany dokument aplikacji z oznaczeniem
`data-bnb-app-shell`. Nie przechwytuje tras logowania, callbacków ani API i nie zapisuje
przekierowań logowania zamiast aplikacji. Usuwane są wyłącznie stare cache BNB.

Logika synchronizacji, katalogu barbera, kartoteki i kalendarza znajduje się w osobnych
hookach. Selektory i typy są wydzielone do `app/lib`. Analityka jest obliczana dopiero
wewnątrz otwartej, leniwie ładowanej zakładki. Główny ekran nadal koordynuje interfejs.

Testy obejmują wyścigi odczytów/zapisów, cache PWA, ograniczenie zapytań przy dużej
bazie testowej, ceny 0 zł, rabaty i agregaty analityki. Testy automatyczne nie zastępują
sprawdzenia na fizycznych telefonach Android/iOS.
