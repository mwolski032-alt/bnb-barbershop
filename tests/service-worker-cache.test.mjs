import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const origin = "https://bnb.example";
const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const shell = '<html data-bnb-app-shell="true"><body>BNB</body></html>';
const html = (text = shell, { path = "/", redirected = false } = {}) => {
  const response = new Response(text, { headers: { "content-type": "text/html" } });
  Object.defineProperty(response, "url", { value: origin + path });
  Object.defineProperty(response, "redirected", { value: redirected });
  return response;
};
function harness() {
  const handlers = new Map();
  const stores = new Map();
  let fetcher = async () => html();
  let failPut = false;
  const key = request => new URL(typeof request === "string" ? request : request.url, origin).href;
  const caches = {
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      return {
        put: async (request, response) => { if (failPut) throw new Error("Quota"); stores.get(name).set(key(request), response.clone()); },
        match: async request => stores.get(name).get(key(request))?.clone(),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
  };
  vm.runInNewContext(source, {
    URL, Set, Promise, caches, fetch: (...args) => fetcher(...args),
    importScripts: () => { throw new Error("offline Firebase import"); },
    self: { location: { origin }, addEventListener: (event, listener) => handlers.set(event, listener),
      skipWaiting: async () => undefined, clients: { claim: async () => undefined } },
  });
  return {
    stores, caches,
    fetch: callback => { fetcher = callback; },
    quota: () => { failPut = true; },
    async lifecycle(type) { let pending; handlers.get(type)({ waitUntil: promise => { pending = promise; } }); await pending; },
    navigate(path = "/", destination = "document") {
      let pending;
      handlers.get("fetch")({ request: { method: "GET", mode: destination === "document" ? "navigate" : "no-cors", destination, url: origin + path },
        respondWith: promise => { pending = promise; } });
      return pending;
    },
  };
}

test("auth redirects, callbacks, API calls and login scripts bypass PWA cache entirely", async () => {
  const h = harness();
  for (const path of ["/__/auth/handler?code=secret", "/__/auth/iframe", "/signin", "/callback", "/.netlify/functions/appointments", "/api/auth"]) {
    assert.equal(h.navigate(path), undefined);
    assert.equal(h.navigate(path, "script"), undefined);
  }
  assert.equal(h.navigate("/unknown-page"), undefined);
  assert.equal(h.stores.size, 0);
});

test("login HTML and redirects cannot replace the cached application shell", async () => {
  const h = harness();
  await h.navigate();
  h.fetch(async () => html("<html>Login</html>", { path: "/__/auth/handler", redirected: true }));
  await h.navigate();
  h.fetch(async () => html("<html>Login</html>"));
  await h.navigate();
  h.fetch(async () => { throw new Error("offline"); });
  assert.equal(await (await h.navigate()).text(), shell);
});

test("offline navigation refuses a poisoned shell even if a cache entry already exists", async () => {
  const h = harness();
  const cache = await h.caches.open("bnb-barbershop-v15");
  await cache.put("/", html("<html>Login</html>"));
  h.fetch(async () => { throw new Error("offline"); });
  await assert.rejects(h.navigate());
});

test("activation removes old BNB caches but leaves unrelated caches alone", async () => {
  const h = harness();
  await h.caches.open("bnb-barbershop-v6");
  await h.caches.open("other-application");
  await h.lifecycle("install");
  await h.lifecycle("activate");
  assert.deepEqual([...h.stores.keys()].sort(), ["bnb-barbershop-v15", "other-application"]);
});

test("storage quota failure does not hide a successful network response", async () => {
  const h = harness();
  h.quota();
  assert.equal((await h.navigate()).status, 200);
});

test("a redirected or HTML response to a script request is never cached as JavaScript", async () => {
  const h = harness();
  await h.navigate("/assets/app.js", "script");
  h.fetch(async () => { throw new Error("offline"); });
  await assert.rejects(h.navigate("/assets/app.js", "script"));
});

test("installation under a login redirect does not cache its HTML at the root", async () => {
  const h = harness();
  h.fetch(async () => html("Login", { path: "/signin", redirected: true }));
  await h.lifecycle("install");
  assert.equal(await (await h.caches.open("bnb-barbershop-v15")).match("/"), undefined);
});
