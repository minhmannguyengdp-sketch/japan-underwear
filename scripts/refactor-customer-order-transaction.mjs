import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const targetPath = path.resolve(root, "lib", "server-ordering.ts");
const scriptPath = fileURLToPath(import.meta.url);

function replaceOnce(source, pattern, replacement, label) {
  const matches = source.match(pattern);
  if (!matches || matches.length !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${matches?.length ?? 0}.`);
  }
  return source.replace(pattern, replacement);
}

let source = fs.readFileSync(targetPath, "utf8");

source = replaceOnce(
  source,
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

source = replaceOnce(
  source,
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

source = replaceOnce(
  source,
  /        subtotal,\n        currency,\n      \],/g,
  `        subtotal,
        currency,
        normalizedCustomerUserId,
      ],`,
  "order insert parameters",
);

if (!source.includes("customer_user_id") || !source.includes("normalizedCustomerUserId")) {
  throw new Error("Atomic customer ownership patch did not produce the expected checkout code.");
}

fs.writeFileSync(targetPath, source);
fs.rmSync(scriptPath);

console.log("Atomic customer order refactor OK.");
console.log("createServerOrder now writes customer_user_id inside its existing transaction.");
console.log("One-shot refactor script removed itself.");
