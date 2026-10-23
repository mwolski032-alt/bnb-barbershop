import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
fs.mkdirSync("outputs", { recursive: true });
const qaBaseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:4191";

try {
  for (const width of [360, 1440]) {
    await fetch(`${qaBaseUrl}/qa-reset`);
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await page.goto(
      `${qaBaseUrl}/?event=admin_rescheduled&appointment=mateusz-upcoming`,
    );
    await page.getByRole("button", { name: /Zaloguj|Kontynuuj z Google/ }).click();

    const confirmation = page.getByRole("alertdialog");
    await confirmation.waitFor();
    await confirmation.getByRole("heading", { name: "Potwierdź nowy termin" }).waitFor();
    await confirmation.getByRole("button", { name: "Potwierdzam nowy termin" }).waitFor();
    await confirmation.getByRole("button", { name: "Termin mi nie pasuje" }).waitFor();
    await page.waitForTimeout(250);

    const layout = await confirmation.evaluate((element) => {
      const alternative = element.querySelector("button.alternative");
      const matchedBackgroundRules = [];
      const collectRules = (rules) => {
        for (const rule of rules) {
          if (rule.cssRules) collectRules(rule.cssRules);
          if (!rule.selectorText || !rule.style?.background) continue;
          try {
            if (alternative.matches(rule.selectorText)) {
              matchedBackgroundRules.push({
                selector: rule.selectorText,
                background: rule.style.background,
                priority: rule.style.getPropertyPriority("background"),
              });
            }
          } catch {}
        }
      };
      for (const sheet of document.styleSheets) collectRules(sheet.cssRules);
      return {
        className: element.className,
        alternativeClassName: alternative.className,
        alternativeMatchesOverride: alternative.matches(
          ".client-appointment-modal .notification-confirmation-actions button.alternative",
        ),
        height: Math.round(element.getBoundingClientRect().height),
        viewportHeight: innerHeight,
        viewportFits: document.documentElement.scrollWidth <= innerWidth,
        surfaceToken: getComputedStyle(alternative).getPropertyValue("--color-surface"),
        alternativeBackground: getComputedStyle(alternative).backgroundColor,
        matchedBackgroundRules,
      };
    });
    assert.match(layout.className, /notification-confirmation-modal/);
    if (width === 360) assert.ok(layout.height >= layout.viewportHeight - 1, JSON.stringify(layout));
    assert.equal(layout.viewportFits, true);
    assert.equal(layout.alternativeMatchesOverride, true);
    assert.equal(layout.alternativeBackground, "rgb(251, 244, 231)", JSON.stringify(layout));
    await page.screenshot({
      path: `outputs/integration-notification-confirmation-${width}.png`,
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(`PASS notification confirmation ${width}px`);
    await page.close();
  }
} finally {
  await browser.close();
}
