import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { loadR2Config } from "./config.mjs";

const envFile = path.resolve(process.cwd(), ".env.local");
const groups = {
  accountId: ["CLOUDFLARE_R2_ACCOUNT_ID", "R2_ACCOUNT_ID"],
  bucket: ["CLOUDFLARE_R2_BUCKET", "R2_BUCKET"],
  accessKeyId: ["CLOUDFLARE_R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"],
  secretAccessKey: [
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    "R2_SECRET_ACCESS_KEY",
  ],
};

const patterns = {
  accountId: /^[a-f0-9]{32}$/i,
  accessKeyId: /^[a-f0-9]{32}$/i,
  secretAccessKey: /^[a-f0-9]{64}$/i,
};

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function resolveValue(parsed, names) {
  for (const name of names) {
    const processValue = process.env[name]?.trim();
    if (processValue) return { value: processValue, source: name, origin: "process" };

    const fileValue = parsed[name]?.trim();
    if (fileValue) return { value: fileValue, source: name, origin: ".env.local" };
  }

  return { value: null, source: null, origin: null };
}

function describe(label, result, secret = false) {
  if (!result.value) {
    console.log(`${label}: missing`);
    return;
  }

  if (secret) {
    console.log(
      `${label}: present | source=${result.source} | length=${result.value.length} | sha256=${fingerprint(result.value)}`,
    );
    return;
  }

  console.log(`${label}: ${result.value} | source=${result.source}`);
}

function findConflicts(parsed, names) {
  const present = names
    .map((name) => ({ name, value: process.env[name]?.trim() || parsed[name]?.trim() || null }))
    .filter((entry) => entry.value);

  if (present.length < 2) return [];
  const unique = new Set(present.map((entry) => entry.value));
  if (unique.size < 2) return [];

  return present.map((entry) => entry.name);
}

let source;
try {
  source = await fs.readFile(envFile, "utf8");
} catch (error) {
  console.error(`Không đọc được ${envFile}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const parsed = parse(source);
const resolved = Object.fromEntries(
  Object.entries(groups).map(([key, names]) => [key, resolveValue(parsed, names)]),
);
const errors = [];
const warnings = [];

if (!resolved.accountId.value) errors.push("Thiếu R2 Account ID.");
if (!resolved.bucket.value) errors.push("Thiếu tên bucket R2.");
if (!resolved.accessKeyId.value) errors.push("Thiếu R2 Access Key ID.");
if (!resolved.secretAccessKey.value) errors.push("Thiếu R2 Secret Access Key.");

if (resolved.accountId.value && !patterns.accountId.test(resolved.accountId.value)) {
  errors.push(`${resolved.accountId.source} phải gồm đúng 32 ký tự hex.`);
}
if (resolved.accessKeyId.value && !patterns.accessKeyId.test(resolved.accessKeyId.value)) {
  errors.push(`${resolved.accessKeyId.source} phải gồm đúng 32 ký tự hex.`);
}
if (
  resolved.secretAccessKey.value &&
  !patterns.secretAccessKey.test(resolved.secretAccessKey.value)
) {
  errors.push(`${resolved.secretAccessKey.source} phải gồm đúng 64 ký tự hex.`);
}

for (const [key, names] of Object.entries(groups)) {
  const conflicts = findConflicts(parsed, names);
  if (conflicts.length > 0) {
    warnings.push(
      `${key} có nhiều biến khác nhau: ${conflicts.join(", ")}. Đang ưu tiên ${resolved[key].source}.`,
    );
  }
}

console.log(`Env file: ${envFile}`);
if (resolved.accountId.value) {
  console.log(
    `Account ID: ${resolved.accountId.value.slice(0, 6)}…${resolved.accountId.value.slice(-4)} | source=${resolved.accountId.source}`,
  );
} else {
  console.log("Account ID: missing");
}
describe("Bucket", resolved.bucket);
describe("Access Key ID", resolved.accessKeyId, true);
describe("Secret Access Key", resolved.secretAccessKey, true);

if (
  resolved.accessKeyId.value &&
  resolved.secretAccessKey.value &&
  resolved.accessKeyId.value === resolved.secretAccessKey.value
) {
  errors.push("Access Key ID và Secret Access Key đang giống hệt nhau.");
}

let client;
try {
  const config = loadR2Config();
  client = config.client;
  console.log(`Endpoint: ${config.endpoint}`);
  console.log(`Endpoint source: ${config.endpointSource}`);
  console.log(`Public base URL: ${config.publicBaseUrl ?? "not configured"}`);
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
} finally {
  client?.destroy();
}

if (warnings.length > 0) {
  console.log("\nCảnh báo:");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length > 0) {
  console.error("\nLỗi cấu hình:");
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}

console.log("\nCấu trúc biến R2 hợp lệ. Tiếp tục chạy: npm run r2:check");
