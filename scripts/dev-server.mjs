import { spawn, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const rawPort = process.env.DEV_PORT ?? "3100";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`DEV_PORT không hợp lệ: ${rawPort}`);
  process.exit(1);
}

if (port === 3000) {
  console.error("Port 3000 đã được giữ riêng và tuyệt đối không được dùng cho dự án này.");
  process.exit(1);
}

const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");

if (!existsSync(nextBin)) {
  console.error("Chưa cài dependencies. Chạy npm install trước.");
  process.exit(1);
}

function normalizeBaseUrl(value) {
  return String(value).trim().replace(/\/+$/, "");
}

function publicBaseFromObject(object) {
  if (!object?.publicUrl || !object?.key) return null;

  const url = new URL(String(object.publicUrl));
  const pathSegments = url.pathname.split("/").filter(Boolean);
  const keySegments = String(object.key).split("/").filter(Boolean);

  if (pathSegments.length < keySegments.length || keySegments.length === 0) {
    return null;
  }

  const keyStart = pathSegments.length - keySegments.length;
  for (let index = 0; index < keySegments.length; index += 1) {
    if (decodeURIComponent(pathSegments[keyStart + index]) !== keySegments[index]) {
      return null;
    }
  }

  const basePath = pathSegments.slice(0, keyStart).join("/");
  return normalizeBaseUrl(`${url.origin}${basePath ? `/${basePath}` : ""}`);
}

async function resolveR2PublicBaseUrl() {
  const configured = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (configured) return normalizeBaseUrl(configured);

  const reportPath = path.resolve(
    process.env.LOCAL_R2_UPLOAD_REPORT ??
      path.join(cwd, "data", "local", "r2-upload-report.json"),
  );

  if (!existsSync(reportPath)) {
    throw new Error(
      `Thiếu R2_PUBLIC_BASE_URL và không tìm thấy upload report tại ${reportPath}.`,
    );
  }

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  if (!Array.isArray(report.objects) || report.objects.length === 0) {
    throw new Error("R2 upload report không có object để suy ra public base URL.");
  }

  const bases = new Set();
  for (const object of report.objects) {
    const base = publicBaseFromObject(object);
    if (!base) {
      throw new Error(
        `Không suy ra được public base URL từ object R2: ${object?.key ?? "unknown"}.`,
      );
    }
    bases.add(base);
  }

  if (bases.size !== 1) {
    throw new Error(
      `R2 upload report chứa nhiều public base URL: ${[...bases].join(", ")}.`,
    );
  }

  return [...bases][0];
}

const ensureCatalogScript = path.join(
  cwd,
  "scripts",
  "catalog",
  "ensure-order-catalog.mjs",
);
const ensureCatalog = spawnSync(process.execPath, [ensureCatalogScript], {
  cwd,
  env: process.env,
  stdio: "inherit",
  shell: false,
});

if (ensureCatalog.error) throw ensureCatalog.error;
if (ensureCatalog.status !== 0) {
  process.exit(ensureCatalog.status ?? 1);
}

let r2PublicBaseUrl;
try {
  r2PublicBaseUrl = await resolveR2PublicBaseUrl();
  process.env.R2_PUBLIC_BASE_URL = r2PublicBaseUrl;
  console.log(`R2 public base: ${r2PublicBaseUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`Khởi động Tuấn Thủy tại http://localhost:${port}`);

const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
    R2_PUBLIC_BASE_URL: r2PublicBaseUrl,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
