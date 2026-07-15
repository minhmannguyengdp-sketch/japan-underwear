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
const outputPath = path.resolve(
  process.cwd(),
  args[2] ?? decisionsArgument.replace(/\.json$/i, "") + ".review.json",
);
const decisions = JSON.parse(await fs.readFile(decisionsPath, "utf8"));
validateCompleteColorEvidence(decisions, "decisions");

const result = spawnSync(
  process.execPath,
  [path.resolve("scripts/catalog/build-tuan-thuy-image-color-review.mjs"), ...args],
  { cwd: process.cwd(), encoding: "utf8", stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const decisionsByKey = new Map(decisions.products.map((product) => [product.key, product]));
const review = JSON.parse(await fs.readFile(outputPath, "utf8"));
review.businessRules.observedImagesAloneDoNotProveCompleteness = true;
review.businessRules.colorSetCompletenessVerified = true;
review.summary.completeColorSetProductCount = 30;

for (const collectionName of ["candidateProducts", "productReviews"]) {
  for (const product of review[collectionName] ?? []) {
    const decision = decisionsByKey.get(product.key);
    if (!decision) throw new Error(`Thiếu quyết định nguồn cho ${product.key}.`);
    product.reviewEvidence = {
      ...(product.reviewEvidence ?? {}),
      colorSetComplete: true,
      completenessEvidenceTypes: decision.completenessEvidenceTypes,
      completenessEvidenceTexts: decision.completenessEvidenceTexts,
      completenessEvidenceUrls: decision.completenessEvidenceUrls,
    };
  }
}

validateCompleteColorEvidence(review, "review");
await fs.writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
console.log("Complete color-set evidence attached to review payload.");
