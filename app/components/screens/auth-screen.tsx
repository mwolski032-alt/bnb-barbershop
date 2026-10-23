"use client";

function AuthBrand() {
  return (
    <div className="auth-brand">
      <span className="auth-logo" aria-hidden="true">
        <img src="/brand/bnb-logo.png" alt="" />
      </span>
      <p>BNB Barbershop</p>
    </div>
  );
}

/** Shown while the sign-in session is being verified and the salon page cannot be shown. */
export function SessionCheckScreen() {
  return (
    <main className="auth-shell" aria-label="Ładowanie logowania">
      <section className="auth-card">
        <AuthBrand />
        <div className="auth-loader" aria-hidden="true" />
        <h1>Sprawdzamy sesję</h1>
        <p className="auth-copy">Za chwilę pokażemy rezerwacje albo ekran logowania.</p>
      </section>
    </main>
  );
}

type LoginScreenProps = {
  signingIn: boolean;
  error: string;
  onGoogleSignIn: () => void;
  onBackToSalon: () => void;
};

export function LoginScreen({ signingIn, error, onGoogleSignIn, onBackToSalon }: LoginScreenProps) {
  return (
    <main className="auth-shell" aria-label="Logowanie do aplikacji">
      <button type="button" className="salon-return" onClick={onBackToSalon}>‹ Strona salonu</button>
      <section className="auth-card">
        <AuthBrand />

        <div className="auth-hero">
          <p className="eyebrow">Witaj w B&apos;n&apos;B</p>
          <h1>Twój następny termin</h1>
          <p className="auth-copy">
            Zaloguj się, wybierz barbera, usługę i godzinę, która pasuje do Twojego dnia.
          </p>
        </div>

        <div className="auth-benefits" aria-label="Korzyści dla klienta">
          <span>Rezerwacja w mniej niż minutę</span>
          <span>Przypomnienie przed wizytą</span>
        </div>

        <button
          className="google-login-button"
          type="button"
          onClick={onGoogleSignIn}
          disabled={signingIn}
          aria-busy={signingIn}
        >
          <span aria-hidden="true">G</span>
          {signingIn ? "Łączenie..." : "Kontynuuj z Google"}
        </button>

        {error ? <p className="auth-error">{error}</p> : null}
      </section>
    </main>
  );
}
