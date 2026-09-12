const CACHE_NAME = "bnb-barbershop-v23";
const APP_SHELL_URL = "/";
const ASSET_MANIFEST_URL = "/asset-manifest.json";
const APP_SHELL = [
  APP_SHELL_URL,
  "/manifest.webmanifest?v=10",
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
const readBuildAssets = async () => {
  try {
    const response = await fetch(ASSET_MANIFEST_URL, { cache: "reload" });
    if (!response.ok || response.redirected) return [];
    const manifest = await response.json();
    return Array.isArray(manifest?.assets)
      ? manifest.assets.filter((path) => typeof path === "string" && /^\/assets\/[A-Za-z0-9._-]+$/.test(path)).slice(0, 100)
      : [];
  } catch {
    return [];
  }
};
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
  const confirmActionToken = data.confirmActionToken ?? "";
  const isSupportedAndroid = /Android/i.test(self.navigator?.userAgent ?? "");
  const options = {
    body: notification.body ?? data.body ?? "Masz nowe powiadomienie.",
    icon: notification.icon ?? data.icon ?? "/icons/icon-192.png",
    badge: notification.badge ?? data.badge ?? "/icons/notification-b-v4.png",
    tag: notification.tag ?? data.tag ?? "bnb-barbershop",
    data: {
      url: payload.fcmOptions?.link ?? data.link ?? "/",
      confirmActionToken,
    },
    ...(confirmActionToken && isSupportedAndroid
      ? {
          actions: [
            { action: "confirm", title: "Potwierdź" },
            { action: "details", title: "Zobacz szczegóły" },
          ],
        }
      : {}),
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
      .then(async (cache) => {
        const buildAssets = await readBuildAssets();
        const paths = [...new Set([...APP_SHELL, ASSET_MANIFEST_URL, ...buildAssets])];
        await Promise.allSettled(paths.map(async (path) => {
          const response = await fetch(path, { cache: "reload" });
          if (path === APP_SHELL_URL ? await isAppShell(response) : response.ok && !response.redirected &&
            !(response.headers.get("content-type") || "").includes("text/html")) {
            await cache.put(path, response);
          }
        }));
      })
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

const openNotificationTarget = async (targetUrl) => {
  const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existingClient = clientList.find((client) => client.url.startsWith(self.location.origin));
  if (existingClient) {
    const navigatedClient = await existingClient.navigate(targetUrl);
    return navigatedClient?.focus();
  }
  return self.clients.openWindow(targetUrl);
};

const confirmAppointmentFromNotification = async (notification, targetUrl) => {
  try {
    const response = await fetch("/.netlify/functions/notification-action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: notification.data?.confirmActionToken ?? "" }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      await self.registration.showNotification("Sprawdź termin wizyty", {
        body: result.error ?? "Nie udało się potwierdzić terminu. Otwórz szczegóły wizyty.",
        icon: "/icons/icon-192.png",
        badge: "/icons/notification-b-v4.png",
        tag: notification.tag,
        data: { url: targetUrl, confirmActionToken: "" },
      });
      return;
    }
    await self.registration.showNotification("Termin potwierdzony", {
      body: result.message ?? "Nowy termin wizyty został potwierdzony.",
      icon: "/icons/icon-192.png",
      badge: "/icons/notification-b-v4.png",
      tag: notification.tag,
      data: { url: targetUrl, confirmActionToken: "" },
    });
  } catch {
    await self.registration.showNotification("Sprawdź termin wizyty", {
      body: "Brak połączenia. Otwórz szczegóły i spróbuj ponownie.",
      icon: "/icons/icon-192.png",
      badge: "/icons/notification-b-v4.png",
      tag: notification.tag,
      data: { url: targetUrl, confirmActionToken: "" },
    });
  }
};

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const targetUrl = new URL(notification.data?.url ?? "/", self.location.origin).href;
  notification.close();

  if (event.action === "confirm" && notification.data?.confirmActionToken) {
    event.waitUntil(confirmAppointmentFromNotification(notification, targetUrl));
    return;
  }

  event.waitUntil(openNotificationTarget(targetUrl));
});
