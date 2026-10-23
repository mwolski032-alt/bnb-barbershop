import { getAuth } from "firebase/auth";
import {
  GALLERY_MAX_BYTES,
  GALLERY_WIDTHS,
  galleryImagePath,
  isGalleryId,
} from "../../shared/gallery-images.mjs";
import { firebaseApp } from "./firebase";

export type StoredGalleryFields = {
  imageUrl: string;
  storage: true;
  width: number;
  height: number;
  blur: string;
};

const acceptedTypes = ["image/jpeg", "image/png", "image/webp"];
const maxSourceBytes = 10 * 1024 * 1024;
const endpoint = "/api/gallery-images";

const loadImage = async (blob: Blob) => {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const encode = (canvas: HTMLCanvasElement, qualities: number[], maxBytes: number) =>
  new Promise<Blob>((resolve, reject) => {
    const attempt = (index: number) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Nie udało się przygotować zdjęcia."));
        if (blob.size <= maxBytes) return resolve(blob);
        if (index + 1 < qualities.length) return attempt(index + 1);
        reject(new Error("Zdjęcie jest zbyt duże po kompresji. Wybierz mniejszy plik."));
      }, "image/webp", qualities[index]);
    };
    attempt(0);
  });

const resized = (image: HTMLImageElement, targetWidth: number) => {
  const width = Math.min(targetWidth, image.naturalWidth);
  const height = Math.max(1, Math.round((image.naturalHeight * width) / image.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Nie udało się przygotować zdjęcia.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas;
};

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Nie udało się odczytać zdjęcia."));
    reader.readAsDataURL(blob);
  });

const toDataUrl = async (blob: Blob) => `data:image/webp;base64,${await toBase64(blob)}`;

const authorization = async () => {
  const user = getAuth(firebaseApp).currentUser;
  if (!user) throw new Error("Zaloguj się ponownie, aby zapisać zdjęcie.");
  return { Authorization: `Bearer ${await user.getIdToken()}` };
};

/** Resize one source file into the three stored sizes plus a tiny blurred placeholder. */
async function prepareVariants(source: Blob) {
  if (!acceptedTypes.includes(source.type) || source.size > maxSourceBytes) {
    throw new Error("Wybierz JPG, PNG lub WebP do 10 MB.");
  }
  const image = await loadImage(source);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("Nie udało się przygotować zdjęcia.");

  const variants: Record<string, string> = {};
  for (const width of GALLERY_WIDTHS as number[]) {
    const blob = await encode(
      resized(image, width),
      [0.82, 0.7, 0.55, 0.4],
      (GALLERY_MAX_BYTES as Record<number, number>)[width],
    );
    variants[String(width)] = await toBase64(blob);
  }
  const placeholder = await encode(resized(image, 24), [0.5, 0.3], 2100);
  const full = resized(image, 1600);
  return { variants, blur: await toDataUrl(placeholder), width: full.width, height: full.height };
}

/** Upload a new photo and return the record fields to save in the database. */
export async function uploadGalleryPhoto(id: string, source: Blob): Promise<StoredGalleryFields> {
  if (!isGalleryId(id)) throw new Error("Nieprawidłowy identyfikator zdjęcia.");
  const { variants, blur, width, height } = await prepareVariants(source);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...(await authorization()), "Content-Type": "application/json" },
    body: JSON.stringify({ id, variants }),
  });
  if (!response.ok) throw new Error("Nie udało się zapisać zdjęcia. Spróbuj ponownie.");
  return { imageUrl: galleryImagePath(id, 1600), storage: true, width, height, blur };
}

/** Best effort cleanup of stored files after the database record is gone. */
export async function deleteGalleryPhotoFiles(id: string) {
  if (!isGalleryId(id)) return;
  try {
    await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: await authorization() });
  } catch { /* An orphaned file is harmless; the record is already removed. */ }
}

/** Convert an inline (base64) photo from the old gallery into Storage files. */
export async function migrateLegacyPhoto(id: string, inlineUrl: string): Promise<StoredGalleryFields> {
  const blob = await (await fetch(inlineUrl)).blob();
  return uploadGalleryPhoto(id, blob);
}
