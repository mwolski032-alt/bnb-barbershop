# BNB — etap 3: audyt, weryfikacja i publikacja

## Status

Opublikowano na https://bnbbarber.netlify.app.
Wdrożenie: https://6a9fa066bf3df1ec7bd80842--bnbbarber.netlify.app.
Reguły Firebase również zostały opublikowane. Nie usuwano ani nie migrowano danych użytkowników.
Po przerwaniu limitem sprawdzono aktualne repozytorium, ponownie wykonano kontrolę produkcji, typecheck, lint i build z testami oraz dokończono test PWA offline. Nie zmieniano ponownie kodu aplikacji i nie wykonywano zbędnej powtórnej publikacji.

## Poprawki audytu

- Odświeżanie katalogu nie kasuje wybranej usługi i godziny w przejściowym stanie ładowania.
- Wstecz przy otwartej liście rezerwowej zamyka najpierw jej okno, zachowując krok kreatora.
- Formularz informacji salonu jest zablokowany do zakończenia wczytywania oraz podczas zapisu: nie nadpisze istniejących informacji pustymi polami przed ich pobraniem.
- Manifest i metadane używają jasnego papierowego koloru paska systemowego; dodano viewport-fit dla safe area.
- Nowa wersja cache PWA v11 i manifest v6. Testy nadal sprawdzają wyłączenie logowania/API z cache i ochronę przed zastąpieniem aplikacji stroną logowania.
- Zachowano działające API, logikę rezerwacji, idempotencję, powiadomienia, ceny, przesuwanie i anulowanie. Nie usuwano starego interfejsu, który nadal obsługuje zarządzanie wizytami.

## Wyniki

- Typecheck i lint: poprawne, również po wznowieniu.
- Produkcyjny build i testy: 213/213 poprawnych, również po wznowieniu. Istniejąca asercja zamykania procesu Vinext/Node na Windows występuje po ukończeniu eksportu statycznego; dotychczasowy skrypt rozpoznaje ten przypadek i kończy się kodem 0.
- Emulator Firebase: 14/14. Sprawdzono uprawnienia ról, odmowę bezpośredniego zapisu wizyt, galerię tylko dla aktywnego administratora, limit zdjęć oraz odrzucenie niedozwolonych pól.
- Pełny BookingHome + rzeczywista funkcja appointments + baza w pamięci: rezerwacja od strony salonu przez granicę logowania do potwierdzenia, przesuwanie, anulowanie i Wstecz przy liście rezerwowej na 360 i 1440 px. Oddzielnie panele barbera i administratora, w tym widoczność zarządzania galerią. Tożsamości logowania są testowe; nie jest to rzeczywisty dialog Google OAuth.
- Kreator: 320, 360, 390, 768, 1440 px; wszystkie kroki, cofanie, zachowanie danych, ograniczona wysokość widoku, offline, błąd i ponowienie zapisu, podwójne kliknięcie, zamknięcie. Brak poziomego przepełnienia i błędów/ostrzeżeń konsoli w tej serii.
- Strona salonu: profile i starszy profil bez nowych pól, Instagram, przywrócenie focus, podgląd pełnoekranowy oraz dodawanie/usuwanie/porządkowanie zdjęć i zapis informacji salonu w izolacji na 320, 390, 768, 1440 px.
- Produkcja: strona → profil → ekran logowania → strona na 360, 390, 768, 1440 px; brak błędów i ostrzeżeń konsoli. Publiczny endpoint zespołu zwraca tylko publiczne pola, prywatny terminarz odmawia anonimowego dostępu (401). Service worker gotowy, manifest jasny, sw.js wymaga rewalidacji.
- Dokończony test produkcyjnej PWA: po wcześniejszym wczytaniu i zapełnieniu cache strona salonu uruchamia się offline. Aktywny cache: bnb-barbershop-v11. Nie oznacza to możliwości rezerwowania bez internetu.
- Pomiar po wznowieniu: gotowość CTA 0,81–1,66 s, pierwszy widoczny rendering 0,22–0,72 s. Pojedyncze pomiary z przeglądarki testowej, bez sztucznego spowalniania sieci/CPU; nie są gwarancją wydajności na telefonie ani wynikiem sesji zalogowanego użytkownika.

## Ograniczenia do sprawdzenia na urządzeniach

Fizyczny Android/iPhone: instalacja i aktualizacja PWA, wygląd ikon systemowych, rzeczywista klawiatura, sprzętowy Wstecz, logowanie Google/redirect oraz odbiór push. Responsywność była testowana w Chromium, nie w rzeczywistym Safari na iOS. Nie wykonywano prawdziwych rezerwacji ani wysyłki testowych powiadomień do klientów na produkcji. Ich pełny przepływ sprawdzono w izolacji i testach backendu.

## Pliki etapu 3

Kod: app/booking-home.tsx, app/components/booking-wizard.tsx, app/components/salon-manager.tsx, app/layout.tsx, public/manifest.webmanifest, public/sw.js.

Testy zaktualizowane: tests/paper-theme.test.mjs, tests/rendered-html.test.mjs, tests/service-worker-cache.test.mjs.

Testy dodane: tests/visual/integration-preview.mjs, tests/visual/integration-qa.mjs, tests/visual/salon-qa.mjs, tests/visual/production-smoke.mjs.

Pozostałe zmiany repozytorium pochodzą z poprzednich etapów i zostały zachowane. Repozytorium nadal zawiera niezatwierdzone zmiany; publikacja została wykonana z lokalnego, przetestowanego buildu, bez tworzenia commita lub pushowania gałęzi.
