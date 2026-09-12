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
function harness({ userAgent = "Desktop Chrome" } = {}) {
  const handlers = new Map();
  const stores = new Map();
  const shownNotifications = [];
  const openedWindows = [];
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
  const clients = {
    claim: async () => undefined,
    matchAll: async () => [],
    openWindow: async url => { openedWindows.push(url); },
  };
  vm.runInNewContext(source, {
    URL, Set, Promise, caches, fetch: (...args) => fetcher(...args),
    importScripts: () => { throw new Error("offline Firebase import"); },
    self: {
      location: { origin }, navigator: { userAgent },
      addEventListener: (event, listener) => handlers.set(event, listener),
      skipWaiting: async () => undefined,
      registration: {
        showNotification: async (title, options) => { shownNotifications.push({ title, options }); },
      },
      clients,
    },
  });
  return {
    stores, caches, shownNotifications, openedWindows,
    fetch: callback => { fetcher = callback; },
    quota: () => { failPut = true; },
    async lifecycle(type) { let pending; handlers.get(type)({ waitUntil: promise => { pending = promise; } }); await pending; },
    navigate(path = "/", destination = "document") {
      let pending;
      handlers.get("fetch")({ request: { method: "GET", mode: destination === "document" ? "navigate" : "no-cors", destination, url: origin + path },
        respondWith: promise => { pending = promise; } });
      return pending;
    },
    async push(payload) {
      let pending;
      handlers.get("push")({
        data: { json: () => payload },
        waitUntil: promise => { pending = promise; },
      });
      await pending;
    },
    async notificationClick(index, action = "") {
      let pending;
      const displayed = shownNotifications[index];
      handlers.get("notificationclick")({
        action,
        notification: {
          ...displayed.options,
          close: () => undefined,
        },
        waitUntil: promise => { pending = promise; },
      });
      await pending;
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
  const cache = await h.caches.open("bnb-barbershop-v23");
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
  assert.deepEqual([...h.stores.keys()].sort(), ["bnb-barbershop-v23", "other-application"]);
});

test("installation precaches lazy application files from the build manifest", async () => {
  const h = harness();
  h.fetch(async input => {
    const path = new URL(typeof input === "string" ? input : input.url, origin).pathname;
    if (path === "/") return html();
    if (path === "/asset-manifest.json") {
      return Response.json({ assets: ["/assets/admin-clients-screen-test.js", "/assets/index-test.css"] });
    }
    const contentType = path.endsWith(".css") ? "text/css" : "application/javascript";
    return new Response("asset", { headers: { "content-type": contentType } });
  });
  await h.lifecycle("install");
  const cache = await h.caches.open("bnb-barbershop-v23");
  assert.ok(await cache.match("/assets/admin-clients-screen-test.js"));
  assert.ok(await cache.match("/assets/index-test.css"));
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
  assert.equal(await (await h.caches.open("bnb-barbershop-v23")).match("/"), undefined);
});

test("Android reschedule notification offers confirmation and details actions", async () => {
  const h = harness({ userAgent: "Mozilla/5.0 (Linux; Android 16) Chrome/152 Mobile" });
  let actionRequest;
  h.fetch(async (input, options) => {
    actionRequest = { input: String(input), options };
    return Response.json({ ok: true, message: "Nowy termin wizyty został potwierdzony." });
  });
  await h.push({
    data: {
      title: "Potwierdź nowy termin wizyty",
      body: "Strzyżenie: 20.09.2026 o 14:30.",
      link: `${origin}/?event=admin_rescheduled&appointment=visit-1`,
      tag: "appointment-visit-1-admin_rescheduled",
      confirmActionToken: "signed-confirmation-token",
    },
  });

  assert.deepEqual(
    Array.from(h.shownNotifications[0].options.actions, action => [action.action, action.title]),
    [["confirm", "Potwierdź"], ["details", "Zobacz szczegóły"]],
  );
  await h.notificationClick(0, "confirm");
  assert.equal(actionRequest.input, "/.netlify/functions/notification-action");
  assert.equal(actionRequest.options.method, "POST");
  assert.deepEqual(JSON.parse(actionRequest.options.body), { token: "signed-confirmation-token" });
  assert.equal(h.shownNotifications[1].title, "Termin potwierdzony");
  assert.equal(h.openedWindows.length, 0);
});

test("unsupported devices keep the current detail-opening notification", async () => {
  const h = harness({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)" });
  const target = `${origin}/?event=admin_rescheduled&appointment=visit-2`;
  await h.push({
    data: {
      title: "Potwierdź nowy termin wizyty",
      link: target,
      confirmActionToken: "signed-confirmation-token",
    },
  });

  assert.equal(h.shownNotifications[0].options.actions, undefined);
  await h.notificationClick(0);
  assert.deepEqual(h.openedWindows, [target]);
});
