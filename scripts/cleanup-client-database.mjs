import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  databaseUrl,
  getAccessToken,
  readDatabase,
  readDatabaseWithEtag,
  writeDatabaseIfUnchanged,
} from "../netlify/functions/_firebase-admin.mjs";
import { buildClientDatabaseCleanup } from "../shared/client-cleanup.mjs";
import { validateCanonicalDatabase } from "../shared/data-model.mjs";

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readOption = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] ?? "") : fallback;
};
const readOptions = (name) =>
  args.flatMap((value, index) => (value === name && args[index + 1] ? [String(args[index + 1])] : []));

const apply = hasFlag("--apply");
const keepNames = readOptions("--keep-name");
const confirmedDatabaseUrl = readOption("--confirm-database-url");
const confirmedProjectId = readOption("--confirm-project-id");
const approvalToken = readOption("--approval-token");
const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputDirectory = path.resolve(
  readOption("--output-dir", path.join("migration-artifacts", `client-cleanup-${timestamp}`)),
);

if (keepNames.length === 0) throw new Error("Użyj --keep-name dla każdego klienta, który ma pozostać.");
if (apply && confirmedDatabaseUrl !== databaseUrl) {
  throw new Error("--confirm-database-url musi dokładnie odpowiadać FIREBASE_DATABASE_URL.");
}
if (apply && (!projectId || confirmedProjectId !== projectId)) {
  throw new Error("--confirm-project-id musi dokładnie odpowiadać FIREBASE_PROJECT_ID.");
}
if (apply && approvalToken !== "APPLY-CLIENT-DATABASE-CLEANUP") {
  throw new Error("Tryb --apply wymaga tokenu APPLY-CLIENT-DATABASE-CLEANUP.");
}

await mkdir(outputDirectory, { recursive: true });
const accessToken = await getAccessToken();
const snapshot = await readDatabaseWithEtag("", accessToken);
const cleanup = buildClientDatabaseCleanup(snapshot.value, { keepNames });
const validation = validateCanonicalDatabase(cleanup.data);
const blockingErrors = validation.errors.filter((error) => error.code !== "legacy_paths");
const backupContents = `${JSON.stringify(snapshot.value, null, 2)}\n`;
const candidateContents = `${JSON.stringify(cleanup.data, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const report = {
  ...cleanup.report,
  mode: apply ? "apply" : "dry-run",
  valid: blockingErrors.length === 0,
  errors: validation.errors,
  warnings: validation.warnings,
  backupSha256: sha256(backupContents),
  candidateSha256: sha256(candidateContents),
};

await Promise.all([
  writeFile(path.join(outputDirectory, "backup.json"), backupContents, "utf8"),
  writeFile(path.join(outputDirectory, "candidate.json"), candidateContents, "utf8"),
  writeFile(path.join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
]);

if (blockingErrors.length > 0) {
  throw new Error(`Czyszczenie zablokowane: ${blockingErrors.length} błędów integralności.`);
}

if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", ...cleanup.report }, null, 2));
} else {
  const written = await writeDatabaseIfUnchanged("", cleanup.data, snapshot.etag, accessToken);
  if (!written) throw new Error("Baza zmieniła się w trakcie czyszczenia. Zapis został przerwany.");
  const persisted = await readDatabase("", accessToken);
  const persistedValidation = validateCanonicalDatabase(persisted);
  const persistedBlockingErrors = persistedValidation.errors.filter(
    (error) => error.code !== "legacy_paths",
  );
  if (persistedBlockingErrors.length > 0) {
    throw new Error("Walidacja zapisanej bazy nie przeszła. Backup jest dostępny lokalnie.");
  }
  console.log(JSON.stringify({ mode: "apply", verified: true, ...cleanup.report }, null, 2));
}
