import { getAccessToken, readDatabase } from "./_firebase-admin.mjs";

export const config = { path: "/api/barber-photo/*" };

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const PHOTO = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/;

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

/**
 * A barber's profile picture as a normal image, used as the icon of "Napisz do klientów" notifications
 * (a push can only show a picture that has an address). The link carries `?v=<time of the change>`.
 */
export const createHandler = (readPhoto = async (barberId) => readDatabase(`barbers/${encodeURIComponent(barberId)}/profile/photoUrl`, await getAccessToken())) =>
  async function handler(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const barberId = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
    if (!ID.test(barberId)) return notFound();
    try {
      const match = PHOTO.exec(String(await readPhoto(barberId) ?? ""));
      if (!match) return notFound();
      const bytes = Buffer.from(match[2], "base64");
      return new Response(request.method === "HEAD" ? null : bytes, {
        status: 200,
        headers: {
          "Content-Type": match[1],
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
