import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const rawPort = process.env.PORT ?? process.env.APP_PORT ?? "3100";
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`PORT không hợp lệ: ${rawPort}`);
  process.exit(1);
}

if (port === 3000) {
  console.error("Port 3000 đã được giữ riêng và tuyệt đối không được dùng cho dự án này.");
  process.exit(1);
}

const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

if (!existsSync(nextBin)) {
  console.error("Chưa cài dependencies. Chạy npm install trước.");
  process.exit(1);
}

console.log(`Khởi động Tuấn Thủy production server tại port ${port}`);

const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
