import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const catalogSchema = pgSchema("japan_underwear");

export const importStatus = catalogSchema.enum("catalog_import_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const brands = catalogSchema.table(
  "brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    accentColor: text("accent_color"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("brands_slug_uidx").on(table.slug)],
);

export const categories = catalogSchema.table(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_slug_uidx").on(table.slug),
    index("categories_parent_idx").on(table.parentId),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "categories_parent_fk",
    }).onDelete("set null"),
  ],
);

export const products = catalogSchema.table(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
    modelCode: text("model_code").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    shortDescription: text("short_description"),
    basePrice: integer("base_price").notNull(),
    currency: text("currency").notNull().default("VND"),
    sourceProductId: text("source_product_id"),
    sourceUrl: text("source_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_slug_uidx").on(table.slug),
    uniqueIndex("products_brand_category_model_uidx").on(table.brandId, table.categoryId, table.modelCode),
    index("products_category_idx").on(table.categoryId),
    index("products_active_idx").on(table.isActive),
  ],
);

export const productColors = catalogSchema.table(
  "product_colors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    swatch: text("swatch"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("product_colors_product_code_uidx").on(table.productId, table.code),
    index("product_colors_product_idx").on(table.productId),
    check("product_colors_code_nonempty_chk", sql`btrim(${table.code}) <> ''`),
    check("product_colors_name_nonempty_chk", sql`btrim(${table.name}) <> ''`),
  ],
);

export const productVariants = catalogSchema.table(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    sizeCode: text("size_code").notNull(),
    cupCode: text("cup_code"),
    sku: text("sku"),
    priceOverride: integer("price_override"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_variants_product_size_cup_uidx")
      .on(table.productId, table.sizeCode, table.cupCode)
      .where(sql`${table.cupCode} is not null`),
    uniqueIndex("product_variants_product_size_no_cup_uidx")
      .on(table.productId, table.sizeCode)
      .where(sql`${table.cupCode} is null`),
    uniqueIndex("product_variants_sku_uidx").on(table.sku).where(sql`${table.sku} is not null`),
    index("product_variants_product_idx").on(table.productId),
    check("product_variants_size_nonempty_chk", sql`btrim(${table.sizeCode}) <> ''`),
    check(
      "product_variants_cup_format_chk",
      sql`${table.cupCode} is null or ${table.cupCode} ~ '^[A-Z]+$'`,
    ),
    check(
      "product_variants_price_override_nonnegative_chk",
      sql`${table.priceOverride} is null or ${table.priceOverride} >= 0`,
    ),
  ],
);

export const productImages = catalogSchema.table(
  "product_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    colorId: uuid("color_id").references(() => productColors.id, { onDelete: "set null" }),
    r2Key: text("r2_key").notNull(),
    sourceFilename: text("source_filename"),
    altText: text("alt_text"),
    sortOrder: integer("sort_order").notNull().default(0),
    isCover: boolean("is_cover").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_images_r2_key_uidx").on(table.r2Key),
    index("product_images_product_sort_idx").on(table.productId, table.sortOrder),
    index("product_images_color_idx").on(table.colorId),
  ],
);

export const carts = catalogSchema.table(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    token: uuid("token").defaultRandom().notNull(),
    status: text("status").$type<"active" | "converted" | "abandoned">().notNull().default("active"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("carts_token_uidx").on(table.token),
    index("carts_status_updated_idx").on(table.status, table.updatedAt),
    check("carts_status_chk", sql`${table.status} in ('active', 'converted', 'abandoned')`),
  ],
);

export const cartItems = catalogSchema.table(
  "cart_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cartId: uuid("cart_id").notNull().references(() => carts.id, { onDelete: "cascade" }),
    productVariantId: uuid("product_variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    colorId: uuid("color_id").notNull().references(() => productColors.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPriceSnapshot: integer("unit_price_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cart_items_cart_variant_color_uidx").on(
      table.cartId,
      table.productVariantId,
      table.colorId,
    ),
    index("cart_items_cart_idx").on(table.cartId),
    index("cart_items_variant_idx").on(table.productVariantId),
    index("cart_items_color_idx").on(table.colorId),
    check("cart_items_quantity_chk", sql`${table.quantity} between 1 and 999`),
    check("cart_items_price_chk", sql`${table.unitPriceSnapshot} >= 0`),
  ],
);

export const orders = catalogSchema.table(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderCode: text("order_code").notNull(),
    sourceCartId: uuid("source_cart_id").notNull().references(() => carts.id, { onDelete: "restrict" }),
    status: text("status").$type<"submitted" | "confirmed" | "cancelled">().notNull().default("submitted"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    deliveryAddress: text("delivery_address"),
    note: text("note"),
    deliveryLatitude: doublePrecision("delivery_latitude"),
    deliveryLongitude: doublePrecision("delivery_longitude"),
    deliveryAccuracyMeters: doublePrecision("delivery_accuracy_meters"),
    locationCollectedAt: timestamp("location_collected_at", { withTimezone: true }),
    locationSource: text("location_source").$type<"browser_geolocation">(),
    subtotal: integer("subtotal").notNull(),
    currency: text("currency").notNull().default("VND"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_order_code_uidx").on(table.orderCode),
    uniqueIndex("orders_source_cart_uidx").on(table.sourceCartId),
    index("orders_status_created_idx").on(table.status, table.createdAt),
    index("orders_customer_phone_idx").on(table.customerPhone),
    check("orders_status_chk", sql`${table.status} in ('submitted', 'confirmed', 'cancelled')`),
    check("orders_customer_name_nonempty_chk", sql`btrim(${table.customerName}) <> ''`),
    check("orders_customer_phone_nonempty_chk", sql`btrim(${table.customerPhone}) <> ''`),
    check("orders_subtotal_chk", sql`${table.subtotal} >= 0`),
    check(
      "orders_location_all_or_none_chk",
      sql`num_nonnulls(
        ${table.deliveryLatitude},
        ${table.deliveryLongitude},
        ${table.deliveryAccuracyMeters},
        ${table.locationCollectedAt},
        ${table.locationSource}
      ) in (0, 5)`,
    ),
    check(
      "orders_location_latitude_chk",
      sql`${table.deliveryLatitude} is null or ${table.deliveryLatitude} between -90 and 90`,
    ),
    check(
      "orders_location_longitude_chk",
      sql`${table.deliveryLongitude} is null or ${table.deliveryLongitude} between -180 and 180`,
    ),
    check(
      "orders_location_accuracy_chk",
      sql`${table.deliveryAccuracyMeters} is null or (${table.deliveryAccuracyMeters} > 0 and ${table.deliveryAccuracyMeters} <= 100000)`,
    ),
    check(
      "orders_location_collected_at_chk",
      sql`${table.locationCollectedAt} is null or ${table.locationCollectedAt} >= timestamptz '2000-01-01 00:00:00+00'`,
    ),
    check(
      "orders_location_source_chk",
      sql`${table.locationSource} is null or ${table.locationSource} = 'browser_geolocation'`,
    ),
  ],
);

export const orderItems = catalogSchema.table(
  "order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    productVariantId: uuid("product_variant_id").notNull().references(() => productVariants.id, { onDelete: "restrict" }),
    colorId: uuid("color_id").notNull().references(() => productColors.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price").notNull(),
    lineTotal: integer("line_total").notNull(),
    productCodeSnapshot: text("product_code_snapshot").notNull(),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    colorCodeSnapshot: text("color_code_snapshot").notNull(),
    colorNameSnapshot: text("color_name_snapshot").notNull(),
    sizeCodeSnapshot: text("size_code_snapshot").notNull(),
    cupCodeSnapshot: text("cup_code_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("order_items_order_variant_color_uidx").on(
      table.orderId,
      table.productVariantId,
      table.colorId,
    ),
    index("order_items_order_idx").on(table.orderId),
    index("order_items_variant_idx").on(table.productVariantId),
    index("order_items_color_idx").on(table.colorId),
    check("order_items_quantity_chk", sql`${table.quantity} between 1 and 999`),
    check("order_items_unit_price_chk", sql`${table.unitPrice} >= 0`),
    check("order_items_line_total_chk", sql`${table.lineTotal} = ${table.unitPrice} * ${table.quantity}`),
  ],
);

export const catalogImportRuns = catalogSchema.table(
  "catalog_import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    status: importStatus("status").notNull().default("pending"),
    manifestHash: text("manifest_hash"),
    summary: jsonb("summary").$type<Record<string, number>>().notNull().default({}),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("catalog_import_runs_status_idx").on(table.status)],
);

export type Brand = typeof brands.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductColor = typeof productColors.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
export type Cart = typeof carts.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
