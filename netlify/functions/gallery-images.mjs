import { getStore } from "@netlify/blobs";
import {
  getAccessToken,
  getAdminContext,
  jsonResponse,
  readDatabase,
  verifyRequestUser,
} from "./_firebase-admin.mjs";
import {
  GALLERY_MAX_BYTES,
  GALLERY_STORE,
  GALLERY_WIDTHS,
  galleryBlobKey,
  isGalleryId,
  isWebp,
} from "../../shared/gallery-images.mjs";

export const config = {
  path: "/api/gallery-images",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const maxBodyLength = 1_700_000;

// The active owner may change the whole gallery. A barber the owner switched "Galeria" on for may add
// photos and delete their own. The browser never writes to the store itself: it sends the three
// prepared sizes here, and this function validates and saves them.
const requireUploader = async (request) => {
  const user = await verifyRequestUser(request);
  if (!user) return null;
  const accessToken = await getAccessToken();
  const context = await getAdminContext(user, accessToken);
  if (!context.active) return null;
  if (context.isOwner) return { isOwner: true, barberId: "", accessToken };
  if (context.role === "barber" && context.access?.gallery === true && context.barberId) {
    return { isOwner: false, barberId: context.barberId, accessToken };
  }
  return null;
};

const readGalleryRecords = async (accessToken) => Object.values((await readDatabase("shopfront/gallery", accessToken)) ?? {});

const decodeVariants = (variants) => {
  if (!variants || typeof variants !== "object") return null;
  const decoded = new Map();
  for (const width of GALLERY_WIDTHS) {
    const text = variants[String(width)];
    if (typeof text !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
    const bytes = Buffer.from(text, "base64");
    if (!isWebp(bytes) || bytes.length > GALLERY_MAX_BYTES[width]) return null;
    decoded.set(width, bytes);
  }
  return decoded;
};

const toArrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

/** The store is injectable so tests can run without Netlify. */
export const createHandler = (
  openStore = () => getStore({ name: GALLERY_STORE, consistency: "strong" }),
  readGallery = readGalleryRecords,
) =>
  async function handler(request) {
    try {
      if (request.method !== "POST" && request.method !== "DELETE") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      const uploader = await requireUploader(request);
      if (!uploader) return jsonResponse({ error: "Gallery access required" }, 403);

      if (request.method === "DELETE") {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!isGalleryId(id)) return jsonResponse({ error: "Invalid photo id" }, 400);
        if (!uploader.isOwner) {
          // A barber deletes only their own photos. A photo with no record is an orphan nobody can see.
          const record = (await readGallery(uploader.accessToken)).find((item) => item?.id === id);
          if (record && record.barberId !== uploader.barberId) return jsonResponse({ error: "Not your photo" }, 403);
        }
        const store = openStore();
        await Promise.all(GALLERY_WIDTHS.map((width) => store.delete(galleryBlobKey(id, width))));
        return jsonResponse({ deleted: true });
      }

      if (Number(request.headers.get("content-length") || 0) > maxBodyLength) {
        return jsonResponse({ error: "Photo too large" }, 413);
      }
      const raw = await request.text();
      if (raw.length > maxBodyLength) return jsonResponse({ error: "Photo too large" }, 413);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
      }
      if (!isGalleryId(payload?.id)) return jsonResponse({ error: "Invalid photo id" }, 400);
      const variants = decodeVariants(payload.variants);
      if (!variants) return jsonResponse({ error: "Invalid photo data" }, 400);

      const store = openStore();
      // A barber may only create new photos, never overwrite the files of one that already exists.
      if (!uploader.isOwner && (await store.getMetadata(galleryBlobKey(payload.id, GALLERY_WIDTHS[0])))) {
        return jsonResponse({ error: "Photo already exists" }, 409);
      }
      await Promise.all(
        [...variants].map(([width, bytes]) =>
          store.set(galleryBlobKey(payload.id, width), toArrayBuffer(bytes), { metadata: { contentType: "image/webp" } })),
      );
      return jsonResponse({ stored: true, id: payload.id }, 201);
    } catch {
      return jsonResponse({ error: "Nie udało się zapisać zdjęcia." }, 503);
    }
  };

export default createHandler();
