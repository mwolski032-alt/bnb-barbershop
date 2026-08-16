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
