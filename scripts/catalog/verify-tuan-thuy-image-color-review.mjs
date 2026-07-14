import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-color-review-"));

const targetKeys = [
  "winking:ao-nguc:5002",
  "winking:ao-nguc:5003",
  "winking:ao-nguc:9050",
  "pensee:ao-nguc:9501",
  "pensee:ao-nguc:9503",
  "pensee:ao-nguc:9504",
  "pensee:ao-nguc:9505",
  "pensee:ao-nguc:9506",
  "pensee:ao-nguc:9507",
  "pensee:ao-nguc:9508",
  "pensee:ao-nguc:9509",
  "pensee:ao-nguc:9510",
  "pensee:ao-nguc:9511",
  "pensee:ao-nguc:9512",
  "pensee:ao-nguc:9513",
  "pensee:ao-nguc:9514",
  "pensee:ao-nguc:9515",
  "pensee:ao-nguc:9517",
  "pensee:ao-nguc:9518",
  "pensee:ao-nguc:9519",
  "pensee:ao-nguc:9523",
  "pensee:ao-nguc:9524",
  "pensee:ao-nguc:9525",
  "pensee:ao-nguc:9526",
  "pensee:ao-nguc:9529",
  "pensee:ao-nguc:9530",
  "pensee:ao-nguc:9531",
  "pensee:ao-nguc:9532",
  "pensee:ao-nguc:9535",
  "pensee:ao-nguc:9536",
];
const existingColorKeys = ["pensee:ao-nguc:9502", "pensee:ao-nguc:9516"];
const allKeys = [...targetKeys, ...existingColorKeys];

function run(script, args, expectedSuccess = true) {
  const result = spawnSync(process.execPath, [path.join(cwd, script), ...args], {
    cwd,
    encoding: "utf8",
  });
  const success = result.status === 0;
  if (success !== expectedSuccess) {
    throw new Error(
      [
        `Unexpected exit for ${script}: ${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }
  return result;
}

try {
  const variantGroups = new Map(allKeys.map((key) => [key, []]));
  const sizes = ["70", "75", "80", "85", "90", "95", "100"];
  for (let index = 0; index < 199; index += 1) {
    const key = allKeys[index % allKeys.length];
    const round = Math.floor(index / allKeys.length);
    variantGroups.get(key).push({
      sizeCode: sizes[round],
      cupCode: String.fromCharCode(65 + (round % 4)),
    });
  }

  const approvedOrder = {
    schemaVersion: 1,
    approval: { approvedVariantCandidateCount: 199 },
    approvedVariantCandidates: allKeys.map((key) => ({
      key,
      variants: variantGroups.get(key),
    })),
    approvedColorCandidates: existingColorKeys.map((key) => ({ key, colors: [{ code: "da", name: "Da" }] })),
  };

  const decisions = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "https://tuanthuy.com.vn",
    businessRules: {
      manualReviewOfLiveProductImages: true,
      noAutomatedColorInferenceFromFilenames: true,
      noDatabaseWrite: true,
    },
    summary: {
      reviewedProductCount: 30,
      reviewedColorCount: 30,
      unresolvedProductCount: 0,
    },
    reviewedBy: "workflow-test",
    products: targetKeys.map((key) => ({
      key,
      sourceUrls: [`https://tuanthuy.com.vn/san-pham/${key.split(":").at(-1)}/`],
      imageUrl: `https://tuanthuy.com.vn/images/${key.split(":").at(-1)}.png`,
      previewSha256: "0".repeat(64),
      colors: [
        {
          code: "da",
          name: "Da",
          sortOrder: 0,
          sourceSystem: "tuanthuy-manual-live-image-review",
          evidenceTypes: ["manual-live-image-review"],
          evidenceTexts: ["Synthetic live-image review evidence."],
          evidenceUrls: [
            `https://tuanthuy.com.vn/san-pham/${key.split(":").at(-1)}/`,
            `https://tuanthuy.com.vn/images/${key.split(":").at(-1)}.png`,
          ],
        },
      ],
    })),
  };

  const approvedOrderPath = path.join(tempDir, "order.approved.json");
  const decisionsPath = path.join(tempDir, "colors.decisions.json");
  const reviewPath = path.join(tempDir, "colors.review.json");
  const approvedColorsPath = path.join(tempDir, "colors.review.approved.json");
  await Promise.all([
    fs.writeFile(approvedOrderPath, `${JSON.stringify(approvedOrder, null, 2)}\n`, "utf8"),
    fs.writeFile(decisionsPath, `${JSON.stringify(decisions, null, 2)}\n`, "utf8"),
  ]);

  run("scripts/catalog/build-tuan-thuy-image-color-review.mjs", [
    approvedOrderPath,
    decisionsPath,
    reviewPath,
  ]);
  const review = JSON.parse(await fs.readFile(reviewPath, "utf8"));
  if (
    review.summary?.candidateProductCount !== 30 ||
    review.summary?.candidateColorCount !== 30 ||
    review.sourceApprovedOrderData?.approvedVariantCandidateCount !== 199
  ) {
    throw new Error("Generated review summary is incorrect.");
  }

  run("scripts/catalog/approve-tuan-thuy-color-review.mjs", [
    reviewPath,
    "--approve",
    `--output=${approvedColorsPath}`,
  ]);
  const approvedColors = JSON.parse(await fs.readFile(approvedColorsPath, "utf8"));
  if (
    approvedColors.approval?.approvedProductCount !== 30 ||
    approvedColors.approval?.approvedColorCount !== 30 ||
    !approvedColors.approval?.manualReviewOfLiveProductImages
  ) {
    throw new Error("Approved color payload is incorrect.");
  }

  const dryRun = run("scripts/catalog/import-tuan-thuy-reviewed-colors.mjs", [approvedColorsPath]);
  if (!dryRun.stdout.includes("DRY RUN: chưa ghi PostgreSQL.")) {
    throw new Error("Color importer did not complete its dry run.");
  }

  const missingDecisionPath = path.join(tempDir, "colors.missing.json");
  const invalidDecisions = {
    ...decisions,
    summary: { ...decisions.summary, reviewedProductCount: 29, reviewedColorCount: 29 },
    products: decisions.products.slice(1),
  };
  await fs.writeFile(missingDecisionPath, `${JSON.stringify(invalidDecisions, null, 2)}\n`, "utf8");
  run(
    "scripts/catalog/build-tuan-thuy-image-color-review.mjs",
    [approvedOrderPath, missingDecisionPath, path.join(tempDir, "must-not-exist.json")],
    false,
  );

  console.log("Live-image color review workflow verified: 32 products / 199 variants / 30 colors.");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
