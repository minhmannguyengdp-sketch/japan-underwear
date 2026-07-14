import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const [approvedArgument, decisionsArgument, outputArgument] = process.argv.slice(2);
if (!approvedArgument || !decisionsArgument) {
  throw new Error(
    "Usage: node scripts/catalog/build-tuan-thuy-image-color-review.mjs <approved-order-data.json> <reviewed-color-decisions.json> [output.json]",
  );
}

const approvedPath = path.resolve(cwd, approvedArgument);
const decisionsPath = path.resolve(cwd, decisionsArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? decisionsArgument.replace(/\.json$/i, "") + ".review.json",
);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const unique = (values) => [...new Set(values.filter(Boolean))];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function parseKey(key) {
  const [brand, category, modelCode] = clean(key).split(":");
  if (!brand || !category || !modelCode) throw new Error(`Product key không hợp lệ: ${key}`);
  return { brand, category, modelCode };
}

const [approvedRaw, decisionsRaw] = await Promise.all([
  fs.readFile(approvedPath, "utf8"),
  fs.readFile(decisionsPath, "utf8"),
]);
const approved = JSON.parse(approvedRaw);
const decisions = JSON.parse(decisionsRaw);

if (approved.schemaVersion !== 1) {
  throw new Error(`Approved order data schemaVersion phải là 1; nhận ${approved.schemaVersion}.`);
}
if (Number(approved.approval?.approvedVariantCandidateCount) !== 199) {
  throw new Error("Approved order data không còn đúng 199 size/cup đã duyệt.");
}
if (decisions.schemaVersion !== 1 || !Array.isArray(decisions.products)) {
  throw new Error("Reviewed color decisions phải có schemaVersion 1 và mảng products.");
}
if (Number(decisions.summary?.reviewedProductCount) !== 30) {
  throw new Error("Reviewed color decisions phải có đúng 30 product.");
}
if (Number(decisions.summary?.unresolvedProductCount) !== 0) {
  throw new Error("Reviewed color decisions vẫn còn product unresolved.");
}
if (!decisions.businessRules?.manualReviewOfLiveProductImages) {
  throw new Error("Reviewed color decisions thiếu xác nhận review ảnh live.");
}
if (!decisions.businessRules?.noAutomatedColorInferenceFromFilenames) {
  throw new Error("Reviewed color decisions phải cấm suy màu tự động từ tên file.");
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

const decisionsByKey = new Map();
for (const item of decisions.products) {
  const key = clean(item.key);
  parseKey(key);
  if (decisionsByKey.has(key)) throw new Error(`Reviewed color decisions trùng product: ${key}`);
  decisionsByKey.set(key, item);
}
const unexpectedKeys = [...decisionsByKey.keys()].filter((key) => !missingColorKeys.includes(key));
const absentKeys = missingColorKeys.filter((key) => !decisionsByKey.has(key));
if (unexpectedKeys.length || absentKeys.length) {
  throw new Error(
    `Reviewed color decisions lệch baseline. Thừa: ${unexpectedKeys.join(", ") || "không"}; thiếu: ${absentKeys.join(", ") || "không"}.`,
  );
}

let colorCandidateCount = 0;
const candidateProducts = missingColorKeys.map((key) => {
  const identity = parseKey(key);
  const decision = decisionsByKey.get(key);
  const sourceUrls = unique((decision.sourceUrls ?? []).map((value) => clean(value)));
  if (sourceUrls.length === 0) throw new Error(`Product ${key} thiếu source URL.`);
  const colors = (decision.colors ?? []).map((color, index) => {
    const code = clean(color.code).toLowerCase();
    const name = clean(color.name);
    const sortOrder = Number(color.sortOrder ?? index);
    const evidenceTypes = unique((color.evidenceTypes ?? []).map((value) => clean(value)));
    const evidenceTexts = unique((color.evidenceTexts ?? []).map((value) => clean(value)));
    const evidenceUrls = unique((color.evidenceUrls ?? []).map((value) => clean(value)));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || !name) {
      throw new Error(`Màu không hợp lệ: ${key} ${code}/${name}`);
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new Error(`sortOrder không hợp lệ: ${key}:${code}:${sortOrder}`);
    }
    if (!evidenceTypes.includes("manual-live-image-review")) {
      throw new Error(`Màu ${key}:${code} thiếu evidence type manual-live-image-review.`);
    }
    if (evidenceTexts.length === 0 || evidenceUrls.length < 2) {
      throw new Error(`Màu ${key}:${code} thiếu mô tả hoặc URL bằng chứng ảnh live.`);
    }
    return {
      code,
      name,
      sortOrder,
      sourceSystem: clean(color.sourceSystem) || "tuanthuy-manual-live-image-review",
      evidenceTypes,
      evidenceTexts,
      evidenceUrls,
    };
  });
  if (colors.length === 0) throw new Error(`Product ${key} không có màu đã review.`);
  if (new Set(colors.map((color) => color.code)).size !== colors.length) {
    throw new Error(`Product ${key} có mã màu trùng.`);
  }
  colorCandidateCount += colors.length;
  return {
    key,
    ...identity,
    sourceUrls,
    colors: colors.sort((left, right) => left.sortOrder - right.sortOrder),
    disposition: "candidate",
    reviewEvidence: {
      imageUrl: clean(decision.imageUrl) || null,
      previewSha256: clean(decision.previewSha256) || null,
      reviewedBy: clean(decisions.reviewedBy) || null,
    },
  };
});

if (colorCandidateCount !== Number(decisions.summary?.reviewedColorCount)) {
  throw new Error(
    `Số màu review lệch: ${colorCandidateCount}/${decisions.summary?.reviewedColorCount}.`,
  );
}

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
    path: decisionsPath,
    sha256: sha256(decisionsRaw),
    generatedAt: decisions.generatedAt ?? null,
    source: decisions.source ?? null,
    sourcePreview: decisions.sourcePreview ?? null,
  },
  businessRules: {
    productIdentity: "brand + category + model",
    preserveApprovedSizeCupExactly: true,
    sourceVerifiedColorsOnly: true,
    manualReviewOfLiveProductImages: true,
    noAutomatedColorInferenceFromFilenames: true,
    colorImportIsSeparateFromVariantImport: true,
    noDatabaseWrite: true,
  },
  summary: {
    approvedVariantProductCount: variantKeys.length,
    targetMissingColorProductCount: missingColorKeys.length,
    candidateProductCount: candidateProducts.length,
    candidateColorCount: colorCandidateCount,
    unresolvedProductCount: 0,
    unresolvedAuditPageCount: 0,
  },
  candidateProducts,
  unresolvedProducts: [],
  unresolvedAuditPages: [],
  productReviews: candidateProducts,
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log("=== Tuấn Thủy live-image color review ===");
console.log("Preserved size/cup: 32 products / 199 variants");
console.log(`Targets reviewed: ${candidateProducts.length}`);
console.log(`Color candidates: ${colorCandidateCount}`);
console.log("Unresolved products: 0");
console.log(`Output: ${outputPath}`);
