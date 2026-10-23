# BNB — strona salonu, etap 1

Punkt wyjścia: lokalny commit 937f4da, pliki zgodne z 208ad7d. Projekt: `BNB WebSite — kopia`. Bez publikacji Netlify i bez wdrożenia reguł Firebase.

## Wykonanie

- Nowa publiczna strona salonu w istniejącej palecie papier/zielona farba i z globalną typografią Sitka/Georgia.
- Okładka, główny przycisk „Umów wizytę”, zespół, profile w modalach, opcjonalna galeria i podgląd pełnoekranowy.
- Pierwsze zdjęcie administratora staje się okładką. Do czasu dodania zdjęć używana jest istniejąca grafika BNB; nie dodano fikcyjnych zdjęć salonu.
- Profile pobierane przez nowy, tylko odczytowy endpoint z kanonicznych rekordów aktywnych barberów. Publiczna odpowiedź zawiera wyłącznie nazwę, identyfikator barbera, zdjęcie, opis, specjalizacje i Instagram. Prywatne kontakty, przypisania kont i uprawnienia nie są zwracane.
- Profil barbera przyjmuje nazwę konta lub pełny link Instagram. Link jest walidowany. Osobne opcjonalne pole specjalizacji i opis imienia/nazwiska wyświetlanego publicznie. Starsze profile mają bezpieczne wartości domyślne.
- Panel właściciela (ekran wyboru barbera) zawiera „Strona salonu”: dodawanie, usuwanie, kolejność zdjęć, adres i godziny. Puste dane salonu nie są pokazywane.
- Galeria ma sześć miejsc egzekwowanych kluczami 0–5 w regułach Firebase. Tylko aktywny właściciel może pisać. Transakcje zachowują kolejność przy równoczesnych zmianach; zdjęcia są kompresowane przed zapisem.
- „Umów wizytę” otwiera istniejący proces (dla niezalogowanego: dotychczasowe logowanie). Zachowano moje wizyty, panel, instalację PWA i wejścia z powiadomień. Kod operacji rezerwacji nie został przebudowany.

## Weryfikacja

- Typecheck i lint: poprawne.
- Produkcyjny build: poprawny; narzędzie Vinext nadal zgłasza znany komunikat zamykania procesu Node na Windows po ukończeniu eksportu. Nie uniemożliwia to buildu.
- Testy aplikacji: 213/213.
- Emulator Firebase: 14/14, w tym odrzucenie zapisu galerii przez klienta/barbera, limit miejsc oraz walidacja danych. Użyto przenośnej Java 21 w katalogu tymczasowym; systemowej Java nie zmieniono.
- Interaktywne QA prawdziwych komponentów na izolowanych danych: 360, 390, 768 i 1440 px, bez poziomego przepełnienia. Profile, poprawny link Instagram, Escape, pełnoekranowe zdjęcie, kolejność, dodanie/usunięcie zdjęcia i formularze.
- Lokalny build z odczytem prawdziwych profili: strona salonu → profil → „Umów wizytę” → istniejące logowanie → powrót. Rozmiary 360 i 1440 px, bez błędów JavaScript.
- Nie wykonywano zapisu rezerwacji ani zdjęć w produkcyjnej bazie. Pełne logowanie na fizycznym Androidzie/iOS nie było częścią automatycznego QA.

## Pliki

Nowe:
- `app/components/salon-home.tsx`
- `app/components/salon-dialog.tsx`
- `app/components/salon-manager.tsx`
- `app/salon.css`
- `netlify/functions/public-barbers.mjs`
- `shared/shopfront.mjs`
- `tests/shopfront.test.mjs`
- `tests/visual/salon-preview.mjs`

Zmodyfikowane:
- `app/booking-home.tsx`
- `app/components/screens/admin-settings-screen.tsx`
- `app/lib/booking-types.ts`
- `app/layout.tsx`
- `app/page.tsx`
- `database.rules.json`
- `tests/emulator/firebase-rules.test.mjs`

Podgląd lokalny: http://localhost:8890/ (Netlify Dev serwujący gotowy build i funkcje). Przyszła publikacja musi obejmować także nowe reguły Firebase. Podgląd odczytuje konfigurację produkcji; interaktywne testy zapisów były przeprowadzone wyłącznie na izolowanych danych.
