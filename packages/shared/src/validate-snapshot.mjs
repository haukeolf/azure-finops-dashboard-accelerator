import { readFile } from "node:fs/promises";
import { validateDashboardSnapshot } from "./schema.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node validate-snapshot.mjs <snapshot.json>");
  process.exit(1);
}

const snapshot = JSON.parse(await readFile(file, "utf8"));
validateDashboardSnapshot(snapshot);
console.log(`Snapshot is valid: ${file}`);

