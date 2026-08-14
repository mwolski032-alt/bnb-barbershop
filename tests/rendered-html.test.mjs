import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the BNB booking app shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="pl"/i);
  assert.match(html, /BNB Barbershop/);
  assert.match(html, /Rezerwacja wizyty/);
  assert.match(html, /\/brand\/bnb-logo\.png/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site|codex-preview/i);
});

test("keeps BNB metadata and production assets wired", async () => {
  const [page, layout, manifest, serviceWorker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(page, /BNB Barbershop \| Rezerwacja wizyty/);
  assert.match(page, /<BookingHome \/>/);
  assert.match(layout, /applicationName:\s*"BNB Barbershop"/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest\?v=3"/);
  assert.match(manifest, /"name":\s*"BNB Barbershop"/);
  assert.match(serviceWorker, /bnb-barbershop-v3/);
});

test("keeps the premium client booking flow and safety controls", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /Twoja najbliższa wizyta/);
  assert.match(bookingHome, /className="booking-progress"/);
  assert.match(bookingHome, /Potwierdź nowy termin/);
  assert.match(bookingHome, /Odwołaj wizytę/);
  assert.match(bookingHome, /if \(direction === -1 && !canShiftToPreviousMonth\) return/);
  assert.match(bookingHome, /event\.key !== "Escape"/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.client-service-picker \.service-list/);
});

test("keeps the professional admin client directory and SMS workflow", async () => {
  const [bookingHome, styles] = await Promise.all([
    readFile(new URL("../app/booking-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(bookingHome, /const getAdminClientId/);
  assert.match(bookingHome, /const adminClientProfiles = useMemo/);
  assert.match(bookingHome, /className="client-search"/);
  assert.match(bookingHome, /Historia wizyt/);
  assert.match(bookingHome, /sms-composer-modal/);
  assert.match(bookingHome, /Otwórz aplikację SMS/);
  assert.match(bookingHome, /Potwierdzam Twoją wizytę/);
  assert.match(styles, /\.client-directory-tools/);
  assert.match(styles, /\.admin-client-profile-modal/);
  assert.match(styles, /\.sms-template-picker/);
});
