import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const BRAND_NAMES = {
  winking: "Winking",
  pensee: "Pensee",
};

const CATEGORY_NAMES = {
  "ao-nguc": "Áo ngực",
  "quan-lot": "Quần lót",
  "quan-gen": "Quần gen",
};

function parseArgs(argv) {
  const options = {
    apply: false,
    allowWarnings: false,
  };

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

function productKey(product) {
  return `${product.brand}:${product.category}:${product.modelCode}`;
}

function businessKey(product) {
  return `${product.brand}:${product.modelCode}`;
}

function isLocalDatabase(connectionString) {
  return /@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(connectionString);
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

  const declaredProductCount = Number(manifest.summary?.productGroupCount ?? -1);
  if (declaredProductCount !== manifest.products.length) {
    throw new Error(
      `Số model trong manifest không khớp: summary=${declaredProductCount}, products=${manifest.products.length}.`,
    );
  }

  const warningCount = Number(manifest.summary?.classificationWarningCount ?? 0);
  if (warningCount > 0 && !allowWarnings) {
    throw new Error(
      `Manifest còn ${warningCount} cảnh báo thật. Dùng --allow-warnings chỉ sau khi đã kiểm tra thủ công.`,
    );
  }

  const seenProductKeys = new Set();
  const seenBusinessKeys = new Set();
  for (const product of manifest.products) {
    const key = productKey(product);
    if (seenProductKeys.has(key)) {
      throw new Error(`Manifest trùng product key: ${key}.`);
    }
    seenProductKeys.add(key);

    const uniqueBusinessKey = businessKey(product);
    if (seenBusinessKeys.has(uniqueBusinessKey)) {
      throw new Error(
        `Một brand + model xuất hiện ở nhiều category, không phù hợp unique key hiện tại: ${uniqueBusinessKey}.`,
      );
    }
    seenBusinessKeys.add(uniqueBusinessKey);
  }

  if (report.mode !== "apply") {
    throw new Error("R2 report không phải apply report. Hãy chạy upload với --apply trước.");
  }

  if (!Array.isArray(report.objects) || report.objects.length === 0) {
    throw new Error("R2 report không có object nào.");
  }

  const failed = Number(report.uploadSummary?.failed ?? 0);
  if (failed !== 0) {
    throw new Error(`R2 report còn ${failed} object upload lỗi.`);
  }

  const uploaded = Number(report.uploadSummary?.uploaded ?? 0);
  const skippedExisting = Number(report.summary?.skippedExisting ?? 0);
  if (uploaded + skippedExisting !== report.objects.length) {
    throw new Error(
      `R2 report chưa chứng minh đủ object đã tồn tại: uploaded=${uploaded}, skipped=${skippedExisting}, objects=${report.objects.length}.`,
    );
  }

  const reportObjectsByProduct = new Map();
  const seenR2Keys = new Set();

  for (const object of report.objects) {
    if (!object.key || !object.publicUrl || !object.relativeToTtRoot) {
      throw new Error("R2 report có object thiếu key, publicUrl hoặc relativeToTtRoot.");
    }
    if (seenR2Keys.has(object.key)) {
      throw new Error(`R2 report trùng key: ${object.key}.`);
    }
    seenR2Keys.add(object.key);

    const key = productKey(object);
    const current = reportObjectsByProduct.get(key) ?? [];
    current.push(object);
    reportObjectsByProduct.set(key, current);
  }

  for (const product of manifest.products) {
    const images = reportObjectsByProduct.get(productKey(product)) ?? [];
    if (images.length === 0) {
      throw new Error(
        `Model ${productKey(product)} không có object R2 trong report.`,
      );
    }
    images.sort(
      (left, right) =>
        Number(left.sortOrder ?? 0) - Number(right.sortOrder ?? 0) ||
        String(left.key).localeCompare(String(right.key), "vi"),
    );
  }

  return { reportObjectsByProduct, warningCount };
}

const options = parseArgs(process.argv.slice(2));
const manifestPath = path.resolve(
  process.env.LOCAL_CATALOG_MANIFEST ??
    path.join(process.cwd(), "data", "local", "catalog-manifest.json"),
);
const reportPath = path.resolve(
  process.env.LOCAL_R2_UPLOAD_REPORT ??
    path.join(process.cwd(), "data", "local", "r2-upload-report.json"),
);

const [{ raw: manifestRaw, value: manifest }, { value: report }] =
  await Promise.all([
    readJson(manifestPath, "catalog manifest"),
    readJson(reportPath, "R2 upload report"),
  ]);

const { reportObjectsByProduct, warningCount } = validateSources(
  manifest,
  report,
  options.allowWarnings,
);

const manifestHash = crypto
  .createHash("sha256")
  .update(manifestRaw)
  .digest("hex");

const plannedImageCount = [...reportObjectsByProduct.values()].reduce(
  (sum, images) => sum + images.length,
  0,
);

console.log(`Manifest: ${manifestPath}`);
console.log(`R2 report: ${reportPath}`);
console.log(`Model sẽ đồng bộ: ${manifest.products.length}`);
console.log(`Ảnh R2 sẽ đồng bộ: ${plannedImageCount}`);
console.log(`Cảnh báo phân loại: ${warningCount}`);

if (!options.apply) {
  console.log("DRY RUN: chưa ghi PostgreSQL.");
  console.log("Sau khi kiểm tra, chạy: npm run catalog:db:import -- --apply");
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const client = new Client({
  connectionString,
  ssl: isLocalDatabase(connectionString)
    ? undefined
    : { rejectUnauthorized: false },
});

let importRunId;

try {
  await client.connect();

  const schemaCheck = await client.query(
    "SELECT to_regclass('japan_underwear.products') AS products_table",
  );
  if (!schemaCheck.rows[0]?.products_table) {
    throw new Error(
      "Không tìm thấy japan_underwear.products. Chạy migration database trước.",
    );
  }

  const runResult = await client.query(
    `
      INSERT INTO japan_underwear.catalog_import_runs
        (source, status, manifest_hash, summary, started_at)
      VALUES ($1, 'running', $2, $3::jsonb, now())
      RETURNING id
    `,
    [
      "local-manifest+r2-report",
      manifestHash,
      JSON.stringify({
        plannedProducts: manifest.products.length,
        plannedImages: plannedImageCount,
        warningCount,
      }),
    ],
  );
  importRunId = runResult.rows[0].id;

  await client.query("BEGIN");

  const brandIds = new Map();
  const categoryIds = new Map();
  const productIds = [];
  const importedR2Keys = [];

  for (const brandSlug of [...new Set(manifest.products.map((item) => item.brand))]) {
    const brandName = BRAND_NAMES[brandSlug] ?? titleFromSlug(brandSlug);
    const brandResult = await client.query(
      `
        INSERT INTO japan_underwear.brands
          (name, slug, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          is_active = true,
          updated_at = now()
        RETURNING id
      `,
      [brandName, brandSlug],
    );
    brandIds.set(brandSlug, brandResult.rows[0].id);
  }

  for (const categorySlug of [
    ...new Set(manifest.products.map((item) => item.category)),
  ]) {
    const categoryName = CATEGORY_NAMES[categorySlug] ?? titleFromSlug(categorySlug);
    const categoryResult = await client.query(
      `
        INSERT INTO japan_underwear.categories
          (name, slug, sort_order, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          sort_order = EXCLUDED.sort_order,
          is_active = true,
          updated_at = now()
        RETURNING id
      `,
      [
        categoryName,
        categorySlug,
        ["ao-nguc", "quan-lot", "quan-gen"].indexOf(categorySlug) + 1,
      ],
    );
    categoryIds.set(categorySlug, categoryResult.rows[0].id);
  }

  for (const product of manifest.products) {
    const brandId = brandIds.get(product.brand);
    const categoryId = categoryIds.get(product.category);
    const brandName = BRAND_NAMES[product.brand] ?? titleFromSlug(product.brand);
    const categoryName =
      CATEGORY_NAMES[product.category] ?? titleFromSlug(product.category);
    const slug = `${product.brand}-${product.modelCode}`;
    const name = `${categoryName} ${brandName} ${product.modelCode}`;
    const sourceProductId = `${product.brand}:${product.modelCode}`;

    const productResult = await client.query(
      `
        INSERT INTO japan_underwear.products
          (brand_id, category_id, model_code, name, slug, short_description,
           base_price, currency, source_product_id, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, 0, 'VND', $7, true)
        ON CONFLICT (brand_id, model_code) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          name = EXCLUDED.name,
          slug = EXCLUDED.slug,
          source_product_id = EXCLUDED.source_product_id,
          is_active = true,
          updated_at = now()
        RETURNING id
      `,
      [
        brandId,
        categoryId,
        String(product.modelCode),
        name,
        slug,
        "Gallery thật từ R2. Giá, màu và size được bổ sung từ nguồn bảng giá riêng.",
        sourceProductId,
      ],
    );

    const productId = productResult.rows[0].id;
    productIds.push(productId);

    await client.query(
      "UPDATE japan_underwear.product_images SET is_cover = false WHERE product_id = $1",
      [productId],
    );

    const images = reportObjectsByProduct.get(productKey(product));
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const sourceFilename = path.posix.basename(
        String(image.relativeToTtRoot).replaceAll("\\", "/"),
      );
      const sortOrder = index + 1;
      const isCover = index === 0;
      const altText = `${name} - ảnh ${sortOrder}`;

      await client.query(
        `
          INSERT INTO japan_underwear.product_images
            (product_id, r2_key, source_filename, alt_text, sort_order, is_cover)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (r2_key) DO UPDATE SET
            product_id = EXCLUDED.product_id,
            source_filename = EXCLUDED.source_filename,
            alt_text = EXCLUDED.alt_text,
            sort_order = EXCLUDED.sort_order,
            is_cover = EXCLUDED.is_cover
        `,
        [productId, image.key, sourceFilename, altText, sortOrder, isCover],
      );
      importedR2Keys.push(image.key);
    }
  }

  const productCountResult = await client.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM japan_underwear.products
      WHERE id = ANY($1::uuid[])
    `,
    [productIds],
  );
  const imageCountResult = await client.query(
    `
      SELECT COUNT(*)::integer AS count
      FROM japan_underwear.product_images
      WHERE r2_key = ANY($1::text[])
    `,
    [importedR2Keys],
  );

  const verifiedProducts = Number(productCountResult.rows[0].count);
  const verifiedImages = Number(imageCountResult.rows[0].count);
  if (
    verifiedProducts !== manifest.products.length ||
    verifiedImages !== plannedImageCount
  ) {
    throw new Error(
      `Hậu kiểm không khớp: products=${verifiedProducts}/${manifest.products.length}, images=${verifiedImages}/${plannedImageCount}.`,
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
        brands: brandIds.size,
        categories: categoryIds.size,
        warningCount,
      }),
    ],
  );

  await client.query("COMMIT");

  console.log("Catalog PostgreSQL import OK.");
  console.log(`Products: ${verifiedProducts}.`);
  console.log(`Images: ${verifiedImages}.`);
  console.log(`Brands: ${brandIds.size}. Categories: ${categoryIds.size}.`);
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Không che lỗi gốc nếu transaction chưa bắt đầu hoặc connection đã đóng.
  }

  if (importRunId) {
    try {
      await client.query(
        `
          UPDATE japan_underwear.catalog_import_runs
          SET status = 'failed', error_message = $2, finished_at = now()
          WHERE id = $1
        `,
        [
          importRunId,
          error instanceof Error ? error.message.slice(0, 4000) : String(error),
        ],
      );
    } catch {
      // Không che lỗi import gốc.
    }
  }

  throw error;
} finally {
  await client.end().catch(() => undefined);
}
