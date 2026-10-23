# Remaster aplikacji B'n'B: raport

Remaster wykonano w siedmiu etapach bez zmian w funkcjach rezerwacji, cennikach, autoryzacji i danych klientów.

## Etapy

| Etap | Zakres | Główne pliki |
|---|---|---|
| 0 | Porządki, raporty do `docs/`, pomiar wyjściowy | `docs/` |
| 1 | Tokeny designu (promienie, odstępy, typografia, cienie, czas i easing), czcionki Fraunces i Geist hostowane lokalnie | `app/theme.css`, `public/fonts/` |
| 2 | Zdjęcia galerii w Netlify Blobs (3 rozmiary WebP, `srcset`, rozmyty podgląd, cache CDN na rok), zapis tylko przez funkcję właściciela | `shared/gallery-images.mjs`, `netlify/functions/gallery-images.mjs`, `netlify/functions/gallery-image.mjs` |
| 3 | Animacje: dialogi, kierunkowe kroki kreatora, pojawianie przy przewijaniu, View Transitions, ekran sukcesu | `app/motion.css` |
| 4 | Ekrany klienta: układ dwukolumnowy, lightbox z gestami, okna potwierdzeń, stany puste | `app/components/gallery-lightbox.tsx`, `app/lib/confirm-action.tsx` |
| 5 | Panel barbera i właściciela: wzrost wykresów, kaskada list, reakcja na dotyk | `app/motion.css` |
| 6 | Refaktor: podział `booking-home.tsx`, wygaszanie okien panelu, martwy CSS | `app/lib/*`, `app/components/*` |
| 7 | Lighthouse, kontrast, SEO (`robots.txt`, `sitemap.xml`), dokumentacja | `public/robots.txt`, `public/sitemap.xml` |

## Pomiary

| Miara | Przed | Po |
|---|---|---|
| JS, główna paczka (gzip) | 55,6 KB | 56,7 KB |
| CSS (gzip) | 33,4 KB | 36,5 KB |
| Dane galerii pobierane z bazy | do ok. 2 MB (base64) | kilka KB (rekordy) |
| `booking-home.tsx` | 7197 linii | 6321 linii |
| Testy automatyczne | 223 | 264 |
| Lighthouse (lokalnie, desktop) | brak pomiaru wyjściowego | wydajność 0,84, dostępność 1,0, dobre praktyki 1,0, SEO 0,92 (1,0 po dodaniu `robots.txt`) |

Lighthouse uruchomiony na lokalnym serwerze nie widzi kompresji ani nagłówków cache Netlify, więc pozycje
"uses-text-compression" i "uses-long-cache-ttl" nie odzwierciedlają produkcji.

## Rekomendacje na później

1. **Kontrast placeholderów.** `--color-text-muted` (#8A8479) ma 3,1:1 na tle strony, poniżej 4,5:1 z WCAG AA.
   Kolor wskazał zamawiający, więc nie zmieniano go. Wartość #6F6A5F spełnia AA (4,6:1).
2. **Obramowania pól formularzy.** `--color-border-strong` ma ok. 2:1, a WCAG 1.4.11 wymaga 3:1 dla elementów
   interfejsu. Kolor #8F7F63 daje 3,6:1.
3. **Podział CSS.** Na stronie głównej Lighthouse widzi ok. 183 KiB nieużywanego CSS (to style panelu).
   Podział `globals.css` na część klienta i admina ograniczyłby blokujący CSS, ale wymaga uporządkowania
   kolejności kaskady.
4. **Funkcja `BookingHome`** ma nadal ok. 5900 linii. Dalszy podział wymaga przeniesienia stanu do kontekstu
   albo hooków i najlepiej testów interfejsu.
5. **Zdjęcia profilowe barberów** są nadal zapisane jako base64 w bazie (512 px). Warto je przenieść do Netlify Blobs
   tą samą metodą co galerię.
6. **Test emulatora reguł** (`npm run test:rules`) wymaga Javy 21+. Na tym komputerze jest Java 8.
