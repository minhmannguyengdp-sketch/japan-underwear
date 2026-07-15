import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-supplier-color-variants-"));
const importerPath = path.join(
  cwd,
  "scripts",
  "catalog",
  "import-tuan-thuy-supplier-color-variants.mjs",
);

function run(args, expectedSuccess) {
  const result = spawnSync(process.execPath, [importerPath, ...args], {
    cwd,
    encoding: "utf8",
  });
  const success = result.status === 0;
  if (success !== expectedSuccess) {
    throw new Error(
      [
        `Unexpected exit ${result.status}; expected success=${expectedSuccess}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }
  return result;
}

function variant(sizeCode, cupCode) {
  return { sizeCode, cupCode, label: `${sizeCode}${cupCode}` };
}

try {
  const sourcePath = path.join(tempDir, "supplier.xlsx");
  const sourceBuffer = Buffer.from("synthetic supplier color variant spreadsheet");
  await fs.writeFile(sourcePath, sourceBuffer);
  const sourceHash = crypto.createHash("sha256").update(sourceBuffer).digest("hex");

  const products = [
    {
      key: "pensee:ao-nguc:9501",
      brand: "pensee",
      category: "ao-nguc",
      modelCode: "9501",
      sourceSheet: "Pensee",
      colors: [
        {
          code: "da",
          name: "Da",
          sourceRow: 5,
          sourceSizeText: "75A, 80A",
          variants: [variant("75", "A"), variant("80", "A")],
        },
        {
          code: "den",
          name: "Đen",
          sourceRow: 6,
          sourceSizeText: "75A",
          variants: [variant("75", "A")],
        },
      ],
      uniqueVariants: [variant("75", "A"), variant("80", "A")],
    },
    {
      key: "pensee:ao-nguc:9502",
      brand: "pensee",
      category: "ao-nguc",
      modelCode: "9502",
      sourceSheet: "Pensee",
      colors: [
        {
          code: "da",
          name: "Da",
          sourceRow: 7,
          sourceSizeText: "75B",
          variants: [variant("75", "B")],
        },
      ],
      uniqueVariants: [variant("75", "B")],
    },
    {
      key: "winking:ao-nguc:9070",
      brand: "winking",
      category: "ao-nguc",
      modelCode: "9070",
      sourceSheet: "Winking",
      colors: [
        {
          code: "trang",
          name: "Trắng",
          sourceRow: 8,
          sourceSizeText: "80B",
          variants: [variant("80", "B")],
        },
      ],
      uniqueVariants: [variant("80", "B")],
    },
  ];

  const manifest = {
    schemaVersion: 1,
    sourceSupplierFile: {
      filename: "supplier.xlsx",
      sha256: sourceHash,
      sheets: ["Pensee", "Winking"],
    },
    businessRules: {
      rowLevelColorVariantAvailability: true,
      noCartesianProduct: true,
      supplierRowsAreCompletePerColor: true,
      onlyActiveCatalogProductsAreMatched: true,
      noProductCreation: true,
      noColorWrite: true,
      noPriceWrite: true,
      historicalOrdersUnchanged: true,
    },
    sourceCorrections: [],
    summary: {
      inScopeBraProductCount: 3,
      inScopeColorCount: 4,
      colorVariantCombinationCount: 5,
      productVariantIdentityCount: 4,
      productsWithColorSpecificVariantSets: 1,
      targetMissingSizeCupProductCount: 30,
      targetProductsCovered: 3,
      targetProductsStillMissing: 27,
    },
    targetCoverage: Array.from({ length: 30 }, (_, index) => ({
      key: `pensee:ao-nguc:${9501 + index}`,
      present: index < 3,
    })),
    products,
  };

  const manifestPath = path.join(tempDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const valid = run([manifestPath, sourcePath, "--validate-only"], true);
  if (!valid.stdout.includes("Exact color–size/cup combinations: 5")) {
    throw new Error("Valid manifest did not report exact combination count.");
  }
  if (!valid.stdout.includes("VALIDATE ONLY")) {
    throw new Error("Valid manifest did not complete validation.");
  }

  const cartesianManifest = structuredClone(manifest);
  cartesianManifest.businessRules.noCartesianProduct = false;
  const cartesianPath = path.join(tempDir, "cartesian.json");
  await fs.writeFile(
    cartesianPath,
    `${JSON.stringify(cartesianManifest, null, 2)}\n`,
    "utf8",
  );
  run([cartesianPath, sourcePath, "--validate-only"], false);

  const duplicatedManifest = structuredClone(manifest);
  duplicatedManifest.products[0].colors[0].variants.push(variant("75", "A"));
  duplicatedManifest.summary.colorVariantCombinationCount += 1;
  const duplicatedPath = path.join(tempDir, "duplicated.json");
  await fs.writeFile(
    duplicatedPath,
    `${JSON.stringify(duplicatedManifest, null, 2)}\n`,
    "utf8",
  );
  run([duplicatedPath, sourcePath, "--validate-only"], false);

  const incompleteUnion = structuredClone(manifest);
  incompleteUnion.products[0].uniqueVariants = [variant("75", "A")];
  const incompletePath = path.join(tempDir, "incomplete-union.json");
  await fs.writeFile(
    incompletePath,
    `${JSON.stringify(incompleteUnion, null, 2)}\n`,
    "utf8",
  );
  run([incompletePath, sourcePath, "--validate-only"], false);

  const changedSourcePath = path.join(tempDir, "changed.xlsx");
  await fs.writeFile(changedSourcePath, Buffer.from("changed"));
  run([manifestPath, changedSourcePath, "--validate-only"], false);

  console.log("Supplier exact color–size/cup validation verified.");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
