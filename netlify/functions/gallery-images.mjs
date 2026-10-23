import { getStore } from "@netlify/blobs";
import {
  getAccessToken,
  getAdminContext,
  jsonResponse,
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

// Only the active owner may change the gallery. The browser never writes to the store itself:
// it sends the three prepared sizes here, and this function validates and saves them.
const requireOwner = async (request) => {
  const user = await verifyRequestUser(request);
  if (!user) return null;
  const context = await getAdminContext(user, await getAccessToken());
  return context.isOwner && context.active ? user : null;
};

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
export const createHandler = (openStore = () => getStore({ name: GALLERY_STORE, consistency: "strong" })) =>
  async function handler(request) {
    try {
      if (request.method !== "POST" && request.method !== "DELETE") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }
      const owner = await requireOwner(request);
      if (!owner) return jsonResponse({ error: "Owner access required" }, 403);

      if (request.method === "DELETE") {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        if (!isGalleryId(id)) return jsonResponse({ error: "Invalid photo id" }, 400);
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
