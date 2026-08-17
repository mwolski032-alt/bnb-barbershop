import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  databaseUrl,
  getAccessToken,
  readDatabase,
  readDatabaseWithEtag,
  writeDatabaseIfUnchanged,
} from "../netlify/functions/_firebase-admin.mjs";
import {
  buildCanonicalMigration,
  validateCanonicalDatabase,
} from "../shared/data-model.mjs";

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readOption = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] ?? "") : fallback;
};

if (hasFlag("--help")) {
  console.log(`Użycie:
  npm run data:migrate:dry-run -- [--input backup.json] [--legacy-barber-id mateusz]
  node scripts/migrate-data-model.mjs --apply \\
    --confirm-database-url <dokładny URL> --confirm-project-id <projectId> \\
    --approval-token APPLY-CANONICAL-DATA-MIGRATION

Domyślnie skrypt wykonuje wyłącznie dry-run i zapisuje lokalny backup, kandydata oraz raport.`);
  process.exit(0);
}

const apply = hasFlag("--apply");
const inputPath = readOption("--input");
const legacyBarberId = readOption("--legacy-barber-id", "mateusz");
const confirmedDatabaseUrl = readOption("--confirm-database-url");
const confirmedProjectId = readOption("--confirm-project-id");
const approvalToken = readOption("--approval-token");
const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputDirectory = path.resolve(
  readOption("--output-dir", path.join("migration-artifacts", timestamp)),
);

if (apply && inputPath) {
  throw new Error("Tryb --apply nie przyjmuje --input. Zapis produkcyjny zawsze pobiera świeży snapshot z ETag.");
}
if (apply && confirmedDatabaseUrl !== databaseUrl) {
  throw new Error("--confirm-database-url musi dokładnie odpowiadać FIREBASE_DATABASE_URL.");
}
if (apply && (!projectId || confirmedProjectId !== projectId)) {
  throw new Error("--confirm-project-id musi dokładnie odpowiadać FIREBASE_PROJECT_ID.");
}
if (apply && approvalToken !== "APPLY-CANONICAL-DATA-MIGRATION") {
  throw new Error("Tryb --apply wymaga jawnego --approval-token APPLY-CANONICAL-DATA-MIGRATION.");
}

await mkdir(outputDirectory, { recursive: true });

let source;
let etag = "";
if (inputPath) {
  source = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
} else {
  const accessToken = await getAccessToken();
  const snapshot = await readDatabaseWithEtag("", accessToken);
  source = snapshot.value;
  etag = snapshot.etag;
}

const backupContents = `${JSON.stringify(source, null, 2)}\n`;
await writeFile(path.join(outputDirectory, "backup.json"), backupContents, "utf8");

const migration = buildCanonicalMigration(source, { legacyBarberId });
const candidateContents = `${JSON.stringify(migration.data, null, 2)}\n`;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const report = {
  ...migration.report,
  mode: apply ? "apply" : "dry-run",
  databaseUrl: inputPath ? "local-input" : databaseUrl,
  projectId: inputPath ? "local-input" : projectId,
  backupFile: path.join(outputDirectory, "backup.json"),
  candidateFile: path.join(outputDirectory, "candidate.json"),
  backupSha256: sha256(backupContents),
  candidateSha256: sha256(candidateContents),
};

await Promise.all([
  writeFile(
    path.join(outputDirectory, "candidate.json"),
    candidateContents,
    "utf8",
  ),
  writeFile(
    path.join(outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
]);

if (!report.canApply) {
  console.error(`Migracja zablokowana: ${report.errors.length} błędów integralności.`);
  console.error(`Raport: ${path.join(outputDirectory, "report.json")}`);
  process.exitCode = 1;
} else if (!apply) {
  console.log("Dry-run zakończony. Baza nie została zmodyfikowana.");
  console.log(`Zmiany: ${report.changes.length}. Raport: ${path.join(outputDirectory, "report.json")}`);
} else {
  const accessToken = await getAccessToken();
  const written = await writeDatabaseIfUnchanged("", migration.data, etag, accessToken);
  if (!written) {
    throw new Error("Baza zmieniła się od wykonania backupu. Zapis przerwany; uruchom nowy dry-run.");
  }
  const persisted = await readDatabase("", accessToken);
  const postWriteValidation = validateCanonicalDatabase(persisted);
  await writeFile(
    path.join(outputDirectory, "post-write-validation.json"),
    `${JSON.stringify(postWriteValidation, null, 2)}\n`,
    "utf8",
  );
  if (!postWriteValidation.valid) {
    throw new Error("Walidacja po zapisie nie przeszła. Użyj backup.json do kontrolowanego przywrócenia.");
  }
  console.log("Migracja zapisana i zweryfikowana.");
  console.log(`Backup: ${path.join(outputDirectory, "backup.json")}`);
}
