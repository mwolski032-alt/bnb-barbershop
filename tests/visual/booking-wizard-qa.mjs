// Start salon-preview.mjs first. This suite never writes to production.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
fs.mkdirSync("outputs", { recursive: true });
try {
  for (const width of [320, 360, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 820 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    async function screen(step) {
      await page.locator(`.story-progress li:nth-child(${step})[aria-current=step]`).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}, step ${step}`);
      await page.screenshot({ path: `outputs/wizard-${width}-${step}.png`, fullPage: true });
    }
    await page.goto("http://127.0.0.1:4188/wizard");
    await page.getByRole("button", { name: "Umów wizytę" }).click();
    await screen(1);
    await page.getByRole("button", { name: /Mateusz Kowalski/ }).click();
    await screen(2);
    await page.getByRole("button", { name: /Strzyżenie włosów/ }).click();
    await screen(3);
    await page.getByRole("button", { name: "8 września 2026, dostępny", exact: true }).click();
    await screen(4);
    await page.getByRole("button", { name: "11:00", exact: true }).click();
    await screen(5);
    await page.getByLabel("Imię i nazwisko").fill("Jan Testowy");
    await page.getByLabel("Numer telefonu").fill("123");
    assert.equal(await page.getByRole("button", { name: /Przejdź do podsumowania/ }).isDisabled(), true);
    await page.getByLabel("Numer telefonu").fill("123456789");
    // Native browser Back models the Android Back navigation event.
    await page.evaluate(() => history.back());
    await screen(4);
    assert.equal(await page.getByRole("button", { name: "11:00", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "11:00", exact: true }).click();
    assert.equal(await page.getByLabel("Numer telefonu").inputValue(), "123456789");
    await page.getByRole("button", { name: /Przejdź do podsumowania/ }).click();
    await screen(6);
    assert.match(await page.locator(".story-ticket").innerText(), /Jan Testowy/);
    for (let step = 5; step >= 1; step--) {
      await page.getByRole("button", {name: "Wstecz", exact: true}).click();
      await screen(step);
    }
    assert.equal(await page.getByRole("button", {name: /Mateusz Kowalski/}).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", {name: /Mateusz Kowalski/}).click();
    assert.equal(await page.getByRole("button", {name: /Strzyżenie włosów/}).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", {name: /Strzyżenie włosów/}).click();
    assert.equal(await page.getByRole("button", {name: "8 września 2026, dostępny", exact:true}).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", {name: "8 września 2026, dostępny", exact:true}).click();
    await page.getByRole("button", {name: "11:00", exact:true}).click();
    assert.equal(await page.getByLabel("Imię i nazwisko").inputValue(), "Jan Testowy");
    await page.setViewportSize({width,height:480});
    await page.getByLabel("Numer telefonu").focus();
    await page.getByRole("button", {name: /Przejdź do podsumowania/}).click();
    await page.setViewportSize({width,height:820});
    await context.setOffline(true);
    await page.getByText(/Jesteś offline/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Potwierdzam rezerwację" }).isDisabled(), true);
    await context.setOffline(false);
    await page.getByRole("button", { name: "Potwierdzam rezerwację" }).waitFor();
    // Dispatch two synchronous events: the ref lock must stop the second write.
    await page.getByRole("button", { name: "Potwierdzam rezerwację" }).evaluate(button => { button.click(); button.click(); });
    assert.equal(await page.getByRole("button", {name:"Zamknij kreator"}).isDisabled(), true);
    await page.getByText("Test: chwilowy błąd zapisu. Spróbuj ponownie.").waitFor();
    assert.match(await page.locator(".story-ticket").innerText(), /Jan Testowy/);
    await page.getByRole("button", { name: "Potwierdzam rezerwację" }).click();
    await page.getByRole("heading", { name: "Wizyta potwierdzona" }).waitFor();
    assert.equal(await page.getByLabel("Liczba zapisów").innerText(), "2", "one failed request + one retry only");
    await page.waitForURL("**/wizard");
    await page.getByRole("button", { name: "Umów wizytę" }).click();
    await page.getByRole("button", { name: "Zamknij kreator" }).click();
    await page.waitForURL("**/wizard");
    await page.getByRole("button", { name: "Umów wizytę" }).click();
    await page.waitForURL("**#rezerwacja");
    await page.evaluate(() => history.back());
    await page.getByRole("button", { name: "Umów wizytę" }).waitFor();
    assert.deepEqual(errors, [], `console at ${width}`);
    console.log(`PASS ${width}px: six steps, browser Back, retained details, offline, failed request/retry, duplicate lock, close, console, overflow`);
    await context.close();
  }
} finally { await browser.close(); }
