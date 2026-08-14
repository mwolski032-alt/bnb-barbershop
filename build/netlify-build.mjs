import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteCli, "build"], {
  env: {
    ...process.env,
    NETLIFY: "true",
    NITRO_PRESET: "netlify",
  },
  stdio: "inherit",
});

const exitCode = await new Promise((resolve) => {
  child.on("exit", (code) => resolve(code ?? 1));
});

process.exit(exitCode);
