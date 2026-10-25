import { onValue, ref, set } from "firebase/database";
import { realtimeDb } from "./firebase";

/** What a client chose for their account. Anything missing falls back to the Google profile. */
export type ClientProfile = {
  displayName?: string;
  /** Nine digits, no spaces. */
  phone?: string;
  /** A small WebP data URL, see `prepareAvatar`. */
  photoUrl?: string;
  favoriteBarberId?: string;
};

export const AVATAR_MAX_CHARS = 60000;
const AVATAR_SIZE = 256;

const clean = (profile: ClientProfile): ClientProfile => ({
  ...(profile.displayName?.trim() ? { displayName: profile.displayName.trim().slice(0, 60) } : {}),
  ...(profile.phone ? { phone: profile.phone } : {}),
  ...(profile.photoUrl ? { photoUrl: profile.photoUrl } : {}),
  ...(profile.favoriteBarberId ? { favoriteBarberId: profile.favoriteBarberId } : {}),
});

export const subscribeClientProfile = (uid: string, onChange: (profile: ClientProfile) => void) =>
  onValue(ref(realtimeDb, `clientProfiles/${uid}`), snapshot => onChange(clean((snapshot.val() ?? {}) as ClientProfile)), () => onChange({}));

export const saveClientProfile = (uid: string, profile: ClientProfile) =>
  set(ref(realtimeDb, `clientProfiles/${uid}`), { ...clean(profile), updatedAt: Date.now() });

export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Shrink an already cropped square picture (a data URL) until it fits the stored limit. Colours are kept as they are. */
export async function shrinkAvatar(dataUrl: string): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  for (const size of [AVATAR_SIZE, 192, 128]) {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Nie udało się przygotować zdjęcia.");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, size, size);
    for (const quality of [0.85, 0.7, 0.55]) {
      const result = canvas.toDataURL("image/webp", quality);
      if (result.startsWith("data:image/webp;base64,") && result.length <= AVATAR_MAX_CHARS) return result;
    }
  }
  throw new Error("Zdjęcie jest zbyt złożone. Wybierz inne.");
}
