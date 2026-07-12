import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const CATALOG_CATEGORIES = new Set(["ao-nguc", "quan-lot", "quan-gen"]);
const PREFIX_CATEGORY = { AL: "ao-nguc", QL: "quan-lot", QG: "quan-gen" };

const rawBuilderPath = path.resolve(cwd, "scripts", "catalog", "build-local-manifest.mjs");
const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ?? path.join(cwd, "data", "local", "catalog-manifest.json"),
);
const referencePath = path.resolve(
  process.env.LOCAL_PRICE_REFERENCE ??
    path.join(cwd, "data", "reference", "price-list-2026-04-02.json"),
);

function productKey(value) {
  return `${value.brand}:${value.category}:${String(value.modelCode)}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function explicitCategory(product) {
  const categories = unique(
    (product.productPrefixes ?? []).map((prefix) => PREFIX_CATEGORY[String(prefix).toUpperCase()]),
  );
  return categories.length === 1 ? categories[0] : null;
}

function choosePriceIdentity(product, candidates) {
  if (candidates.length === 0) {
    return { identity: null, reason: "not-in-price-list", candidates: [] };
  }

  const preferredCategory = explicitCategory(product);
  if (preferredCategory) {
    const byExplicitCategory = candidates.filter((candidate) => candidate.category === preferredCategory);
    if (byExplicitCategory.length === 1) {
      return { identity: byExplicitCategory[0], reason: "price+explicit-prefix", candidates };
    }

    const byExplicitAndBrand = byExplicitCategory.filter(
      (candidate) => candidate.brand === product.brand,
    );
    if (byExplicitAndBrand.length === 1) {
      return { identity: byExplicitAndBrand[0], reason: "price+explicit-prefix+brand", candidates };
    }
  }

  const exact = candidates.filter(
    (candidate) => candidate.brand === product.brand && candidate.category === product.category,
  );
  if (exact.length === 1) {
    return { identity: exact[0], reason: "price+raw-exact", candidates };
  }

  const byCategory = candidates.filter((candidate) => candidate.category === product.category);
  if (byCategory.length === 1) {
    return { identity: byCategory[0], reason: "price+category", candidates };
  }

  const byBrand = candidates.filter((candidate) => candidate.brand === product.brand);
  if (byBrand.length === 1) {
    return { identity: byBrand[0], reason: "price+brand", candidates };
  }

  if (candidates.length === 1) {
    return { identity: candidates[0], reason: "price-only-candidate", candidates };
  }

  return { identity: null, reason: "ambiguous-price-identity", candidates };
}

function mergeProduct(target, source, identity, resolutionReason) {
  const imageByPath = new Map(
    (target.images ?? []).map((image) => [String(image.relativeToTtRoot), image]),
  );
  for (const image of source.images ?? []) {
    imageByPath.set(String(image.relativeToTtRoot), image);
  }

  target.images = [...imageByPath.values()].sort((left, right) =>
    String(left.relativeToTtRoot).localeCompare(String(right.relativeToTtRoot), "vi"),
  );
  target.productPrefixes = unique([
    ...(target.productPrefixes ?? []),
    ...(source.productPrefixes ?? []),
  ]).sort();
  target.modelSources = unique([...(target.modelSources ?? []), ...(source.modelSources ?? [])]).sort();
  target.brandSources = unique([...(target.brandSources ?? []), ...(source.brandSources ?? [])]).sort();
  target.categorySources = unique([
    ...(target.categorySources ?? []),
    ...(source.categorySources ?? []),
  ]).sort();
  target.sources = unique([...(target.sources ?? []), ...(source.sources ?? [])]).sort();
  target.folders = unique([...(target.folders ?? []), ...(source.folders ?? [])]).sort((left, right) =>
    String(left).localeCompare(String(right), "vi"),
  );
  target.rawIdentities = unique([
    ...(target.rawIdentities ?? []),
    productKey(source),
  ]).sort();
  target.resolutionReasons = unique([
    ...(target.resolutionReasons ?? []),
    resolutionReason,
  ]).sort();
  target.priceRows = identity.rows;
}

console.log("[manifest] Quét ảnh nguồn...");
const rawBuild = spawnSync(process.execPath, [rawBuilderPath], {
  cwd,
  env: process.env,
  stdio: "inherit",
  shell: false,
});
if (rawBuild.error) throw rawBuild.error;
if (rawBuild.status !== 0) {
  throw new Error(`Raw manifest builder thất bại với mã ${rawBuild.status}.`);
}

const [manifest, priceReference] = await Promise.all([
  fs.readFile(manifestPath, "utf8").then(JSON.parse),
  fs.readFile(referencePath, "utf8").then(JSON.parse),
]);

const priceByKey = new Map();
for (const entry of priceReference.entries ?? []) {
  if (!entry.inCatalogScope || !entry.modelCode || !CATALOG_CATEGORIES.has(entry.category)) continue;
  const key = productKey(entry);
  const current = priceByKey.get(key) ?? {
    brand: entry.brand,
    category: entry.category,
    modelCode: String(entry.modelCode),
    rows: [],
  };
  current.rows.push({
    rawCode: entry.rawCode,
    variantSuffix: entry.variantSuffix ?? null,
    priceVnd: entry.priceVnd ?? null,
    sourceSheet: entry.sourceSheet ?? null,
    sourceRow: entry.sourceRow ?? null,
  });
  priceByKey.set(key, current);
}

const priceByModel = new Map();
for (const identity of priceByKey.values()) {
  const modelCode = String(identity.modelCode);
  const current = priceByModel.get(modelCode) ?? [];
  current.push(identity);
  priceByModel.set(modelCode, current);
}

const canonicalByKey = new Map();
const excludedImageProducts = [];
const unresolvedImageProducts = [];

for (const product of manifest.products ?? []) {
  const candidates = priceByModel.get(String(product.modelCode)) ?? [];
  const resolved = choosePriceIdentity(product, candidates);

  if (!resolved.identity) {
    const item = {
      rawKey: productKey(product),
      modelCode: String(product.modelCode),
      reason: resolved.reason,
      candidateKeys: resolved.candidates.map(productKey).sort(),
      imageCount: (product.images ?? []).length,
      sources: product.sources ?? [],
      folders: product.folders ?? [],
    };
    if (resolved.reason === "not-in-price-list") excludedImageProducts.push(item);
    else unresolvedImageProducts.push(item);
    continue;
  }

  const identity = resolved.identity;
  const key = productKey(identity);
  const current = canonicalByKey.get(key) ?? {
    brand: identity.brand,
    category: identity.category,
    modelCode: String(identity.modelCode),
    productPrefixes: [],
    modelSources: [],
    brandSources: [],
    categorySources: [],
    sources: [],
    folders: [],
    images: [],
    rawIdentities: [],
    resolutionReasons: [],
    priceRows: identity.rows,
    identitySource: "price-reference",
  };
  mergeProduct(current, product, identity, resolved.reason);
  canonicalByKey.set(key, current);
}

const products = [...canonicalByKey.values()].sort((left, right) =>
  left.brand.localeCompare(right.brand, "vi") ||
  left.category.localeCompare(right.category, "vi") ||
  left.modelCode.localeCompare(right.modelCode, "vi"),
);
const activeKeys = new Set(products.map(productKey));
const priceProductsWithoutImages = [...priceByKey.values()]
  .filter((identity) => !activeKeys.has(productKey(identity)))
  .map((identity) => ({
    key: productKey(identity),
    brand: identity.brand,
    category: identity.category,
    modelCode: identity.modelCode,
    priceRows: identity.rows,
    disposition: "omitted-no-images-possible-discontinued",
  }))
  .sort((left, right) => left.key.localeCompare(right.key, "vi"));

const matchedImageCount = products.reduce(
  (sum, product) => sum + (product.images ?? []).length,
  0,
);

const canonicalManifest = {
  ...manifest,
  schemaVersion: 6,
  generatedAt: new Date().toISOString(),
  classificationRules: {
    ...manifest.classificationRules,
    authority: "price-list",
    activeCatalogRule: "intersection(price-list, products-with-images)",
    priority: [
      "price list determines canonical brand + category + model",
      "AL/QL/QG prefix disambiguates category when the price list has multiple candidates",
      "path/source folder is evidence only, never authoritative",
      "model prefix is fallback evidence only",
      "price-list products without images are omitted as possible discontinued models",
      "image products absent from the price list are excluded from the active catalog",
    ],
  },
  priceReference: {
    path: referencePath,
    sourceFile: priceReference.sourceFile,
    effectiveDate: priceReference.effectiveDate,
    authoritative: true,
  },
  summary: {
    ...manifest.summary,
    rawProductGroupCount: Number(manifest.summary?.productGroupCount ?? 0),
    rawMatchedImageCount: Number(manifest.summary?.matchedImageCount ?? 0),
    productGroupCount: products.length,
    matchedImageCount,
    excludedImageOnlyProductCount: excludedImageProducts.length,
    unresolvedImageProductCount: unresolvedImageProducts.length,
    priceProductCount: priceByKey.size,
    priceProductsWithoutImagesCount: priceProductsWithoutImages.length,
    classificationWarningCount: unresolvedImageProducts.length,
    activeCatalogDefinition: "price-list-and-images",
  },
  products,
  excludedImageProducts,
  unresolvedImageProducts,
  priceProductsWithoutImages,
  rawClassificationWarnings: manifest.classificationWarnings ?? [],
  rawClassificationExceptions: manifest.classificationExceptions ?? [],
  classificationWarnings: unresolvedImageProducts.map((item) => ({
    brand: "unresolved",
    category: "unresolved",
    modelCode: item.modelCode,
    reasons: [
      {
        code: item.reason,
        message: "Không xác định duy nhất brand + category + model từ bảng giá.",
        candidates: item.candidateKeys,
      },
    ],
    folders: item.folders,
    imageCount: item.imageCount,
  })),
  classificationExceptions: [],
};

await fs.writeFile(manifestPath, `${JSON.stringify(canonicalManifest, null, 2)}\n`, "utf8");

console.log("\n=== Manifest theo bảng giá ===");
console.log(`Catalog active: ${products.length} model / ${matchedImageCount} ảnh.`);
console.log(
  `Bỏ vì có ảnh nhưng không có trong bảng giá: ${excludedImageProducts.length} model.`,
);
console.log(
  `Bỏ vì có trong bảng giá nhưng không có ảnh: ${priceProductsWithoutImages.length} model.`,
);
console.log(`Còn mơ hồ cần duyệt: ${unresolvedImageProducts.length} model.`);
console.log(`Manifest: ${manifestPath}`);
