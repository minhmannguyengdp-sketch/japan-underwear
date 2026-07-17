import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const [supplierArgument, auditArgument, outputArgument] = process.argv.slice(2);
if (!supplierArgument || !auditArgument) {
  throw new Error(
    "Usage: node scripts/catalog/build-tuan-thuy-supplier-color-reconciliation.mjs <supplier-manifest.json> <conflict-audit.json> [output.review.json]",
  );
}

const supplierPath = path.resolve(cwd, supplierArgument);
const auditPath = path.resolve(cwd, auditArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? "data/local/tuan-thuy-supplier-color-reconciliation.review.json",
);

const [supplierRaw, auditRaw] = await Promise.all([
  fs.readFile(supplierPath, "utf8"),
  fs.readFile(auditPath, "utf8"),
]);
const supplier = JSON.parse(supplierRaw);
const audit = JSON.parse(auditRaw);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseKey(key) {
  const [brand, category, modelCode] = clean(key).split(":");
  if (!brand || !category || !modelCode) {
    throw new Error(`Product key không hợp lệ: ${key}`);
  }
  return { brand, category, modelCode };
}

if (supplier.schemaVersion !== 1 || !Array.isArray(supplier.products)) {
  throw new Error("Supplier manifest không hợp lệ.");
}
if (audit.schemaVersion !== 1 || !Array.isArray(audit.conflicts)) {
  throw new Error("Conflict audit không hợp lệ.");
}

const supplierByKey = new Map();
for (const product of supplier.products) {
  const key = clean(product.key);
  parseKey(key);
  if (supplierByKey.has(key)) throw new Error(`Supplier product trùng: ${key}.`);
  const colors = (product.colors ?? []).map((color) => ({
    code: clean(color.code).toLowerCase(),
    name: clean(color.name),
  }));
  if (colors.length === 0 || new Set(colors.map((color) => color.code)).size !== colors.length) {
    throw new Error(`Supplier colors không hợp lệ: ${key}.`);
  }
  supplierByKey.set(key, colors);
}

const reconciliationProducts = [];
const seenKeys = new Set();
let deactivateColorCount = 0;
for (const conflict of audit.conflicts) {
  const key = clean(conflict.key);
  const identity = parseKey(key);
  if (seenKeys.has(key)) throw new Error(`Conflict product trùng: ${key}.`);
  seenKeys.add(key);

  const supplierColors = supplierByKey.get(key);
  if (!supplierColors) throw new Error(`Conflict không có trong supplier manifest: ${key}.`);

  const auditSupplierColors = (conflict.supplierColors ?? []).map((color) => ({
    code: clean(color.code).toLowerCase(),
    name: clean(color.name),
  }));
  if (JSON.stringify(auditSupplierColors) !== JSON.stringify(supplierColors)) {
    throw new Error(`Supplier colors trong audit đã lệch manifest: ${key}.`);
  }

  const expectedCodes = new Set(supplierColors.map((color) => color.code));
  const colorsToDeactivate = (conflict.unexpectedActiveColors ?? []).map((color) => ({
    code: clean(color.code).toLowerCase(),
    name: clean(color.name),
  }));
  if (colorsToDeactivate.length === 0) {
    throw new Error(`Conflict ${key} không có màu cần chuyển inactive.`);
  }
  if (
    new Set(colorsToDeactivate.map((color) => color.code)).size !== colorsToDeactivate.length ||
    colorsToDeactivate.some((color) => !color.code || !color.name || expectedCodes.has(color.code))
  ) {
    throw new Error(`Danh sách màu cần chuyển inactive không hợp lệ: ${key}.`);
  }

  deactivateColorCount += colorsToDeactivate.length;
  reconciliationProducts.push({
    key,
    ...identity,
    colorsToDeactivate,
    supplierCompleteColors: supplierColors,
  });
}

const expectedProductCount = Number(audit.summary?.productsWithUnexpectedActiveColors);
const expectedColorCount = Number(audit.summary?.unexpectedActiveColorCount);
if (
  reconciliationProducts.length !== expectedProductCount ||
  deactivateColorCount !== expectedColorCount ||
  reconciliationProducts.length <= 0 ||
  deactivateColorCount <= 0
) {
  throw new Error(
    `Conflict summary lệch: ${reconciliationProducts.length}/${expectedProductCount} product, ${deactivateColorCount}/${expectedColorCount} màu.`,
  );
}

const review = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceSupplierManifest: {
    path: supplierPath,
    sha256: sha256(supplierRaw),
  },
  sourceConflictAudit: {
    path: auditPath,
    sha256: sha256(auditRaw),
  },
  businessRules: {
    supplierListIsCompleteForMatchedProducts: true,
    deactivateOnlyUnexpectedActiveColors: true,
    neverDeleteColorRows: true,
    noProductCreation: true,
    noDescriptionWrite: true,
    noPriceWrite: true,
    noVariantWrite: true,
  },
  summary: {
    productCount: reconciliationProducts.length,
    colorCount: deactivateColorCount,
  },
  approval: {
    status: "pending",
    ownerApproved: false,
  },
  products: reconciliationProducts,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");

console.log("=== Supplier color reconciliation review ===");
console.log(`Products: ${review.summary.productCount}`);
console.log(`Colors to deactivate: ${review.summary.colorCount}`);
for (const product of review.products) {
  console.log(
    `${product.key}: ${product.colorsToDeactivate.map((color) => color.name).join(", ")} -> inactive`,
  );
}
console.log(`Output: ${outputPath}`);
console.log("Review only: chưa duyệt và chưa ghi PostgreSQL.");
