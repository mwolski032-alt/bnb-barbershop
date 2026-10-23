import { getStore } from "@netlify/blobs";
import {
  GALLERY_CACHE_CONTROL,
  GALLERY_STORE,
  galleryBlobKey,
  parseGalleryImagePath,
} from "../../shared/gallery-images.mjs";

export const config = { path: "/api/gallery-image/*" };

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/**
 * Public read of one gallery photo. Photo ids never change their content, so the response is
 * cached for a year both in browsers and on Netlify's CDN: after the first request a photo
 * is served from the CDN and this function is not invoked again.
 */
export const createHandler = (openStore = () => getStore({ name: GALLERY_STORE })) =>
  async function handler(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const target = parseGalleryImagePath(new URL(request.url).pathname);
    if (!target) return notFound();
    try {
      const bytes = await openStore().get(galleryBlobKey(target.id, target.width), { type: "arrayBuffer" });
      if (!bytes) return notFound();
      return new Response(request.method === "HEAD" ? null : bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": GALLERY_CACHE_CONTROL,
          "Netlify-CDN-Cache-Control": GALLERY_CACHE_CONTROL,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };

export default createHandler();
