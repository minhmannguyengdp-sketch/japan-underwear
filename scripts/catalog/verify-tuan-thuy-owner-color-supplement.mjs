import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-owner-colors-"));
const importerPath = path.join(
  cwd,
  "scripts",
  "catalog",
  "import-tuan-thuy-owner-color-supplement.mjs",
);

function run(manifestPath, expectedSuccess) {
  const result = spawnSync(process.execPath, [importerPath, manifestPath, "--validate-only"], {
    cwd,
    encoding: "utf8",
  });
  if ((result.status === 0) !== expectedSuccess) {
    throw new Error(
      [`Unexpected exit ${result.status}; expected ${expectedSuccess}`, result.stdout, result.stderr].join(
        "\n",
      ),
    );
  }
  return result;
}

const definitions = [
  ["winking:ao-nguc:5002", "winking", "5002", [["da", "Da"], ["den", "Đen"], ["tim", "Tím"]]],
  ["winking:ao-nguc:5003", "winking", "5003", [["da", "Da"], ["den", "Đen"]]],
  ["pensee:ao-nguc:9512", "pensee", "9512", [["da", "Da"], ["xanh", "Xanh"], ["do", "Đỏ"], ["tim", "Tím"], ["den", "Đen"]]],
  ["pensee:ao-nguc:9536", "pensee", "9536", [["da", "Da"], ["den", "Đen"]]],
];

try {
  const products = definitions.map(([key, brand, modelCode, colors]) => ({
    key,
    brand,
    category: "ao-nguc",
    modelCode,
    colors: colors.map(([code, name], index) => ({
      code,
      name,
      sortOrder: index,
      evidenceType: "catalog-owner-confirmed-color-list",
    })),
    colorSetComplete: true,
    completenessEvidenceTypes: ["catalog-owner-confirmed-color-list"],
    completenessEvidenceTexts: [`Owner confirmed ${modelCode}.`],
    shortDescription: null,
  }));

  const manifest = {
    schemaVersion: 1,
    sourceOwnerConfirmation: {
      confirmedBy: "catalog-owner",
      confirmedAt: "2026-07-15T00:00:00.000Z",
      confirmationText: "Synthetic owner confirmation.",
    },
    businessRules: {
      productIdentity: "brand + category + model",
      colorSetCompletenessVerifiedPerListedProduct: true,
      ownerConfirmationIsExplicitColorList: true,
      noDescriptionWrite: true,
      noVariantWrite: true,
      noPriceWrite: true,
      noProductCreation: true,
    },
    summary: {
      productCount: 4,
      colorCount: 12,
      targetProductsCovered: 4,
      targetProductsStillMissing: 0,
    },
    products,
  };

  const validPath = path.join(tempDir, "valid.json");
  await fs.writeFile(validPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const valid = run(validPath, true);
  if (!valid.stdout.includes("VALIDATE ONLY")) {
    throw new Error("Valid owner supplement did not complete validation.");
  }

  const missingProduct = structuredClone(manifest);
  missingProduct.products.pop();
  missingProduct.summary.productCount = 3;
  const missingPath = path.join(tempDir, "missing.json");
  await fs.writeFile(missingPath, `${JSON.stringify(missingProduct, null, 2)}\n`, "utf8");
  run(missingPath, false);

  const descriptionWrite = structuredClone(manifest);
  descriptionWrite.products[0].shortDescription = "Không được phép cập nhật mô tả từ supplement màu.";
  const descriptionPath = path.join(tempDir, "description.json");
  await fs.writeFile(descriptionPath, `${JSON.stringify(descriptionWrite, null, 2)}\n`, "utf8");
  run(descriptionPath, false);

  const incompleteColors = structuredClone(manifest);
  incompleteColors.products[0].colorSetComplete = false;
  const incompletePath = path.join(tempDir, "incomplete.json");
  await fs.writeFile(incompletePath, `${JSON.stringify(incompleteColors, null, 2)}\n`, "utf8");
  run(incompletePath, false);

  console.log("Owner color supplement validation verified: 4 products / 12 colors.");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
