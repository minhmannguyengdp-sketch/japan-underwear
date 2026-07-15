import { spawnSync } from "node:child_process";
import process from "node:process";

const TRANSIENT_DATABASE_PATTERNS = [
  /timeout expired/i,
  /connection terminated due to connection timeout/i,
  /connection terminated unexpectedly/i,
  /connect etimedout/i,
  /econnreset/i,
  /econnrefused/i,
  /eai_again/i,
  /enetunreach/i,
  /server closed the connection unexpectedly/i,
  /the database system is starting up/i,
  /too many clients already/i,
  /remaining connection slots are reserved/i,
];

function readPositiveInteger(name, fallback, minimum, maximum) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} không hợp lệ: ${rawValue}`);
  }
  return value;
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function outputText(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function writeResult(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

export function isTransientDatabaseFailure(value) {
  const text = String(value ?? "");
  return TRANSIENT_DATABASE_PATTERNS.some((pattern) => pattern.test(text));
}

export function runProcessWithDatabaseRetry({
  command,
  args,
  cwd,
  env = process.env,
  label,
}) {
  const maxAttempts = readPositiveInteger("DB_STARTUP_RETRIES", 3, 1, 8);
  const baseDelayMs = readPositiveInteger("DB_STARTUP_RETRY_DELAY_MS", 2_000, 250, 60_000);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      console.log(`\nThử lại ${label} (${attempt}/${maxAttempts})...`);
    }

    const result = spawnSync(command, args, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    });

    writeResult(result);

    if (result.error) throw result.error;
    if (result.status === 0) return;

    const captured = outputText(result);
    const transient = isTransientDatabaseFailure(captured);

    if (!transient || attempt === maxAttempts) {
      const suffix = transient
        ? ` sau ${maxAttempts} lần thử kết nối PostgreSQL`
        : "";
      throw new Error(`${label} thất bại với mã ${result.status ?? "unknown"}${suffix}.`);
    }

    const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 30_000);
    console.warn(`PostgreSQL chưa sẵn sàng; chờ ${Math.round(delayMs / 1000)} giây.`);
    wait(delayMs);
  }
}
