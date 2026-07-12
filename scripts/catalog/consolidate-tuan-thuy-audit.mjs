import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const [inputArgument, outputArgument] = process.argv.slice(2);

if (!inputArgument) {
  console.error(
    "Usage: node scripts/catalog/consolidate-tuan-thuy-audit.mjs <raw-audit.json> [output.json]",
  );
  process.exit(1);
}

const inputPath = path.resolve(cwd, inputArgument);
const outputPath = path.resolve(
  cwd,
  outputArgument ?? inputArgument.replace(/\.json$/i, "") + ".consolidated.json",
);
const priceReferencePath = path.resolve(
  process.env.LOCAL_PRICE_REFERENCE ??
    path.join(cwd, "data", "reference", "price-list-2026-04-02.json"),
);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function fold(value) {
  return clean(value)
    .replace(/đ/gi, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function slug(value) {
  return fold(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function productKey(value) {
  return `${value.brand}:${value.category}:${value.modelCode}`;
}

function normalizeBrand(page) {
  const evidence = fold(`${page.brand ?? ""} ${page.name ?? ""}`);
  if (/pensee|pensees|pensse/.test(evidence)) return "pensee";
  if (/winking/.test(evidence)) return "winking";
  return null;
}

function inferCategory(page) {
  const evidence = fold(page.name);
  if (/ao nguc/.test(evidence)) return "ao-nguc";
  if (/quan lot/.test(evidence)) return "quan-lot";
  if (/quan gen/.test(evidence)) return "quan-gen";
  return null;
}

function resolveModel(page) {
  const nameModels = unique(
    [...clean(page.name).matchAll(/(?:^|\D)([5789]\d{3})(?:\D|$)/g)].map((match) => match[1]),
  );
  const candidates = unique((page.modelCandidates ?? []).map(String));
  if (nameModels.length === 1) {
    return {
      modelCode: nameModels[0],
      candidates,
      source: "product-name",
      hasExtraCandidates: candidates.some((value) => value !== nameModels[0]),
    };
  }
  if (candidates.length === 1) {
    return {
      modelCode: candidates[0],
      candidates,
      source: "scraper-candidate",
      hasExtraCandidates: false,
    };
  }
  return {
    modelCode: null,
    candidates,
    source: null,
    hasExtraCandidates: candidates.length > 1,
  };
}

const COLOR_TOKENS = new Set([
  "da",
  "dam",
  "nhat",
  "den",
  "do",
  "tim",
  "trang",
  "hong",
  "xam",
  "xanh",
  "duong",
  "ngoc",
  "cam",
  "nau",
  "bo",
  "kem",
  "be",
  "ghi",
  "reu",
  "sen",
]);

function colorLabelsFromTitle(page, modelCode) {
  const name = clean(page.name);
  const index = name.indexOf(modelCode);
  if (index < 0) return [];

  const suffix = name
    .slice(index + modelCode.length)
    .replace(/^[\s\-–—:]+/, "")
    .trim();
  if (!suffix) return [];

  const labels = suffix
    .split(/\s*[,/]\s*/)
    .map(clean)
    .filter(Boolean);

  return labels.filter((label) => {
    const tokens = fold(label).split(/[^a-z0-9]+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => COLOR_TOKENS.has(token));
  });
}

function scorePrimaryPage(page) {
  return (
    Number((page.variants ?? []).length > 0) * 1_000_000 +
    Number((page.featureCandidates ?? []).length) * 10_000 +
    clean(page.description).length +
    Number((page.images ?? []).length) * 10
  );
}

function selectPriceIdentity(page, modelResolution, priceByBrandModel) {
  const brand = normalizeBrand(page);
  const category = inferCategory(page);
  const modelCode = modelResolution.modelCode;
  if (!brand || !category || !modelCode) {
    return {
      identity: null,
      reason: "insufficient-web-identity",
      candidates: [],
      brand,
      category,
      modelCode,
    };
  }

  const candidates = priceByBrandModel.get(`${brand}:${modelCode}`) ?? [];
  const categoryMatches = candidates.filter((candidate) => candidate.category === category);
  if (categoryMatches.length === 1) {
    return {
      identity: categoryMatches[0],
      reason: "price-reference+web-product-kind",
      candidates,
      brand,
      category,
      modelCode,
    };
  }

  if (candidates.length === 1) {
    return {
      identity: candidates[0],
      reason: "price-reference-single-brand-model",
      candidates,
      brand,
      category,
      modelCode,
    };
  }

  return {
    identity: null,
    reason: candidates.length ? "ambiguous-price-identity" : "not-in-price-reference",
    candidates,
    brand,
    category,
    modelCode,
  };
}

const [rawAudit, priceReference] = await Promise.all([
  fs.readFile(inputPath, "utf8").then(JSON.parse),
  fs.readFile(priceReferencePath, "utf8").then(JSON.parse),
]);

if (Number(rawAudit.schemaVersion) < 3 || !Array.isArray(rawAudit.products)) {
  throw new Error("Expected a Tuấn Thủy raw audit with schemaVersion >= 3.");
}

const priceByBrandModel = new Map();
for (const entry of priceReference.entries ?? []) {
  if (!entry.inCatalogScope || !entry.modelCode || !entry.brand || !entry.category) continue;
  const key = `${entry.brand}:${String(entry.modelCode)}`;
  const candidates = priceByBrandModel.get(key) ?? [];
  let identity = candidates.find((candidate) => candidate.category === entry.category);
  if (!identity) {
    identity = {
      brand: entry.brand,
      category: entry.category,
      modelCode: String(entry.modelCode),
      rows: [],
    };
    candidates.push(identity);
  }
  identity.rows.push({
    rawCode: entry.rawCode,
    variantSuffix: entry.variantSuffix ?? null,
    priceVnd: entry.priceVnd ?? null,
    sourceSheet: entry.sourceSheet ?? null,
    sourceRow: entry.sourceRow ?? null,
  });
  priceByBrandModel.set(key, candidates);
}

const groups = new Map();
const unresolvedPages = [];

for (const page of rawAudit.products) {
  const modelResolution = resolveModel(page);
  const priceResolution = selectPriceIdentity(page, modelResolution, priceByBrandModel);
  if (!priceResolution.identity) {
    unresolvedPages.push({
      sourceUrl: page.sourceUrl ?? null,
      name: page.name ?? null,
      modelCandidates: modelResolution.candidates,
      inferredBrand: priceResolution.brand,
      inferredCategory: priceResolution.category,
      reason: priceResolution.reason,
      candidateKeys: priceResolution.candidates.map(productKey).sort(),
    });
    continue;
  }

  const identity = priceResolution.identity;
  const key = productKey(identity);
  const current = groups.get(key) ?? {
    key,
    brand: identity.brand,
    category: identity.category,
    modelCode: identity.modelCode,
    identitySource: "price-reference",
    priceRows: identity.rows,
    pages: [],
    colors: new Map(),
    variants: new Map(),
    reviewFlags: new Set(),
    blockers: new Set(),
  };

  const pageSummary = {
    sourceUrl: page.sourceUrl ?? null,
    sourceKey: page.sourceKey ?? null,
    name: page.name ?? null,
    webSku: page.sku ?? null,
    webBrand: page.brand ?? null,
    webCategory: page.category ?? null,
    webPriceVnd: page.price ?? null,
    descriptionPriceCandidates: page.descriptionPriceCandidates ?? [],
    images: page.images ?? [],
    variantSource: page.variantSource ?? null,
    variantCount: (page.variants ?? []).length,
    blockers: page.blockers ?? [],
    reviewFlags: page.reviewFlags ?? [],
  };
  current.pages.push(pageSummary);

  for (const label of colorLabelsFromTitle(page, identity.modelCode)) {
    const code = slug(label);
    const color = current.colors.get(code) ?? {
      code,
      name: label,
      sourceSystem: "tuanthuy-page-title",
      evidenceUrls: [],
    };
    color.evidenceUrls.push(page.sourceUrl);
    current.colors.set(code, color);
  }

  for (const variant of page.variants ?? []) {
    if (!variant.size) continue;
    const variantKey = `${clean(variant.size).toUpperCase()}::${clean(variant.cup).toUpperCase()}`;
    const existing = current.variants.get(variantKey) ?? {
      variantKey,
      sizeCode: clean(variant.size).toUpperCase(),
      cupCode: clean(variant.cup).toUpperCase() || null,
      displayLabel: clean(variant.label) || null,
      sourceSystem: "tuanthuy-description",
      evidenceUrls: [],
      evidenceTexts: [],
      evidenceTypes: [],
    };
    existing.evidenceUrls.push(page.sourceUrl);
    existing.evidenceTexts.push(
      ...(variant.rawRows ?? []).map((row) => row.sourceText).filter(Boolean),
    );
    existing.evidenceTypes.push(...(variant.evidence ?? []));
    current.variants.set(variantKey, existing);
  }

  if (modelResolution.hasExtraCandidates) {
    current.reviewFlags.add("extra-model-candidates-ignored-because-name-was-explicit");
  }
  for (const flag of page.reviewFlags ?? []) current.reviewFlags.add(flag);
  groups.set(key, current);
}

const products = [...groups.values()]
  .map((group) => {
    const sourcePages = [...group.pages].sort((left, right) =>
      String(left.sourceUrl).localeCompare(String(right.sourceUrl), "vi"),
    );
    const rawPages = rawAudit.products.filter((page) =>
      sourcePages.some((source) => source.sourceUrl === page.sourceUrl),
    );
    const primaryPage = [...rawPages].sort(
      (left, right) => scorePrimaryPage(right) - scorePrimaryPage(left),
    )[0];

    const colors = [...group.colors.values()]
      .map((color) => ({
        ...color,
        evidenceUrls: unique(color.evidenceUrls).sort(),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "vi"));

    const variants = [...group.variants.values()]
      .map((variant) => ({
        ...variant,
        evidenceUrls: unique(variant.evidenceUrls).sort(),
        evidenceTexts: unique(variant.evidenceTexts),
        evidenceTypes: unique(variant.evidenceTypes),
        priceVnd: null,
        priceSource: "resolved-at-server-from-authoritative-price-reference",
      }))
      .sort((left, right) =>
        String(left.displayLabel).localeCompare(String(right.displayLabel), "vi", {
          numeric: true,
        }),
      );

    const basePriceRows = group.priceRows.filter((row) => !row.variantSuffix);
    const basePrices = unique(basePriceRows.map((row) => row.priceVnd));
    const authoritativeBasePrice = basePrices.length === 1 ? basePrices[0] : null;

    const webPrices = unique(sourcePages.map((page) => page.webPriceVnd));
    const conflictingWebPages = sourcePages.filter(
      (page) =>
        page.webPriceVnd !== null &&
        authoritativeBasePrice !== null &&
        page.webPriceVnd !== authoritativeBasePrice,
    );
    const missingWebPricePages = sourcePages.filter((page) => page.webPriceVnd === null);

    if (!variants.length) group.blockers.add("no-size-cup-source-after-model-merge");
    if (basePriceRows.length === 0) group.blockers.add("missing-authoritative-base-price");
    if (authoritativeBasePrice === null) group.blockers.add("ambiguous-authoritative-base-price");
    if (conflictingWebPages.length) group.reviewFlags.add("web-price-conflicts-price-reference");
    if (missingWebPricePages.length) group.reviewFlags.add("some-color-pages-missing-web-price");
    if (colors.length) group.reviewFlags.add("colors-derived-from-page-title");
    if (!clean(primaryPage?.description)) group.reviewFlags.add("missing-product-description");
    if (!(primaryPage?.featureCandidates ?? []).length) {
      group.reviewFlags.add("missing-feature-candidates");
    }

    const variantReviewRequired = variants.some((variant) =>
      variant.evidenceTypes.includes("description-explicit-size-cup-list"),
    );

    return {
      key: group.key,
      brand: group.brand,
      category: group.category,
      modelCode: group.modelCode,
      identitySource: group.identitySource,
      authoritativeBasePriceVnd: authoritativeBasePrice,
      priceRows: group.priceRows,
      colors,
      variants,
      primaryContentSourceUrl: primaryPage?.sourceUrl ?? null,
      description: primaryPage?.description ?? "",
      featureCandidates: primaryPage?.featureCandidates ?? [],
      sourcePages,
      audit: {
        webPageCount: sourcePages.length,
        webPricesVnd: webPrices,
        conflictingWebPriceUrls: conflictingWebPages.map((page) => page.sourceUrl),
        missingWebPriceUrls: missingWebPricePages.map((page) => page.sourceUrl),
        blockers: [...group.blockers].sort(),
        reviewFlags: [...group.reviewFlags].sort(),
        variantReviewRequired,
        importReady: group.blockers.size === 0 && !variantReviewRequired,
      },
    };
  })
  .sort(
    (left, right) =>
      left.brand.localeCompare(right.brand, "vi") ||
      left.category.localeCompare(right.category, "vi") ||
      left.modelCode.localeCompare(right.modelCode, "vi", { numeric: true }),
  );

const output = {
  schemaVersion: 1,
  sourceAudit: {
    path: inputPath,
    schemaVersion: rawAudit.schemaVersion,
    generatedAt: rawAudit.generatedAt,
    rawPageCount: rawAudit.products.length,
  },
  priceReference: {
    path: priceReferencePath,
    effectiveDate: priceReference.effectiveDate,
    authoritative: true,
  },
  businessRules: {
    productIdentity: "brand + category + model",
    colorsAreProductLevelDisplayData: true,
    colorsDoNotControlGallery: true,
    colorsDoNotParticipateInCartIdentity: true,
    orderVariantIdentity: "product + size + cup",
    noColorImageMapping: true,
    noCartesianSizeCupInference: true,
    websitePricesAreAuditEvidenceOnly: true,
    authoritativePricingSource: "price-reference",
    noDatabaseWrite: true,
  },
  summary: {
    rawPageCount: rawAudit.products.length,
    canonicalProductCount: products.length,
    mergedColorPageCount: products.reduce(
      (sum, product) => sum + Math.max(0, product.sourcePages.length - 1),
      0,
    ),
    productsWithColorsFromTitles: products.filter((product) => product.colors.length).length,
    productsWithVariants: products.filter((product) => product.variants.length).length,
    variantCount: products.reduce((sum, product) => sum + product.variants.length, 0),
    productsWithoutVariants: products.filter((product) => !product.variants.length).length,
    productsWithBlockers: products.filter((product) => product.audit.blockers.length).length,
    productsRequiringVariantReview: products.filter(
      (product) => product.audit.variantReviewRequired,
    ).length,
    importReadyProductCount: products.filter((product) => product.audit.importReady).length,
    unresolvedPageCount: unresolvedPages.length,
  },
  unresolvedPages,
  products,
};

await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log("=== Tuấn Thủy model-level audit ===");
console.log(`Raw pages: ${output.summary.rawPageCount}`);
console.log(`Canonical products: ${output.summary.canonicalProductCount}`);
console.log(`Merged color pages: ${output.summary.mergedColorPageCount}`);
console.log(`Products with title colors: ${output.summary.productsWithColorsFromTitles}`);
console.log(`Products with variants: ${output.summary.productsWithVariants}`);
console.log(`Variant candidates: ${output.summary.variantCount}`);
console.log(`Products without variants: ${output.summary.productsWithoutVariants}`);
console.log(`Products with blockers: ${output.summary.productsWithBlockers}`);
console.log(`Products requiring variant review: ${output.summary.productsRequiringVariantReview}`);
console.log(`Import-ready products: ${output.summary.importReadyProductCount}`);
console.log(`Unresolved pages: ${output.summary.unresolvedPageCount}`);
console.log(`Output: ${outputPath}`);
