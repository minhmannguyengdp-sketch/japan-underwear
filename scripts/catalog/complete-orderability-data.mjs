import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const files = args.filter((value) => !value.startsWith("--"));
if (args.some((value) => value.startsWith("--") && value !== "--apply") || files.length !== 2) {
  throw new Error(
    "Usage: node scripts/catalog/complete-orderability-data.mjs <manifest.json> <source.xlsx> [--apply]",
  );
}

const [manifestArg, sourceArg] = files;
const manifestPath = path.resolve(cwd, manifestArg);
const sourcePath = path.resolve(cwd, sourceArg);
const reportPath = path.resolve(cwd, "data/local/orderability-data-completion-report.json");
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Thiếu DATABASE_URL trong .env.local hoặc .env.");

const clean = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const variantKey = (size, cup) => `${clean(size)}:${clean(cup).toUpperCase()}`;
const isLocal = (value) => {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//iu.test(value);
  }
};

function loadSource() {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const excel = fs.readFileSync(sourcePath);
  const manifest = JSON.parse(raw);
  const expectedHash = clean(manifest.sourceSupplierFile?.sha256).toLowerCase();
  const actualHash = hash(excel);
  if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{64}$/u.test(expectedHash)) {
    throw new Error("Manifest không hợp lệ hoặc thiếu SHA-256 Excel.");
  }
  if (actualHash !== expectedHash) {
    throw new Error(`Excel không khớp manifest: ${actualHash}/${expectedHash}.`);
  }

  const seen = new Set();
  const products = (manifest.products ?? []).map((product) => {
    const key = clean(product.key);
    const [brand, category, modelCode] = key.split(":");
    if (!brand || !category || !modelCode || seen.has(key)) {
      throw new Error(`Product key không hợp lệ hoặc trùng: ${key}.`);
    }
    seen.add(key);

    const colorSeen = new Set();
    const colors = (product.colors ?? []).map((color, sortOrder) => {
      const code = clean(color.code).toLowerCase();
      const name = clean(color.name);
      if (!code || !name || colorSeen.has(code)) throw new Error(`Màu lỗi: ${key}:${code}.`);
      colorSeen.add(code);
      return { code, name, sortOrder };
    });

    const variantSeen = new Set();
    const variants = (product.uniqueVariants ?? []).map((variant) => {
      const sizeCode = clean(variant.sizeCode);
      const cupCode = clean(variant.cupCode).toUpperCase() || null;
      const identity = variantKey(sizeCode, cupCode);
      if (!sizeCode || (cupCode && !/^[A-Z]+$/u.test(cupCode)) || variantSeen.has(identity)) {
        throw new Error(`Size/cup lỗi: ${key}:${sizeCode}${cupCode ?? ""}.`);
      }
      variantSeen.add(identity);
      return { sizeCode, cupCode };
    });

    if (colors.length === 0 || variants.length === 0) {
      throw new Error(`Manifest thiếu màu hoặc size/cup: ${key}.`);
    }
    return { key, brand, category, modelCode, colors, variants };
  });
  if (products.length === 0) throw new Error("Manifest không có sản phẩm.");
  return { products, sourceHash: actualHash };
}

async function protectedHash(client) {
  const sqlList = [
    `SELECT id::text, base_price, currency, is_active, short_description
     FROM japan_underwear.products ORDER BY id`,
    `SELECT id::text, cart_id::text, product_variant_id::text, color_id::text,
            quantity, unit_price_snapshot, created_at, updated_at
     FROM japan_underwear.cart_items ORDER BY id`,
    `SELECT * FROM japan_underwear.orders ORDER BY id`,
    `SELECT * FROM japan_underwear.order_items ORDER BY id`,
  ];
  const snapshot = [];
  for (const sql of sqlList) snapshot.push((await client.query(sql)).rows);
  return hash(JSON.stringify(snapshot));
}

async function inspect(client, sourceProducts) {
  const products = (await client.query(`
    SELECT product.id::text, brand.slug AS brand, category.slug AS category,
           product.model_code
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    WHERE product.is_active = true AND brand.is_active = true
    ORDER BY brand.slug, category.slug, product.model_code
  `)).rows.map((row) => ({
    id: String(row.id),
    key: `${clean(row.brand)}:${clean(row.category)}:${clean(row.model_code)}`,
  }));

  const productByKey = new Map(products.map((row) => [row.key, row]));
  const sourceByKey = new Map(sourceProducts.map((row) => [row.key, row]));
  const matched = sourceProducts
    .map((source) => productByKey.has(source.key) ? { source, db: productByKey.get(source.key) } : null)
    .filter(Boolean);
  const ids = matched.map((item) => item.db.id);
  const colors = ids.length ? (await client.query(
    `SELECT id::text, product_id::text, code, name, sort_order, is_active
     FROM japan_underwear.product_colors WHERE product_id = ANY($1::uuid[])`, [ids],
  )).rows : [];
  const variants = ids.length ? (await client.query(
    `SELECT id::text, product_id::text, size_code, COALESCE(cup_code, '') AS cup_code, is_active
     FROM japan_underwear.product_variants WHERE product_id = ANY($1::uuid[])`, [ids],
  )).rows : [];

  const colorsByProduct = new Map();
  for (const row of colors) {
    const map = colorsByProduct.get(String(row.product_id)) ?? new Map();
    map.set(clean(row.code).toLowerCase(), row);
    colorsByProduct.set(String(row.product_id), map);
  }
  const variantsByProduct = new Map();
  for (const row of variants) {
    const map = variantsByProduct.get(String(row.product_id)) ?? new Map();
    map.set(variantKey(row.size_code, row.cup_code), row);
    variantsByProduct.set(String(row.product_id), map);
  }

  const plan = { colorsCreate: [], colorsReactivate: [], variantsCreate: [], variantsReactivate: [] };
  const reported = { colorNameMismatches: [], extraActiveVariantsPreserved: [] };
  for (const item of matched) {
    const colorMap = colorsByProduct.get(item.db.id) ?? new Map();
    for (const color of item.source.colors) {
      const existing = colorMap.get(color.code);
      if (!existing) plan.colorsCreate.push({ productId: item.db.id, productKey: item.source.key, ...color });
      else {
        if (!existing.is_active) plan.colorsReactivate.push({ id: String(existing.id), productKey: item.source.key, ...color });
        if (clean(existing.name) !== color.name) reported.colorNameMismatches.push({
          productKey: item.source.key, code: color.code, databaseName: clean(existing.name), sourceName: color.name,
        });
      }
    }

    const variantMap = variantsByProduct.get(item.db.id) ?? new Map();
    const expected = new Set();
    for (const variant of item.source.variants) {
      const key = variantKey(variant.sizeCode, variant.cupCode);
      expected.add(key);
      const existing = variantMap.get(key);
      if (!existing) plan.variantsCreate.push({ productId: item.db.id, productKey: item.source.key, ...variant });
      else if (!existing.is_active) plan.variantsReactivate.push({ id: String(existing.id), productKey: item.source.key, ...variant });
    }
    for (const [key, row] of variantMap) {
      if (row.is_active && !expected.has(key)) reported.extraActiveVariantsPreserved.push({
        productKey: item.source.key, sizeCode: clean(row.size_code), cupCode: clean(row.cup_code) || null,
      });
    }
  }

  const orderability = (await client.query(`
    SELECT product.id::text, brand.slug AS brand, category.slug AS category, product.model_code,
           count(DISTINCT color.id)::int AS colors, count(DISTINCT variant.id)::int AS variants
    FROM japan_underwear.products AS product
    JOIN japan_underwear.brands AS brand ON brand.id = product.brand_id
    JOIN japan_underwear.categories AS category ON category.id = product.category_id
    LEFT JOIN japan_underwear.product_colors AS color ON color.product_id = product.id AND color.is_active = true
    LEFT JOIN japan_underwear.product_variants AS variant ON variant.product_id = product.id AND variant.is_active = true
    WHERE product.is_active = true AND brand.is_active = true
    GROUP BY product.id, brand.slug, category.slug, product.model_code
    ORDER BY brand.slug, category.slug, product.model_code
  `)).rows.map((row) => {
    const key = `${clean(row.brand)}:${clean(row.category)}:${clean(row.model_code)}`;
    const colorCount = Number(row.colors);
    const variantCount = Number(row.variants);
    return { key, colorCount, variantCount, orderable: colorCount > 0 && variantCount > 0, hasSource: sourceByKey.has(key) };
  });

  return {
    activeProducts: products.length,
    matchedProducts: matched.length,
    sourceNotActive: sourceProducts.filter((row) => !productByKey.has(row.key)).map((row) => row.key).sort(),
    activeWithoutSource: products.filter((row) => !sourceByKey.has(row.key)).map((row) => row.key).sort(),
    plan,
    reported,
    orderability,
  };
}

function printState(title, state) {
  const blocked = state.orderability.filter((row) => !row.orderable);
  const blockedWithSource = blocked.filter((row) => row.hasSource);
  const blockedWithoutSource = blocked.filter((row) => !row.hasSource);
  console.log(`=== ${title} ===`);
  console.log(`Active products: ${state.activeProducts}`);
  console.log(`Matched source products: ${state.matchedProducts}`);
  console.log(`Orderable: ${state.orderability.length - blocked.length}`);
  console.log(`Blocked: ${blocked.length}`);
  console.log(`Blocked but Excel manifest has source: ${blockedWithSource.length}`);
  console.log(`Blocked without source: ${blockedWithoutSource.length}`);
  console.log(`Colors to create/reactivate: ${state.plan.colorsCreate.length}/${state.plan.colorsReactivate.length}`);
  console.log(`Variants to create/reactivate: ${state.plan.variantsCreate.length}/${state.plan.variantsReactivate.length}`);
  console.log(`Extra active variants preserved: ${state.reported.extraActiveVariantsPreserved.length}`);
  if (blockedWithoutSource.length) {
    console.log("SOURCE GAPS:");
    for (const row of blockedWithoutSource) console.log(`  - ${row.key} | colors=${row.colorCount} | variants=${row.variantCount}`);
  }
}

const source = loadSource();
const client = new Client({
  connectionString,
  ssl: isLocal(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  query_timeout: 300_000,
});
let transactionOpen = false;

try {
  await client.connect();
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  transactionOpen = true;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('japan-underwear:complete-orderability-data'))");

  const before = await inspect(client, source.products);
  printState("ORDERABILITY DATA BEFORE", before);

  if (!apply) {
    const report = { generatedAt: new Date().toISOString(), mode: "dry-run", sourceHash: source.sourceHash, before };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await client.query("ROLLBACK");
    transactionOpen = false;
    console.log(`REPORT: ${reportPath}`);
    console.log("DRY RUN: chưa ghi PostgreSQL.");
    process.exit(0);
  }

  const protectedBefore = await protectedHash(client);
  for (const row of before.plan.colorsCreate) {
    await client.query(
      `INSERT INTO japan_underwear.product_colors (product_id, code, name, sort_order, is_active)
       VALUES ($1::uuid, $2, $3, $4, true)`,
      [row.productId, row.code, row.name, row.sortOrder],
    );
  }
  for (const row of before.plan.colorsReactivate) {
    await client.query(
      `UPDATE japan_underwear.product_colors SET is_active = true, name = $2, sort_order = $3 WHERE id = $1::uuid`,
      [row.id, row.name, row.sortOrder],
    );
  }
  for (const row of before.plan.variantsCreate) {
    await client.query(
      `INSERT INTO japan_underwear.product_variants
         (product_id, size_code, cup_code, sku, price_override, is_active)
       VALUES ($1::uuid, $2, $3, NULL, NULL, true)`,
      [row.productId, row.sizeCode, row.cupCode],
    );
  }
  for (const row of before.plan.variantsReactivate) {
    await client.query(`UPDATE japan_underwear.product_variants SET is_active = true WHERE id = $1::uuid`, [row.id]);
  }

  if ((await protectedHash(client)) !== protectedBefore) {
    throw new Error("Giá, sản phẩm, giỏ hàng hoặc đơn lịch sử bị thay đổi; transaction đã hủy.");
  }

  const after = await inspect(client, source.products);
  printState("ORDERABILITY DATA AFTER", after);
  const remainingPlan = Object.values(after.plan).reduce((total, rows) => total + rows.length, 0);
  const matchedBlocked = after.orderability.filter((row) => row.hasSource && !row.orderable);
  if (remainingPlan !== 0 || matchedBlocked.length !== 0) {
    throw new Error(`Hậu kiểm thất bại; remainingPlan=${remainingPlan}, matchedBlocked=${matchedBlocked.length}.`);
  }

  await client.query("COMMIT");
  transactionOpen = false;
  const report = { generatedAt: new Date().toISOString(), mode: "apply", sourceHash: source.sourceHash, before, after };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`REPORT: ${reportPath}`);
  console.log("ORDERABILITY DATA COMPLETION VERIFIED: OK");
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  console.error(`ORDERABILITY DATA COMPLETION FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
