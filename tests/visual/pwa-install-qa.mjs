import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const baseUrl = process.env.QA_URL || "http://127.0.0.1:4191";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});

const openSalon = async (userAgent) => {
  await fetch(`${baseUrl}/qa-reset`);
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    userAgent,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${baseUrl}/?role=client`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Zainstaluj aplikację", exact: true }).waitFor();
  return { context, page, errors };
};

try {
  const android = await openSalon(
    "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 Chrome/152 Mobile Safari/537.36",
  );
  await android.page.evaluate(() => {
    const installEvent = new Event("beforeinstallprompt", { cancelable: true });
    let promptCalls = 0;
    Object.defineProperties(installEvent, {
      prompt: { value: async () => { promptCalls += 1; } },
      userChoice: { value: Promise.resolve({ outcome: "accepted", platform: "web" }) },
    });
    window.__bnbInstallPromptCalls = () => promptCalls;
    window.dispatchEvent(installEvent);
  });
  await android.page.getByRole("button", { name: "Zainstaluj aplikację", exact: true }).click();
  await android.page.waitForFunction(() => window.__bnbInstallPromptCalls?.() === 1);
  assert.match(
    await android.page.locator(".salon-feedback.success").innerText(),
    /Instalacja została zaakceptowana/,
  );
  await android.page.getByRole("button", { name: "Umów wizytę", exact: true }).click();
  await android.page.getByRole("button", { name: /Kontynuuj z Google/ }).waitFor();
  assert.equal(
    await android.page.getByRole("button", { name: "Zainstaluj aplikację", exact: true }).count(),
    0,
  );
  assert.deepEqual(android.errors, []);
  await android.context.close();

  const ios = await openSalon(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
  );
  await ios.page.getByRole("button", { name: "Zainstaluj aplikację", exact: true }).click();
  const guide = ios.page.getByRole("dialog");
  await guide.getByRole("heading", { name: "Otwórz stronę w Safari" }).waitFor();
  assert.match(await guide.innerText(), /Instrukcja instalacji na iPhonie i iPadzie/);
  assert.deepEqual(ios.errors, []);
  await ios.context.close();
} finally {
  await browser.close();
}

console.log("PWA install QA passed for Android prompt, iOS fallback and login cleanup.");
