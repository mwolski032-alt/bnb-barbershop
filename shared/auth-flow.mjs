const redirectFallbackCodes = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

export const shouldUseRedirectSignIn = ({
  userAgent = "",
  platform = "",
  maxTouchPoints = 0,
} = {}) => {
  const appleMobileDevice = /iPad|iPhone|iPod/i.test(userAgent);
  const ipadInDesktopMode =
    /Mac/i.test(platform) && Number(maxTouchPoints) > 1;

  return appleMobileDevice || ipadInDesktopMode;
};

export const shouldFallbackToRedirect = (errorCode = "") =>
  redirectFallbackCodes.has(errorCode);

export const getGoogleSignInErrorMessage = (errorCode = "") => {
  if (errorCode === "auth/network-request-failed") {
    return "Nie udało się połączyć z logowaniem. Sprawdź internet i spróbuj ponownie.";
  }

  if (errorCode === "auth/unauthorized-domain") {
    return "Logowanie nie jest aktywne dla tego adresu aplikacji.";
  }

  if (
    errorCode === "auth/web-storage-unsupported" ||
    errorCode === "auth/operation-not-supported-in-this-environment"
  ) {
    return "Przeglądarka blokuje logowanie. Otwórz aplikację bezpośrednio w Safari i spróbuj ponownie.";
  }

  return "Nie udało się zalogować. Spróbuj ponownie.";
};
