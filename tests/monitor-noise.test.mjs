import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

// The build machine runs an older Node that cannot import .ts files directly, so the two files are compiled
// with TypeScript here, exactly as the build does, and imported from a temporary folder.
const folder = await mkdtemp(join(tmpdir(), "bnb-monitor-"));
const loadTypeScript = async (path, replacements = []) => {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const file = join(folder, `${path.split("/").pop().replace(/\.ts$/, "")}.mjs`);
  await writeFile(file, outputText);
  return import(pathToFileURL(file).href);
};

// The monitor and the view-transition helper are browser code; a few stand-ins are enough to run them here.
const storage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    has: (key) => data.has(key),
  };
};
const local = storage();
const session = storage();
let reloads = 0;
let online = true;
let visibility = "visible";
const calls = [];

globalThis.localStorage = local;
globalThis.sessionStorage = session;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    get onLine() { return online; },
    userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36",
  },
});
globalThis.window = globalThis;
globalThis.location = { pathname: "/", href: "https://bnb.example/", reload: () => { reloads += 1; } };
globalThis.document = {
  get visibilityState() { return visibility; },
  body: { dataset: {} },
  documentElement: { classList: { add: () => undefined, remove: () => undefined } },
  querySelector: () => null,
};
globalThis.matchMedia = () => ({ matches: false });
globalThis.addEventListener = () => undefined;
globalThis.removeEventListener = () => undefined;
globalThis.fetch = async (url, init) => { calls.push([String(url), init?.body]); return new Response("{}"); };

const { reportClientError } = await loadTypeScript("app/lib/client-error-monitoring.ts");
const queued = () => JSON.parse(local.getItem("bnb-diagnostic-queue-v1") ?? "[]").map((report) => report.message);

test("harmless browser noise is not reported", () => {
  for (const message of [
    "Error: Database is closing/hidden",
    "Firebase: Error (auth/network-request-failed).",
    "Transition was aborted because of invalid state",
    "Transition was skipped",
  ]) {
    reportClientError("promise", message);
  }
  assert.deepEqual(queued(), []);
});

test("a real fault is still queued for the owner", () => {
  reportClientError("javascript", "Cannot read properties of undefined (reading 'map')", "TypeError: x\n at a");
  assert.deepEqual(queued(), ["Cannot read properties of undefined (reading 'map')"]);
});

test("a page built before the latest deployment reloads once instead of reporting an error", () => {
  reportClientError("promise", "Failed to fetch dynamically imported module: https://bnb.example/assets/admin-calendar-screen-abc.js");
  assert.equal(reloads, 1);
  reportClientError("promise", "error loading dynamically imported module");
  assert.equal(reloads, 1, "no second reload within a minute");
  assert.ok(!queued().some((message) => /dynamically imported/.test(message)));
  // Offline there is nothing to fetch, so nothing to reload either.
  session.removeItem("bnb-stale-build-reload-at");
  online = false;
  reportClientError("promise", "Importing a module script failed.");
  online = true;
  assert.equal(reloads, 1);
});

test("a skipped or aborted view transition leaves no unhandled rejection behind", async () => {
  // flushSync only matters to React; the stand-in just runs the update.
  const { withViewTransition } = await loadTypeScript("app/lib/view-transition.ts", [
    [/import \{ flushSync \} from "react-dom";/, "const flushSync = (update) => update();"],
  ]);
  let updated = 0;
  const reject = () => Promise.reject(new DOMException("Transition was aborted because of invalid state", "InvalidStateError"));
  document.startViewTransition = (update) => { update(); return { finished: reject(), ready: reject(), updateCallbackDone: reject() }; };
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  withViewTransition(() => { updated += 1; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(updated, 1);
  assert.deepEqual(unhandled, []);
});
