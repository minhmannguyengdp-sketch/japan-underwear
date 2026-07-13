import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument) {
  throw new Error(
    "Usage: node scripts/catalog/consolidate-tuan-thuy-order-audit.mjs <raw-audit.json> [output.json]",
  );
}

const outputPath = path.resolve(
  cwd,
  outputArgument ?? inputArgument.replace(/\.json$/i, "") + ".consolidated.json",
);

await import("./consolidate-tuan-thuy-audit.mjs");

const output = JSON.parse(await fs.readFile(outputPath, "utf8"));
output.schemaVersion = 2;
output.businessRules = {
  productIdentity: "brand + category + model",
  orderVariantIdentity: "product + size + cup",
  orderLineIdentity: "product + color + size + cup",
  colorsAreProductLevelOrderChoices: true,
  colorsParticipateInCartIdentity: true,
  colorsDoNotControlGallery: true,
  noColorImageMapping: true,
  noPrecomputedColorSizeCupCartesianRows: true,
  websitePricesAreAuditEvidenceOnly: true,
  authoritativePricingSource: "price-reference",
  noDatabaseWrite: true,
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log("Order-line rules normalized: product + color + size + cup.");
