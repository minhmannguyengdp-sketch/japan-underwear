import type { PoolClient } from "pg";

import { getPool } from "@/db/client";
import type {
  CatalogAdminActor,
  CatalogAdminEntityType,
  CatalogAdminStatusFilter,
  CatalogChangeAuditEvent,
  ManagedCatalogColor,
  ManagedCatalogData,
  ManagedCatalogProduct,
  ManagedCatalogVariant,
  UpdateManagedColorInput,
  UpdateManagedProductInput,
  UpdateManagedVariantInput,
} from "@/lib/catalog-admin-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DATABASE_INTEGER = 2_147_483_647;
const DEFAULT_PRODUCT_LIMIT = 100;
const MAX_PRODUCT_LIMIT = 200;
const AUDIT_LIMIT = 100;

type DatabaseRow = Record<string, unknown>;

export class CatalogAdminError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CatalogAdminError";
  }
}

function toIso(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Database returned an invalid catalog timestamp.");
  }
  return date.toISOString();
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeUuid(value: string, code: string) {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new CatalogAdminError("Mã catalog không hợp lệ.", 400, code);
  }
  return normalized;
}

function normalizeVersion(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DATABASE_INTEGER) {
    throw new CatalogAdminError(
      "Phiên bản catalog không hợp lệ.",
      400,
      "invalid_catalog_version",
    );
  }
  return value;
}

function normalizeActor(actor: CatalogAdminActor) {
  const userId = normalizeUuid(actor.userId, "invalid_catalog_actor");
  const requestId = normalizeUuid(actor.requestId, "invalid_catalog_request_id");
  const label = actor.label.trim();
  if (!label || label.length > 160) {
    throw new CatalogAdminError(
      "Không xác định được người thao tác catalog.",
      400,
      "invalid_catalog_actor",
    );
  }
  return { userId, requestId, label };
}

function normalizeRequiredText(value: string, label: string, max: number) {
  const normalized = value.trim();
  if (!normalized) {
    throw new CatalogAdminError(`${label} không được để trống.`, 400, "invalid_catalog_value");
  }
  if (normalized.length > max) {
    throw new CatalogAdminError(
      `${label} không được vượt quá ${max} ký tự.`,
      400,
      "invalid_catalog_value",
    );
  }
  return normalized;
}

function normalizeOptionalText(value: string | null, label: string, max: number) {
  const normalized = value?.trim() || null;
  if (normalized && normalized.length > max) {
    throw new CatalogAdminError(
      `${label} không được vượt quá ${max} ký tự.`,
      400,
      "invalid_catalog_value",
    );
  }
  return normalized;
}

function normalizePrice(value: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_DATABASE_INTEGER) {
    throw new CatalogAdminError(
      `${label} phải là số nguyên từ 0 đến ${MAX_DATABASE_INTEGER}.`,
      400,
      "invalid_catalog_price",
    );
  }
  return value;
}

function normalizeSortOrder(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new CatalogAdminError(
      "Thứ tự màu phải là số nguyên từ 0 đến 100000.",
      400,
      "invalid_catalog_sort_order",
    );
  }
  return value;
}

function parseEntityType(value: unknown): CatalogAdminEntityType {
  if (value === "product" || value === "color" || value === "variant") return value;
  throw new Error(`Database returned an unsupported catalog entity: ${String(value)}.`);
}

function mapColor(row: DatabaseRow): ManagedCatalogColor {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    swatch: row.swatch == null ? null : String(row.swatch),
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
    rowVersion: Number(row.row_version),
    updatedAt: toIso(row.updated_at),
  };
}

function mapVariant(row: DatabaseRow): ManagedCatalogVariant {
  const sizeCode = String(row.size_code);
  const cupCode = row.cup_code == null ? null : String(row.cup_code);
  return {
    id: String(row.id),
    sizeCode,
    cupCode,
    label: cupCode ? `${sizeCode}${cupCode}` : sizeCode,
    sku: row.sku == null ? null : String(row.sku),
    priceOverride: row.price_override == null ? null : Number(row.price_override),
    effectivePrice: Number(row.effective_price),
    isActive: Boolean(row.is_active),
    rowVersion: Number(row.row_version),
    updatedAt: toIso(row.updated_at),
  };
}

function mapProduct(
  row: DatabaseRow,
  colors: ManagedCatalogColor[],
  variants: ManagedCatalogVariant[],
): ManagedCatalogProduct {
  return {
    id: String(row.id),
    modelCode: String(row.model_code),
    name: String(row.name),
    shortDescription:
      row.short_description == null ? null : String(row.short_description),
    brandName: String(row.brand_name),
    brandSlug: String(row.brand_slug),
    categoryName: String(row.category_name),
    categorySlug: String(row.category_slug),
    basePrice: Number(row.base_price),
    currency: String(row.currency),
    isActive: Boolean(row.is_active),
    rowVersion: Number(row.row_version),
    updatedAt: toIso(row.updated_at),
    colors,
    variants,
  };
}

function mapAudit(row: DatabaseRow): CatalogChangeAuditEvent {
  return {
    id: String(row.id),
    actorUserId: row.actor_user_id == null ? null : String(row.actor_user_id),
    actorLabel: String(row.actor_label),
    requestId: row.request_id == null ? null : String(row.request_id),
    entityType: parseEntityType(row.entity_type),
    entityId: String(row.entity_id),
    productId: String(row.product_id),
    action: "updated",
    beforeSnapshot: parseJsonObject(row.before_snapshot),
    afterSnapshot: parseJsonObject(row.after_snapshot),
    createdAt: toIso(row.created_at),
  };
}

function normalizeStatusFilter(value: CatalogAdminStatusFilter | undefined) {
  return value === "active" || value === "inactive" ? value : "all";
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isInteger(value) || Number(value) < 1) return DEFAULT_PRODUCT_LIMIT;
  return Math.min(Number(value), MAX_PRODUCT_LIMIT);
}

export async function listManagedCatalog(query: {
  q?: string | null;
  status?: CatalogAdminStatusFilter;
  limit?: number;
} = {}): Promise<ManagedCatalogData> {
  const search = query.q?.trim() ?? "";
  if (search.length > 160) {
    throw new CatalogAdminError(
      "Từ khóa catalog không được vượt quá 160 ký tự.",
      400,
      "catalog_search_too_long",
    );
  }

  const status = normalizeStatusFilter(query.status);
  const params: Array<string | number | boolean> = [search];
  const conditions = [
    `(
      $1 = ''
      OR concat_ws(
        ' ',
        product.model_code,
        product.name,
        brand.name,
        category.name
      ) ILIKE '%' || $1 || '%'
    )`,
  ];

  if (status !== "all") {
    params.push(status === "active");
    conditions.push(`product.is_active = $${params.length}`);
  }
  params.push(normalizeLimit(query.limit));

  const pool = getPool();
  const productResult = await pool.query(
    `
      SELECT
        product.id,
        product.model_code,
        product.name,
        product.short_description,
        product.base_price,
        product.currency,
        product.is_active,
        product.row_version,
        product.updated_at,
        brand.name AS brand_name,
        brand.slug AS brand_slug,
        category.name AS category_name,
        category.slug AS category_slug
      FROM japan_underwear.products AS product
      JOIN japan_underwear.brands AS brand
        ON brand.id = product.brand_id
      JOIN japan_underwear.categories AS category
        ON category.id = product.category_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY brand.name, category.sort_order, product.model_code
      LIMIT $${params.length}
    `,
    params,
  );

  if (productResult.rowCount === 0) {
    return { products: [], auditEvents: [] };
  }

  const productIds = productResult.rows.map((row) => String(row.id));
  const [colorResult, variantResult, auditResult] = await Promise.all([
    pool.query(
      `
        SELECT
          id,
          product_id,
          code,
          name,
          swatch,
          sort_order,
          is_active,
          row_version,
          updated_at
        FROM japan_underwear.product_colors
        WHERE product_id = ANY($1::uuid[])
        ORDER BY product_id, sort_order, code
      `,
      [productIds],
    ),
    pool.query(
      `
        SELECT
          variant.id,
          variant.product_id,
          variant.size_code,
          variant.cup_code,
          variant.sku,
          variant.price_override,
          COALESCE(variant.price_override, product.base_price) AS effective_price,
          variant.is_active,
          variant.row_version,
          variant.updated_at
        FROM japan_underwear.product_variants AS variant
        JOIN japan_underwear.products AS product
          ON product.id = variant.product_id
        WHERE variant.product_id = ANY($1::uuid[])
        ORDER BY variant.product_id, variant.size_code, variant.cup_code NULLS FIRST
      `,
      [productIds],
    ),
    pool.query(
      `
        SELECT
          id,
          actor_user_id,
          actor_label,
          request_id,
          entity_type,
          entity_id,
          product_id,
          action,
          before_snapshot,
          after_snapshot,
          created_at
        FROM japan_underwear.catalog_change_audit
        WHERE product_id = ANY($1::uuid[])
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `,
      [productIds, AUDIT_LIMIT],
    ),
  ]);

  const colorsByProduct = new Map<string, ManagedCatalogColor[]>();
  for (const row of colorResult.rows as DatabaseRow[]) {
    const productId = String(row.product_id);
    const rows = colorsByProduct.get(productId) ?? [];
    rows.push(mapColor(row));
    colorsByProduct.set(productId, rows);
  }

  const variantsByProduct = new Map<string, ManagedCatalogVariant[]>();
  for (const row of variantResult.rows as DatabaseRow[]) {
    const productId = String(row.product_id);
    const rows = variantsByProduct.get(productId) ?? [];
    rows.push(mapVariant(row));
    variantsByProduct.set(productId, rows);
  }

  return {
    products: (productResult.rows as DatabaseRow[]).map((row) => {
      const productId = String(row.id);
      return mapProduct(
        row,
        colorsByProduct.get(productId) ?? [],
        variantsByProduct.get(productId) ?? [],
      );
    }),
    auditEvents: (auditResult.rows as DatabaseRow[]).map(mapAudit),
  };
}

function mapCatalogDatabaseError(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  ) {
    const constraint =
      "constraint" in error && typeof error.constraint === "string"
        ? error.constraint
        : null;
    if (constraint === "product_variants_sku_uidx") {
      throw new CatalogAdminError(
        "SKU đã được dùng cho biến thể khác.",
        409,
        "catalog_sku_conflict",
      );
    }
    throw new CatalogAdminError(
      "Dữ liệu catalog bị trùng với bản ghi hiện có.",
      409,
      "catalog_unique_conflict",
    );
  }
  throw error;
}

async function withCatalogUpdate<T>(
  actorInput: CatalogAdminActor,
  work: (client: PoolClient) => Promise<T>,
) {
  const actor = normalizeActor(actorInput);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('japan_underwear.catalog_actor_user_id', $1, true)",
      [actor.userId],
    );
    await client.query(
      "SELECT set_config('japan_underwear.catalog_actor_label', $1, true)",
      [actor.label],
    );
    await client.query(
      "SELECT set_config('japan_underwear.catalog_request_id', $1, true)",
      [actor.requestId],
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    mapCatalogDatabaseError(error);
  } finally {
    client.release();
  }
}

async function throwMissingOrConflict(
  client: PoolClient,
  table: "products" | "product_colors" | "product_variants",
  id: string,
  notFoundMessage: string,
) {
  const result = await client.query(
    `SELECT row_version FROM japan_underwear.${table} WHERE id = $1::uuid`,
    [id],
  );
  if (result.rowCount === 0) {
    throw new CatalogAdminError(notFoundMessage, 404, "catalog_entity_not_found");
  }
  throw new CatalogAdminError(
    "Dữ liệu catalog đã được người khác thay đổi. Tải lại trang trước khi lưu tiếp.",
    409,
    "catalog_version_conflict",
  );
}

export async function updateManagedProduct(
  productIdInput: string,
  actor: CatalogAdminActor,
  input: UpdateManagedProductInput,
) {
  const productId = normalizeUuid(productIdInput, "invalid_product_id");
  const expectedVersion = normalizeVersion(input.expectedVersion);
  const assignments: string[] = [];
  const values: unknown[] = [productId, expectedVersion];

  if (input.name !== undefined) {
    values.push(normalizeRequiredText(input.name, "Tên sản phẩm", 240));
    assignments.push(`name = $${values.length}`);
  }
  if (input.shortDescription !== undefined) {
    values.push(normalizeOptionalText(input.shortDescription, "Mô tả ngắn", 2000));
    assignments.push(`short_description = $${values.length}`);
  }
  if (input.basePrice !== undefined) {
    values.push(normalizePrice(input.basePrice, "Giá cơ bản"));
    assignments.push(`base_price = $${values.length}`);
  }
  if (input.isActive !== undefined) {
    values.push(input.isActive);
    assignments.push(`is_active = $${values.length}`);
  }
  if (assignments.length === 0) {
    throw new CatalogAdminError(
      "Không có thay đổi sản phẩm để lưu.",
      400,
      "empty_catalog_update",
    );
  }

  return withCatalogUpdate(actor, async (client) => {
    const result = await client.query(
      `
        UPDATE japan_underwear.products AS product
        SET ${assignments.join(", ")}
        FROM japan_underwear.brands AS brand,
             japan_underwear.categories AS category
        WHERE product.id = $1::uuid
          AND product.row_version = $2
          AND brand.id = product.brand_id
          AND category.id = product.category_id
        RETURNING
          product.id,
          product.model_code,
          product.name,
          product.short_description,
          product.base_price,
          product.currency,
          product.is_active,
          product.row_version,
          product.updated_at,
          brand.name AS brand_name,
          brand.slug AS brand_slug,
          category.name AS category_name,
          category.slug AS category_slug
      `,
      values,
    );
    if (result.rowCount !== 1) {
      await throwMissingOrConflict(client, "products", productId, "Không tìm thấy sản phẩm.");
    }
    const product = mapProduct(result.rows[0] as DatabaseRow, [], []);
    return { entity: product, changed: product.rowVersion !== expectedVersion };
  });
}

export async function updateManagedColor(
  colorIdInput: string,
  actor: CatalogAdminActor,
  input: UpdateManagedColorInput,
) {
  const colorId = normalizeUuid(colorIdInput, "invalid_color_id");
  const expectedVersion = normalizeVersion(input.expectedVersion);
  const assignments: string[] = [];
  const values: unknown[] = [colorId, expectedVersion];

  if (input.name !== undefined) {
    values.push(normalizeRequiredText(input.name, "Tên màu", 160));
    assignments.push(`name = $${values.length}`);
  }
  if (input.swatch !== undefined) {
    values.push(normalizeOptionalText(input.swatch, "Mã swatch", 64));
    assignments.push(`swatch = $${values.length}`);
  }
  if (input.sortOrder !== undefined) {
    values.push(normalizeSortOrder(input.sortOrder));
    assignments.push(`sort_order = $${values.length}`);
  }
  if (input.isActive !== undefined) {
    values.push(input.isActive);
    assignments.push(`is_active = $${values.length}`);
  }
  if (assignments.length === 0) {
    throw new CatalogAdminError(
      "Không có thay đổi màu để lưu.",
      400,
      "empty_catalog_update",
    );
  }

  return withCatalogUpdate(actor, async (client) => {
    const result = await client.query(
      `
        UPDATE japan_underwear.product_colors
        SET ${assignments.join(", ")}
        WHERE id = $1::uuid
          AND row_version = $2
        RETURNING id, code, name, swatch, sort_order, is_active, row_version, updated_at
      `,
      values,
    );
    if (result.rowCount !== 1) {
      await throwMissingOrConflict(
        client,
        "product_colors",
        colorId,
        "Không tìm thấy màu sản phẩm.",
      );
    }
    const color = mapColor(result.rows[0] as DatabaseRow);
    return { entity: color, changed: color.rowVersion !== expectedVersion };
  });
}

export async function updateManagedVariant(
  variantIdInput: string,
  actor: CatalogAdminActor,
  input: UpdateManagedVariantInput,
) {
  const variantId = normalizeUuid(variantIdInput, "invalid_variant_id");
  const expectedVersion = normalizeVersion(input.expectedVersion);
  const assignments: string[] = [];
  const values: unknown[] = [variantId, expectedVersion];

  if (input.sku !== undefined) {
    values.push(normalizeOptionalText(input.sku, "SKU", 160));
    assignments.push(`sku = $${values.length}`);
  }
  if (input.priceOverride !== undefined) {
    values.push(
      input.priceOverride === null
        ? null
        : normalizePrice(input.priceOverride, "Giá riêng biến thể"),
    );
    assignments.push(`price_override = $${values.length}`);
  }
  if (input.isActive !== undefined) {
    values.push(input.isActive);
    assignments.push(`is_active = $${values.length}`);
  }
  if (assignments.length === 0) {
    throw new CatalogAdminError(
      "Không có thay đổi biến thể để lưu.",
      400,
      "empty_catalog_update",
    );
  }

  return withCatalogUpdate(actor, async (client) => {
    const result = await client.query(
      `
        UPDATE japan_underwear.product_variants AS variant
        SET ${assignments.join(", ")}
        FROM japan_underwear.products AS product
        WHERE variant.id = $1::uuid
          AND variant.row_version = $2
          AND product.id = variant.product_id
        RETURNING
          variant.id,
          variant.size_code,
          variant.cup_code,
          variant.sku,
          variant.price_override,
          COALESCE(variant.price_override, product.base_price) AS effective_price,
          variant.is_active,
          variant.row_version,
          variant.updated_at
      `,
      values,
    );
    if (result.rowCount !== 1) {
      await throwMissingOrConflict(
        client,
        "product_variants",
        variantId,
        "Không tìm thấy biến thể sản phẩm.",
      );
    }
    const variant = mapVariant(result.rows[0] as DatabaseRow);
    return { entity: variant, changed: variant.rowVersion !== expectedVersion };
  });
}
