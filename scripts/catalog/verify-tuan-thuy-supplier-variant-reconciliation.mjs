import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-supplier-variant-reconcile-"));

function run(script, args, expectedSuccess = true) {
  const result = spawnSync(process.execPath, [path.join(cwd, script), ...args], {
    cwd,
    encoding: "utf8",
  });
  const success = result.status === 0;
  if (success !== expectedSuccess) {
    throw new Error(
      [
        `Unexpected exit for ${script}: ${result.status}; expected success=${expectedSuccess}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }
  return result;
}

function variant(sizeCode, cupCode, id) {
  return id ? { id, sizeCode, cupCode } : { sizeCode, cupCode, label: `${sizeCode}${cupCode}` };
}

try {
  const supplierPath = path.join(tempDir, "supplier-variants.json");
  const auditPath = path.join(tempDir, "variant-audit.json");
  const reviewPath = path.join(tempDir, "variant-reconcile.review.json");
  const approvedPath = path.join(tempDir, "variant-reconcile.review.approved.json");

  const supplier = {
    schemaVersion: 1,
    products: [
      {
        key: "pensee:ao-nguc:9501",
        uniqueVariants: [variant("75", "A"), variant("80", "A")],
      },
      {
        key: "winking:ao-nguc:9100",
        uniqueVariants: [variant("75", "B"), variant("80", "B")],
      },
    ],
  };
  const audit = {
    schemaVersion: 1,
    summary: {
      productsWithUnexpectedActiveVariants: 2,
      unexpectedActiveVariantCount: 3,
    },
    conflicts: [
      {
        key: "pensee:ao-nguc:9501",
        productId: "11111111-1111-4111-8111-111111111111",
        supplierCompleteVariants: [variant("75", "A"), variant("80", "A")],
        unexpectedActiveVariants: [
          variant("90", "A", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        ],
      },
      {
        key: "winking:ao-nguc:9100",
        productId: "22222222-2222-4222-8222-222222222222",
        supplierCompleteVariants: [variant("75", "B"), variant("80", "B")],
        unexpectedActiveVariants: [
          variant("85", "B", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
          variant("90", "B", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
        ],
      },
    ],
  };

  await Promise.all([
    fs.writeFile(supplierPath, `${JSON.stringify(supplier, null, 2)}\n`, "utf8"),
    fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8"),
  ]);

  const build = run("scripts/catalog/build-tuan-thuy-supplier-variant-reconciliation.mjs", [
    supplierPath,
    auditPath,
    reviewPath,
  ]);
  if (!build.stdout.includes("Variants to deactivate: 3")) {
    throw new Error("Builder did not report the expected variant count.");
  }

  const review = JSON.parse(await fs.readFile(reviewPath, "utf8"));
  if (
    review.approval?.status !== "pending" ||
    review.summary?.productCount !== 2 ||
    review.summary?.variantCount !== 3
  ) {
    throw new Error("Generated variant reconciliation review is incorrect.");
  }

  run(
    "scripts/catalog/import-tuan-thuy-supplier-variant-reconciliation.mjs",
    [reviewPath, "--validate-only"],
    false,
  );

  const approval = run(
    "scripts/catalog/approve-tuan-thuy-supplier-variant-reconciliation.mjs",
    [reviewPath, "--approve", `--output=${approvedPath}`],
  );
  if (!approval.stdout.includes("Approved variants to deactivate: 3")) {
    throw new Error("Approval did not report the expected variant count.");
  }

  const validate = run(
    "scripts/catalog/import-tuan-thuy-supplier-variant-reconciliation.mjs",
    [approvedPath, "--validate-only"],
  );
  if (!validate.stdout.includes("VALIDATE ONLY")) {
    throw new Error("Approved variant reconciliation did not complete validate-only.");
  }

  audit.generatedAt = new Date().toISOString();
  await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  run(
    "scripts/catalog/import-tuan-thuy-supplier-variant-reconciliation.mjs",
    [approvedPath, "--validate-only"],
    false,
  );

  console.log("Supplier variant reconciliation workflow verified.");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
