import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const baseUrl = process.env.QA_URL || "http://127.0.0.1:4192";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});

const errors = [];
for (const viewport of [
  { name: "mobile", width: 393, height: 852 },
  { name: "desktop", width: 1280, height: 900 },
]) {
  await fetch(`${baseUrl}/qa-reset`);
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => sessionStorage.setItem("qa-auth", "1"));
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${viewport.name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${viewport.name}: ${message.text()}`);
  });

  await page.goto(`${baseUrl}/?role=client`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Moje wizyty" }).click();
  await page.getByRole("heading", { name: "Strzyzenie", level: 3 }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Umów ponownie/ }).count(), 1);
  await page.screenshot({ path: `outputs/repeat-visit-list-${viewport.name}.png`, fullPage: true });

  await page.getByRole("button", { name: /Umów ponownie/ }).click();
  await page.getByRole("heading", { name: "Znajdź dzień dla siebie." }).waitFor();
  assert.match(await page.locator(".story-recap").innerText(), /Mateusz/);
  assert.match(await page.locator(".story-recap").innerText(), /Strzyzenie/);
  await page.getByRole("button", { name: "Zamknij kreator" }).click();

  const cancelled = await page.evaluate(async () => {
    const response = await fetch("/.netlify/functions/appointments", {
      method: "POST",
      headers: {
        Authorization: "Bearer client-a-id-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "cancel_client",
        appointmentId: "mateusz-upcoming",
        operationId: `repeat-card-${Date.now()}`,
        expectedVersion: 1,
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

  await page.reload({ waitUntil: "networkidle" });
  const repeatCard = page.locator(".salon-repeat-card");
  await repeatCard.waitFor();
  assert.equal(await repeatCard.count(), 1);
  assert.match(await repeatCard.innerText(), /Czas na kolejne cięcie\?/);
  assert.match(await repeatCard.innerText(), /Ostatnio: Strzyzenie · Mateusz/);
  await page.screenshot({ path: `outputs/repeat-home-${viewport.name}.png`, fullPage: true });
  await repeatCard.getByRole("button", { name: /Umów ponownie/ }).click();
  await page.getByRole("heading", { name: "Znajdź dzień dla siebie." }).waitFor();

  await context.close();
}

await browser.close();
assert.deepEqual(errors, []);
console.log("Repeat booking QA passed on mobile and desktop.");
