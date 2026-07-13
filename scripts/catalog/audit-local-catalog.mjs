import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const CATALOG_CATEGORIES = new Set(["ao-nguc", "quan-lot", "quan-gen"]);
const QL_SOURCE = "quan-lot";

function parseArgs(argv) {
  const options = { refreshManifest: true, strict: false, hashConcurrency: 8 };

  for (const arg of argv) {
    if (arg === "--no-refresh") options.refreshManifest = false;
    else if (arg === "--strict") options.strict = true;
    else if (arg.startsWith("--hash-concurrency=")) {
      options.hashConcurrency = Number.parseInt(arg.slice("--hash-concurrency=".length), 10);
    } else {
      throw new Error(`Tham số không hợp lệ: ${arg}`);
    }
  }

  if (
    !Number.isInteger(options.hashConcurrency) ||
    options.hashConcurrency < 1 ||
    options.hashConcurrency > 32
  ) {
    throw new Error("--hash-concurrency phải là số nguyên từ 1 đến 32.");
  }

  return options;
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function productKey(value) {
  return `${value.brand}:${value.category}:${String(value.modelCode)}`;
}

function brandModelKey(value) {
  return `${value.brand}:${String(value.modelCode)}`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function readJson(filePath, label, { optional = false } = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    throw new Error(
      `Không đọc được ${label} tại ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkImages(root) {
  const files = [];

  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(absolutePath);
        files.push({
          absolutePath,
          relativeToRoot: normalizePath(path.relative(root, absolutePath)),
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.relativeToRoot.localeCompare(right.relativeToRoot, "vi"));
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function addIssue(issues, issue) {
  issues.push({
    severity: issue.severity ?? "warning",
    code: issue.code,
    productKey: issue.productKey ?? null,
    message: issue.message,
    paths: issue.paths ?? [],
    expected: issue.expected ?? null,
    actual: issue.actual ?? null,
    details: issue.details ?? null,
  });
}

function severityRank(value) {
  return { critical: 0, warning: 1, info: 2 }[value] ?? 3;
}

const options = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ?? path.join(cwd, "data", "local", "catalog-manifest.json"),
);
const reportPath = path.resolve(
  process.env.LOCAL_R2_UPLOAD_REPORT ?? path.join(cwd, "data", "local", "r2-upload-report.json"),
);
const referencePath = path.resolve(
  process.env.LOCAL_PRICE_REFERENCE ??
    path.join(cwd, "data", "reference", "price-list-2026-04-02.json"),
);
const outputJsonPath = path.resolve(cwd, "data", "local", "catalog-audit.json");
const outputCsvPath = path.resolve(cwd, "data", "local", "catalog-audit-issues.csv");
const outputMarkdownPath = path.resolve(cwd, "data", "local", "catalog-audit.md");

if (options.refreshManifest) {
  const manifestBuilder = path.resolve(cwd, "scripts", "catalog", "build-local-manifest.mjs");
  console.log("[1/6] Làm mới catalog manifest từ WK_1600, pensee_1600 và QL...");
  const refreshed = spawnSync(process.execPath, [manifestBuilder], {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (refreshed.error) throw refreshed.error;
  if (refreshed.status !== 0) {
    throw new Error(`Tạo manifest thất bại với mã ${refreshed.status}.`);
  }
} else {
  console.log("[1/6] Dùng manifest hiện có (--no-refresh).");
}

console.log("[2/6] Đọc manifest, R2 report và bảng giá chuẩn hóa...");
const [manifest, r2Report, priceReference] = await Promise.all([
  readJson(manifestPath, "catalog manifest"),
  readJson(reportPath, "R2 upload report", { optional: true }),
  readJson(referencePath, "price-list reference"),
]);

const ttRoot = path.resolve(manifest.ttRoot ?? process.env.LOCAL_TT_ROOT ?? path.join(cwd, ".."));
const qlRoot = path.resolve(process.env.LOCAL_QL_IMAGES ?? path.join(ttRoot, "QL"));
if (!(await pathExists(qlRoot))) {
  throw new Error(`Không tìm thấy thư mục QL: ${qlRoot}`);
}

const issues = [];
const manifestProducts = Array.isArray(manifest.products) ? manifest.products : [];
const manifestProductByKey = new Map(manifestProducts.map((product) => [productKey(product), product]));
const manifestKeys = new Set(manifestProductByKey.keys());
const manifestByBrandModel = new Map();
for (const product of manifestProducts) {
  const key = brandModelKey(product);
  const categories = manifestByBrandModel.get(key) ?? new Set();
  categories.add(product.category);
  manifestByBrandModel.set(key, categories);
}

const mappedByRelativePath = new Map();
for (const product of manifestProducts) {
  for (const image of product.images ?? []) {
    const relativeToTtRoot = normalizePath(image.relativeToTtRoot);
    mappedByRelativePath.set(relativeToTtRoot, {
      relativeToTtRoot,
      source: image.source,
      brand: product.brand,
      category: product.category,
      modelCode: String(product.modelCode),
      productKey: productKey(product),
      mapped: true,
      extension: String(image.extension ?? path.extname(relativeToTtRoot)).toLowerCase(),
    });
  }
}
for (const image of manifest.unmatchedFiles ?? []) {
  const relativeToTtRoot = normalizePath(image.relativeToTtRoot);
  if (!mappedByRelativePath.has(relativeToTtRoot)) {
    mappedByRelativePath.set(relativeToTtRoot, {
      relativeToTtRoot,
      source: image.source,
      brand: null,
      category: null,
      modelCode: null,
      productKey: null,
      mapped: false,
      extension: String(image.extension ?? path.extname(relativeToTtRoot)).toLowerCase(),
      unmatchedReason: image.reason ?? null,
    });
  }
}

console.log("[3/6] Quét lại thư mục QL và kiểm tra manifest có bị stale...");
const qlFiles = await walkImages(qlRoot);
const currentQlByRelativePath = new Map();
for (const file of qlFiles) {
  const relativeToTtRoot = normalizePath(path.relative(ttRoot, file.absolutePath));
  currentQlByRelativePath.set(relativeToTtRoot, { ...file, relativeToTtRoot });
  if (!mappedByRelativePath.has(relativeToTtRoot)) {
    addIssue(issues, {
      severity: "warning",
      code: "ql-file-not-in-manifest",
      message: "Ảnh đang có trong QL nhưng chưa xuất hiện trong manifest vừa tạo.",
      paths: [relativeToTtRoot],
    });
    mappedByRelativePath.set(relativeToTtRoot, {
      relativeToTtRoot,
      source: QL_SOURCE,
      brand: null,
      category: null,
      modelCode: null,
      productKey: null,
      mapped: false,
      extension: path.extname(relativeToTtRoot).toLowerCase(),
      discoveredAfterManifest: true,
    });
  }
}

for (const record of mappedByRelativePath.values()) {
  if (record.source !== QL_SOURCE) continue;
  if (!currentQlByRelativePath.has(record.relativeToTtRoot)) {
    addIssue(issues, {
      severity: "critical",
      code: "ql-manifest-file-missing",
      productKey: record.productKey,
      message: "Manifest còn tham chiếu ảnh QL nhưng file không còn trên ổ đĩa.",
      paths: [record.relativeToTtRoot],
    });
  }

  if (record.mapped && !["quan-lot", "quan-gen"].includes(record.category)) {
    addIssue(issues, {
      severity: "critical",
      code: "ql-mapped-to-non-pants-category",
      productKey: record.productKey,
      message: "Ảnh trong thư mục QL bị map sang nhóm không phải quần lót/quần gen.",
      paths: [record.relativeToTtRoot],
      expected: "quan-lot hoặc quan-gen",
      actual: record.category,
    });
  }

  if (record.mapped && record.category === "quan-gen") {
    const normalized = record.relativeToTtRoot.toUpperCase();
    if (!/(^|[^A-Z0-9])QG\s*'?\s*\d{3,5}/.test(normalized)) {
      addIssue(issues, {
        severity: "warning",
        code: "ql-quan-gen-without-qg-prefix",
        productKey: record.productKey,
        message: "Ảnh QL được map thành quần gen nhưng đường dẫn không có tiền tố QG rõ ràng.",
        paths: [record.relativeToTtRoot],
      });
    }
  }
}

const hashCandidates = [];
for (const record of mappedByRelativePath.values()) {
  const absolutePath = path.resolve(ttRoot, ...record.relativeToTtRoot.split("/").filter(Boolean));
  if (!(await pathExists(absolutePath))) continue;
  hashCandidates.push({ ...record, absolutePath });
}

console.log(`[4/6] Hash ${hashCandidates.length} ảnh để tìm trùng nội dung...`);
let hashedCount = 0;
const hashedRecords = await mapConcurrent(
  hashCandidates,
  options.hashConcurrency,
  async (record) => {
    const sha256 = await hashFile(record.absolutePath);
    hashedCount += 1;
    if (hashedCount % 100 === 0 || hashedCount === hashCandidates.length) {
      console.log(`      ${hashedCount}/${hashCandidates.length} ảnh`);
    }
    return { ...record, sha256 };
  },
);

const duplicateGroups = [];
const byHash = new Map();
for (const record of hashedRecords) {
  const group = byHash.get(record.sha256) ?? [];
  group.push(record);
  byHash.set(record.sha256, group);
}

for (const [sha256, records] of byHash.entries()) {
  if (records.length < 2 || !records.some((record) => record.source === QL_SOURCE)) continue;

  const productKeys = new Set(records.map((record) => record.productKey).filter(Boolean));
  const qlRecords = records.filter((record) => record.source === QL_SOURCE);
  const nonQlRecords = records.filter((record) => record.source !== QL_SOURCE);
  let classification;
  let severity;
  let message;

  if (productKeys.size > 1) {
    classification = "cross-product";
    severity = "critical";
    message = "Cùng một nội dung ảnh đang được map cho nhiều sản phẩm khác nhau.";
  } else if (qlRecords.length > 1) {
    classification = "within-ql";
    severity = "warning";
    message = "Thư mục QL chứa nhiều file có nội dung giống hệt nhau.";
  } else if (nonQlRecords.length > 0 && productKeys.size === 1) {
    classification = "cross-source-same-product";
    severity = "info";
    message = "Ảnh QL trùng nội dung với nguồn khác nhưng cùng map một sản phẩm.";
  } else {
    classification = "unmapped-duplicate";
    severity = "warning";
    message = "Có ảnh QL trùng nội dung nhưng chưa đủ mapping để xác nhận sản phẩm.";
  }

  const group = {
    sha256,
    classification,
    productKeys: [...productKeys].sort(),
    paths: records.map((record) => record.relativeToTtRoot).sort((a, b) => a.localeCompare(b, "vi")),
  };
  duplicateGroups.push(group);
  addIssue(issues, {
    severity,
    code: `duplicate-content-${classification}`,
    productKey: productKeys.size === 1 ? [...productKeys][0] : null,
    message,
    paths: group.paths,
    details: { sha256, productKeys: group.productKeys },
  });
}

console.log("[5/6] Đối chiếu model với bảng giá và R2 report...");
const referenceEntries = Array.isArray(priceReference.entries) ? priceReference.entries : [];
const expectedRows = referenceEntries.filter(
  (entry) => entry.inCatalogScope && entry.modelCode && CATALOG_CATEGORIES.has(entry.category),
);
const expectedByKey = new Map();
for (const entry of expectedRows) {
  const key = productKey(entry);
  const current = expectedByKey.get(key) ?? { ...entry, rows: [] };
  current.rows.push({
    rawCode: entry.rawCode,
    priceVnd: entry.priceVnd,
    variantSuffix: entry.variantSuffix,
    sourceSheet: entry.sourceSheet,
    sourceRow: entry.sourceRow,
  });
  expectedByKey.set(key, current);
}
const expectedKeys = new Set(expectedByKey.keys());
const expectedByBrandModel = new Map();
for (const entry of expectedByKey.values()) {
  const key = brandModelKey(entry);
  const categories = expectedByBrandModel.get(key) ?? new Set();
  categories.add(entry.category);
  expectedByBrandModel.set(key, categories);
}

const missingExpected = [];
for (const [key, entry] of expectedByKey.entries()) {
  if (manifestKeys.has(key)) continue;
  const actualCategories = [...(manifestByBrandModel.get(brandModelKey(entry)) ?? [])].sort();
  const categoryMismatch = actualCategories.length > 0;
  const item = {
    key,
    brand: entry.brand,
    category: entry.category,
    modelCode: entry.modelCode,
    priceRows: entry.rows,
    actualCategories,
  };
  missingExpected.push(item);
  addIssue(issues, {
    severity: categoryMismatch ? "critical" : "warning",
    code: categoryMismatch ? "price-product-category-mismatch" : "price-product-missing-images",
    productKey: key,
    message: categoryMismatch
      ? "Bảng giá có sản phẩm ở nhóm này nhưng manifest đang map cùng brand/model sang nhóm khác."
      : "Bảng giá có sản phẩm nhưng catalog ảnh chưa có model tương ứng.",
    expected: entry.category,
    actual: categoryMismatch ? actualCategories.join(", ") : "không có trong manifest",
    details: { priceRows: entry.rows },
  });
}

const extraManifest = [];
for (const [key, product] of manifestProductByKey.entries()) {
  if (!CATALOG_CATEGORIES.has(product.category) || expectedKeys.has(key)) continue;
  const expectedCategories = [...(expectedByBrandModel.get(brandModelKey(product)) ?? [])].sort();
  const item = {
    key,
    brand: product.brand,
    category: product.category,
    modelCode: String(product.modelCode),
    expectedCategories,
    sources: product.sources ?? [],
  };
  extraManifest.push(item);
  addIssue(issues, {
    severity: expectedCategories.length > 0 ? "critical" : "warning",
    code: expectedCategories.length > 0 ? "manifest-category-mismatch-price" : "manifest-product-not-in-price-list",
    productKey: key,
    message:
      expectedCategories.length > 0
        ? "Manifest có model nhưng nhóm hàng không khớp bảng giá."
        : "Catalog ảnh có model chưa xuất hiện trong bảng giá ngày 02/04/2026.",
    expected: expectedCategories.length > 0 ? expectedCategories.join(", ") : "có trong bảng giá",
    actual: product.category,
  });
}

const qlExpectedKeys = new Set(
  [...expectedByKey.keys()].filter((key) => key.includes(":quan-lot:") || key.includes(":quan-gen:")),
);
const qlManifestProducts = manifestProducts.filter(
  (product) => (product.sources ?? []).includes(QL_SOURCE),
);
const qlManifestKeys = new Set(qlManifestProducts.map(productKey));
const qlMissingExpected = [...qlExpectedKeys].filter((key) => !manifestKeys.has(key)).sort();
const qlUnexpectedMapped = [...qlManifestKeys].filter((key) => !expectedKeys.has(key)).sort();

const reportObjects = Array.isArray(r2Report?.objects) ? r2Report.objects : [];
const reportKeySet = new Set(reportObjects.map((object) => String(object.key)));
const expectedR2Keys = new Set();
const r2Prefix = String(r2Report?.prefix ?? process.env.R2_PREFIX ?? "catalog").replace(/^\/+|\/+$/g, "");
for (const record of hashedRecords) {
  if (!record.mapped || !record.productKey) continue;
  const extension = record.extension || path.extname(record.relativeToTtRoot).toLowerCase();
  expectedR2Keys.add(
    `${r2Prefix}/${record.brand}/${record.category}/${record.modelCode}/${record.sha256.slice(0, 24)}${extension}`,
  );
}

const missingR2Keys = r2Report
  ? [...expectedR2Keys].filter((key) => !reportKeySet.has(key)).sort()
  : [];
const staleR2Keys = r2Report
  ? [...reportKeySet].filter((key) => !expectedR2Keys.has(key)).sort()
  : [];

if (!r2Report) {
  addIssue(issues, {
    severity: "warning",
    code: "r2-report-missing",
    message: "Không có r2-upload-report.json để đối chiếu object đã upload.",
  });
} else {
  for (const key of missingR2Keys) {
    addIssue(issues, {
      severity: "critical",
      code: "manifest-object-missing-from-r2-report",
      message: "Object cần cho manifest hiện tại không có trong R2 apply report.",
      paths: [key],
    });
  }
  for (const key of staleR2Keys) {
    addIssue(issues, {
      severity: "info",
      code: "r2-report-object-not-in-current-manifest",
      message: "R2 apply report còn object không thuộc manifest hiện tại.",
      paths: [key],
    });
  }
}

issues.sort(
  (left, right) =>
    severityRank(left.severity) - severityRank(right.severity) ||
    left.code.localeCompare(right.code, "vi") ||
    String(left.productKey ?? "").localeCompare(String(right.productKey ?? ""), "vi"),
);

const severityCounts = issues.reduce(
  (summary, issue) => {
    summary[issue.severity] = (summary[issue.severity] ?? 0) + 1;
    return summary;
  },
  { critical: 0, warning: 0, info: 0 },
);

const qlMappedFileCount = hashedRecords.filter(
  (record) => record.source === QL_SOURCE && record.mapped,
).length;
const qlUnmatchedFileCount = hashedRecords.filter(
  (record) => record.source === QL_SOURCE && !record.mapped,
).length;
const qlMappedProductCount = qlManifestKeys.size;
const presentExpectedCount = [...expectedKeys].filter((key) => manifestKeys.has(key)).length;
const presentQlExpectedCount = [...qlExpectedKeys].filter((key) => manifestKeys.has(key)).length;

const audit = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  inputs: {
    ttRoot,
    qlRoot,
    manifestPath,
    r2ReportPath: r2Report ? reportPath : null,
    priceReferencePath: referencePath,
    priceReferenceSource: priceReference.sourceFile,
    priceReferenceEffectiveDate: priceReference.effectiveDate,
  },
  summary: {
    manifestProducts: manifestProducts.length,
    manifestMatchedImages: Number(manifest.summary?.matchedImageCount ?? 0),
    manifestUnmatchedImages: Number(manifest.summary?.unmatchedImageCount ?? 0),
    currentQlFiles: qlFiles.length,
    qlMappedFiles: qlMappedFileCount,
    qlUnmatchedFiles: qlUnmatchedFileCount,
    qlMappedProducts: qlMappedProductCount,
    priceExpectedProducts: expectedKeys.size,
    priceProductsPresentInManifest: presentExpectedCount,
    priceProductsMissingFromManifest: missingExpected.length,
    priceRowsOutsideCatalogScope: referenceEntries.filter((entry) => !entry.inCatalogScope).length,
    qlExpectedProducts: qlExpectedKeys.size,
    qlExpectedProductsPresent: presentQlExpectedCount,
    qlExpectedProductsMissing: qlMissingExpected.length,
    qlMappedProductsNotInPriceList: qlUnexpectedMapped.length,
    duplicateGroupsTouchingQl: duplicateGroups.length,
    duplicateCrossProductGroups: duplicateGroups.filter(
      (group) => group.classification === "cross-product",
    ).length,
    missingR2Objects: missingR2Keys.length,
    staleR2Objects: staleR2Keys.length,
    issues: severityCounts,
  },
  coverage: {
    missingExpectedProducts: missingExpected,
    manifestProductsNotInPriceList: extraManifest,
    qlMissingExpectedProducts: qlMissingExpected,
    qlMappedProductsNotInPriceList: qlUnexpectedMapped,
  },
  duplicates: duplicateGroups.sort((left, right) =>
    left.classification.localeCompare(right.classification, "vi"),
  ),
  r2: {
    reportPresent: Boolean(r2Report),
    reportObjectCount: reportObjects.length,
    expectedObjectCountFromCurrentFiles: expectedR2Keys.size,
    missingKeys: missingR2Keys,
    staleKeys: staleR2Keys,
  },
  issues,
};

console.log("[6/6] Ghi báo cáo audit...");
await fs.mkdir(path.dirname(outputJsonPath), { recursive: true });
await fs.writeFile(outputJsonPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

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
      issue.paths.join(" | "),
      issue.details ? JSON.stringify(issue.details) : "",
    ]
      .map(csvCell)
      .join(","),
  );
}
await fs.writeFile(outputCsvPath, `${csvRows.join("\n")}\n`, "utf8");

const topIssues = issues.slice(0, 80);
const markdown = [
  "# Catalog audit: QL + bảng giá + R2",
  "",
  `- Thời điểm: ${audit.generatedAt}`,
  `- Manifest: **${audit.summary.manifestProducts} model / ${audit.summary.manifestMatchedImages} ảnh khớp**`,
  `- QL hiện tại: **${audit.summary.currentQlFiles} ảnh**; map được ${audit.summary.qlMappedFiles}; chưa map ${audit.summary.qlUnmatchedFiles}`,
  `- Bảng giá trong scope: **${audit.summary.priceExpectedProducts} sản phẩm**; có ảnh ${audit.summary.priceProductsPresentInManifest}; thiếu ảnh ${audit.summary.priceProductsMissingFromManifest}`,
  `- Riêng quần lót + quần gen: **${audit.summary.qlExpectedProducts} sản phẩm**; có ảnh ${audit.summary.qlExpectedProductsPresent}; thiếu ảnh ${audit.summary.qlExpectedProductsMissing}`,
  `- Nhóm ảnh trùng chạm QL: **${audit.summary.duplicateGroupsTouchingQl}**; trùng chéo nhiều sản phẩm: **${audit.summary.duplicateCrossProductGroups}**`,
  `- R2 thiếu object theo manifest hiện tại: **${audit.summary.missingR2Objects}**`,
  `- Issues: **${severityCounts.critical} critical / ${severityCounts.warning} warning / ${severityCounts.info} info**`,
  "",
  "## Issues ưu tiên",
  "",
  "| Mức | Mã | Sản phẩm | Nội dung | Đường dẫn |",
  "|---|---|---|---|---|",
  ...topIssues.map(
    (issue) =>
      `| ${issue.severity} | ${issue.code} | ${issue.productKey ?? ""} | ${issue.message.replaceAll("|", "\\|")} | ${issue.paths.slice(0, 3).join("<br>").replaceAll("|", "\\|")} |`,
  ),
  "",
  `Báo cáo JSON đầy đủ: \`${normalizePath(path.relative(cwd, outputJsonPath))}\``,
  `Danh sách CSV: \`${normalizePath(path.relative(cwd, outputCsvPath))}\``,
  "",
].join("\n");
await fs.writeFile(outputMarkdownPath, markdown, "utf8");

console.log("\n=== Kết quả audit ===");
console.log(`QL: ${audit.summary.currentQlFiles} ảnh; map ${audit.summary.qlMappedFiles}; chưa map ${audit.summary.qlUnmatchedFiles}.`);
console.log(
  `Bảng giá: ${audit.summary.priceProductsPresentInManifest}/${audit.summary.priceExpectedProducts} sản phẩm có ảnh; thiếu ${audit.summary.priceProductsMissingFromManifest}.`,
);
console.log(
  `Quần lót + quần gen: ${audit.summary.qlExpectedProductsPresent}/${audit.summary.qlExpectedProducts} sản phẩm có ảnh; thiếu ${audit.summary.qlExpectedProductsMissing}.`,
);
console.log(
  `Trùng ảnh chạm QL: ${audit.summary.duplicateGroupsTouchingQl} nhóm; cross-product critical: ${audit.summary.duplicateCrossProductGroups}.`,
);
console.log(
  `Issues: ${severityCounts.critical} critical / ${severityCounts.warning} warning / ${severityCounts.info} info.`,
);
console.log(`Markdown: ${outputMarkdownPath}`);
console.log(`JSON: ${outputJsonPath}`);
console.log(`CSV: ${outputCsvPath}`);

if (options.strict && severityCounts.critical > 0) {
  process.exitCode = 2;
}
