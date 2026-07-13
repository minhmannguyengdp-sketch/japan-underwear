import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

const cwd = process.cwd();
loadEnv({ path: path.resolve(cwd, ".env.local"), override: true, quiet: true });
loadEnv({ path: path.resolve(cwd, ".env"), override: false, quiet: true });

const BRAND_NAMES = {
  winking: "Winking",
  pensee: "Pensee",
};

const CATEGORY_NAMES = {
  "ao-nguc": "Áo ngực",
  "quan-lot": "Quần lót",
  "quan-gen": "Quần gen",
};

const CATEGORY_ORDER = ["ao-nguc", "quan-lot", "quan-gen"];
const LOCAL_SOURCE_PREFIX = "local:";
const IMAGE_BATCH_SIZE = 250;

function parseArgs(argv) {
  const options = { apply: false, allowWarnings: false };

  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--allow-warnings") options.allowWarnings = true;
    else throw new Error(`Tham số không hợp lệ: ${arg}`);
  }

  return options;
}

function titleFromSlug(value) {
  return String(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function productKey(value) {
  return `${value.brand}:${value.category}:${value.modelCode}`;
}

function isLocalDatabase(connectionString) {
  try {
    const url = new URL(connectionString);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connectionString);
  }
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

function validateSources(manifest, report, allowWarnings) {
  if (!Array.isArray(manifest.products) || manifest.products.length === 0) {
    throw new Error("Manifest không có product nào.");
  }

  const declaredCount = Number(manifest.summary?.productGroupCount ?? -1);
  if (declaredCount !== manifest.products.length) {
    throw new Error(
      `Số model trong manifest không khớp: summary=${declaredCount}, products=${manifest.products.length}.`,
    );
  }

  const warningCount = Number(manifest.summary?.classificationWarningCount ?? 0);
  if (warningCount > 0 && !allowWarnings) {
    throw new Error(
      `Manifest còn ${warningCount} cảnh báo thật. Chỉ dùng --allow-warnings sau khi đã kiểm tra thủ công.`,
    );
  }

  const productKeys = new Set();
  for (const product of manifest.products) {
    if (!product.brand || !product.category || !product.modelCode) {
      throw new Error("Manifest có product thiếu brand, category hoặc modelCode.");
    }

    const key = productKey(product);
    if (productKeys.has(key)) throw new Error(`Manifest trùng product key: ${key}.`);
    productKeys.add(key);
  }

  if (report.mode !== "apply") {
    throw new Error("R2 report không phải apply report.");
  }
  if (!Array.isArray(report.objects) || report.objects.length === 0) {
    throw new Error("R2 report không có object nào.");
  }

  const failed = Number(report.uploadSummary?.failed ?? 0);
  const uploaded = Number(report.uploadSummary?.uploaded ?? 0);
  const skippedExisting = Number(report.summary?.skippedExisting ?? 0);

  if (failed !== 0) throw new Error(`R2 report còn ${failed} object upload lỗi.`);
  if (uploaded + skippedExisting !== report.objects.length) {
    throw new Error(
      `R2 report chưa chứng minh đủ object: uploaded=${uploaded}, skipped=${skippedExisting}, objects=${report.objects.length}.`,
    );
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
    if (!productKeys.has(key)) {
      throw new Error(`R2 report có object không thuộc manifest: ${key}.`);
    }

    const current = objectsByProduct.get(key) ?? [];
    current.push(object);
    objectsByProduct.set(key, current);
  }

  for (const product of manifest.products) {
    const key = productKey(product);
    const images = objectsByProduct.get(key) ?? [];
    if (images.length === 0) throw new Error(`Model ${key} không có object R2.`);
    images.sort(
      (left, right) =>
        Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) ||
        String(left.key).localeCompare(String(right.key), "vi"),
    );
  }

  return { objectsByProduct, warningCount };
}

function buildPayload(manifest, objectsByProduct) {
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
        const configuredOrder = CATEGORY_ORDER.indexOf(product.category);
        return [
          product.category,
          {
            slug: product.category,
            name:
              CATEGORY_NAMES[product.category] ?? titleFromSlug(product.category),
            sortOrder: configuredOrder === -1 ? 100 : configuredOrder + 1,
          },
        ];
      }),
    ).values(),
  ];

  const products = [];
  const images = [];

  for (const product of manifest.products) {
    const brandName = BRAND_NAMES[product.brand] ?? titleFromSlug(product.brand);
    const categoryName =
      CATEGORY_NAMES[product.category] ?? titleFromSlug(product.category);
    const name = `${categoryName} ${brandName} ${product.modelCode}`;

    products.push({
      brandSlug: product.brand,
      categorySlug: product.category,
      modelCode: String(product.modelCode),
      name,
      slug: `${product.brand}-${product.category}-${product.modelCode}`,
      description:
        "Gallery thật từ R2. Giá, màu và size được bổ sung từ nguồn bảng giá riêng.",
      sourceProductId: `${LOCAL_SOURCE_PREFIX}${product.brand}:${product.category}:${product.modelCode}`,
    });

    const productImages = objectsByProduct.get(productKey(product));
    for (let index = 0; index < productImages.length; index += 1) {
      const image = productImages[index];
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

  return { brands, categories, products, images };
}

const options = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ??
    path.join(cwd, "data", "local", "catalog-manifest.json"),
);
const reportPath = path.resolve(
  process.env.LOCAL_R2_UPLOAD_REPORT ??
    path.join(cwd, "data", "local", "r2-upload-report.json"),
);

const [{ raw: manifestRaw, value: manifest }, { value: report }] =
  await Promise.all([
    readJson(manifestPath, "catalog manifest"),
    readJson(reportPath, "R2 upload report"),
  ]);

const { objectsByProduct, warningCount } = validateSources(
  manifest,
  report,
  options.allowWarnings,
);
const payload = buildPayload(manifest, objectsByProduct);
const manifestHash = crypto
  .createHash("sha256")
  .update(manifestRaw)
  .digest("hex");

console.log(`Manifest: ${manifestPath}`);
console.log(`R2 report: ${reportPath}`);
console.log(`Model sẽ đồng bộ: ${payload.products.length}`);
console.log(`Ảnh R2 sẽ đồng bộ: ${payload.images.length}`);
console.log(`Cảnh báo phân loại: ${warningCount}`);

if (!options.apply) {
  console.log("DRY RUN: chưa ghi PostgreSQL.");
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString)
    ? undefined
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
  query_timeout: 300_000,
});

let importRunId;
let transactionStarted = false;

try {
  console.log("Kết nối PostgreSQL...");
  await client.connect();

  const schemaCheck = await client.query(`
    SELECT
      to_regclass('japan_underwear.products') AS products_table,
      to_regclass('japan_underwear.products_brand_category_model_uidx') AS identity_index
  `);
  if (!schemaCheck.rows[0]?.products_table || !schemaCheck.rows[0]?.identity_index) {
    throw new Error("Schema catalog hoặc unique index product identity chưa sẵn sàng.");
  }

  const runResult = await client.query(
    `
      INSERT INTO japan_underwear.catalog_import_runs
        (source, status, manifest_hash, summary, started_at)
      VALUES ($1, 'running', $2, $3::jsonb, now())
      RETURNING id
    `,
    [
      "local-manifest+r2-report-batch",
      manifestHash,
      JSON.stringify({
        plannedProducts: payload.products.length,
        plannedImages: payload.images.length,
        warningCount,
      }),
    ],
  );
  importRunId = runResult.rows[0].id;

  await client.query("BEGIN");
  transactionStarted = true;
  await client.query("SET LOCAL statement_timeout = '5min'");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('japan-underwear:catalog-import'))",
  );

  console.log(`[1/5] Đồng bộ ${payload.brands.length} thương hiệu...`);
  await client.query(
    `
      INSERT INTO japan_underwear.brands (name, slug, is_active)
      SELECT input.name, input.slug, true
      FROM jsonb_to_recordset($1::jsonb) AS input(name text, slug text)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        is_active = true,
        updated_at = now()
    `,
    [JSON.stringify(payload.brands)],
  );

  console.log(`[2/5] Đồng bộ ${payload.categories.length} nhóm hàng...`);
  await client.query(
    `
      INSERT INTO japan_underwear.categories
        (name, slug, sort_order, is_active)
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
        payload.categories.map((category) => ({
          name: category.name,
          slug: category.slug,
          sort_order: category.sortOrder,
        })),
      ),
    ],
  );

  console.log(`[3/5] Đồng bộ ${payload.products.length} model trong một batch...`);
  const productResult = await client.query(
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
          input.source_product_id
        FROM input
        JOIN japan_underwear.brands AS brand
          ON brand.slug = input.brand_slug
        JOIN japan_underwear.categories AS category
          ON category.slug = input.category_slug
      )
      INSERT INTO japan_underwear.products
        (brand_id, category_id, model_code, name, slug, short_description,
         base_price, currency, source_product_id, is_active)
      SELECT
        brand_id, category_id, model_code, name, slug, description,
        0, 'VND', source_product_id, true
      FROM resolved
      ON CONFLICT (brand_id, category_id, model_code) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        short_description = EXCLUDED.short_description,
        source_product_id = EXCLUDED.source_product_id,
        is_active = true,
        updated_at = now()
      RETURNING id, source_product_id
    `,
    [
      JSON.stringify(
        payload.products.map((product) => ({
          brand_slug: product.brandSlug,
          category_slug: product.categorySlug,
          model_code: product.modelCode,
          name: product.name,
          slug: product.slug,
          description: product.description,
          source_product_id: product.sourceProductId,
        })),
      ),
    ],
  );

  if (productResult.rowCount !== payload.products.length) {
    throw new Error(
      `Upsert product thiếu dòng: ${productResult.rowCount}/${payload.products.length}.`,
    );
  }

  const productIds = productResult.rows.map((row) => row.id);
  await client.query(
    `
      UPDATE japan_underwear.product_images
      SET is_cover = false
      WHERE product_id = ANY($1::uuid[])
    `,
    [productIds],
  );

  console.log(
    `[4/5] Đồng bộ ${payload.images.length} ảnh theo batch ${IMAGE_BATCH_SIZE}...`,
  );
  for (let offset = 0; offset < payload.images.length; offset += IMAGE_BATCH_SIZE) {
    const batch = payload.images.slice(offset, offset + IMAGE_BATCH_SIZE);
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
          JOIN japan_underwear.brands AS brand
            ON brand.slug = input.brand_slug
          JOIN japan_underwear.categories AS category
            ON category.slug = input.category_slug
          JOIN japan_underwear.products AS product
            ON product.brand_id = brand.id
           AND product.category_id = category.id
           AND product.model_code = input.model_code
        )
        INSERT INTO japan_underwear.product_images
          (product_id, r2_key, source_filename, alt_text, sort_order, is_cover)
        SELECT
          product_id, r2_key, source_filename, alt_text, sort_order, is_cover
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
          batch.map((image) => ({
            brand_slug: image.brandSlug,
            category_slug: image.categorySlug,
            model_code: image.modelCode,
            r2_key: image.r2Key,
            source_filename: image.sourceFilename,
            alt_text: image.altText,
            sort_order: image.sortOrder,
            is_cover: image.isCover,
          })),
        ),
      ],
    );

    const completed = Math.min(offset + batch.length, payload.images.length);
    console.log(`      ${completed}/${payload.images.length} ảnh`);
  }

  const importedR2Keys = payload.images.map((image) => image.r2Key);
  await client.query(
    `
      DELETE FROM japan_underwear.product_images
      WHERE product_id = ANY($1::uuid[])
        AND NOT (r2_key = ANY($2::text[]))
    `,
    [productIds, importedR2Keys],
  );

  await client.query(
    `
      UPDATE japan_underwear.products
      SET is_active = false,
          updated_at = now()
      WHERE source_product_id LIKE 'local:%'
        AND NOT (id = ANY($1::uuid[]))
    `,
    [productIds],
  );

  console.log("[5/5] Hậu kiểm và commit...");
  const verifyResult = await client.query(
    `
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.products
          WHERE id = ANY($1::uuid[])
        ) AS products,
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.product_images
          WHERE r2_key = ANY($2::text[])
        ) AS images,
        (
          SELECT COUNT(*)::integer
          FROM japan_underwear.products
          WHERE source_product_id LIKE 'local:%'
            AND is_active = true
        ) AS active_products
    `,
    [productIds, importedR2Keys],
  );

  const verifiedProducts = Number(verifyResult.rows[0].products);
  const verifiedImages = Number(verifyResult.rows[0].images);
  const activeProducts = Number(verifyResult.rows[0].active_products);

  if (
    verifiedProducts !== payload.products.length ||
    verifiedImages !== payload.images.length ||
    activeProducts !== payload.products.length
  ) {
    throw new Error(
      `Hậu kiểm không khớp: products=${verifiedProducts}/${payload.products.length}, images=${verifiedImages}/${payload.images.length}, active=${activeProducts}/${payload.products.length}.`,
    );
  }

  await client.query(
    `
      UPDATE japan_underwear.catalog_import_runs
      SET status = 'completed',
          summary = $2::jsonb,
          finished_at = now()
      WHERE id = $1
    `,
    [
      importRunId,
      JSON.stringify({
        products: verifiedProducts,
        images: verifiedImages,
        brands: payload.brands.length,
        categories: payload.categories.length,
        warningCount,
        mode: "batch",
      }),
    ],
  );

  await client.query("COMMIT");
  transactionStarted = false;

  console.log("Catalog PostgreSQL import OK.");
  console.log(`Products: ${verifiedProducts}.`);
  console.log(`Images: ${verifiedImages}.`);
  console.log(
    `Brands: ${payload.brands.length}. Categories: ${payload.categories.length}.`,
  );
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
          SET status = 'failed',
              error_message = $2,
              finished_at = now()
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
