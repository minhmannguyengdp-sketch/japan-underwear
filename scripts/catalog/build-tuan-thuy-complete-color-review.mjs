import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { validateCompleteColorEvidence } from "./complete-color-evidence.mjs";

const args = process.argv.slice(2);
const decisionsArgument = args[1];
if (!decisionsArgument) {
  throw new Error(
    "Usage: node scripts/catalog/build-tuan-thuy-complete-color-review.mjs <approved-order-data.json> <reviewed-color-decisions.json> [output.json]",
  );
}

const decisionsPath = path.resolve(process.cwd(), decisionsArgument);
const decisions = JSON.parse(await fs.readFile(decisionsPath, "utf8"));
validateCompleteColorEvidence(decisions, "decisions");

const result = spawnSync(
  process.execPath,
  [path.resolve("scripts/catalog/build-tuan-thuy-image-color-review.mjs"), ...args],
  { cwd: process.cwd(), encoding: "utf8", stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
