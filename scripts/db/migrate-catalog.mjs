import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const cwd = process.cwd();
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, label) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} thất bại với mã ${result.status ?? "unknown"}.`);
  }
}

run(npmCommand, ["run", "db:migrate:drizzle"], "Drizzle migrations");
run(
  process.execPath,
  [path.resolve(cwd, "scripts", "db", "apply-order-variant-identity.mjs")],
  "Order variant identity migration",
);

console.log("\nCatalog migrations completed.");
