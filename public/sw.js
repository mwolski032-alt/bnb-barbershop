const CACHE_NAME = "bnb-barbershop-v3";
const STATIC_ASSET_TYPES = new Set(["font", "image", "manifest", "script", "style"]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
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
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }

      return networkResponse;
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }

  const notification = payload.notification ?? payload.data ?? {};
  const title = notification.title ?? "BNB Barbershop";
  const options = {
    body: notification.body ?? "Masz nowe powiadomienie.",
    icon: notification.icon ?? "/icons/icon-192.png",
    badge: notification.badge ?? "/icons/icon-192.png",
    tag: notification.tag ?? "bnb-barbershop",
    data: {
      url: payload.fcmOptions?.link ?? payload.data?.link ?? "/",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
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
          existingClient.focus();
          existingClient.navigate(targetUrl);
          return;
        }

        return self.clients.openWindow(targetUrl);
      }),
  );
});
