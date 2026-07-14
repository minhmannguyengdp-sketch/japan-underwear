import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const [approvedArgument, auditArgument, outputArgument] = process.argv.slice(2);
if (!approvedArgument || !auditArgument) {
  throw new Error(
    "Usage: node scripts/catalog/build-tuan-thuy-color-review.mjs <approved-order-data.json> <color-audit.json> [output.json]",
  );
}

const approvedPath = path.resolve(cwd, approvedArgument);
const auditPath = path.resolve(cwd, auditArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? auditArgument.replace(/\.json$/i, "") + ".review.json",
);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set(values.filter(Boolean))];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseKey(key) {
  const [brand, category, modelCode] = clean(key).split(":");
  if (!brand || !category || !modelCode) throw new Error(`Product key không hợp lệ: ${key}`);
  return { brand, category, modelCode };
}

const [approvedRaw, auditRaw] = await Promise.all([
  fs.readFile(approvedPath, "utf8"),
  fs.readFile(auditPath, "utf8"),
]);
const approved = JSON.parse(approvedRaw);
const audit = JSON.parse(auditRaw);

if (approved.schemaVersion !== 1) {
  throw new Error(`Approved order data schemaVersion phải là 1; nhận ${approved.schemaVersion}.`);
}
if (Number(approved.approval?.approvedVariantCandidateCount) !== 199) {
  throw new Error("Approved order data không còn đúng 199 size/cup đã duyệt.");
}
if (audit.schemaVersion !== 1 || !Array.isArray(audit.products)) {
  throw new Error("Color audit phải có schemaVersion 1 và mảng products.");
}

const variantPayload = approved.approvedVariantCandidates ?? [];
const variantKeys = variantPayload.map((item) => clean(item.key));
if (variantKeys.length !== 32 || new Set(variantKeys).size !== 32) {
  throw new Error(`Approved size/cup phải có đúng 32 product; nhận ${variantKeys.length}.`);
}

const existingColorKeys = new Set(
  (approved.approvedColorCandidates ?? []).map((item) => clean(item.key)),
);
const missingColorKeys = variantKeys.filter((key) => !existingColorKeys.has(key)).sort();
if (missingColorKeys.length !== 30) {
  throw new Error(`Baseline phải có đúng 30 product có size/cup nhưng thiếu màu; nhận ${missingColorKeys.length}.`);
}

const pageGroups = new Map();
const unresolvedAuditPages = [];
for (const page of audit.products) {
  const key = clean(page.key);
  if (!key) {
    unresolvedAuditPages.push({
      sourceUrl: page.sourceUrl ?? null,
      name: page.name ?? null,
      reason: "unresolved-product-identity",
    });
    continue;
  }
  if (!missingColorKeys.includes(key)) continue;
  parseKey(key);
  const group = pageGroups.get(key) ?? {
    key,
    sourceUrls: [],
    colors: new Map(),
  };
  if (page.sourceUrl) group.sourceUrls.push(String(page.sourceUrl));
  for (const color of page.colors ?? []) {
    const code = clean(color.code).toLowerCase();
    const name = clean(color.name);
    const evidenceTypes = unique((color.evidenceTypes ?? []).map(clean));
    const evidenceTexts = unique((color.evidenceTexts ?? []).map(clean));
    if (!code || !name || evidenceTypes.length === 0 || evidenceTexts.length === 0) continue;
    const current = group.colors.get(code) ?? {
      code,
      name,
      evidenceTypes: [],
      evidenceTexts: [],
      evidenceUrls: [],
    };
    if (current.name !== name) {
      throw new Error(`Màu ${key}:${code} có nhiều tên: ${current.name}/${name}.`);
    }
    current.evidenceTypes.push(...evidenceTypes);
    current.evidenceTexts.push(...evidenceTexts);
    if (page.sourceUrl) current.evidenceUrls.push(String(page.sourceUrl));
    group.colors.set(code, current);
  }
  pageGroups.set(key, group);
}

const productReviews = missingColorKeys.map((key) => {
  const identity = parseKey(key);
  const group = pageGroups.get(key);
  const colors = group
    ? [...group.colors.values()]
        .map((color, index) => ({
          code: color.code,
          name: color.name,
          sortOrder: index,
          sourceSystem: "tuanthuy-explicit-color-audit",
          evidenceTypes: unique(color.evidenceTypes).sort(),
          evidenceTexts: unique(color.evidenceTexts),
          evidenceUrls: unique(color.evidenceUrls).sort(),
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "vi"))
        .map((color, index) => ({ ...color, sortOrder: index }))
    : [];
  return {
    key,
    ...identity,
    sourceUrls: unique(group?.sourceUrls ?? []).sort(),
    colors,
    disposition: colors.length > 0 ? "candidate" : "unresolved",
  };
});

const unresolvedProducts = productReviews.filter((item) => item.colors.length === 0);
const candidateProducts = productReviews.filter((item) => item.colors.length > 0);
const colorCandidateCount = candidateProducts.reduce((sum, item) => sum + item.colors.length, 0);

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceApprovedOrderData: {
    path: approvedPath,
    sha256: sha256(approvedRaw),
    approvedVariantPayloadSha256: sha256(JSON.stringify(variantPayload)),
    approvedVariantProductCount: variantKeys.length,
    approvedVariantCandidateCount: 199,
  },
  sourceColorAudit: {
    path: auditPath,
    sha256: sha256(auditRaw),
    generatedAt: audit.generatedAt ?? null,
    source: audit.source ?? null,
  },
  businessRules: {
    productIdentity: "brand + category + model",
    preserveApprovedSizeCupExactly: true,
    explicitWebsiteColorsOnly: true,
    noColorInferenceFromImagesOrFilenames: true,
    colorImportIsSeparateFromVariantImport: true,
    noDatabaseWrite: true,
  },
  summary: {
    approvedVariantProductCount: variantKeys.length,
    targetMissingColorProductCount: missingColorKeys.length,
    candidateProductCount: candidateProducts.length,
    candidateColorCount: colorCandidateCount,
    unresolvedProductCount: unresolvedProducts.length,
    unresolvedAuditPageCount: unresolvedAuditPages.length,
  },
  candidateProducts,
  unresolvedProducts,
  unresolvedAuditPages,
  productReviews,
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log("=== Tuấn Thủy missing-color review ===");
console.log("Preserved size/cup: 32 products / 199 variants");
console.log(`Targets missing color: ${missingColorKeys.length}`);
console.log(`Color candidates: ${candidateProducts.length} products / ${colorCandidateCount} colors`);
console.log(`Unresolved products: ${unresolvedProducts.length}`);
console.log(`Output: ${outputPath}`);
