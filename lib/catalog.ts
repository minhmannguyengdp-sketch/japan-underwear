import { getPool } from "@/db/client";
import type {
  CatalogColor,
  CatalogImage,
  CatalogProduct,
  CatalogQuery,
  CatalogVariant,
} from "@/lib/catalog-types";

function publicUrlForKey(key: string) {
  const baseUrl = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return null;

  const encodedKey = key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${baseUrl}/${encodedKey}`;
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isInteger(value) || Number(value) < 1) return 200;
  return Math.min(Number(value), 200);
}

function variantLabel(size: string, cup: string | null) {
  return cup ? `${size}${cup}` : size;
}

export async function listCatalogProducts(
  query: CatalogQuery = {},
): Promise<CatalogProduct[]> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const params: Array<string | number> = [];
    const conditions = ["product.is_active = true", "brand.is_active = true"];

    if (query.brand?.trim()) {
      params.push(query.brand.trim().toLowerCase());
      conditions.push(`brand.slug = $${params.length}`);
    }

    if (query.category?.trim()) {
      params.push(query.category.trim().toLowerCase());
      conditions.push(`category.slug = $${params.length}`);
    }

    if (query.q?.trim()) {
      params.push(`%${query.q.trim()}%`);
      conditions.push(`(
        product.model_code ILIKE $${params.length}
        OR product.name ILIKE $${params.length}
        OR brand.name ILIKE $${params.length}
      )`);
    }

    params.push(normalizeLimit(query.limit));

    const productResult = await client.query(
      `
        SELECT
          product.id,
          product.model_code,
          product.name,
          product.slug,
          product.short_description,
          product.base_price,
          product.currency,
          brand.name AS brand_name,
          brand.slug AS brand_slug,
          category.name AS category_name,
          category.slug AS category_slug
        FROM japan_underwear.products AS product
        JOIN japan_underwear.brands AS brand
          ON brand.id = product.brand_id
        LEFT JOIN japan_underwear.categories AS category
          ON category.id = product.category_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY
          brand.name ASC,
          category.sort_order ASC NULLS LAST,
          product.model_code ASC
        LIMIT $${params.length}
      `,
      params,
    );

    if (productResult.rowCount === 0) return [];

    const productIds = productResult.rows.map((row) => String(row.id));

    const imageResult = await client.query(
      `
        SELECT id, product_id, r2_key, alt_text, sort_order, is_cover
        FROM japan_underwear.product_images
        WHERE product_id = ANY($1::uuid[])
        ORDER BY product_id, is_cover DESC, sort_order ASC, r2_key ASC
      `,
      [productIds],
    );

    const colorResult = await client.query(
      `
        SELECT id, product_id, code, name, swatch, sort_order
        FROM japan_underwear.product_colors
        WHERE product_id = ANY($1::uuid[])
          AND is_active = true
        ORDER BY product_id, sort_order ASC, name ASC
      `,
      [productIds],
    );

    const variantResult = await client.query(
      `
        SELECT id, product_id, size_code, cup_code, sku, price_override
        FROM japan_underwear.product_variants
        WHERE product_id = ANY($1::uuid[])
          AND is_active = true
        ORDER BY product_id, size_code ASC, cup_code ASC NULLS FIRST
      `,
      [productIds],
    );

    const imagesByProduct = new Map<string, CatalogImage[]>();
    for (const row of imageResult.rows) {
      const productId = String(row.product_id);
      const images = imagesByProduct.get(productId) ?? [];
      const r2Key = String(row.r2_key);
      images.push({
        id: String(row.id),
        r2Key,
        src: publicUrlForKey(r2Key),
        alt: String(row.alt_text ?? "Ảnh sản phẩm"),
        sortOrder: Number(row.sort_order),
        isCover: Boolean(row.is_cover),
      });
      imagesByProduct.set(productId, images);
    }

    const colorsByProduct = new Map<string, CatalogColor[]>();
    for (const row of colorResult.rows) {
      const productId = String(row.product_id);
      const colors = colorsByProduct.get(productId) ?? [];
      colors.push({
        id: String(row.id),
        code: String(row.code),
        label: String(row.name),
        swatch: row.swatch ? String(row.swatch) : null,
        sortOrder: Number(row.sort_order),
      });
      colorsByProduct.set(productId, colors);
    }

    const productPriceById = new Map(
      productResult.rows.map((row) => [String(row.id), Number(row.base_price)]),
    );
    const variantsByProduct = new Map<string, CatalogVariant[]>();
    for (const row of variantResult.rows) {
      const productId = String(row.product_id);
      const variants = variantsByProduct.get(productId) ?? [];
      const size = String(row.size_code);
      const cup = row.cup_code ? String(row.cup_code) : null;
      variants.push({
        id: String(row.id),
        size,
        cup,
        label: variantLabel(size, cup),
        sku: row.sku ? String(row.sku) : null,
        price:
          row.price_override === null
            ? (productPriceById.get(productId) ?? 0)
            : Number(row.price_override),
      });
      variantsByProduct.set(productId, variants);
    }

    return productResult.rows.map((row) => {
      const id = String(row.id);
      const colors = colorsByProduct.get(id) ?? [];
      const variants = variantsByProduct.get(id) ?? [];
      const orderable = colors.length > 0 && variants.length > 0;
      const orderingBlocker = orderable
        ? null
        : colors.length === 0
          ? "missing-color"
          : "missing-size-cup";

      return {
        id,
        brand: String(row.brand_name),
        brandSlug: String(row.brand_slug),
        category: row.category_name ? String(row.category_name) : null,
        categorySlug: row.category_slug ? String(row.category_slug) : null,
        code: String(row.model_code),
        name: String(row.name),
        slug: String(row.slug),
        description: row.short_description ? String(row.short_description) : null,
        price: Number(row.base_price),
        currency: String(row.currency),
        images: imagesByProduct.get(id) ?? [],
        colors,
        variants,
        orderable,
        orderingBlocker,
      } satisfies CatalogProduct;
    });
  } finally {
    client.release();
  }
}
