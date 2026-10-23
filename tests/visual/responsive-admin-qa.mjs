import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:4191";
const viewports = [
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop", width: 1366, height: 900 },
  { name: "desktop-wide", width: 1600, height: 1000 },
];

fs.mkdirSync("outputs", { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

try {
  for (const viewport of viewports) {
    await fetch(`${baseUrl}/qa-reset`);
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );

    await page.goto(`${baseUrl}/?role=barber`);
    await page.getByRole("button", { name: "Umów wizytę", exact: true }).click();
    await page.getByRole("button", { name: /Kontynuuj z Google/ }).click();
    await page.getByRole("button", { name: "Zamknij kreator" }).click();
    await page.getByRole("button", { name: /Twój panel/ }).click();
    await page.getByRole("heading", { name: "4 najbliższe wizyty" }).waitFor();

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      };
      const cards = [...document.querySelectorAll(".nearest-appointment-card")].map((element) => {
        const box = element.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height) };
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        shell: rect(".app-shell.admin-page"),
        panel: rect(".admin-view"),
        content: rect(".admin-content-frame"),
        header: rect(".nearest-section-header"),
        list: rect(".nearest-appointments-list"),
        waitlist: rect(".admin-waitlist"),
        navigation: rect(".admin-bottom-nav"),
        cards,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });

    assert.equal(layout.overflow, false);
    assert.ok(
      layout.waitlist.y - (layout.list.y + layout.list.height) <= 20,
      `waitlist must follow the nearest cards without an empty band: ${JSON.stringify(layout)}`,
    );
    if (viewport.name.startsWith("tablet")) {
      assert.ok(layout.shell.width >= viewport.width * 0.9, "tablet panel should use the available width");
      assert.ok(
        Math.abs(layout.navigation.x - (layout.shell.x + 16)) <= 2,
        "tablet navigation should align with the panel content",
      );
    }
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: `outputs/responsive-admin-${viewport.name}.png`,
      fullPage: true,
    });
    console.log(JSON.stringify({ name: viewport.name, ...layout }));

    const screens = [
      { name: "calendar", role: "tab", button: "Kalendarz", ready: ".schedule-desktop-grid, .schedule-mobile-agenda" },
      { name: "clients", role: "tab", button: "Klienci", ready: ".clients-view" },
      { name: "analytics", role: "button", button: "Analiza", ready: ".analytics-view" },
      { name: "work", role: "button", button: "Praca", ready: ".work-view" },
      { name: "profile", role: "button", button: "Profil", ready: ".barber-profile-view" },
    ];
    for (const screen of screens) {
      await page.getByRole(screen.role, { name: screen.button, exact: true }).click();
      await page.locator(screen.ready).first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({
        path: `outputs/responsive-${screen.name}-${viewport.name}.png`,
        fullPage: true,
      });
    }

    await page.close();
  }
} finally {
  await browser.close();
}
