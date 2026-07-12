import { config as loadEnv } from "dotenv";
import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }
  return value;
}

function normalizePrefix(value) {
  return String(value ?? "catalog")
    .trim()
    .replace(/^\/+|\/+$/g, "") || "catalog";
}

function parseConcurrency(value) {
  const parsed = Number.parseInt(String(value ?? "4"), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new Error("R2_UPLOAD_CONCURRENCY phải là số nguyên từ 1 đến 16.");
  }
  return parsed;
}

export function loadR2Config() {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const bucket = requireEnv("R2_BUCKET");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/g, "") || null;
  const prefix = normalizePrefix(process.env.R2_PREFIX);
  const concurrency = parseConcurrency(process.env.R2_UPLOAD_CONCURRENCY);
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return {
    accountId,
    bucket,
    endpoint,
    publicBaseUrl,
    prefix,
    concurrency,
    client,
  };
}

export function publicUrlForKey(publicBaseUrl, key) {
  if (!publicBaseUrl) return null;
  return `${publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
