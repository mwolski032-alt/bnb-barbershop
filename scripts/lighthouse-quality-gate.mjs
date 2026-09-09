import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { launch } from "chrome-launcher";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

if (process.platform !== "win32") {
  const cli = fileURLToPath(new URL("../node_modules/@lhci/cli/src/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "autorun"], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const outputDirectory = path.join(projectRoot, ".lighthouseci");
const staticDirectory = path.join(projectRoot, "dist", "client");
const mimeTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const normalizedPath = path.normalize(relativePath);
    if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
      response.writeHead(400).end("Bad request");
      return;
    }
    let filePath = path.join(staticDirectory, normalizedPath);
    try {
      if (!(await stat(filePath)).isFile()) filePath = path.join(staticDirectory, "index.html");
    } catch {
      filePath = path.join(staticDirectory, "index.html");
    }
    response.setHeader("Content-Type", mimeTypes[path.extname(filePath)] ?? "application/octet-stream");
    response.end(await readFile(filePath));
  } catch (error) {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : "Server error");
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") throw new Error("Nie udało się uruchomić kontroli Lighthouse.");

let chrome;
let report;
try {
  chrome = await launch({
    chromeFlags: ["--headless", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const result = await lighthouse(
    `http://127.0.0.1:${address.port}/`,
    { logLevel: "error", output: "json", port: chrome.port },
    desktopConfig,
  );
  if (!result) throw new Error("Lighthouse nie zwrócił raportu.");
  report = result.lhr;
} finally {
  server.close();
  if (chrome) {
    try {
      await chrome.kill();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The Windows sandbox can allow Chrome to start while denying taskkill.
      // The report is already complete at this point, so treat only the known
      // cleanup permission error as non-fatal. CI runs on Linux and still uses
      // LHCI's normal lifecycle.
      if (!/EPERM|Permission denied|Access denied/i.test(message)) throw error;
    }
  }
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "local-report.json"), JSON.stringify(report), "utf8");

const categoryThresholds = {
  performance: 0.6,
  accessibility: 0.9,
  "best-practices": 0.9,
  seo: 0.85,
};
const metricThresholds = {
  "first-contentful-paint": 3500,
  "largest-contentful-paint": 4000,
  "total-blocking-time": 600,
  "cumulative-layout-shift": 0.1,
};
const failures = [];

for (const [id, minimum] of Object.entries(categoryThresholds)) {
  const score = report.categories[id]?.score;
  if (typeof score !== "number" || score < minimum) failures.push(`${id}: ${score ?? "brak"} < ${minimum}`);
}
for (const [id, maximum] of Object.entries(metricThresholds)) {
  const value = report.audits[id]?.numericValue;
  if (typeof value !== "number" || value > maximum) failures.push(`${id}: ${value ?? "brak"} > ${maximum}`);
}

const summary = Object.fromEntries(Object.keys(categoryThresholds).map(id => [id, report.categories[id]?.score]));
console.log("Lighthouse:", summary);
if (failures.length) throw new Error(`Bramka Lighthouse nie przeszła:\n${failures.join("\n")}`);
console.log("Lighthouse quality gate passed.");
