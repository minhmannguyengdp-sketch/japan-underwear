import {
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadR2Config, publicUrlForKey } from "../r2/config.mjs";

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

function parseArgs(argv) {
  const options = {
    apply: false,
    force: false,
    allowWarnings: false,
    brand: null,
    category: null,
    model: null,
    limit: null,
    concurrency: null,
  };

  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--allow-warnings") options.allowWarnings = true;
    else if (arg.startsWith("--brand=")) options.brand = arg.slice(8).trim();
    else if (arg.startsWith("--category=")) options.category = arg.slice(11).trim();
    else if (arg.startsWith("--model=")) options.model = arg.slice(8).trim();
    else if (arg.startsWith("--limit=")) options.limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith("--concurrency=")) {
      options.concurrency = Number.parseInt(arg.slice(14), 10);
    } else {
      throw new Error(`Tham số không hợp lệ: ${arg}`);
    }
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit phải là số nguyên dương.");
  }

  if (
    options.concurrency !== null &&
    (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 16)
  ) {
    throw new Error("--concurrency phải là số nguyên từ 1 đến 16.");
  }

  return options;
}

function safeSegment(value, label) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) throw new Error(`Không thể tạo segment R2 cho ${label}.`);
  return normalized;
}

function localPathFromManifest(ttRoot, relativeToTtRoot) {
  const segments = String(relativeToTtRoot).split("/").filter(Boolean);
  return path.resolve(ttRoot, ...segments);
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

async function listExistingKeys(client, bucket, prefix) {
  const keys = new Set();
  let continuationToken;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const item of response.Contents ?? []) {
      if (item.Key) keys.add(item.Key);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const options = parseArgs(process.argv.slice(2));
const r2 = loadR2Config();
const concurrency = options.concurrency ?? r2.concurrency;
const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ??
    path.join(process.cwd(), "data", "local", "catalog-manifest.json"),
);
const planPath = path.resolve(process.cwd(), "data", "local", "r2-upload-plan.json");
const reportPath = path.resolve(process.cwd(), "data", "local", "r2-upload-report.json");

let manifest;
try {
  manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
} catch (error) {
  throw new Error(
    `Không đọc được manifest tại ${manifestPath}. Hãy chạy npm run catalog:manifest trước. ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

const warningCount = Number(manifest.summary?.classificationWarningCount ?? 0);
if (warningCount > 0 && !options.allowWarnings) {
  throw new Error(
    `Manifest còn ${warningCount} cảnh báo thật. Uploader dừng để tránh gắn sai ảnh.`,
  );
}

const selectedProducts = (manifest.products ?? []).filter((product) => {
  if (options.brand && product.brand !== options.brand) return false;
  if (options.category && product.category !== options.category) return false;
  if (options.model && String(product.modelCode) !== options.model) return false;
  return true;
});

if (selectedProducts.length === 0) {
  throw new Error("Không có model nào khớp bộ lọc upload.");
}

console.log(`Đang lập kế hoạch cho ${selectedProducts.length} model...`);

const candidates = [];
const missingLocalFiles = [];

for (const product of selectedProducts) {
  const brand = safeSegment(product.brand, "brand");
  const category = safeSegment(product.category, "category");
  const modelCode = safeSegment(product.modelCode, "modelCode");

  for (let index = 0; index < product.images.length; index += 1) {
    const image = product.images[index];
    const localPath = localPathFromManifest(manifest.ttRoot, image.relativeToTtRoot);

    let stat;
    try {
      stat = await fs.stat(localPath);
      if (!stat.isFile()) throw new Error("not-file");
    } catch {
      missingLocalFiles.push({
        brand: product.brand,
        category: product.category,
        modelCode: product.modelCode,
        relativeToTtRoot: image.relativeToTtRoot,
      });
      continue;
    }

    const extension = String(image.extension ?? path.extname(localPath)).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) continue;

    const sha256 = await hashFile(localPath);
    const key = `${r2.prefix}/${brand}/${category}/${modelCode}/${sha256.slice(0, 24)}${extension}`;

    candidates.push({
      brand: product.brand,
      category: product.category,
      modelCode: String(product.modelCode),
      source: image.source,
      relativeToTtRoot: image.relativeToTtRoot,
      localPath,
      sizeBytes: stat.size,
      sortOrder: index + 1,
      sha256,
      key,
      contentType,
      publicUrl: publicUrlForKey(r2.publicBaseUrl, key),
    });
  }
}

if (missingLocalFiles.length > 0) {
  throw new Error(
    `Có ${missingLocalFiles.length} file trong manifest không còn tồn tại. Chạy lại npm run catalog:manifest.`,
  );
}

const uniqueByKey = new Map();
const duplicateLocalFiles = [];
for (const candidate of candidates) {
  if (uniqueByKey.has(candidate.key)) {
    duplicateLocalFiles.push({
      key: candidate.key,
      kept: uniqueByKey.get(candidate.key).relativeToTtRoot,
      duplicate: candidate.relativeToTtRoot,
    });
    continue;
  }
  uniqueByKey.set(candidate.key, candidate);
}

let uniqueCandidates = [...uniqueByKey.values()];
if (options.limit !== null) uniqueCandidates = uniqueCandidates.slice(0, options.limit);

const existingKeys = await listExistingKeys(r2.client, r2.bucket, r2.prefix);
const uploadCandidates = options.force
  ? uniqueCandidates
  : uniqueCandidates.filter((candidate) => !existingKeys.has(candidate.key));
const skippedExisting = uniqueCandidates.filter((candidate) => existingKeys.has(candidate.key));

const plan = {
  generatedAt: new Date().toISOString(),
  mode: options.apply ? "apply" : "dry-run",
  bucket: r2.bucket,
  prefix: r2.prefix,
  publicBaseUrl: r2.publicBaseUrl,
  filters: {
    brand: options.brand,
    category: options.category,
    model: options.model,
    limit: options.limit,
  },
  manifest: {
    path: manifestPath,
    schemaVersion: manifest.schemaVersion,
    productCount: selectedProducts.length,
    classificationWarningCount: warningCount,
    classificationExceptionCount: Number(
      manifest.summary?.classificationExceptionCount ?? 0,
    ),
    unmatchedImageCount: Number(manifest.summary?.unmatchedImageCount ?? 0),
  },
  summary: {
    localImageReferences: candidates.length,
    uniqueObjects: uniqueCandidates.length,
    duplicateLocalFiles: duplicateLocalFiles.length,
    existingObjectsUnderPrefix: existingKeys.size,
    skippedExisting: skippedExisting.length,
    toUpload: uploadCandidates.length,
    force: options.force,
    concurrency,
  },
  objects: uniqueCandidates.map(({ localPath: _localPath, ...candidate }) => ({
    ...candidate,
    action:
      options.force || !existingKeys.has(candidate.key) ? "upload" : "skip-existing",
  })),
  duplicateLocalFiles,
};

await writeJson(planPath, plan);

console.log(`Plan: ${planPath}`);
console.log(`Object local duy nhất: ${plan.summary.uniqueObjects}`);
console.log(`Đã tồn tại trên R2: ${plan.summary.skippedExisting}`);
console.log(`Cần upload: ${plan.summary.toUpload}`);
console.log(`Ảnh local trùng nội dung: ${plan.summary.duplicateLocalFiles}`);

if (!options.apply) {
  console.log("DRY RUN: chưa upload file nào.");
  console.log("Sau khi kiểm tra plan, chạy: npm run catalog:r2:upload -- --apply");
  r2.client.destroy();
  process.exit(0);
}

if (uploadCandidates.length === 0) {
  console.log("R2 đã đủ object cần thiết; không có gì để upload.");
  await writeJson(reportPath, {
    ...plan,
    completedAt: new Date().toISOString(),
    uploadSummary: { uploaded: 0, failed: 0 },
    uploads: [],
  });
  r2.client.destroy();
  process.exit(0);
}

console.log(`Bắt đầu upload ${uploadCandidates.length} object với concurrency ${concurrency}...`);
let completed = 0;

const uploads = await mapConcurrent(uploadCandidates, concurrency, async (candidate) => {
  try {
    await r2.client.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: candidate.key,
        Body: createReadStream(candidate.localPath),
        ContentLength: candidate.sizeBytes,
        ContentType: candidate.contentType,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: {
          brand: safeSegment(candidate.brand, "brand"),
          category: safeSegment(candidate.category, "category"),
          model: safeSegment(candidate.modelCode, "modelCode"),
          source: safeSegment(candidate.source, "source"),
          sha256: candidate.sha256,
        },
      }),
    );

    completed += 1;
    if (completed % 25 === 0 || completed === uploadCandidates.length) {
      console.log(`Đã upload ${completed}/${uploadCandidates.length}`);
    }

    return {
      key: candidate.key,
      relativeToTtRoot: candidate.relativeToTtRoot,
      status: "uploaded",
      publicUrl: candidate.publicUrl,
    };
  } catch (error) {
    return {
      key: candidate.key,
      relativeToTtRoot: candidate.relativeToTtRoot,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

const failed = uploads.filter((item) => item.status === "failed");
const report = {
  ...plan,
  completedAt: new Date().toISOString(),
  uploadSummary: {
    uploaded: uploads.length - failed.length,
    failed: failed.length,
  },
  uploads,
};

await writeJson(reportPath, report);
r2.client.destroy();

console.log(`Report: ${reportPath}`);
console.log(`Upload thành công: ${report.uploadSummary.uploaded}`);
console.log(`Upload lỗi: ${report.uploadSummary.failed}`);

if (failed.length > 0) process.exitCode = 1;
