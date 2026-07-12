import { config as loadEnv } from "dotenv";
import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const R2_JURISDICTIONS = new Set(["default", "eu", "fedramp"]);

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }
  return value;
}

function normalizePrefix(value) {
  return (
    String(value ?? "catalog")
      .trim()
      .replace(/^\/+|\/+$/g, "") || "catalog"
  );
}

function parseConcurrency(value) {
  const parsed = Number.parseInt(String(value ?? "4"), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 16) {
    throw new Error("R2_UPLOAD_CONCURRENCY phải là số nguyên từ 1 đến 16.");
  }
  return parsed;
}

function resolveEndpoint(accountId) {
  const customEndpoint = process.env.R2_ENDPOINT?.trim().replace(/\/+$/g, "");
  if (customEndpoint) {
    let parsed;
    try {
      parsed = new URL(customEndpoint);
    } catch {
      throw new Error("R2_ENDPOINT phải là URL HTTPS hợp lệ.");
    }

    if (parsed.protocol !== "https:") {
      throw new Error("R2_ENDPOINT bắt buộc dùng HTTPS.");
    }

    return {
      endpoint: customEndpoint,
      jurisdiction: "custom",
      endpointSource: "R2_ENDPOINT",
    };
  }

  const jurisdiction = (process.env.R2_JURISDICTION ?? "default")
    .trim()
    .toLowerCase();

  if (!R2_JURISDICTIONS.has(jurisdiction)) {
    throw new Error(
      "R2_JURISDICTION chỉ nhận default, eu hoặc fedramp. Hoặc đặt R2_ENDPOINT đầy đủ.",
    );
  }

  const jurisdictionSegment = jurisdiction === "default" ? "" : `.${jurisdiction}`;
  return {
    endpoint: `https://${accountId}${jurisdictionSegment}.r2.cloudflarestorage.com`,
    jurisdiction,
    endpointSource: "derived",
  };
}

export function loadR2Config() {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error(
      "R2_ACCOUNT_ID phải là Account ID 32 ký tự hex, không phải URL, Zone ID hay API token.",
    );
  }

  const bucket = requireEnv("R2_BUCKET");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const publicBaseUrl =
    process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/g, "") || null;
  const prefix = normalizePrefix(process.env.R2_PREFIX);
  const concurrency = parseConcurrency(process.env.R2_UPLOAD_CONCURRENCY);
  const { endpoint, jurisdiction, endpointSource } = resolveEndpoint(accountId);

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
    endpointSource,
    jurisdiction,
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
