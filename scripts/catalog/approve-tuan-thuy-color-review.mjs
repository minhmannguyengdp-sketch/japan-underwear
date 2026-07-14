import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const inputArgument = args.find((arg) => !arg.startsWith("--"));
const approve = args.includes("--approve");
const outputArgument = args.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);
for (const arg of args) {
  if (arg !== inputArgument && arg !== "--approve" && !arg.startsWith("--output=")) {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}
if (!inputArgument) {
  throw new Error(
    "Usage: node scripts/catalog/approve-tuan-thuy-color-review.mjs <color-review.json> --approve [--output=approved.json]",
  );
}
if (!approve) throw new Error("Thiếu --approve. Chưa tạo file màu được duyệt.");

const inputPath = path.resolve(cwd, inputArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? inputArgument.replace(/\.json$/i, "") + ".approved.json",
);
const raw = await fs.readFile(inputPath, "utf8");
const review = JSON.parse(raw);

if (review.schemaVersion !== 1) {
  throw new Error(`Color review schemaVersion phải là 1; nhận ${review.schemaVersion}.`);
}
if (Number(review.summary?.approvedVariantProductCount) !== 32) {
  throw new Error("Color review không còn liên kết với đúng 32 product size/cup.");
}
if (Number(review.sourceApprovedOrderData?.approvedVariantCandidateCount) !== 199) {
  throw new Error("Color review không còn khóa đúng 199 size/cup đã duyệt.");
}
if (Number(review.summary?.targetMissingColorProductCount) !== 30) {
  throw new Error("Color review không còn đúng baseline 30 product thiếu màu.");
}
if (Number(review.summary?.unresolvedProductCount) !== 0) {
  throw new Error(
    `Còn ${review.summary?.unresolvedProductCount} product chưa có màu công khai được xác nhận; không được approve.`,
  );
}

const products = review.candidateProducts ?? [];
if (products.length !== 30 || new Set(products.map((item) => item.key)).size !== 30) {
  throw new Error(`Phải có đúng 30 product màu được duyệt; nhận ${products.length}.`);
}

const seenColorKeys = new Set();
let approvedColorCount = 0;
for (const product of products) {
  if (!(product.sourceUrls ?? []).length) {
    throw new Error(`Product ${product.key} thiếu URL bằng chứng.`);
  }
  if (!(product.colors ?? []).length) {
    throw new Error(`Product ${product.key} không có màu.`);
  }
  for (const color of product.colors) {
    const code = String(color.code ?? "").trim().toLowerCase();
    const name = String(color.name ?? "").trim();
    const sortOrder = Number(color.sortOrder);
    if (!code || !name || !Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new Error(`Màu không hợp lệ: ${product.key} ${code}/${name}/${sortOrder}`);
    }
    if (!(color.evidenceUrls ?? []).length || !(color.evidenceTypes ?? []).length) {
      throw new Error(`Màu ${product.key}:${code} thiếu bằng chứng web.`);
    }
    const uniqueKey = `${product.key}:${code}`;
    if (seenColorKeys.has(uniqueKey)) throw new Error(`Màu trùng: ${uniqueKey}`);
    seenColorKeys.add(uniqueKey);
    approvedColorCount += 1;
  }
}

if (approvedColorCount !== Number(review.summary?.candidateColorCount)) {
  throw new Error(
    `Số màu lệch: ${approvedColorCount}/${review.summary?.candidateColorCount}.`,
  );
}

const approval = {
  schemaVersion: 1,
  approvedAt: new Date().toISOString(),
  sourceReview: {
    path: inputPath,
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    generatedAt: review.generatedAt ?? null,
  },
  sourceApprovedOrderData: review.sourceApprovedOrderData,
  sourceColorAudit: review.sourceColorAudit,
  approval: {
    approvedBy: "catalog-owner-cli",
    approvedProductCount: products.length,
    approvedColorCount,
    preservesApprovedVariantPayloadSha256:
      review.sourceApprovedOrderData.approvedVariantPayloadSha256,
    explicitWebsiteColorsOnly: true,
    noColorInferenceFromImagesOrFilenames: true,
    colorImportIsSeparateFromVariantImport: true,
  },
  approvedProducts: products,
};

await fs.writeFile(outputPath, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
console.log("=== Tuấn Thủy color approval ===");
console.log(`Approved products: ${products.length}`);
console.log(`Approved colors: ${approvedColorCount}`);
console.log("Approved size/cup payload remains unchanged: 32 products / 199 variants.");
console.log("No database write performed.");
console.log(`Output: ${outputPath}`);
