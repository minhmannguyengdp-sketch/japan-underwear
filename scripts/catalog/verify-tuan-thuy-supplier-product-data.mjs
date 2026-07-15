import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-supplier-product-"));
const importerPath = path.join(
  cwd,
  "scripts",
  "catalog",
  "import-tuan-thuy-supplier-product-data.mjs",
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

try {
  const sourcePath = path.join(tempDir, "supplier.xlsx");
  const sourceBuffer = Buffer.from("synthetic supplier spreadsheet");
  await fs.writeFile(sourcePath, sourceBuffer);
  const sourceHash = crypto.createHash("sha256").update(sourceBuffer).digest("hex");

  const products = [];
  for (let index = 0; index < 3; index += 1) {
    const modelCode = String(9501 + index);
    products.push({
      key: `pensee:ao-nguc:${modelCode}`,
      brand: "pensee",
      category: "ao-nguc",
      modelCode,
      sourceSheet: "Pensee",
      sourceRows: [5 + index],
      colors: [
        {
          code: "da",
          name: "Da",
          sourceRow: 5 + index,
          consensusStatus: "consensus",
          evidenceColumns: {
            productName: `Áo Ngực Penseé ${modelCode} - Da`,
            color: "Da",
            sku: `${modelCode}-Da`,
          },
        },
      ],
      colorConflicts: [],
      shortDescription:
        "Spandex co giãn. Có gọng, cúp chéo. Mút dày nâng ngực. Dây vai điều chỉnh.",
      colorSetComplete: true,
      completenessEvidenceTypes: ["supplier-confirmed-color-list"],
      completenessEvidenceTexts: ["Synthetic supplier color list."],
    });
  }

  const manifest = {
    schemaVersion: 1,
    sourceSupplierFile: {
      filename: "supplier.xlsx",
      sha256: sourceHash,
      sheets: ["Pensee"],
    },
    businessRules: {
      supplierSpreadsheetIsExplicitColorList: true,
      colorSetCompletenessVerifiedPerListedProduct: true,
      descriptionsAreCondensedFromSupplierHighlights: true,
      noVariantWrite: true,
      noPriceWrite: true,
    },
    summary: {
      inScopeBraProductCount: products.length,
      inScopeColorCount: products.length,
      targetMissingColorProductCount: 30,
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
  if (!valid.stdout.includes("VALIDATE ONLY")) {
    throw new Error("Valid supplier manifest did not complete validation.");
  }

  const incompleteManifest = structuredClone(manifest);
  incompleteManifest.products[0].colorSetComplete = false;
  const incompletePath = path.join(tempDir, "incomplete.json");
  await fs.writeFile(
    incompletePath,
    `${JSON.stringify(incompleteManifest, null, 2)}\n`,
    "utf8",
  );
  run([incompletePath, sourcePath, "--validate-only"], false);

  const conflictedManifest = structuredClone(manifest);
  conflictedManifest.products[0].colors[0].consensusStatus = "conflict";
  const conflictPath = path.join(tempDir, "conflict.json");
  await fs.writeFile(
    conflictPath,
    `${JSON.stringify(conflictedManifest, null, 2)}\n`,
    "utf8",
  );
  run([conflictPath, sourcePath, "--validate-only"], false);

  const changedSourcePath = path.join(tempDir, "changed.xlsx");
  await fs.writeFile(changedSourcePath, Buffer.from("changed"));
  run([manifestPath, changedSourcePath, "--validate-only"], false);

  console.log("Supplier product data validation verified.");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
