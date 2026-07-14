import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const orderingPath = path.resolve(root, "lib", "server-ordering.ts");
const catalogVerifierPath = path.resolve(
  root,
  "scripts",
  "db",
  "verify-catalog-migration.mjs",
);
const scriptPath = fileURLToPath(import.meta.url);

function readNormalized(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  return {
    source: original.replaceAll("\r\n", "\n"),
    eol: original.includes("\r\n") ? "\r\n" : "\n",
  };
}

function writeWithEol(filePath, source, eol) {
  fs.writeFileSync(filePath, eol === "\n" ? source : source.replaceAll("\n", eol));
}

function replaceOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${matches.length}.`);
  }
  return source.replace(pattern, replacement);
}

const orderingFile = readNormalized(orderingPath);
let orderingSource = orderingFile.source;

if (!orderingSource.includes("customerUserId: string")) {
  orderingSource = replaceOnce(
    orderingSource,
    /export async function createServerOrder\(\n  requestedToken: string \| null,\n  input: CheckoutInput,\n\): Promise<CreatedOrder> \{\n  const location = normalizeCheckoutLocation\(input\.location\);/g,
    `export async function createServerOrder(
  requestedToken: string | null,
  customerUserId: string,
  input: CheckoutInput,
): Promise<CreatedOrder> {
  const normalizedCustomerUserId = customerUserId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedCustomerUserId)) {
    throw new OrderingError(
      "Danh tính người dùng không hợp lệ.",
      400,
      "invalid_customer_user_id",
    );
  }
  const location = normalizeCheckoutLocation(input.location);`,
    "createServerOrder signature",
  );

  orderingSource = replaceOnce(
    orderingSource,
    /          subtotal,\n          currency\n        \)\n        VALUES \(\n          \$1, \$2::uuid, 'submitted', \$3, \$4, \$5, \$6,\n          \$7, \$8, \$9, \$10::timestamptz, \$11, \$12, \$13\n        \)/g,
    `          subtotal,
          currency,
          customer_user_id
        )
        VALUES (
          $1, $2::uuid, 'submitted', $3, $4, $5, $6,
          $7, $8, $9, $10::timestamptz, $11, $12, $13, $14::uuid
        )`,
    "order insert SQL",
  );

  orderingSource = replaceOnce(
    orderingSource,
    /        subtotal,\n        currency,\n      \],/g,
    `        subtotal,
        currency,
        normalizedCustomerUserId,
      ],`,
    "order insert parameters",
  );
}

if (
  !orderingSource.includes("customer_user_id") ||
  !orderingSource.includes("normalizedCustomerUserId")
) {
  throw new Error("Atomic customer ownership patch did not produce the expected checkout code.");
}

const verifierFile = readNormalized(catalogVerifierPath);
let verifierSource = verifierFile.source;
if (!verifierSource.includes("1783880000000")) {
  verifierSource = replaceOnce(
    verifierSource,
    /  1783875000000,\n\];/g,
    `  1783875000000,
  1783880000000,
];`,
    "catalog expected migrations",
  );
}

writeWithEol(orderingPath, orderingSource, orderingFile.eol);
writeWithEol(catalogVerifierPath, verifierSource, verifierFile.eol);
fs.rmSync(scriptPath);

console.log("Atomic customer order refactor OK.");
console.log("createServerOrder now writes customer_user_id inside its existing transaction.");
console.log("Catalog verifier now requires all 9 migration records.");
console.log("One-shot refactor script removed itself.");
