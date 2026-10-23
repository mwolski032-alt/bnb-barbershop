# B'n'B — papierowy design system

## Zakres

Wspólny wygląd obejmuje logowanie i start, rezerwację, wybór barbera/usługi/dnia/godziny, kalendarz, najbliższe wizyty, klientów, analizę, pracę, usługi, zarządzanie zespołem, profil barbera, formularze, powiadomienia interfejsu i okna dialogowe.

- `app/theme.css` jest źródłem palety, typografii, cieni i promieni narożników.
- `app/globals.css` zachowuje układ i breakpointy; dotychczasowe kolory zastąpiono tokenami, usunięto dekoracyjne gradienty i rozmycia.
- `app/paper-components.css` określa wspólne stany CTA, zaznaczeń, formularzy, błędów, focus i disabled.
- Papierowe tło #F6EBD7, powierzchnie #FBF4E7, ciemna zieleń #014241. Magenta występuje jako niewielki detal, nie tło dużych paneli.
- Wszystkie napisy dziedziczą stos Sitka Heading / Sitka / Georgia / serif. Repozytorium nie zawiera licencjonowanego webfontu Sitka; instrukcja jego późniejszego lokalnego podłączenia znajduje się w `public/fonts/README.md`. Nie pobierano zamienników ani nie dodawano brakujących żądań fontów.
- Manifest i kolor przeglądarki/PWA są jasne. Wersja cache v8 usuwa poprzedni cache aplikacji, zachowując dotychczasowe zabezpieczenia logowania.

## Audyt i wyjątki

Kolory CSS mają jedno źródło prawdy. W metadanych i manifeście wymagane są literalne wartości; test pilnuje ich zgodności z theme. Wielokolorowa ikona Chrome w instrukcji instalacji zachowuje identyfikację przeglądarki. Oryginalne zdjęcia, logo i ikony aplikacji nie są zastępowane. Nieużywane startowe SVG pozostają poza interfejsem.

Nazwy kategorii kalendarza (np. blue/mint) pozostają bez zmian ze względu na istniejące dane; ich wygląd korzysta z przygaszonych tokenów. Linie siatki kalendarza pozostają funkcjonalnymi gradientami CSS. Błędy, ostrzeżenia i sukcesy zachowują osobne znaczenie.

Nie zmieniano backendu, routingu, autoryzacji, API, cen, rezerwacji, dostępności, scalania ani danych klientów.

## Weryfikacja

- Produkcyjny build oraz 209 testów automatycznych zakończone powodzeniem.
- Typecheck i lint zakończone powodzeniem.
- Nowe testy pilnują palety, wspólnej typografii, braku surowych kolorów w arkuszach komponentów, metadanych PWA oraz kontrastu podstawowego tekstu, CTA i komunikatów.
- Osiem rzeczywistych komponentów paneli sprawdzono na lokalnych, nieinteraktywnych danych testowych w szerokościach 320, 360, 768 i 1440 px: bez poziomego wychodzenia dokumentu poza viewport.
- W przeglądarce sprawdzono prawdziwy ekran logowania i okno instrukcji instalacji oraz reprezentatywne stany rezerwacji i okna odwołania w izolowanym podglądzie.
- Podgląd można odtworzyć po buildzie: `node tests/visual/paper-preview.mjs`. Działa wyłącznie na 127.0.0.1:4177, nie łączy się z Firebase i nie wykonuje operacji na klientach.

To nie jest potwierdzenie testów na fizycznym Androidzie/iPhonie ani pełnego przebiegu logowania Google. Weryfikacja paneli wizualnych nie wykonuje prawdziwych rezerwacji. Wskazane przez zamawiającego kolory placeholderów i nieaktywnych kontrolek zachowano; nie deklarujemy zgodności każdego drobnego tekstu z AA.

Lokalny Windows zgłasza znany komunikat Node/Vinext podczas zamykania procesu po poprawnym eksporcie. Istniejący skrypt budowania weryfikuje rezultat eksportu; testy przechodzą. Nie zmieniano narzędzi budowania w ramach redesignu.
