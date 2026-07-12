import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const [auditArgument, manifestArgument, outputArgument] = process.argv.slice(2);

if (!auditArgument) {
  console.error(
    "Usage: node scripts/catalog/build-tuan-thuy-review-plan.mjs <consolidated-audit.json> [catalog-manifest.json] [output.json]",
  );
  process.exit(1);
}

const auditPath = path.resolve(cwd, auditArgument);
const manifestPath = path.resolve(
  cwd,
  manifestArgument ?? path.join(cwd, "data", "local", "catalog-manifest.json"),
);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? auditArgument.replace(/\.json$/i, "") + ".review-plan.json",
);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function productKey(value) {
  return `${clean(value.brand).toLowerCase()}:${clean(value.category).toLowerCase()}:${clean(value.modelCode)}`;
}

function parseProductKey(key) {
  const [brand, category, modelCode] = clean(key).split(":");
  return { brand, category, modelCode };
}

function inspectVariant(variant) {
  const issues = [];
  const sizeCode = clean(variant.sizeCode);
  const cupCode = clean(variant.cupCode).toUpperCase();
  const expectedKey = `${sizeCode}::${cupCode}`;
  const expectedLabel = `${sizeCode}${cupCode}`;

  if (!/^\d{2,3}$/.test(sizeCode)) issues.push("invalid-size-code");
  if (!/^[A-D]$/.test(cupCode)) issues.push("invalid-cup-code");
  if (clean(variant.variantKey) !== expectedKey) issues.push("variant-key-mismatch");
  if (clean(variant.displayLabel).toUpperCase() !== expectedLabel) {
    issues.push("display-label-mismatch");
  }
  if (!(variant.evidenceTypes ?? []).includes("description-explicit-size-cup-list")) {
    issues.push("missing-explicit-size-cup-evidence");
  }
  if (!(variant.evidenceUrls ?? []).length) issues.push("missing-evidence-url");
  if (!(variant.evidenceTexts ?? []).some((text) => clean(text))) {
    issues.push("missing-evidence-text");
  }

  return {
    variantKey: expectedKey,
    sizeCode,
    cupCode,
    displayLabel: expectedLabel,
    evidenceUrls: unique(variant.evidenceUrls ?? []),
    evidenceTexts: unique(variant.evidenceTexts ?? []),
    evidenceTypes: unique(variant.evidenceTypes ?? []),
    issues,
  };
}

function inspectColor(color, sortOrder) {
  const issues = [];
  const code = clean(color.code).toLowerCase();
  const name = clean(color.name);
  const evidenceUrls = unique(color.evidenceUrls ?? []);
  if (!code) issues.push("missing-color-code");
  if (!name) issues.push("missing-color-name");
  if (!evidenceUrls.length) issues.push("missing-color-evidence-url");
  return {
    code,
    name,
    sourceSystem: clean(color.sourceSystem),
    evidenceUrls,
    sortOrder,
    issues,
  };
}

const [auditText, manifestText] = await Promise.all([
  fs.readFile(auditPath, "utf8"),
  fs.readFile(manifestPath, "utf8"),
]);
const audit = JSON.parse(auditText);
const manifest = JSON.parse(manifestText);

if (!Array.isArray(audit.products)) throw new Error("Consolidated audit không có mảng products.");
if (!Array.isArray(manifest.products)) throw new Error("Catalog manifest không có mảng products.");

const activeProducts = manifest.products
  .map((product) => ({
    key: productKey(product),
    brand: clean(product.brand).toLowerCase(),
    category: clean(product.category).toLowerCase(),
    modelCode: clean(product.modelCode),
    retainedWithoutImages: Boolean(product.retainedWithoutImages),
  }))
  .sort((left, right) => left.key.localeCompare(right.key, "vi"));

const duplicateActiveKeys = [...new Set(
  activeProducts
    .map((product) => product.key)
    .filter((key, index, keys) => keys.indexOf(key) !== index),
)].sort();
if (duplicateActiveKeys.length) {
  throw new Error(`Catalog manifest có khóa product trùng: ${duplicateActiveKeys.join(", ")}`);
}

const activeByKey = new Map(activeProducts.map((product) => [product.key, product]));
const webByKey = new Map();
for (const product of audit.products) {
  const key = clean(product.key) || productKey(product);
  if (webByKey.has(key)) throw new Error(`Consolidated audit có product trùng: ${key}`);
  webByKey.set(key, product);
}

const productReviews = [...webByKey.entries()]
  .map(([key, product]) => {
    const activeProduct = activeByKey.get(key) ?? null;
    const variantReviews = (product.variants ?? []).map(inspectVariant);
    const duplicateVariantKeys = [...new Set(
      variantReviews
        .map((variant) => variant.variantKey)
        .filter((variantKey, index, keys) => keys.indexOf(variantKey) !== index),
    )].sort();
    const variantValidationIssues = unique([
      ...variantReviews.flatMap((variant) => variant.issues),
      ...(duplicateVariantKeys.length ? ["duplicate-variant-keys"] : []),
      ...(!Number.isInteger(product.authoritativeBasePriceVnd) || product.authoritativeBasePriceVnd <= 0
        ? ["missing-authoritative-base-price"]
        : []),
    ]).sort();

    const colorReviews = (product.colors ?? []).map(inspectColor);
    const duplicateColorCodes = [...new Set(
      colorReviews
        .map((color) => color.code)
        .filter((code, index, codes) => codes.indexOf(code) !== index),
    )].sort();
    const colorValidationIssues = unique([
      ...colorReviews.flatMap((color) => color.issues),
      ...(duplicateColorCodes.length ? ["duplicate-color-codes"] : []),
    ]).sort();

    const sourceBlockers = unique(product.audit?.blockers ?? []).sort();
    const reviewFlags = unique(product.audit?.reviewFlags ?? []).sort();
    const active = Boolean(activeProduct);
    const hasVariantCandidates = variantReviews.length > 0;
    const hasColorCandidates = colorReviews.length > 0;

    let variantDisposition = "not-applicable";
    if (!active) variantDisposition = "outside-active-catalog";
    else if (sourceBlockers.length || !hasVariantCandidates || variantValidationIssues.length) {
      variantDisposition = "blocked";
    } else {
      variantDisposition = "reviewed-candidate";
    }

    const colorDisposition =
      active && hasColorCandidates && colorValidationIssues.length === 0
        ? "product-order-choice-candidate"
        : "none";
    const orderableCandidate =
      variantDisposition === "reviewed-candidate" &&
      colorDisposition === "product-order-choice-candidate";

    return {
      key,
      ...parseProductKey(key),
      active,
      retainedWithoutImages: activeProduct?.retainedWithoutImages ?? false,
      authoritativeBasePriceVnd: product.authoritativeBasePriceVnd ?? null,
      variantDisposition,
      variantCandidates: variantReviews.map(({ issues, ...variant }) => variant),
      variantValidationIssues,
      sourceBlockers,
      reviewFlags,
      colorDisposition,
      colorCandidates: colorReviews.map(({ issues, ...color }) => color),
      colorValidationIssues,
      orderableCandidate,
      orderingBlocker: orderableCandidate
        ? null
        : variantDisposition !== "reviewed-candidate"
          ? "missing-or-blocked-size-cup"
          : "missing-or-blocked-color",
      primaryContentSourceUrl: product.primaryContentSourceUrl ?? null,
      descriptionAvailable: Boolean(clean(product.description)),
      featureCandidateCount: (product.featureCandidates ?? []).length,
      sourcePageCount: Number(product.audit?.webPageCount ?? product.sourcePages?.length ?? 0),
    };
  })
  .sort((left, right) => left.key.localeCompare(right.key, "vi"));

const activeKeys = new Set(activeProducts.map((product) => product.key));
const webKeys = new Set(productReviews.map((product) => product.key));
const activeProductsWithoutWebAudit = activeProducts.filter((product) => !webKeys.has(product.key));
const webProductsOutsideActiveCatalog = productReviews.filter((product) => !activeKeys.has(product.key));
const activeWebProducts = productReviews.filter((product) => product.active);
const activeReviewedVariantCandidates = activeWebProducts.filter(
  (product) => product.variantDisposition === "reviewed-candidate",
);
const activeBlockedProducts = activeWebProducts.filter(
  (product) => product.variantDisposition === "blocked",
);
const activeColorCandidates = activeWebProducts.filter(
  (product) => product.colorDisposition === "product-order-choice-candidate",
);
const activeOrderableCandidates = activeWebProducts.filter((product) => product.orderableCandidate);

const output = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sourceAudit: {
    path: auditPath,
    schemaVersion: audit.schemaVersion ?? null,
    generatedAt: audit.sourceAudit?.generatedAt ?? null,
  },
  activeCatalog: {
    path: manifestPath,
    schemaVersion: manifest.schemaVersion ?? null,
    generatedAt: manifest.generatedAt ?? null,
    productCount: activeProducts.length,
  },
  businessRules: {
    productIdentity: "brand + category + model",
    orderVariantIdentity: "product + size + cup",
    orderLineIdentity: "product + color + size + cup",
    colorsAreProductLevelOrderChoices: true,
    colorsParticipateInCartIdentity: true,
    colorsDoNotControlGallery: true,
    noColorImageMapping: true,
    noPrecomputedColorSizeCupCartesianRows: true,
    authoritativePricingSource: "price-reference",
    websitePricesAreAuditEvidenceOnly: true,
    databaseWritePerformed: false,
    explicitApprovalRequiredBeforeImport: true,
  },
  summary: {
    activeCatalogProductCount: activeProducts.length,
    webAuditProductCount: productReviews.length,
    activeWebIntersectionCount: activeWebProducts.length,
    activeProductsWithoutWebAuditCount: activeProductsWithoutWebAudit.length,
    webProductsOutsideActiveCatalogCount: webProductsOutsideActiveCatalog.length,
    activeProductsWithReviewedVariantCandidates: activeReviewedVariantCandidates.length,
    activeReviewedVariantCandidateCount: activeReviewedVariantCandidates.reduce(
      (sum, product) => sum + product.variantCandidates.length,
      0,
    ),
    activeProductsBlocked: activeBlockedProducts.length,
    activeProductsWithColorCandidates: activeColorCandidates.length,
    activeColorCandidateCount: activeColorCandidates.reduce(
      (sum, product) => sum + product.colorCandidates.length,
      0,
    ),
    activeOrderableCandidateProductCount: activeOrderableCandidates.length,
    activeOrderableVariantCandidateCount: activeOrderableCandidates.reduce(
      (sum, product) => sum + product.variantCandidates.length,
      0,
    ),
    activeOrderableColorCandidateCount: activeOrderableCandidates.reduce(
      (sum, product) => sum + product.colorCandidates.length,
      0,
    ),
    importReadyProductCount: 0,
  },
  decisions: {
    reviewedVariantCandidates: activeReviewedVariantCandidates.map((product) => ({
      key: product.key,
      authoritativeBasePriceVnd: product.authoritativeBasePriceVnd,
      variants: product.variantCandidates,
      reviewFlags: product.reviewFlags,
      primaryContentSourceUrl: product.primaryContentSourceUrl,
    })),
    activeColorCandidates: activeColorCandidates.map((product) => ({
      key: product.key,
      colors: product.colorCandidates,
    })),
    orderableCandidates: activeOrderableCandidates.map((product) => ({
      key: product.key,
      variants: product.variantCandidates,
      colors: product.colorCandidates,
    })),
    blockedActiveProducts: activeBlockedProducts.map((product) => ({
      key: product.key,
      sourceBlockers: product.sourceBlockers,
      variantValidationIssues: product.variantValidationIssues,
      reviewFlags: product.reviewFlags,
      colors: product.colorCandidates,
    })),
    activeProductsWithoutWebAudit,
    webProductsOutsideActiveCatalog: webProductsOutsideActiveCatalog.map((product) => ({
      key: product.key,
      sourceBlockers: product.sourceBlockers,
      reviewFlags: product.reviewFlags,
    })),
  },
  productReviews,
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log("=== Tuấn Thủy active-catalog review plan ===");
console.log(`Active catalog products: ${output.summary.activeCatalogProductCount}`);
console.log(`Web audit products: ${output.summary.webAuditProductCount}`);
console.log(`Active/web intersection: ${output.summary.activeWebIntersectionCount}`);
console.log(`Active products without web audit: ${output.summary.activeProductsWithoutWebAuditCount}`);
console.log(`Web products outside active catalog: ${output.summary.webProductsOutsideActiveCatalogCount}`);
console.log(
  `Reviewed variant candidates: ${output.summary.activeProductsWithReviewedVariantCandidates} products / ${output.summary.activeReviewedVariantCandidateCount} variants`,
);
console.log(`Blocked active products: ${output.summary.activeProductsBlocked}`);
console.log(
  `Color candidates: ${output.summary.activeProductsWithColorCandidates} products / ${output.summary.activeColorCandidateCount} colors`,
);
console.log(
  `Orderable candidates with both color and size/cup: ${output.summary.activeOrderableCandidateProductCount} products / ${output.summary.activeOrderableVariantCandidateCount} variants / ${output.summary.activeOrderableColorCandidateCount} colors`,
);
console.log("Import-ready products: 0 (explicit approval is still required)");
console.log(`Output: ${outputPath}`);
