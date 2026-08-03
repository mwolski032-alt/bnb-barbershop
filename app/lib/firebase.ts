import { getAnalytics, isSupported } from "firebase/analytics";
import { getApps, initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";

const readEnv = (key: string, fallback: string) => {
  const processValue =
    typeof process !== "undefined" ? (process.env[key] as string | undefined) : undefined;
  const importMetaValue = import.meta.env[key] as string | undefined;

  return processValue || importMetaValue || fallback;
};

const firebaseConfig = {
  apiKey: readEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "AIzaSyATrBnGXzcxUR8r6Y-AeAeXDVPeKAjrymU"),
  authDomain: readEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "bnbbarber-9a7bd.firebaseapp.com"),
  databaseURL: readEnv(
    "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
    "https://bnbbarber-9a7bd-default-rtdb.europe-west1.firebasedatabase.app",
  ),
  projectId: readEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "bnbbarber-9a7bd"),
  storageBucket: readEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "bnbbarber-9a7bd.firebasestorage.app"),
  messagingSenderId: readEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "100630377058"),
  appId: readEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "1:100630377058:web:6cb84e6a208220153f173b"),
  measurementId: readEnv("NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID", "G-KJCB540XC8"),
};

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const db = getFirestore(firebaseApp);
export const realtimeDb = getDatabase(firebaseApp);

export const getFirebaseAnalytics = async () => {
  if (typeof window === "undefined" || !(await isSupported())) {
    return null;
  }

  return getAnalytics(firebaseApp);
};
