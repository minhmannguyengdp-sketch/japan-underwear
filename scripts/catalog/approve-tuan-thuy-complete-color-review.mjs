import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { validateCompleteColorEvidence } from "./complete-color-evidence.mjs";

const args = process.argv.slice(2);
const inputArgument = args.find((arg) => !arg.startsWith("--"));
if (!inputArgument) {
  throw new Error(
    "Usage: node scripts/catalog/approve-tuan-thuy-complete-color-review.mjs <color-review.json> --approve [--output=approved.json]",
  );
}

const reviewPath = path.resolve(process.cwd(), inputArgument);
const outputArgument = args.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
const outputPath = path.resolve(
  process.cwd(),
  outputArgument ?? inputArgument.replace(/\.json$/i, "") + ".approved.json",
);
const review = JSON.parse(await fs.readFile(reviewPath, "utf8"));
validateCompleteColorEvidence(review, "review");

const result = spawnSync(
  process.execPath,
  [path.resolve("scripts/catalog/approve-tuan-thuy-color-review.mjs"), ...args],
  { cwd: process.cwd(), encoding: "utf8", stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const approved = JSON.parse(await fs.readFile(outputPath, "utf8"));
approved.approval.observedImagesAloneDoNotProveCompleteness = true;
approved.approval.colorSetCompletenessVerified = true;
validateCompleteColorEvidence(approved, "approved");
await fs.writeFile(outputPath, `${JSON.stringify(approved, null, 2)}\n`, "utf8");
console.log("Complete color-set evidence attached to approved payload.");
