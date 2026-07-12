import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ??
    path.join(cwd, "data", "local", "catalog-manifest.json"),
);
const hashConcurrency = 8;

function productKey(product) {
  return `${product.brand}:${product.category}:${String(product.modelCode)}`;
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function provenanceRoot(relativeToTtRoot) {
  const segments = normalizePath(relativeToTtRoot).split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() === "ql" && segments[1]) {
    return `${segments[0]}/${segments[1]}`.toLowerCase();
  }
  return String(segments[0] ?? "unknown").toLowerCase();
}

function pathPenalty(relativeToTtRoot) {
  const normalized = normalizePath(relativeToTtRoot).toLowerCase();
  let penalty = 0;
  if (normalized.includes("/new folder/")) penalty += 20;
  if (/\bcopy\b/.test(normalized)) penalty += 10;
  return penalty;
}

function chooseRepresentative(records) {
  return [...records].sort(
    (left, right) =>
      pathPenalty(left.relativeToTtRoot) - pathPenalty(right.relativeToTtRoot) ||
      left.relativeToTtRoot.length - right.relativeToTtRoot.length ||
      left.relativeToTtRoot.localeCompare(right.relativeToTtRoot, "vi"),
  )[0];
}

function compareEvidence(left, right) {
  return (
    right.provenanceCount - left.provenanceCount ||
    right.recordCount - left.recordCount ||
    right.folderCount - left.folderCount ||
    left.productKey.localeCompare(right.productKey, "vi")
  );
}

function evidenceTupleDiffers(left, right) {
  return (
    left.provenanceCount !== right.provenanceCount ||
    left.recordCount !== right.recordCount ||
    left.folderCount !== right.folderCount
  );
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

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, run),
  );
  return results;
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const ttRoot = path.resolve(
  manifest.ttRoot ?? process.env.LOCAL_TT_ROOT ?? path.join(cwd, ".."),
);
const products = Array.isArray(manifest.products) ? manifest.products : [];
const records = [];

for (const product of products) {
  const key = productKey(product);
  for (const image of product.images ?? []) {
    const relativeToTtRoot = normalizePath(image.relativeToTtRoot);
    const absolutePath = path.resolve(
      ttRoot,
      ...relativeToTtRoot.split("/").filter(Boolean),
    );
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) throw new Error("not-file");
    } catch {
      throw new Error(`Không tìm thấy ảnh active: ${relativeToTtRoot}`);
    }
    records.push({
      product,
      productKey: key,
      image,
      relativeToTtRoot,
      absolutePath,
      provenanceRoot: provenanceRoot(relativeToTtRoot),
      folder: normalizePath(path.dirname(relativeToTtRoot)),
    });
  }
}

console.log(`[dedupe] Hash ${records.length} ảnh active...`);
let hashedCount = 0;
const hashedRecords = await mapConcurrent(
  records,
  hashConcurrency,
  async (record) => {
    const sha256 = await hashFile(record.absolutePath);
    hashedCount += 1;
    if (hashedCount % 100 === 0 || hashedCount === records.length) {
      console.log(`         ${hashedCount}/${records.length} ảnh`);
    }
    return { ...record, sha256 };
  },
);

const byHash = new Map();
for (const record of hashedRecords) {
  const group = byHash.get(record.sha256) ?? [];
  group.push(record);
  byHash.set(record.sha256, group);
}

const keepPaths = new Set();
const hashByPath = new Map();
const autoResolvedCrossProduct = [];
const unresolvedCrossProduct = [];
let removedDuplicateReferences = 0;
let sameProductDuplicateGroups = 0;

for (const [sha256, group] of byHash.entries()) {
  const byProduct = new Map();
  for (const record of group) {
    const current = byProduct.get(record.productKey) ?? [];
    current.push(record);
    byProduct.set(record.productKey, current);
  }

  if (byProduct.size === 1) {
    const representative = chooseRepresentative(group);
    keepPaths.add(representative.relativeToTtRoot);
    hashByPath.set(representative.relativeToTtRoot, sha256);
    if (group.length > 1) {
      sameProductDuplicateGroups += 1;
      removedDuplicateReferences += group.length - 1;
    }
    continue;
  }

  const identityRows = [...byProduct.entries()].map(([key, productRecords]) => {
    const sample = productRecords[0];
    return {
      productKey: key,
      brand: sample.product.brand,
      category: sample.product.category,
      modelCode: String(sample.product.modelCode),
      provenanceCount: new Set(
        productRecords.map((record) => record.provenanceRoot),
      ).size,
      recordCount: productRecords.length,
      folderCount: new Set(productRecords.map((record) => record.folder)).size,
      records: productRecords,
    };
  });

  const sameBrandCategory = identityRows.every(
    (row) =>
      row.brand === identityRows[0].brand &&
      row.category === identityRows[0].category,
  );
  const ranked = [...identityRows].sort(compareEvidence);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const uniqueWinner =
    sameBrandCategory &&
    evidenceTupleDiffers(winner, runnerUp) &&
    (winner.provenanceCount >= 2 || winner.recordCount >= 2);

  if (uniqueWinner) {
    const representative = chooseRepresentative(winner.records);
    keepPaths.add(representative.relativeToTtRoot);
    hashByPath.set(representative.relativeToTtRoot, sha256);
    removedDuplicateReferences += group.length - 1;
    autoResolvedCrossProduct.push({
      sha256,
      winner: winner.productKey,
      loserProductKeys: ranked.slice(1).map((row) => row.productKey),
      evidence: ranked.map((row) => ({
        productKey: row.productKey,
        provenanceCount: row.provenanceCount,
        recordCount: row.recordCount,
        folderCount: row.folderCount,
      })),
      keptPath: representative.relativeToTtRoot,
      removedPaths: group
        .map((record) => record.relativeToTtRoot)
        .filter((value) => value !== representative.relativeToTtRoot)
        .sort((left, right) => left.localeCompare(right, "vi")),
    });
    continue;
  }

  for (const row of identityRows) {
    const representative = chooseRepresentative(row.records);
    keepPaths.add(representative.relativeToTtRoot);
    hashByPath.set(representative.relativeToTtRoot, sha256);
    removedDuplicateReferences += row.records.length - 1;
  }
  unresolvedCrossProduct.push({
    sha256,
    productKeys: identityRows.map((row) => row.productKey).sort(),
    evidence: ranked.map((row) => ({
      productKey: row.productKey,
      provenanceCount: row.provenanceCount,
      recordCount: row.recordCount,
      folderCount: row.folderCount,
    })),
    paths: group
      .map((record) => record.relativeToTtRoot)
      .sort((left, right) => left.localeCompare(right, "vi")),
  });
}

for (const product of products) {
  product.images = (product.images ?? [])
    .filter((image) => keepPaths.has(normalizePath(image.relativeToTtRoot)))
    .map((image) => ({
      ...image,
      contentSha256: hashByPath.get(normalizePath(image.relativeToTtRoot)),
    }))
    .sort((left, right) =>
      normalizePath(left.relativeToTtRoot).localeCompare(
        normalizePath(right.relativeToTtRoot),
        "vi",
      ),
    );
}

const matchedImageCount = products.reduce(
  (sum, product) => sum + (product.images ?? []).length,
  0,
);

manifest.generatedAt = new Date().toISOString();
manifest.summary = {
  ...manifest.summary,
  matchedImageCount,
  contentDuplicateReferencesRemoved: removedDuplicateReferences,
  sameProductDuplicateGroups,
  autoResolvedCrossProductGroups: autoResolvedCrossProduct.length,
  unresolvedCrossProductGroups: unresolvedCrossProduct.length,
};
manifest.contentDedupe = {
  algorithm: "sha256",
  rule:
    "same brand/category + unique stronger independent-source consensus wins; otherwise remains unresolved",
  removedDuplicateReferences,
  sameProductDuplicateGroups,
  autoResolvedCrossProduct,
  unresolvedCrossProduct,
};

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log("\n=== Dedupe nội dung ảnh ===");
console.log(`Ảnh active sau dedupe: ${matchedImageCount}.`);
console.log(`Đã bỏ ${removedDuplicateReferences} tham chiếu ảnh trùng.`);
console.log(
  `Tự giải quyết trùng chéo bằng đồng thuận nguồn: ${autoResolvedCrossProduct.length} nhóm.`,
);
console.log(`Trùng chéo còn mơ hồ: ${unresolvedCrossProduct.length} nhóm.`);
for (const resolution of autoResolvedCrossProduct) {
  console.log(`  ${resolution.sha256.slice(0, 12)}… → ${resolution.winner}`);
}
