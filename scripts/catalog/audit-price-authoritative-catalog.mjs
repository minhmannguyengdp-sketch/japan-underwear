import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const strict = process.argv.includes("--strict");
const canonicalBuilderPath = path.resolve(
  cwd,
  "scripts",
  "catalog",
  "build-price-authoritative-manifest.mjs",
);
const rawAuditPath = path.resolve(cwd, "scripts", "catalog", "audit-local-catalog.mjs");
const auditJsonPath = path.resolve(cwd, "data", "local", "catalog-audit.json");
const auditCsvPath = path.resolve(cwd, "data", "local", "catalog-audit-issues.csv");
const auditMarkdownPath = path.resolve(cwd, "data", "local", "catalog-audit.md");
const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ?? path.join(cwd, "data", "local", "catalog-manifest.json"),
);

function runNode(label, scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} thất bại với mã ${result.status}.`);
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function countIssues(issues) {
  return issues.reduce(
    (summary, issue) => {
      summary[issue.severity] = (summary[issue.severity] ?? 0) + 1;
      return summary;
    },
    { critical: 0, warning: 0, info: 0 },
  );
}

console.log("\n=== Audit theo nghiệp vụ bảng giá ===");
console.log("Catalog active = model có trong bảng giá và có ảnh, cộng ngoại lệ đã được chủ catalog xác nhận.");
console.log("Model bảng giá không có ảnh được bỏ qua vì có thể đã ngừng mẫu, trừ ngoại lệ đã giữ lại.\n");

runNode("Canonical manifest", canonicalBuilderPath);
runNode("Raw catalog audit", rawAuditPath, ["--no-refresh"]);

const [audit, manifest] = await Promise.all([
  fs.readFile(auditJsonPath, "utf8").then(JSON.parse),
  fs.readFile(manifestPath, "utf8").then(JSON.parse),
]);

const retainedNoImage = manifest.retainedNoImageProducts ?? [];
const retainedKeys = new Set(retainedNoImage.map((item) => item.key));
const omittedIssueCodes = new Set([
  "price-product-missing-images",
  "ql-file-not-in-manifest",
]);
const R2_PENDING_CODE = "manifest-object-missing-from-r2-report";
const issues = [];
let r2SyncRequiredObjects = 0;

for (const issue of audit.issues ?? []) {
  if (omittedIssueCodes.has(issue.code)) continue;

  if (
    issue.code === "price-product-category-mismatch" &&
    retainedKeys.has(issue.productKey)
  ) {
    continue;
  }

  if (issue.code === R2_PENDING_CODE) {
    r2SyncRequiredObjects += 1;
    issues.push({
      ...issue,
      severity: "warning",
      code: "r2-sync-required-after-canonical-remap",
      message:
        "Manifest canonical đã đổi identity/key; object cần được đồng bộ lại lên R2. Đây là việc đồng bộ, không phải lỗi nhận dạng sản phẩm.",
    });
    continue;
  }

  issues.push(issue);
}

for (const retained of retainedNoImage) {
  issues.push({
    severity: "info",
    code: "owner-reviewed-product-retained-without-image",
    productKey: retained.key,
    message:
      "Sản phẩm được chủ catalog xác nhận phải giữ active dù chưa có ảnh đúng nhóm. Không tự mượn ảnh từ sản phẩm khác category.",
    expected: "active",
    actual: "active-without-image",
    paths: [],
    details: {
      reason: retained.reason ?? null,
      priceRows: retained.priceRows ?? [],
    },
  });
}

const severityCounts = countIssues(issues);
const omittedNoImage = manifest.priceProductsWithoutImages ?? [];
const excludedImageOnly = manifest.excludedImageProducts ?? [];
const unresolved = manifest.unresolvedImageProducts ?? [];
const blockerIssues = issues.filter((issue) => issue.severity === "critical");

const authoritativeAudit = {
  ...audit,
  schemaVersion: 4,
  businessRule: {
    identityAuthority: "price-list",
    activeCatalog:
      "intersection(price-list, products-with-images) plus owner-reviewed retained products",
    missingImageDisposition: "omitted-possible-discontinued",
    retainedWithoutImageDisposition: "active-owner-reviewed",
    imageOnlyDisposition: "excluded-not-in-current-price-list",
    pendingR2SyncDisposition: "warning-not-identity-blocker",
  },
  summary: {
    ...audit.summary,
    activeCatalogProducts: Number(manifest.summary?.productGroupCount ?? 0),
    activeCatalogImages: Number(manifest.summary?.matchedImageCount ?? 0),
    retainedWithoutImages: retainedNoImage.length,
    priceProductsOmittedNoImages: omittedNoImage.length,
    imageProductsExcludedNotInPriceList: excludedImageOnly.length,
    unresolvedImageProducts: unresolved.length,
    r2SyncRequiredObjects,
    blockerCriticalIssues: blockerIssues.length,
    issues: severityCounts,
  },
  coverage: {
    ...audit.coverage,
    retainedProductsWithoutImages: retainedNoImage,
    omittedPriceProductsWithoutImages: omittedNoImage,
    excludedImageProductsNotInPriceList: excludedImageOnly,
    unresolvedImageProducts: unresolved,
  },
  blockers: blockerIssues,
  issues,
};

await fs.writeFile(auditJsonPath, `${JSON.stringify(authoritativeAudit, null, 2)}\n`, "utf8");

const csvHeaders = [
  "severity",
  "code",
  "productKey",
  "message",
  "expected",
  "actual",
  "paths",
  "details",
];
const csvRows = [csvHeaders.join(",")];
for (const issue of issues) {
  csvRows.push(
    [
      issue.severity,
      issue.code,
      issue.productKey,
      issue.message,
      issue.expected,
      issue.actual,
      (issue.paths ?? []).join(" | "),
      issue.details ? JSON.stringify(issue.details) : "",
    ]
      .map(csvCell)
      .join(","),
  );
}
await fs.writeFile(auditCsvPath, `${csvRows.join("\n")}\n`, "utf8");

const topIssues = issues.slice(0, 100);
const markdown = [
  "# Catalog audit theo bảng giá",
  "",
  `- Thời điểm: ${authoritativeAudit.generatedAt}`,
  `- Quy tắc active: **có trong bảng giá + có ảnh, cộng ngoại lệ đã xác nhận**`,
  `- Catalog active: **${authoritativeAudit.summary.activeCatalogProducts} model / ${authoritativeAudit.summary.activeCatalogImages} ảnh**`,
  `- Ngoại lệ được giữ active dù chưa có ảnh đúng nhóm: **${retainedNoImage.length} model**`,
  `- Có trong bảng giá nhưng không có ảnh: **${omittedNoImage.length} model — bỏ qua, có thể đã ngừng mẫu**`,
  `- Có ảnh nhưng không có trong bảng giá hiện tại: **${excludedImageOnly.length} model — loại khỏi catalog active**`,
  `- Identity còn mơ hồ: **${unresolved.length} model**`,
  `- Trùng ảnh chạm QL: **${authoritativeAudit.summary.duplicateGroupsTouchingQl} nhóm**`,
  `- Trùng chéo nhiều sản phẩm: **${authoritativeAudit.summary.duplicateCrossProductGroups} nhóm**`,
  `- R2 cần đồng bộ lại theo manifest canonical: **${r2SyncRequiredObjects} object — không phải lỗi identity**`,
  `- Blocker thật: **${blockerIssues.length} critical**`,
  `- Issues còn hiệu lực: **${severityCounts.critical} critical / ${severityCounts.warning} warning / ${severityCounts.info} info**`,
  "",
  "## Issues cần xử lý",
  "",
  "| Mức | Mã | Sản phẩm | Nội dung | Đường dẫn |",
  "|---|---|---|---|---|",
  ...topIssues.map(
    (issue) =>
      `| ${issue.severity} | ${issue.code} | ${issue.productKey ?? ""} | ${String(issue.message).replaceAll("|", "\\|")} | ${(issue.paths ?? []).slice(0, 3).join("<br>").replaceAll("|", "\\|")} |`,
  ),
  "",
  "## Quyết định nghiệp vụ",
  "",
  "- Không tạo lỗi cho model bảng giá không có ảnh, trừ khi chủ catalog xác nhận phải giữ.",
  "- Ba model quần lót 9501, 9514 và 9108 được giữ active theo xác nhận, nhưng không tự dùng ảnh áo ngực cùng mã.",
  "- Không đưa model chỉ có ảnh nhưng không có trong bảng giá hiện tại vào catalog active.",
  "- R2 report cũ sau khi canonical remap chỉ là trạng thái cần đồng bộ, không phải lỗi identity.",
  "- Chỉ lỗi identity/trùng ảnh chéo còn hiệu lực mới chặn import.",
  "",
  "Báo cáo JSON đầy đủ: `data/local/catalog-audit.json`",
  "Danh sách CSV: `data/local/catalog-audit-issues.csv`",
  "",
].join("\n");
await fs.writeFile(auditMarkdownPath, markdown, "utf8");

console.log("\n=== Kết quả audit theo bảng giá ===");
console.log(
  `Catalog active: ${authoritativeAudit.summary.activeCatalogProducts} model / ${authoritativeAudit.summary.activeCatalogImages} ảnh.`,
);
console.log(`Giữ active dù chưa có ảnh đúng nhóm: ${retainedNoImage.length} model.`);
console.log(
  `Bỏ model bảng giá không có ảnh: ${omittedNoImage.length} (có thể đã ngừng mẫu).`,
);
console.log(
  `Loại model có ảnh nhưng không có trong bảng giá: ${excludedImageOnly.length}.`,
);
console.log(`Identity còn mơ hồ: ${unresolved.length}.`);
console.log(`R2 cần đồng bộ lại: ${r2SyncRequiredObjects} object (không chặn identity).`);
console.log(`Blocker thật: ${blockerIssues.length} critical.`);
console.log(
  `Issues còn hiệu lực: ${severityCounts.critical} critical / ${severityCounts.warning} warning / ${severityCounts.info} info.`,
);
console.log(`Markdown: ${auditMarkdownPath}`);
console.log(`JSON: ${auditJsonPath}`);
console.log(`CSV: ${auditCsvPath}`);

if (strict && blockerIssues.length > 0) process.exitCode = 2;
