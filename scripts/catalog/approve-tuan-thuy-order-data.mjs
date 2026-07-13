import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const args = process.argv.slice(2);
const inputArgument = args.find((arg) => !arg.startsWith("--"));
const approve = args.includes("--approve");
const accept9517 = args.includes("--accept-9517-url-typo");
const outputArgument = args.find((arg) => arg.startsWith("--output="))?.slice("--output=".length);

for (const arg of args) {
  if (
    arg !== inputArgument &&
    arg !== "--approve" &&
    arg !== "--accept-9517-url-typo" &&
    !arg.startsWith("--output=")
  ) {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}

if (!inputArgument) {
  throw new Error(
    "Usage: node scripts/catalog/approve-tuan-thuy-order-data.mjs <review-plan.json> --approve --accept-9517-url-typo [--output=approved.json]",
  );
}
if (!approve) throw new Error("Thiếu --approve. Chưa tạo approval file.");
if (!accept9517) {
  throw new Error("Thiếu --accept-9517-url-typo cho ngoại lệ Pensee 9517.");
}

const inputPath = path.resolve(cwd, inputArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? inputArgument.replace(/\.json$/i, "") + ".approved.json",
);
const raw = await fs.readFile(inputPath, "utf8");
const plan = JSON.parse(raw);

if (plan.schemaVersion !== 2) {
  throw new Error(`Review plan schemaVersion phải là 2; nhận ${plan.schemaVersion}.`);
}

const expectedSummary = {
  activeCatalogProductCount: 108,
  webAuditProductCount: 49,
  activeWebIntersectionCount: 47,
  activeProductsWithoutWebAuditCount: 61,
  webProductsOutsideActiveCatalogCount: 2,
  activeProductsWithReviewedVariantCandidates: 32,
  activeReviewedVariantCandidateCount: 199,
  activeProductsBlocked: 15,
  activeProductsWithColorCandidates: 17,
  activeColorCandidateCount: 66,
  activeOrderableCandidateProductCount: 2,
  activeOrderableVariantCandidateCount: 10,
  activeOrderableColorCandidateCount: 4,
};
for (const [key, expected] of Object.entries(expectedSummary)) {
  if (Number(plan.summary?.[key]) !== expected) {
    throw new Error(`Review plan lệch ${key}: ${plan.summary?.[key]}/${expected}.`);
  }
}

const outsideKeys = (plan.decisions?.webProductsOutsideActiveCatalog ?? [])
  .map((item) => item.key)
  .sort();
const expectedOutside = ["winking:ao-nguc:9059", "winking:ao-nguc:9091"];
if (JSON.stringify(outsideKeys) !== JSON.stringify(expectedOutside)) {
  throw new Error(`Danh sách ngoài active catalog thay đổi: ${outsideKeys.join(", ")}.`);
}

const reviewed = plan.decisions?.reviewedVariantCandidates ?? [];
const colors = plan.decisions?.activeColorCandidates ?? [];
const reviewed9517 = reviewed.find((item) => item.key === "pensee:ao-nguc:9517");
if (!reviewed9517) throw new Error("Không tìm thấy Pensee 9517 trong reviewed variants.");
if (
  !(reviewed9517.reviewFlags ?? []).includes(
    "extra-model-candidates-ignored-because-name-was-explicit",
  )
) {
  throw new Error("Pensee 9517 không còn mang review flag URL/model ngoại lệ.");
}

const approval = {
  schemaVersion: 1,
  approvedAt: new Date().toISOString(),
  sourceReviewPlan: {
    path: inputPath,
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    generatedAt: plan.generatedAt ?? null,
    schemaVersion: plan.schemaVersion,
  },
  approval: {
    approvedBy: "catalog-owner-cli",
    approvedVariantCandidateCount: 199,
    approvedColorCandidateCount: 66,
    acceptedExceptions: [
      "pensee:ao-nguc:9517 source URL contains 95167 but product name, PS9517 description code, active catalog, and authoritative price reference resolve to 9517",
    ],
    excludedOutsideActiveCatalog: expectedOutside,
    blockedProductsRemainNonOrderable: 15,
    orderLineIdentity: "product + color + size + cup",
    noColorImageMapping: true,
    noPrecomputedColorSizeCupCartesianRows: true,
  },
  summary: plan.summary,
  approvedVariantCandidates: reviewed,
  approvedColorCandidates: colors,
  orderableCandidates: plan.decisions?.orderableCandidates ?? [],
};

await fs.writeFile(outputPath, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
console.log("=== Tuấn Thủy order-data approval ===");
console.log("Approved variants: 32 products / 199 variants");
console.log("Approved colors: 17 products / 66 colors");
console.log("Immediately orderable: 2 products / 10 size-cup variants / 4 colors");
console.log("No database write performed.");
console.log(`Output: ${outputPath}`);
