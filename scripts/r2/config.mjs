import { config as loadEnv } from "dotenv";
import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/i;
const ACCESS_KEY_ID_PATTERN = /^[a-f0-9]{32}$/i;
const SECRET_ACCESS_KEY_PATTERN = /^[a-f0-9]{64}$/i;
const R2_JURISDICTIONS = new Set(["default", "eu", "fedramp"]);

// CLOUDFLARE_R2_* is the canonical namespace for this project.
// R2_* remains a fallback only for backward compatibility.
const ENV_ALIASES = {
  accountId: ["CLOUDFLARE_R2_ACCOUNT_ID", "R2_ACCOUNT_ID"],
  bucket: ["CLOUDFLARE_R2_BUCKET", "R2_BUCKET"],
  accessKeyId: ["CLOUDFLARE_R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"],
  secretAccessKey: [
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    "R2_SECRET_ACCESS_KEY",
  ],
  publicBaseUrl: [
    "CLOUDFLARE_R2_CUSTOM_DOMAIN",
    "CLOUDFLARE_R2_PUBLIC_DEV_URL",
    "R2_PUBLIC_BASE_URL",
  ],
  endpoint: [
    "CLOUDFLARE_R2_ENDPOINT",
    "CLOUDFLARE_R2_S3_API_URL",
    "R2_ENDPOINT",
  ],
};

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { value, source: name };
  }
  return { value: null, source: null };
}

function requireAlias(label, names) {
  const result = firstEnv(names);
  if (!result.value) {
    throw new Error(`Thiếu ${label}. Chấp nhận một trong: ${names.join(", ")}.`);
  }
  return result;
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

function normalizeEndpoint(rawEndpoint, source) {
  let parsed;
  try {
    parsed = new URL(rawEndpoint);
  } catch {
    throw new Error(`${source} phải là URL HTTPS hợp lệ.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${source} bắt buộc dùng HTTPS.`);
  }

  // CLOUDFLARE_R2_S3_API_URL may include /<bucket>.
  // The AWS SDK endpoint must be the origin only.
  return parsed.origin;
}

function resolveEndpoint(accountId) {
  const configured = firstEnv(ENV_ALIASES.endpoint);
  if (configured.value) {
    return {
      endpoint: normalizeEndpoint(configured.value, configured.source),
      jurisdiction: "custom",
      endpointSource: configured.source,
    };
  }

  const jurisdiction = (process.env.R2_JURISDICTION ?? "default")
    .trim()
    .toLowerCase();

  if (!R2_JURISDICTIONS.has(jurisdiction)) {
    throw new Error(
      "R2_JURISDICTION chỉ nhận default, eu hoặc fedramp. Hoặc đặt CLOUDFLARE_R2_ENDPOINT/R2_ENDPOINT.",
    );
  }

  const jurisdictionSegment = jurisdiction === "default" ? "" : `.${jurisdiction}`;
  return {
    endpoint: `https://${accountId}${jurisdictionSegment}.r2.cloudflarestorage.com`,
    jurisdiction,
    endpointSource: "derived",
  };
}

export function resolveR2Environment() {
  const account = requireAlias("R2 Account ID", ENV_ALIASES.accountId);
  const bucket = requireAlias("R2 bucket", ENV_ALIASES.bucket);
  const access = requireAlias("R2 Access Key ID", ENV_ALIASES.accessKeyId);
  const secret = requireAlias("R2 Secret Access Key", ENV_ALIASES.secretAccessKey);
  const publicBase = firstEnv(ENV_ALIASES.publicBaseUrl);

  return {
    accountId: account.value,
    bucket: bucket.value,
    accessKeyId: access.value,
    secretAccessKey: secret.value,
    publicBaseUrl: publicBase.value?.replace(/\/+$/g, "") || null,
    sources: {
      accountId: account.source,
      bucket: bucket.source,
      accessKeyId: access.source,
      secretAccessKey: secret.source,
      publicBaseUrl: publicBase.source,
    },
  };
}

export function loadR2Config() {
  const environment = resolveR2Environment();
  const { accountId, bucket, accessKeyId, secretAccessKey, publicBaseUrl } = environment;

  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error(
      `${environment.sources.accountId} phải là Account ID 32 ký tự hex, không phải URL, Zone ID hay API token.`,
    );
  }

  if (!ACCESS_KEY_ID_PATTERN.test(accessKeyId)) {
    throw new Error(
      `${environment.sources.accessKeyId} phải là Access Key ID R2 gồm đúng 32 ký tự hex.`,
    );
  }

  if (!SECRET_ACCESS_KEY_PATTERN.test(secretAccessKey)) {
    throw new Error(
      `${environment.sources.secretAccessKey} phải là Secret Access Key R2 gồm đúng 64 ký tự hex.`,
    );
  }

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
    sources: environment.sources,
    client,
  };
}

export function publicUrlForKey(publicBaseUrl, key) {
  if (!publicBaseUrl) return null;
  return `${publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
