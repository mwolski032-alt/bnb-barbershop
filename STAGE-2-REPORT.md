# Etap 2 — kreator rezerwacji

Wykonano lokalnie, bez publikacji etapu 2 na Netlify.

## Zmiany

- „Umów wizytę” otwiera sześć osobnych ekranów: barber, usługa, dzień, godzina, dane, podsumowanie. Osoba niezalogowana przechodzi najpierw przez dotychczasowe logowanie Google.
- Pasek sześciu segmentów, cofanie przyciskiem i przez historię przeglądarki, zamknięcie do strony salonu. Cofnięcie zachowuje wybory; zmiana barbera/usługi resetuje zależny wybór godziny zgodnie z istniejącą logiką.
- Papierowo-zielone karty, kalendarz, godziny, podsumowanie z ceną. Wspólne tokeny kolorów i typografii, focus, reduced motion, safe area, formularz dostępny przy zmniejszonej wysokości ekranu.
- Walidacja danych, informacja offline, blokada podwójnego wysłania, stan zapisu, błąd i ponowienie. Dane osobowe pozostają w pamięci bieżącego widoku, nie trafiają do URL ani historii. Przeładowanie całej strony nie odtwarza formularza; chwilowa utrata sieci go nie kasuje.
- Wybranej godziny nie kasujemy w trakcie optymistycznego zapisu ani wczytywania danych. Kreator nie wybiera automatycznie innego dnia, gdy pierwotny termin przestaje być dostępny. Potwierdzenie wymaga aktualnie dostępnej godziny.
- Ponowienie pobierania obejmuje również usługi i godziny pracy; dodano widoczny komunikat błędu ich pobierania.
- Nowy interfejs wywołuje istniejące `confirmBooking` / `create_client`. Nie zmieniono API, backendu, reguł bazy, ochrony przed konfliktem ani wysyłki powiadomień w ramach tego etapu.
- Istniejący panel „Moje wizyty”, przesuwanie, odwoływanie i lista rezerwowa pozostają dostępne. Nie usuwano starego interfejsu używanego do tych czynności.

## Weryfikacja

- Typecheck: poprawny.
- Lint: poprawny.
- Produkcyjny build: poprawny eksport statyczny. Istniejące narzędzie Vinext/Node na Windows zgłasza podczas zamykania procesu znaną asercję, którą istniejący skrypt rozpoznaje po ukończonym eksporcie; końcowy kod wyjścia 0.
- Testy automatyczne: 213/213, w tym konflikty rezerwacji, idempotencja i powiadomienia.
- Reguły Firebase w emulatorze: 14/14. Komunikaty permission_denied w tych testach są oczekiwanymi odmowami niedozwolonych operacji.
- Interaktywny test rzeczywistego komponentu z danymi w pamięci: 320, 360, 390, 768 i 1440 px. Wszystkie sześć kroków, cofanie przez wszystkie kroki, historia przeglądarki, zachowanie formularza, skrócony widok 480 px, offline, błąd zapisu i ponowienie, dwa jednoczesne kliknięcia, zamknięcie i ponowne otwarcie — poprawne. Brak poziomego przepełnienia oraz błędów/ostrzeżeń konsoli w tym podglądzie.
- Rzeczywisty lokalny build: strona salonu → logowanie → strona salonu sprawdzone na 360 i 1440 px, bez błędów JavaScript.
- Nie utworzono prawdziwych wizyt i nie wykonano logowania na prywatne konto. Pełny przebieg zapisu UI testowano w izolacji; backend w istniejących testach. Nie jest to test end-to-end zalogowanego konta na produkcji.
- Fizyczne Android/iOS, sprzętowy przycisk Wstecz, rzeczywista klawiatura, Google redirect i obszary systemowe zainstalowanej PWA wymagają jeszcze potwierdzenia na urządzeniach. Test historii przeglądarki nie zastępuje takiego testu telefonu.

## Pliki etapu 2

- `app/components/booking-wizard.tsx` — nowy komponent.
- `app/booking-wizard.css` — nowy arkusz.
- `app/booking-home.tsx` — integracja z istniejącym stanem i operacjami.
- `app/layout.tsx` — globalny import stylów kreatora.
- `app/hooks/use-barber-catalog.ts` — ponowienie subskrypcji i komunikat błędu godzin pracy.
- `tests/visual/booking-wizard-preview.tsx` — izolowane dane i testowy zapis.
- `tests/visual/booking-wizard-qa.mjs` — powtarzalny test przeglądarkowy.
- `tests/visual/salon-preview.mjs` — trasa `/wizard` dla podglądu QA.
- `STAGE-2-REPORT.md` — raport.

Pozostałe niezatwierdzone pliki w repozytorium pochodzą z etapu 1 i zostały zachowane.

Lokalna aplikacja: http://localhost:8890/
Izolowany podgląd kreatora: http://127.0.0.1:4188/wizard
Podgląd izolowany nie rezerwuje prawdziwych terminów; pierwszy zapis celowo zwraca błąd do sprawdzenia ponowienia.
