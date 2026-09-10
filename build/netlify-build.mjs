import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const vinextCli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const child = spawn(process.execPath, [vinextCli, "build"], {
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  output += chunk;
  process.stderr.write(chunk);
});

const exitCode = await new Promise((resolve) => {
  child.on("close", (code) => resolve(code ?? 1));
});

const completedStaticExport =
  existsSync(fileURLToPath(new URL("../dist/client/index.html", import.meta.url))) &&
  output.includes("Build complete");
if (completedStaticExport) {
  const assetsDirectory = fileURLToPath(new URL("../dist/client/assets/", import.meta.url));
  const manifestPath = fileURLToPath(new URL("../dist/client/asset-manifest.json", import.meta.url));
  const assets = readdirSync(assetsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.endsWith(".map"))
    .map((entry) => `/assets/${entry.name}`)
    .sort();
  writeFileSync(manifestPath, JSON.stringify({ assets }, null, 2));
}
const knownWindowsShutdownAssertion =
  process.platform === "win32" && output.includes("UV_HANDLE_CLOSING");

if (exitCode !== 0 && completedStaticExport && knownWindowsShutdownAssertion) {
  process.stderr.write(
    "[build] Vinext completed the static export before a known Node.js Windows shutdown assertion.\n",
  );
  process.exit(0);
}

process.exit(exitCode);
