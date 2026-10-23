// Salon gallery photos are stored in Netlify Blobs as three WebP sizes per photo and served
// from the site's own domain. The database keeps only a small record; every URL is derived
// from the photo id, so nothing sensitive and no access token is stored or exposed.

export const GALLERY_WIDTHS = [480, 960, 1600];
export const GALLERY_MAX_BYTES = { 480: 120_000, 960: 300_000, 1600: 600_000 };
export const GALLERY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const GALLERY_STORE = "gallery";
/** The salon page and the database rules both allow this many photos (records 0 to 19). */
export const GALLERY_MAX_PHOTOS = 20;
/** Ids of the barbers a photo can be credited to: the same safe keys used for team members. */
export const GALLERY_BARBER_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
export const GALLERY_CACHE_CONTROL = "public, max-age=31536000, immutable";

export const isGalleryId = (value) => typeof value === "string" && GALLERY_ID_PATTERN.test(value);

const assertPhoto = (id, width) => {
  if (!isGalleryId(id)) throw new Error("Invalid gallery photo id.");
  if (!GALLERY_WIDTHS.includes(width)) throw new Error("Unsupported gallery photo width.");
};

/** Key of one size inside the Blobs store. */
export const galleryBlobKey = (id, width) => {
  assertPhoto(id, width);
  return `${id}/${width}.webp`;
};

/** Public, same-origin URL path of one size. Served by netlify/functions/gallery-image.mjs. */
export const galleryImagePath = (id, width) => {
  assertPhoto(id, width);
  return `/api/gallery-image/${id}/${width}.webp`;
};

/** Reads `/api/gallery-image/<id>/<width>.webp` back into its parts, or null when malformed. */
export const parseGalleryImagePath = (pathname) => {
  const match = /^\/api\/gallery-image\/([0-9a-f-]{36})\/(\d{3,4})\.webp$/.exec(pathname);
  if (!match) return null;
  const width = Number(match[2]);
  return isGalleryId(match[1]) && GALLERY_WIDTHS.includes(width) ? { id: match[1], width } : null;
};

// Resolve what the page needs to render a stored gallery record. Photos saved before the
// migration still carry an inline data URL and keep working without a srcset.
export function galleryImageSources(item) {
  const legacy = { src: item.imageUrl, srcSet: undefined, width: undefined, height: undefined, blur: "" };
  if (item.storage !== true || !isGalleryId(item.id)) return legacy;
  return {
    src: galleryImagePath(item.id, 1600),
    srcSet: GALLERY_WIDTHS.map((width) => `${galleryImagePath(item.id, width)} ${width}w`).join(", "),
    width: Number.isFinite(item.width) ? item.width : undefined,
    height: Number.isFinite(item.height) ? item.height : undefined,
    blur: typeof item.blur === "string" && item.blur.startsWith("data:image/webp;base64,") ? item.blur : "",
  };
}

// RIFF....WEBP header check: a cheap guard so the server never stores arbitrary bytes.
export const isWebp = (bytes) =>
  bytes.length > 12 &&
  bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
  bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
