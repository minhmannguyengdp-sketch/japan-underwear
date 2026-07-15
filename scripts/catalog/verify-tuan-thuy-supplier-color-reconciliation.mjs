import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-supplier-reconcile-"));

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

try {
  const supplierPath = path.join(tempDir, "supplier.json");
  const auditPath = path.join(tempDir, "audit.json");
  const reviewPath = path.join(tempDir, "reconcile.review.json");
  const approvedPath = path.join(tempDir, "reconcile.review.approved.json");

  const supplier = {
    schemaVersion: 1,
    products: [
      {
        key: "pensee:ao-nguc:9514",
        colors: [
          { code: "den", name: "Đen" },
          { code: "da", name: "Da" },
          { code: "do", name: "Đỏ" },
          { code: "tim", name: "Tím" },
        ],
      },
      {
        key: "winking:ao-nguc:9100",
        colors: [
          { code: "cam", name: "Cam" },
          { code: "da", name: "Da" },
          { code: "tim", name: "Tím" },
          { code: "xanh-den", name: "Xanh Đen" },
          { code: "do-do", name: "Đỏ Đô" },
        ],
      },
    ],
  };
  const audit = {
    schemaVersion: 1,
    summary: {
      productsWithUnexpectedActiveColors: 2,
      unexpectedActiveColorCount: 2,
    },
    conflicts: [
      {
        key: "pensee:ao-nguc:9514",
        supplierColors: supplier.products[0].colors,
        unexpectedActiveColors: [{ code: "do-do", name: "Đỏ đô" }],
      },
      {
        key: "winking:ao-nguc:9100",
        supplierColors: supplier.products[1].colors,
        unexpectedActiveColors: [{ code: "do", name: "Đỏ" }],
      },
    ],
  };

  await Promise.all([
    fs.writeFile(supplierPath, `${JSON.stringify(supplier, null, 2)}\n`, "utf8"),
    fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8"),
  ]);

  const build = run("scripts/catalog/build-tuan-thuy-supplier-color-reconciliation.mjs", [
    supplierPath,
    auditPath,
    reviewPath,
  ]);
  if (!build.stdout.includes("Colors to deactivate: 2")) {
    throw new Error("Builder did not report the expected reconciliation count.");
  }

  const review = JSON.parse(await fs.readFile(reviewPath, "utf8"));
  if (
    review.approval?.status !== "pending" ||
    review.summary?.productCount !== 2 ||
    review.summary?.colorCount !== 2
  ) {
    throw new Error("Generated reconciliation review is incorrect.");
  }

  run("scripts/catalog/import-tuan-thuy-supplier-color-reconciliation.mjs", [
    reviewPath,
    "--validate-only",
  ], false);

  const approval = run("scripts/catalog/approve-tuan-thuy-supplier-color-reconciliation.mjs", [
    reviewPath,
    "--approve",
    `--output=${approvedPath}`,
  ]);
  if (!approval.stdout.includes("Approved colors to deactivate: 2")) {
    throw new Error("Approval did not report the expected color count.");
  }

  const validate = run("scripts/catalog/import-tuan-thuy-supplier-color-reconciliation.mjs", [
    approvedPath,
    "--validate-only",
  ]);
  if (!validate.stdout.includes("VALIDATE ONLY")) {
    throw new Error("Approved reconciliation did not complete validate-only.");
  }

  const changedAudit = {
    ...audit,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(auditPath, `${JSON.stringify(changedAudit, null, 2)}\n`, "utf8");
  run("scripts/catalog/import-tuan-thuy-supplier-color-reconciliation.mjs", [
    approvedPath,
    "--validate-only",
  ], false);

  const supplierHash = crypto
    .createHash("sha256")
    .update(await fs.readFile(supplierPath, "utf8"))
    .digest("hex");
  if (!/^[a-f0-9]{64}$/.test(supplierHash)) {
    throw new Error("Synthetic supplier hash generation failed.");
  }

  console.log("Supplier color reconciliation workflow verified.");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
