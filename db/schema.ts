import { sql } from "drizzle-orm";
import {
  boolean,
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    modelCode: text("model_code").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    shortDescription: text("short_description"),
    basePrice: integer("base_price").notNull(),
    currency: text("currency").notNull().default("VND"),
    sourceProductId: text("source_product_id"),
    sourceUrl: text("source_url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("products_slug_uidx").on(table.slug),
    uniqueIndex("products_brand_category_model_uidx").on(
      table.brandId,
      table.categoryId,
      table.modelCode,
    ),
    index("products_category_idx").on(table.categoryId),
    index("products_active_idx").on(table.isActive),
  ],
);

export const productColors = catalogSchema.table(
  "product_colors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    swatch: text("swatch"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [
    uniqueIndex("product_colors_product_code_uidx").on(
      table.productId,
      table.code,
    ),
    index("product_colors_product_idx").on(table.productId),
  ],
);

export const productVariants = catalogSchema.table(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    colorId: uuid("color_id")
      .notNull()
      .references(() => productColors.id, { onDelete: "cascade" }),
    sizeCode: text("size_code").notNull(),
    sku: text("sku"),
    priceOverride: integer("price_override"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("product_variants_product_color_size_uidx").on(
      table.productId,
      table.colorId,
      table.sizeCode,
    ),
    uniqueIndex("product_variants_sku_uidx")
      .on(table.sku)
      .where(sql`${table.sku} is not null`),
    index("product_variants_product_idx").on(table.productId),
    index("product_variants_color_idx").on(table.colorId),
  ],
);

export const productImages = catalogSchema.table(
  "product_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    colorId: uuid("color_id").references(() => productColors.id, {
      onDelete: "set null",
    }),
    r2Key: text("r2_key").notNull(),
    sourceFilename: text("source_filename"),
    altText: text("alt_text"),
    sortOrder: integer("sort_order").notNull().default(0),
    isCover: boolean("is_cover").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("product_images_r2_key_uidx").on(table.r2Key),
    index("product_images_product_sort_idx").on(
      table.productId,
      table.sortOrder,
    ),
    index("product_images_color_idx").on(table.colorId),
  ],
);

export const catalogImportRuns = catalogSchema.table(
  "catalog_import_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    status: importStatus("status").notNull().default("pending"),
    manifestHash: text("manifest_hash"),
    summary: jsonb("summary")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("catalog_import_runs_status_idx").on(table.status)],
);

export type Brand = typeof brands.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductColor = typeof productColors.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductImage = typeof productImages.$inferSelect;
