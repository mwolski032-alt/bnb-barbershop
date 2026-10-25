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

/** Crop the picked file to a centred square and shrink it until it fits the stored limit. */
export async function prepareAvatar(file: Blob): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Wybierz zdjęcie JPG, PNG lub WebP do 10 MB.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error("Nie udało się odczytać zdjęcia.");
    for (const size of [AVATAR_SIZE, 192, 128]) {
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Nie udało się przygotować zdjęcia.");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      for (const quality of [0.85, 0.7, 0.55]) {
        const dataUrl = canvas.toDataURL("image/webp", quality);
        if (dataUrl.startsWith("data:image/webp;base64,") && dataUrl.length <= AVATAR_MAX_CHARS) return dataUrl;
      }
    }
    throw new Error("Zdjęcie jest zbyt złożone. Wybierz inne.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
