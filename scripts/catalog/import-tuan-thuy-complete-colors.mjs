import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { validateCompleteColorEvidence } from "./complete-color-evidence.mjs";

const args = process.argv.slice(2);
const inputArgument = args.find((arg) => !arg.startsWith("--"));
if (!inputArgument) {
  throw new Error(
    "Usage: node scripts/catalog/import-tuan-thuy-complete-colors.mjs <approved-colors.json> [--apply]",
  );
}

const approvedPath = path.resolve(process.cwd(), inputArgument);
const approved = JSON.parse(await fs.readFile(approvedPath, "utf8"));
validateCompleteColorEvidence(approved, "approved");

const result = spawnSync(
  process.execPath,
  [path.resolve("scripts/catalog/import-tuan-thuy-reviewed-colors.mjs"), ...args],
  { cwd: process.cwd(), encoding: "utf8", stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
