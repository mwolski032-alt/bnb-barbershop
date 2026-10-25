import { getAccessToken, readDatabase } from "./_firebase-admin.mjs";

export const config = { path: "/api/client-photo/*" };

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const PREFIX = "data:image/webp;base64,";

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/**
 * The picture a client chose in "Moje konto", served as a normal image so barbers see it on their
 * appointments without every record carrying the picture itself. The link carries `?v=<time of the
 * change>`, so browsers keep it for a year and fetch it again only when the client changes it.
 */
export const createHandler = (readPhoto = async (uid) => readDatabase(`clientProfiles/${encodeURIComponent(uid)}/photoUrl`, await getAccessToken())) =>
  async function handler(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const uid = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
    if (!UID.test(uid)) return notFound();
    try {
      const photo = await readPhoto(uid);
      if (typeof photo !== "string" || !photo.startsWith(PREFIX)) return notFound();
      const bytes = Buffer.from(photo.slice(PREFIX.length), "base64");
      return new Response(request.method === "HEAD" ? null : bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Netlify-Vary": "query",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };

export default createHandler();
