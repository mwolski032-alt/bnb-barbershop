import { GoogleAuthProvider, signInWithRedirect, type Auth } from "firebase/auth";
import { shouldUseRedirectSignIn } from "../../shared/auth-flow.mjs";

export const googleRedirectPendingKey = "bnb-google-redirect-pending";

export const hasPendingGoogleRedirect = () => {
  try {
    return window.sessionStorage.getItem(googleRedirectPendingKey) === "1";
  } catch {
    return false;
  }
};

export const clearPendingGoogleRedirect = () => {
  try {
    window.sessionStorage.removeItem(googleRedirectPendingKey);
  } catch {}
};

export const shouldResolveGoogleRedirect = () => {
  const standaloneNavigator = window.navigator as Navigator & { standalone?: boolean };
  return (
    hasPendingGoogleRedirect() ||
    shouldUseRedirectSignIn(window.navigator) ||
    standaloneNavigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
};

export const signInWithGoogleRedirect = async (firebaseAuth: Auth, provider: GoogleAuthProvider) => {
  try {
    window.sessionStorage.setItem(googleRedirectPendingKey, "1");
    await signInWithRedirect(firebaseAuth, provider);
  } catch (error) {
    clearPendingGoogleRedirect();
    throw error;
  }
};
