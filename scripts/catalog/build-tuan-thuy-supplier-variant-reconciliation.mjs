import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const [supplierArgument, auditArgument, outputArgument] = process.argv.slice(2);
if (!supplierArgument || !auditArgument) {
  throw new Error(
    "Usage: node scripts/catalog/build-tuan-thuy-supplier-variant-reconciliation.mjs <supplier-color-variant-manifest.json> <variant-conflict-audit.json> [output.review.json]",
  );
}

const supplierPath = path.resolve(cwd, supplierArgument);
const auditPath = path.resolve(cwd, auditArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? "data/local/tuan-thuy-supplier-variant-reconciliation.review.json",
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

function normalizeVariant(variant) {
  const sizeCode = clean(variant?.sizeCode);
  const cupCode = clean(variant?.cupCode).toUpperCase();
  if (!/^\d{2,3}$/.test(sizeCode) || !/^[A-Z]+$/.test(cupCode)) {
    throw new Error(`Variant không hợp lệ: ${sizeCode}${cupCode}.`);
  }
  return { sizeCode, cupCode };
}

function variantKey(variant) {
  return `${variant.sizeCode}:${variant.cupCode}`;
}

if (supplier.schemaVersion !== 1 || !Array.isArray(supplier.products)) {
  throw new Error("Supplier color–size/cup manifest không hợp lệ.");
}
if (audit.schemaVersion !== 1 || !Array.isArray(audit.conflicts)) {
  throw new Error("Variant conflict audit không hợp lệ.");
}

const supplierByKey = new Map();
for (const product of supplier.products) {
  const key = clean(product.key);
  parseKey(key);
  if (supplierByKey.has(key)) throw new Error(`Supplier product trùng: ${key}.`);
  const variants = (product.uniqueVariants ?? []).map(normalizeVariant);
  if (
    variants.length === 0 ||
    new Set(variants.map(variantKey)).size !== variants.length
  ) {
    throw new Error(`Supplier variants không hợp lệ: ${key}.`);
  }
  supplierByKey.set(key, variants);
}

const reconciliationProducts = [];
const seenKeys = new Set();
let deactivateVariantCount = 0;
for (const conflict of audit.conflicts) {
  const key = clean(conflict.key);
  const identity = parseKey(key);
  if (seenKeys.has(key)) throw new Error(`Conflict product trùng: ${key}.`);
  seenKeys.add(key);

  const supplierVariants = supplierByKey.get(key);
  if (!supplierVariants) {
    throw new Error(`Conflict không có trong supplier manifest: ${key}.`);
  }

  const auditSupplierVariants = (conflict.supplierCompleteVariants ?? []).map(normalizeVariant);
  if (JSON.stringify(auditSupplierVariants) !== JSON.stringify(supplierVariants)) {
    throw new Error(`Supplier variants trong audit đã lệch manifest: ${key}.`);
  }

  const expectedKeys = new Set(supplierVariants.map(variantKey));
  const variantsToDeactivate = (conflict.unexpectedActiveVariants ?? []).map((variant) => ({
    id: clean(variant.id),
    ...normalizeVariant(variant),
  }));
  if (variantsToDeactivate.length === 0) {
    throw new Error(`Conflict ${key} không có variant cần chuyển inactive.`);
  }
  if (
    variantsToDeactivate.some((variant) => !/^[a-f0-9-]{36}$/i.test(variant.id)) ||
    new Set(variantsToDeactivate.map(variantKey)).size !== variantsToDeactivate.length ||
    variantsToDeactivate.some((variant) => expectedKeys.has(variantKey(variant)))
  ) {
    throw new Error(`Danh sách variant cần chuyển inactive không hợp lệ: ${key}.`);
  }

  deactivateVariantCount += variantsToDeactivate.length;
  reconciliationProducts.push({
    key,
    ...identity,
    productId: clean(conflict.productId),
    variantsToDeactivate,
    supplierCompleteVariants: supplierVariants,
  });
}

const expectedProductCount = Number(audit.summary?.productsWithUnexpectedActiveVariants);
const expectedVariantCount = Number(audit.summary?.unexpectedActiveVariantCount);
if (
  reconciliationProducts.length !== expectedProductCount ||
  deactivateVariantCount !== expectedVariantCount ||
  reconciliationProducts.length <= 0 ||
  deactivateVariantCount <= 0
) {
  throw new Error(
    `Conflict summary lệch: ${reconciliationProducts.length}/${expectedProductCount} product, ${deactivateVariantCount}/${expectedVariantCount} variant.`,
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
    supplierVariantUnionIsCompleteForMatchedProducts: true,
    deactivateOnlyUnexpectedActiveVariants: true,
    neverDeleteVariantRows: true,
    noProductCreation: true,
    noColorWrite: true,
    noDescriptionWrite: true,
    noPriceWrite: true,
    noOrderWrite: true,
    historicalOrderSnapshotsUnchanged: true,
    noAvailabilityWrite: true,
  },
  summary: {
    productCount: reconciliationProducts.length,
    variantCount: deactivateVariantCount,
  },
  approval: {
    status: "pending",
    ownerApproved: false,
  },
  products: reconciliationProducts,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");

console.log("=== Supplier variant reconciliation review ===");
console.log(`Products: ${review.summary.productCount}`);
console.log(`Variants to deactivate: ${review.summary.variantCount}`);
for (const product of review.products) {
  console.log(
    `${product.key}: ${product.variantsToDeactivate
      .map((variant) => `${variant.sizeCode}${variant.cupCode}`)
      .join(", ")} -> inactive`,
  );
}
console.log(`Output: ${outputPath}`);
console.log("Review only: chưa duyệt và chưa ghi PostgreSQL.");
