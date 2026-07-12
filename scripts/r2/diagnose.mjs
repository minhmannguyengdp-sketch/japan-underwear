import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { loadR2Config } from "./config.mjs";

const envFile = path.resolve(process.cwd(), ".env.local");
const requiredNames = [
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const ACCESS_KEY_ID_PATTERN = /^[a-f0-9]{32}$/i;
const SECRET_ACCESS_KEY_PATTERN = /^[a-f0-9]{64}$/i;

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function describeSecret(name, value) {
  console.log(`${name}: present | length=${value.length} | sha256=${fingerprint(value)}`);
}

function findRawAssignment(source, name) {
  const line = source
    .split(/\r?\n/)
    .find((candidate) => candidate.trimStart().startsWith(`${name}=`));
  return line ? line.slice(line.indexOf("=") + 1) : null;
}

function inspectRawValue(name, rawValue, warnings) {
  if (rawValue === null) return;
  const trimmed = rawValue.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));

  if (!quoted && trimmed.includes("#")) {
    warnings.push(
      `${name} có dấu # nhưng không được đặt trong dấu nháy; dotenv sẽ cắt phần sau dấu #.`,
    );
  }

  if (/^(access key id|secret access key|client id|client secret)\s*:/i.test(trimmed)) {
    warnings.push(`${name} có vẻ chứa cả nhãn khi copy; chỉ giữ giá trị thuần.`);
  }
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
const warnings = [];
const errors = [];

for (const name of requiredNames) {
  const parsedValue = parsed[name]?.trim();
  const effectiveValue = process.env[name]?.trim() || parsedValue;

  if (!effectiveValue) {
    errors.push(`Thiếu ${name}.`);
    continue;
  }

  const rawValue = findRawAssignment(source, name);
  inspectRawValue(name, rawValue, warnings);

  if (process.env[name] && parsedValue && process.env[name] !== parsedValue) {
    warnings.push(
      `${name} trong PowerShell/system environment đang ghi đè giá trị trong .env.local.`,
    );
  }
}

const accountId = (process.env.R2_ACCOUNT_ID || parsed.R2_ACCOUNT_ID || "").trim();
if (accountId && !ACCOUNT_ID_PATTERN.test(accountId)) {
  errors.push(
    "R2_ACCOUNT_ID không phải chuỗi hex 32 ký tự. Không dùng URL, Zone ID hoặc API token.",
  );
}

const accessKeyId = (
  process.env.R2_ACCESS_KEY_ID ||
  parsed.R2_ACCESS_KEY_ID ||
  ""
).trim();
const secretAccessKey = (
  process.env.R2_SECRET_ACCESS_KEY ||
  parsed.R2_SECRET_ACCESS_KEY ||
  ""
).trim();

if (accessKeyId && !ACCESS_KEY_ID_PATTERN.test(accessKeyId)) {
  errors.push(
    `R2_ACCESS_KEY_ID phải gồm đúng 32 ký tự hex; hiện đang có ${accessKeyId.length} ký tự.`,
  );
}

if (secretAccessKey && !SECRET_ACCESS_KEY_PATTERN.test(secretAccessKey)) {
  errors.push(
    `R2_SECRET_ACCESS_KEY phải gồm đúng 64 ký tự hex; hiện đang có ${secretAccessKey.length} ký tự. Hãy copy lại Secret Access Key từ đúng lần tạo token.`,
  );
}

console.log(`Env file: ${envFile}`);
console.log(`Account ID: ${accountId ? `${accountId.slice(0, 6)}…${accountId.slice(-4)}` : "missing"}`);
console.log(`Bucket: ${(process.env.R2_BUCKET || parsed.R2_BUCKET || "missing").trim()}`);
if (accessKeyId) describeSecret("Access Key ID", accessKeyId);
if (secretAccessKey) describeSecret("Secret Access Key", secretAccessKey);

if (accessKeyId && secretAccessKey && accessKeyId === secretAccessKey) {
  errors.push("Access Key ID và Secret Access Key đang giống hệt nhau.");
}

let client;
try {
  const config = loadR2Config();
  client = config.client;
  console.log(`Endpoint: ${config.endpoint}`);
  console.log(`Jurisdiction: ${config.jurisdiction}`);
  console.log(`Endpoint source: ${config.endpointSource}`);
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
