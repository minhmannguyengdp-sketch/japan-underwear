import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const BRAND_NAMES = { winking: "Winking", pensee: "Pensee" };
const CATEGORY_NAMES = {
  "ao-nguc": "Áo ngực",
  "quan-lot": "Quần lót",
  "quan-gen": "Quần gen",
};
const CATEGORY_ORDER = ["ao-nguc", "quan-lot", "quan-gen"];
const IMAGE_BATCH_SIZE = 250;

function productKey(value) {
  return `${value.brand}:${value.category}:${String(value.modelCode)}`;
}

function titleFromSlug(value) {
  return String(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isLocalDatabase(connectionString) {
  try {
    const url = new URL(connectionString);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connectionString);
  }
}

function resolveBasePrice(product) {
  const prices = [
    ...new Set(
      (product.priceRows ?? [])
        .filter((row) => !row.variantSuffix)
        .map((row) => Number(row.priceVnd))
        .filter((value) => Number.isInteger(value) && value >= 0),
    ),
  ];
  if (prices.length !== 1) {
    throw new Error(
      `Model ${productKey(product)} phải có đúng một giá cơ bản; nhận được ${prices.length}.`,
    );
  }
  return prices[0];
}

async function readJson(filePath, label) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return { raw, value: JSON.parse(raw) };
  } catch (error) {
    throw new Error(
      `Không đọc được ${label} tại ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const apply = process.argv.includes("--apply");
const allowWarnings = process.argv.includes("--allow-warnings");
for (const arg of process.argv.slice(2)) {
  if (!["--apply", "--allow-warnings"].includes(arg)) {
    throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
}

const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ??
    path.join(cwd, "data", "local", "catalog-manifest.json"),
);
const reportPath = path.resolve(
  process.env.LOCAL_R2_UPLOAD_REPORT ??
    path.join(cwd, "data", "local", "r2-upload-report.json"),
);
const [{ raw: manifestRaw, value: manifest }, { value: report }] = await Promise.all([
  readJson(manifestPath, "catalog manifest"),
  readJson(reportPath, "R2 upload report"),
]);

if (!Array.isArray(manifest.products) || manifest.products.length === 0) {
  throw new Error("Manifest không có sản phẩm active.");
}
const expectedProducts = Number(manifest.summary?.productGroupCount ?? -1);
const expectedImages = Number(manifest.summary?.matchedImageCount ?? -1);
const warningCount = Number(manifest.summary?.classificationWarningCount ?? 0);
if (expectedProducts !== manifest.products.length) {
  throw new Error(
    `Manifest lệch product count: ${expectedProducts}/${manifest.products.length}.`,
  );
}
if (warningCount > 0 && !allowWarnings) {
  throw new Error(`Manifest còn ${warningCount} cảnh báo identity.`);
}
if (report.mode !== "apply" || !Array.isArray(report.objects)) {
  throw new Error("R2 report không hợp lệ hoặc chưa apply.");
}
if (report.objects.length !== expectedImages) {
  throw new Error(
    `R2 report chưa khớp manifest: ${report.objects.length}/${expectedImages} ảnh. Chạy npm run catalog:sync.`,
  );
}
const uploaded = Number(report.uploadSummary?.uploaded ?? 0);
const skippedExisting = Number(report.summary?.skippedExisting ?? 0);
const failed = Number(report.uploadSummary?.failed ?? 0);
if (failed !== 0 || uploaded + skippedExisting !== report.objects.length) {
  throw new Error(
    `R2 report chưa hoàn tất: uploaded=${uploaded}, skipped=${skippedExisting}, failed=${failed}, objects=${report.objects.length}.`,
  );
}

const retainedKeys = new Set(
  (manifest.retainedNoImageProducts ?? []).map((item) => item.key),
);
const productByKey = new Map();
for (const product of manifest.products) {
  const key = productKey(product);
  if (productByKey.has(key)) throw new Error(`Manifest trùng product key: ${key}.`);
  resolveBasePrice(product);
  productByKey.set(key, product);
}
for (const key of retainedKeys) {
  if (!productByKey.has(key)) {
    throw new Error(`Ngoại lệ giữ không ảnh không thuộc catalog active: ${key}.`);
  }
}

const objectsByProduct = new Map();
const r2Keys = new Set();
for (const object of report.objects) {
  if (
    !object.brand ||
    !object.category ||
    !object.modelCode ||
    !object.key ||
    !object.publicUrl ||
    !object.relativeToTtRoot
  ) {
    throw new Error("R2 report có object thiếu trường bắt buộc.");
  }
  if (r2Keys.has(object.key)) throw new Error(`R2 report trùng key: ${object.key}.`);
  r2Keys.add(object.key);
  const key = productKey(object);
  if (!productByKey.has(key)) {
    throw new Error(`R2 object không thuộc catalog active: ${key}.`);
  }
  const items = objectsByProduct.get(key) ?? [];
  items.push(object);
  objectsByProduct.set(key, items);
}

for (const [key, product] of productByKey.entries()) {
  const images = objectsByProduct.get(key) ?? [];
  if (images.length === 0 && !retainedKeys.has(key)) {
    throw new Error(`Model ${key} không có ảnh và không phải ngoại lệ đã duyệt.`);
  }
  if (images.length > 0 && retainedKeys.has(key)) {
    throw new Error(`Model ${key} đã có ảnh nhưng vẫn nằm trong danh sách giữ-không-ảnh.`);
  }
  images.sort(
    (left, right) =>
      Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) ||
      String(left.key).localeCompare(String(right.key), "vi"),
  );
  product.images = images;
}

const brands = [
  ...new Map(
    manifest.products.map((product) => [
      product.brand,
      {
        slug: product.brand,
        name: BRAND_NAMES[product.brand] ?? titleFromSlug(product.brand),
      },
    ]),
  ).values(),
];
const categories = [
  ...new Map(
    manifest.products.map((product) => {
      const order = CATEGORY_ORDER.indexOf(product.category);
      return [
        product.category,
        {
          slug: product.category,
          name: CATEGORY_NAMES[product.category] ?? titleFromSlug(product.category),
          sortOrder: order === -1 ? 100 : order + 1,
        },
      ];
    }),
  ).values(),
];
const products = manifest.products.map((product) => {
  const key = productKey(product);
  const brandName = BRAND_NAMES[product.brand] ?? titleFromSlug(product.brand);
  const categoryName = CATEGORY_NAMES[product.category] ?? titleFromSlug(product.category);
  return {
    brandSlug: product.brand,
    categorySlug: product.category,
    modelCode: String(product.modelCode),
    name: `${categoryName} ${brandName} ${product.modelCode}`,
    slug: `${product.brand}-${product.category}-${product.modelCode}`,
    description: retainedKeys.has(key)
      ? "Sản phẩm active theo xác nhận chủ catalog; đang chờ ảnh đúng nhóm."
      : "Sản phẩm active theo bảng giá, gallery thật từ R2.",
    basePrice: resolveBasePrice(product),
    sourceProductId: `local:${key}`,
  };
});
const images = [];
for (const product of manifest.products) {
  const name = products.find(
    (item) => item.sourceProductId === `local:${productKey(product)}`,
  )?.name;
  for (let index = 0; index < product.images.length; index += 1) {
    const image = product.images[index];
    images.push({
      brandSlug: product.brand,
      categorySlug: product.category,
      modelCode: String(product.modelCode),
      r2Key: image.key,
      sourceFilename: path.posix.basename(
        String(image.relativeToTtRoot).replaceAll("\\", "/"),
      ),
      altText: `${name} - ảnh ${index + 1}`,
      sortOrder: index + 1,
      isCover: index === 0,
    });
  }
}

console.log(`Manifest: ${manifestPath}`);
console.log(`R2 report: ${reportPath}`);
console.log(`Model sẽ đồng bộ: ${products.length}`);
console.log(`Ảnh R2 sẽ đồng bộ: ${images.length}`);
console.log(`Model active không ảnh đã duyệt: ${retainedKeys.size}`);
if (!apply) {
  console.log("DRY RUN: chưa ghi PostgreSQL.");
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  query_timeout: 300_000,
});
const manifestHash = crypto.createHash("sha256").update(manifestRaw).digest("hex");
let importRunId;
let transactionStarted = false;

try {
  console.log("Kết nối PostgreSQL...");
  await client.connect();
  const schema = await client.query(`
    SELECT
      to_regclass('japan_underwear.products') AS products_table,
      to_regclass('japan_underwear.products_brand_category_model_uidx') AS identity_index
  `);
  if (!schema.rows[0]?.products_table || !schema.rows[0]?.identity_index) {
    throw new Error("Schema catalog chưa sẵn sàng.");
  }

  const run = await client.query(
    `
      INSERT INTO japan_underwear.catalog_import_runs
        (source, status, manifest_hash, summary, started_at)
      VALUES ($1, 'running', $2, $3::jsonb, now())
      RETURNING id
    `,
    [
      "price-authoritative-active-catalog",
      manifestHash,
      JSON.stringify({
        plannedProducts: products.length,
        plannedImages: images.length,
        retainedWithoutImages: retainedKeys.size,
      }),
    ],
  );
  importRunId = run.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:catalog-import'))",
  );

  console.log(`[1/5] Đồng bộ ${brands.length} thương hiệu...`);
  await client.query(
    `
      INSERT INTO japan_underwear.brands (name, slug, is_active)
      SELECT input.name, input.slug, true
      FROM jsonb_to_recordset($1::jsonb) AS input(name text, slug text)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, is_active = true, updated_at = now()
    `,
    [JSON.stringify(brands)],
  );

  console.log(`[2/5] Đồng bộ ${categories.length} nhóm hàng...`);
  await client.query(
    `
      INSERT INTO japan_underwear.categories (name, slug, sort_order, is_active)
      SELECT input.name, input.slug, input.sort_order, true
      FROM jsonb_to_recordset($1::jsonb)
        AS input(name text, slug text, sort_order integer)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        sort_order = EXCLUDED.sort_order,
        is_active = true,
        updated_at = now()
    `,
    [
      JSON.stringify(
        categories.map((item) => ({
          name: item.name,
          slug: item.slug,
          sort_order: item.sortOrder,
        })),
      ),
    ],
  );

  console.log(`[3/5] Đồng bộ ${products.length} model và giá cơ bản...`);
  const upserted = await client.query(
    `
      WITH input AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS row_data(
          brand_slug text,
          category_slug text,
          model_code text,
          name text,
          slug text,
          description text,
          base_price numeric,
          source_product_id text
        )
      ), resolved AS (
        SELECT
          brand.id AS brand_id,
          category.id AS category_id,
          input.model_code,
          input.name,
          input.slug,
          input.description,
          input.base_price,
          input.source_product_id
        FROM input
        JOIN japan_underwear.brands AS brand ON brand.slug = input.brand_slug
        JOIN japan_underwear.categories AS category ON category.slug = input.category_slug
      )
      INSERT INTO japan_underwear.products
        (brand_id, category_id, model_code, name, slug, short_description,
         base_price, currency, source_product_id, is_active)
      SELECT
        brand_id, category_id, model_code, name, slug, description,
        base_price, 'VND', source_product_id, true
      FROM resolved
      ON CONFLICT (brand_id, category_id, model_code) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        short_description = EXCLUDED.short_description,
        base_price = EXCLUDED.base_price,
        currency = EXCLUDED.currency,
        source_product_id = EXCLUDED.source_product_id,
        is_active = true,
        updated_at = now()
      RETURNING id
    `,
    [
      JSON.stringify(
        products.map((item) => ({
          brand_slug: item.brandSlug,
          category_slug: item.categorySlug,
          model_code: item.modelCode,
          name: item.name,
          slug: item.slug,
          description: item.description,
          base_price: item.basePrice,
          source_product_id: item.sourceProductId,
        })),
      ),
    ],
  );
  if (upserted.rowCount !== products.length) {
    throw new Error(`Upsert model thiếu dòng: ${upserted.rowCount}/${products.length}.`);
  }
  const productIds = upserted.rows.map((row) => row.id);

  await client.query(
    "UPDATE japan_underwear.product_images SET is_cover = false WHERE product_id = ANY($1::uuid[])",
    [productIds],
  );
  console.log(`[4/5] Đồng bộ ${images.length} ảnh theo batch ${IMAGE_BATCH_SIZE}...`);
  for (let offset = 0; offset < images.length; offset += IMAGE_BATCH_SIZE) {
    const batch = images.slice(offset, offset + IMAGE_BATCH_SIZE);
    await client.query(
      `
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset($1::jsonb) AS row_data(
            brand_slug text,
            category_slug text,
            model_code text,
            r2_key text,
            source_filename text,
            alt_text text,
            sort_order integer,
            is_cover boolean
          )
        ), resolved AS (
          SELECT
            product.id AS product_id,
            input.r2_key,
            input.source_filename,
            input.alt_text,
            input.sort_order,
            input.is_cover
          FROM input
          JOIN japan_underwear.brands AS brand ON brand.slug = input.brand_slug
          JOIN japan_underwear.categories AS category ON category.slug = input.category_slug
          JOIN japan_underwear.products AS product
            ON product.brand_id = brand.id
           AND product.category_id = category.id
           AND product.model_code = input.model_code
        )
        INSERT INTO japan_underwear.product_images
          (product_id, r2_key, source_filename, alt_text, sort_order, is_cover)
        SELECT product_id, r2_key, source_filename, alt_text, sort_order, is_cover
        FROM resolved
        ON CONFLICT (r2_key) DO UPDATE SET
          product_id = EXCLUDED.product_id,
          source_filename = EXCLUDED.source_filename,
          alt_text = EXCLUDED.alt_text,
          sort_order = EXCLUDED.sort_order,
          is_cover = EXCLUDED.is_cover
      `,
      [
        JSON.stringify(
          batch.map((item) => ({
            brand_slug: item.brandSlug,
            category_slug: item.categorySlug,
            model_code: item.modelCode,
            r2_key: item.r2Key,
            source_filename: item.sourceFilename,
            alt_text: item.altText,
            sort_order: item.sortOrder,
            is_cover: item.isCover,
          })),
        ),
      ],
    );
    console.log(`      ${Math.min(offset + batch.length, images.length)}/${images.length} ảnh`);
  }

  const importedKeys = images.map((image) => image.r2Key);
  await client.query(
    `
      DELETE FROM japan_underwear.product_images
      WHERE product_id = ANY($1::uuid[])
        AND NOT (r2_key = ANY($2::text[]))
    `,
    [productIds, importedKeys],
  );
  await client.query(
    `
      UPDATE japan_underwear.products
      SET is_active = false, updated_at = now()
      WHERE source_product_id LIKE 'local:%'
        AND NOT (id = ANY($1::uuid[]))
    `,
    [productIds],
  );
  await client.query(
    `
      DELETE FROM japan_underwear.product_images
      WHERE product_id IN (
        SELECT id
        FROM japan_underwear.products
        WHERE source_product_id LIKE 'local:%' AND is_active = false
      )
    `,
  );

  console.log("[5/5] Hậu kiểm và commit...");
  const verified = await client.query(
    `
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.products
          WHERE source_product_id LIKE 'local:%' AND is_active = true
        ) AS products,
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.product_images AS image
          JOIN japan_underwear.products AS product ON product.id = image.product_id
          WHERE product.source_product_id LIKE 'local:%' AND product.is_active = true
        ) AS images,
        (
          SELECT COUNT(*)::integer
          FROM (
            SELECT product.id
            FROM japan_underwear.products AS product
            LEFT JOIN japan_underwear.product_images AS image ON image.product_id = product.id
            WHERE product.source_product_id LIKE 'local:%' AND product.is_active = true
            GROUP BY product.id
            HAVING COUNT(image.id) = 0
          ) AS no_image
        ) AS no_image_products
    `,
  );
  const actualProducts = Number(verified.rows[0].products);
  const actualImages = Number(verified.rows[0].images);
  const actualNoImage = Number(verified.rows[0].no_image_products);
  if (
    actualProducts !== products.length ||
    actualImages !== images.length ||
    actualNoImage !== retainedKeys.size
  ) {
    throw new Error(
      `Hậu kiểm lệch: products=${actualProducts}/${products.length}, images=${actualImages}/${images.length}, noImage=${actualNoImage}/${retainedKeys.size}.`,
    );
  }

  await client.query(
    `
      UPDATE japan_underwear.catalog_import_runs
      SET status = 'completed', summary = $2::jsonb, finished_at = now()
      WHERE id = $1
    `,
    [
      importRunId,
      JSON.stringify({
        products: actualProducts,
        images: actualImages,
        retainedWithoutImages: actualNoImage,
        pricesImported: products.length,
        mode: "price-authoritative-active-catalog",
      }),
    ],
  );
  await client.query("COMMIT");
  transactionStarted = false;

  console.log("Catalog PostgreSQL import OK.");
  console.log(`Products: ${actualProducts}. Images: ${actualImages}.`);
  console.log(`Active không ảnh đã duyệt: ${actualNoImage}.`);
  console.log(`Giá cơ bản đã nhập: ${products.length} model.`);
} catch (error) {
  if (transactionStarted) {
    await client.query("ROLLBACK").catch(() => undefined);
    transactionStarted = false;
  }
  if (importRunId) {
    await client
      .query(
        `
          UPDATE japan_underwear.catalog_import_runs
          SET status = 'failed', error_message = $2, finished_at = now()
          WHERE id = $1
        `,
        [
          importRunId,
          error instanceof Error ? error.message.slice(0, 4000) : String(error),
        ],
      )
      .catch(() => undefined);
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
