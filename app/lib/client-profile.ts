import { onValue, ref, update } from "firebase/database";
import { realtimeDb } from "./firebase";

/** What a client chose for their account. Anything missing falls back to the Google profile. */
export type ClientProfile = {
  displayName?: string;
  /** Nine digits, no spaces. */
  phone?: string;
  /** A small WebP data URL, see `prepareAvatar`. */
  photoUrl?: string;
  favoriteBarberId?: string;
  /** When the profile was last saved (set by the database, read-only here). */
  updatedAt?: number;
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
  onValue(ref(realtimeDb, `clientProfiles/${uid}`), snapshot => {
    const value = (snapshot.val() ?? {}) as ClientProfile;
    onChange({ ...clean(value), ...(Number(value.updatedAt) ? { updatedAt: Number(value.updatedAt) } : {}) });
  }, () => onChange({}));

/** Profiles saved before pictures were shared with barbers get their version stamp the first time they load. */
export const ensurePhotoVersion = (uid: string, updatedAt: number) =>
  update(ref(realtimeDb), { [`clientPhotoVersions/${uid}`]: updatedAt });

/** Saves the profile and, in the same write, a version stamp that tells the server the picture changed. */
export const saveClientProfile = (uid: string, profile: ClientProfile) => {
  const cleaned = clean(profile);
  const now = Date.now();
  return update(ref(realtimeDb), {
    [`clientProfiles/${uid}`]: { ...cleaned, updatedAt: now },
    [`clientPhotoVersions/${uid}`]: cleaned.photoUrl ? now : null,
  });
};

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
