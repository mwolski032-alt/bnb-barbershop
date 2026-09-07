const CACHE_NAME = "bnb-barbershop-v8";
const APP_SHELL_URL = "/";
const APP_SHELL = [
  APP_SHELL_URL,
  "/manifest.webmanifest?v=4",
  "/brand/bnb-logo.png",
  "/icons/icon-192.png?v=3",
];
const STATIC_ASSET_TYPES = new Set(["font", "image", "manifest", "script", "style"]);
const isAppShell = async (response) => response.ok && !response.redirected &&
  new URL(response.url || self.location.origin).pathname === "/" &&
  (response.headers.get("content-type") || "").includes("text/html") &&
  (await response.clone().text()).includes('data-bnb-app-shell="true"');
const isExcludedPath = (path) => path.startsWith("/__/") || path.startsWith("/.netlify/") ||
  path.startsWith("/api/") || path.startsWith("/signin") || path.startsWith("/callback") || path.startsWith("/auth/");
let firebaseMessagingReady = false;
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyATrBnGXzcxUR8r6Y-AeAeXDVPeKAjrymU",
  authDomain: "bnbbarber-9a7bd.firebaseapp.com",
  databaseURL: "https://bnbbarber-9a7bd-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bnbbarber-9a7bd",
  storageBucket: "bnbbarber-9a7bd.firebasestorage.app",
  messagingSenderId: "100630377058",
  appId: "1:100630377058:web:6cb84e6a208220153f173b",
  measurementId: "G-KJCB540XC8",
};

const showPushNotification = (payload = {}) => {
  const notification = payload.notification ?? {};
  const data = payload.data ?? {};
  const title = notification.title ?? data.title ?? "BNB Barbershop";
  const options = {
    body: notification.body ?? data.body ?? "Masz nowe powiadomienie.",
    icon: notification.icon ?? data.icon ?? "/icons/icon-192.png",
    badge: notification.badge ?? data.badge ?? "/icons/notification-b-v4.png",
    tag: notification.tag ?? data.tag ?? "bnb-barbershop",
    data: {
      url: payload.fcmOptions?.link ?? data.link ?? "/",
    },
  };

  return self.registration.showNotification(title, options);
};

try {
  importScripts("https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js");

  firebase.initializeApp(FIREBASE_CONFIG);
  firebase.messaging().onBackgroundMessage((payload) => {
    return showPushNotification(payload);
  });
  firebaseMessagingReady = true;
} catch {
  // The plain Push API fallback below still handles notifications if Firebase
  // cannot be loaded in the service worker.
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map(async (path) => {
        const response = await fetch(path, { cache: "reload" });
        if (path === APP_SHELL_URL ? await isAppShell(response) : response.ok && !response.redirected &&
          !(response.headers.get("content-type") || "").includes("text/html")) {
          await cache.put(path, response);
        }
      })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("bnb-barbershop-") && key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || isExcludedPath(url.pathname)) {
    return;
  }

  if (request.mode === "navigate") {
    if (url.pathname !== APP_SHELL_URL) return;
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const networkResponse = await fetch(request);
          if (await isAppShell(networkResponse)) {
            await cache.put(APP_SHELL_URL, networkResponse.clone()).catch(() => undefined);
          }
          return networkResponse;
        } catch (error) {
          const cachedShell = await cache.match(APP_SHELL_URL);
          if (cachedShell && await isAppShell(cachedShell)) return cachedShell;
          throw error;
        }
      }),
    );
    return;
  }

  if (!STATIC_ASSET_TYPES.has(request.destination)) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) return cachedResponse;

      const networkResponse = await fetch(request);
      if (networkResponse.ok && !networkResponse.redirected &&
          !(networkResponse.headers.get("content-type") || "").includes("text/html")) {
        await cache.put(request, networkResponse.clone()).catch(() => undefined);
      }

      return networkResponse;
    }),
  );
});

self.addEventListener("push", (event) => {
  if (firebaseMessagingReady) {
    return;
  }

  let payload = {};

  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }

  event.waitUntil(showPushNotification(payload));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.url ?? "/", self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        const existingClient = clientList.find((client) => client.url.startsWith(self.location.origin));

        if (existingClient) {
          return existingClient
            .navigate(targetUrl)
            .then((navigatedClient) => navigatedClient?.focus());
        }

        return self.clients.openWindow(targetUrl);
      }),
  );
});
