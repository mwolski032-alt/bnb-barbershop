import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GALLERY_WIDTHS,
  galleryBlobKey,
  galleryImagePath,
  galleryImageSources,
  isGalleryId,
  isWebp,
  parseGalleryImagePath,
} from "../shared/gallery-images.mjs";

const id = "123e4567-e89b-42d3-a456-426614174000";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("blob keys and URLs are derived only from a validated id and a known width", () => {
  assert.equal(galleryBlobKey(id, 960), `${id}/960.webp`);
  assert.equal(galleryImagePath(id, 1600), `/api/gallery-image/${id}/1600.webp`);
  for (const bad of ["../x", "qa-photo", "", `${id}/../a`]) {
    assert.equal(isGalleryId(bad), false);
    assert.throws(() => galleryBlobKey(bad, 480));
    assert.throws(() => galleryImagePath(bad, 480));
  }
  assert.throws(() => galleryImagePath(id, 1234));
});

test("a request path parses back to its photo and rejects anything else", () => {
  assert.deepEqual(parseGalleryImagePath(`/api/gallery-image/${id}/480.webp`), { id, width: 480 });
  for (const bad of [
    `/api/gallery-image/${id}/700.webp`, `/api/gallery-image/${id}/480.png`, `/api/gallery-image/../${id}/480.webp`,
    "/api/gallery-image/not-an-id/480.webp", `/api/gallery-image/${id}/480.webp/extra`, `/x/${id}/480.webp`,
  ]) assert.equal(parseGalleryImagePath(bad), null, bad);
});

test("stored photos get a responsive srcset; legacy inline photos keep working", () => {
  const stored = galleryImageSources({ id, imageUrl: "x", storage: true, width: 1600, height: 1067, blur: "data:image/webp;base64,AAAA" });
  assert.equal(stored.src, `/api/gallery-image/${id}/1600.webp`);
  assert.equal(stored.width, 1600);
  assert.equal(stored.srcSet.split(", ").length, GALLERY_WIDTHS.length);
  assert.match(stored.srcSet, /480w/);
  assert.equal(stored.blur, "data:image/webp;base64,AAAA");
  const legacy = galleryImageSources({ id: "old", imageUrl: "data:image/webp;base64,AAAA" });
  assert.equal(legacy.src, "data:image/webp;base64,AAAA");
  assert.equal(legacy.srcSet, undefined);
  assert.equal(galleryImageSources({ id, imageUrl: "u", storage: true, blur: "javascript:alert(1)" }).blur, "");
});

test("only real WebP bytes pass the server check", () => {
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
  assert.equal(isWebp(webp), true);
  assert.equal(isWebp(Buffer.from("<svg onload=alert(1)>............")), false);
  assert.equal(isWebp(Buffer.from("RIFF")), false);
});

test("no paid or external storage is wired in", () => {
  const files = ["package.json", "firebase.json", "netlify/functions/gallery-images.mjs", "shared/gallery-images.mjs", "app/lib/gallery-photos.ts"];
  for (const file of files) assert.doesNotMatch(read(file), /firebasestorage|devstorage|storage\.googleapis/i, file);
  assert.doesNotMatch(read("firebase.json"), /"storage"/);
  assert.match(read("package.json"), /"@netlify\/blobs"/);
});

test("database rules accept same-origin photo paths only and still reject foreign hosts and scripts", () => {
  const rules = JSON.parse(read("database.rules.json")).rules.shopfront.gallery.$imageId;
  const validate = rules.imageUrl[".validate"];
  const patterns = [...validate.matchAll(/matches\((\/\^.*?\$\/)\)/g)].map((m) => new RegExp(m[1].slice(1, m[1].lastIndexOf("/"))));
  const [dataUrl, photoPath] = patterns;
  assert.ok(photoPath.test(`/api/gallery-image/${id}/1600.webp`));
  for (const bad of [`/api/gallery-image/${id}/480.webp`, "https://evil.example/x.webp", `//evil.example/api/gallery-image/${id}/1600.webp`,
    `/api/gallery-image/${id}/1600.webp?x=1`, "javascript:alert(1)"]) assert.equal(photoPath.test(bad), false, bad);
  assert.ok(dataUrl.test("data:image/webp;base64,AAAA"));
  assert.equal(dataUrl.test("javascript:alert(1)"), false);
  for (const field of ["storage", "width", "height", "blur"]) assert.ok(rules[field], field);
  assert.equal(rules.$other[".validate"], false);
});

// --- Server functions ------------------------------------------------------------------

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_CLIENT_EMAIL = "svc@example.iam.gserviceaccount.com";
process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n");
const { createHandler: createWriter } = await import("../netlify/functions/gallery-images.mjs");
const { createHandler: createReader } = await import("../netlify/functions/gallery-image.mjs");

const memoryStore = ({ failing = false } = {}) => {
  const entries = new Map();
  const guard = () => { if (failing) throw new Error("store down"); };
  return {
    entries,
    set: async (key, value, options) => { guard(); entries.set(key, { value: Buffer.from(value), options }); },
    get: async (key) => { guard(); const entry = entries.get(key); return entry ? entry.value.buffer.slice(entry.value.byteOffset, entry.value.byteOffset + entry.value.byteLength) : null; },
    delete: async (key) => { guard(); entries.delete(key); },
  };
};

const webpBase64 = (size = 64) =>
  Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(size)]).toString("base64");

function installFetch({ uid = "owner-uid", ownerUid = "owner-uid" } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "token" });
    if (url.includes("identitytoolkit.googleapis.com")) return Response.json({ users: [{ localId: uid }] });
    if (url.includes("/team/owner.json")) return Response.json({ userId: ownerUid, active: true });
    if (url.includes("/team/barbers.json")) return Response.json(null);
    throw new Error(`Unexpected fetch ${url}`);
  };
  return () => { globalThis.fetch = original; };
}

const request = (method, body, { url = "https://bnb.example/api/gallery-images", auth = "Bearer firebase-id-token" } = {}) =>
  new Request(url, { method, headers: { authorization: auth, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const validBody = () => ({ id, variants: { 480: webpBase64(), 960: webpBase64(), 1600: webpBase64() } });

test("the owner saves three WebP sizes under the photo id", async () => {
  const restore = installFetch(); const store = memoryStore();
  try {
    const response = await createWriter(() => store)(request("POST", validBody()));
    assert.equal(response.status, 201);
    assert.deepEqual([...store.entries.keys()].sort(), GALLERY_WIDTHS.map((width) => `${id}/${width}.webp`).sort());
    assert.equal(store.entries.get(`${id}/480.webp`).options.metadata.contentType, "image/webp");
  } finally { restore(); }
});

test("anyone who is not the active owner cannot save or delete", async () => {
  const restore = installFetch({ uid: "client-uid" }); const store = memoryStore();
  try {
    const handler = createWriter(() => store);
    assert.equal((await handler(request("POST", validBody()))).status, 403);
    assert.equal((await handler(request("DELETE", null, { url: `https://bnb.example/api/gallery-images?id=${id}` }))).status, 403);
    assert.equal((await handler(request("POST", validBody(), { auth: "" }))).status, 403);
    assert.equal(store.entries.size, 0);
  } finally { restore(); }
});

test("invalid ids, non-WebP bytes and oversized files are rejected before touching the store", async () => {
  const restore = installFetch(); const store = memoryStore();
  try {
    const handler = createWriter(() => store);
    assert.equal((await handler(request("POST", { ...validBody(), id: "../../etc" }))).status, 400);
    assert.equal((await handler(request("POST", { id, variants: { 480: Buffer.from("<script>alert(1)</script>").toString("base64"), 960: webpBase64(), 1600: webpBase64() } }))).status, 400);
    assert.equal((await handler(request("POST", { id, variants: { 480: webpBase64(200_000), 960: webpBase64(), 1600: webpBase64() } }))).status, 400);
    assert.equal((await handler(request("POST", { id, variants: { 480: webpBase64() } }))).status, 400);
    assert.equal((await handler(request("GET"))).status, 405);
    assert.equal(store.entries.size, 0);
  } finally { restore(); }
});

test("deleting removes all three sizes and tolerates photos that are already gone", async () => {
  const restore = installFetch(); const store = memoryStore();
  try {
    const handler = createWriter(() => store);
    await handler(request("POST", validBody()));
    assert.equal(store.entries.size, 3);
    const url = `https://bnb.example/api/gallery-images?id=${id}`;
    assert.equal((await handler(request("DELETE", null, { url }))).status, 200);
    assert.equal(store.entries.size, 0);
    assert.equal((await handler(request("DELETE", null, { url }))).status, 200);
    assert.equal((await handler(request("DELETE", null, { url: "https://bnb.example/api/gallery-images?id=nope" }))).status, 400);
  } finally { restore(); }
});

test("a store failure is reported instead of pretending the photo was saved", async () => {
  const restore = installFetch();
  try {
    assert.equal((await createWriter(() => memoryStore({ failing: true }))(request("POST", validBody()))).status, 503);
  } finally { restore(); }
});

test("a stored photo is served publicly with year-long caching in browser and CDN", async () => {
  const store = memoryStore();
  store.entries.set(`${id}/960.webp`, { value: Buffer.from(webpBase64(), "base64") });
  const reader = createReader(() => store);
  const response = await reader(new Request(`https://bnb.example/api/gallery-image/${id}/960.webp`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.match(response.headers.get("cache-control"), /immutable/);
  assert.match(response.headers.get("netlify-cdn-cache-control"), /max-age=31536000/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(isWebp(new Uint8Array(await response.arrayBuffer())));
  const head = await reader(new Request(`https://bnb.example/api/gallery-image/${id}/960.webp`, { method: "HEAD" }));
  assert.equal(head.status, 200);
});

test("missing, malformed or foreign paths are 404 and never cached; writes are refused", async () => {
  const reader = createReader(() => memoryStore());
  for (const path of [`/api/gallery-image/${id}/480.webp`, `/api/gallery-image/${id}/777.webp`, "/api/gallery-image/x/480.webp", `/api/gallery-image/${id}/../../etc/passwd`]) {
    const response = await reader(new Request(`https://bnb.example${path}`));
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
  }
  assert.equal((await reader(new Request(`https://bnb.example/api/gallery-image/${id}/480.webp`, { method: "POST" }))).status, 405);
  assert.equal((await createReader(() => memoryStore({ failing: true }))(new Request(`https://bnb.example/api/gallery-image/${id}/480.webp`))).status, 503);
});
