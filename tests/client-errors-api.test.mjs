import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

test("anonymous phone report is sanitized and aggregated through the server", async () => {
  const previousFetch = global.fetch;
  const previousClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const previousPrivateKey = process.env.FIREBASE_PRIVATE_KEY;
  let storedReport = null;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FIREBASE_CLIENT_EMAIL = "monitor@example.test";
  process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  global.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "monitor-access-token" });
    }
    if (url.includes("/clientErrorReports/") && (!options.method || options.method === "GET")) {
      return new Response("null", { status: 200, headers: { etag: "null_etag" } });
    }
    if (url.includes("/clientErrorReports/") && options.method === "PUT") {
      storedReport = JSON.parse(options.body);
      return Response.json(storedReport);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const { default: handler } = await import(`../netlify/functions/client-errors.mjs?test=${Date.now()}`);
    const response = await handler(new Request("https://bnbbarber.netlify.app/api/client-errors", {
      method: "POST",
      headers: { Origin: "https://bnbbarber.netlify.app", "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "javascript",
        message: "Błąd klienta jan@example.com, +48 501 234 567",
        route: "/?email=jan@example.com",
        screen: "rezerwacja-krok-5",
        deviceId: "random-device-id",
        fullName: "Jan Testowy",
        device: { os: "Android 15", browser: "Chrome 152", viewport: "390x844", installed: true },
      }),
    }));
    assert.equal(response.status, 202, await response.text());
    assert.ok(storedReport);
    assert.doesNotMatch(JSON.stringify(storedReport), /jan@example|501 234|Jan Testowy/i);
    assert.equal(storedReport.count, 1);
    assert.equal(storedReport.screen, "rezerwacja-krok-5");
    assert.equal(storedReport.device.os, "Android 15");
    assert.equal("deviceId" in storedReport, false);
  } finally {
    global.fetch = previousFetch;
    if (previousClientEmail === undefined) delete process.env.FIREBASE_CLIENT_EMAIL;
    else process.env.FIREBASE_CLIENT_EMAIL = previousClientEmail;
    if (previousPrivateKey === undefined) delete process.env.FIREBASE_PRIVATE_KEY;
    else process.env.FIREBASE_PRIVATE_KEY = previousPrivateKey;
  }
});

test("monitoring endpoint rejects foreign sites before accessing Firebase", async () => {
  const previousFetch = global.fetch;
  let externalCalls = 0;
  global.fetch = async () => { externalCalls += 1; throw new Error("must not run"); };
  try {
    const { default: handler } = await import(`../netlify/functions/client-errors.mjs?origin=${Date.now()}`);
    const response = await handler(new Request("https://bnbbarber.netlify.app/api/client-errors", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "fake" }),
    }));
    assert.equal(response.status, 403);
    assert.equal(externalCalls, 0);
  } finally {
    global.fetch = previousFetch;
  }
});
