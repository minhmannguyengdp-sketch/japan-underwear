import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const inputArgument = args.find((arg) => !arg.startsWith("--"));
const approve = args.includes("--approve");
const outputOption = args.find((arg) => arg.startsWith("--output="));
for (const arg of args) {
  if (arg !== inputArgument && arg !== "--approve" && arg !== outputOption) {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}
if (!inputArgument || !approve) {
  throw new Error(
    "Usage: node scripts/catalog/approve-tuan-thuy-supplier-color-reconciliation.mjs <review.json> --approve [--output=approved.json]",
  );
}

const inputPath = path.resolve(cwd, inputArgument);
const raw = await fs.readFile(inputPath, "utf8");
const review = JSON.parse(raw);
const outputPath = path.resolve(
  cwd,
  outputOption?.slice("--output=".length) || inputPath.replace(/\.json$/i, ".approved.json"),
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function verifySource(source, label) {
  if (!source?.path || !/^[a-f0-9]{64}$/i.test(clean(source.sha256))) {
    throw new Error(`${label} thiếu path hoặc SHA-256.`);
  }
  const sourceRaw = await fs.readFile(path.resolve(cwd, source.path), "utf8");
  if (sha256(sourceRaw) !== clean(source.sha256).toLowerCase()) {
    throw new Error(`${label} đã thay đổi sau khi tạo review.`);
  }
}

if (review.schemaVersion !== 1) throw new Error("Review schemaVersion phải là 1.");
await Promise.all([
  verifySource(review.sourceSupplierManifest, "Supplier manifest"),
  verifySource(review.sourceConflictAudit, "Conflict audit"),
]);

const rules = review.businessRules ?? {};
if (
  !rules.supplierListIsCompleteForMatchedProducts ||
  !rules.deactivateOnlyUnexpectedActiveColors ||
  !rules.neverDeleteColorRows ||
  !rules.noProductCreation ||
  !rules.noDescriptionWrite ||
  !rules.noPriceWrite ||
  !rules.noVariantWrite
) {
  throw new Error("Review thiếu quy tắc bảo toàn dữ liệu bắt buộc.");
}

const products = review.products ?? [];
const productCount = Number(review.summary?.productCount);
const colorCount = products.reduce(
  (sum, product) => sum + (product.colorsToDeactivate ?? []).length,
  0,
);
if (
  products.length !== productCount ||
  colorCount !== Number(review.summary?.colorCount) ||
  products.length <= 0 ||
  colorCount <= 0
) {
  throw new Error("Review summary không khớp danh sách reconciliation.");
}

const approved = {
  ...review,
  approvedAt: new Date().toISOString(),
  approval: {
    status: "approved",
    ownerApproved: true,
    approvedProductCount: products.length,
    approvedColorCount: colorCount,
    reviewSha256: sha256(raw),
  },
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(approved, null, 2)}\n`, "utf8");

console.log("=== Supplier color reconciliation approval ===");
console.log(`Approved products: ${products.length}`);
console.log(`Approved colors to deactivate: ${colorCount}`);
console.log("Rows will be marked inactive, never deleted.");
console.log("No database write performed.");
console.log(`Output: ${outputPath}`);
