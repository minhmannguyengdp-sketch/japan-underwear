import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpmScript(script) {
  const result = spawnSync(npmCommand, ["run", script], {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} thất bại với mã ${result.status}.`);
  }
}

console.log("Kiểm tra migration order variant...");
runNpmScript("db:migrate");
runNpmScript("db:verify");
await import("./ensure-local-catalog.mjs");
