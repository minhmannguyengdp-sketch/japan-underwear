CREATE SCHEMA IF NOT EXISTS "japan_underwear";--> statement-breakpoint
CREATE TYPE "japan_underwear"."catalog_import_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "japan_underwear"."brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"accent_color" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "japan_underwear"."catalog_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" "japan_underwear"."catalog_import_status" DEFAULT 'pending' NOT NULL,
	"manifest_hash" text,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "japan_underwear"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "japan_underwear"."product_colors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"swatch" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "japan_underwear"."product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"color_id" uuid,
	"r2_key" text NOT NULL,
	"source_filename" text,
	"alt_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "japan_underwear"."product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"color_id" uuid NOT NULL,
	"size_code" text NOT NULL,
	"sku" text,
	"price_override" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "japan_underwear"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"category_id" uuid,
	"model_code" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text,
	"base_price" integer NOT NULL,
	"currency" text DEFAULT 'VND' NOT NULL,
	"source_product_id" text,
	"source_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "japan_underwear"."categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "japan_underwear"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_colors" ADD CONSTRAINT "product_colors_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "japan_underwear"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "japan_underwear"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_images" ADD CONSTRAINT "product_images_color_id_product_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "japan_underwear"."product_colors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "japan_underwear"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "japan_underwear"."product_variants" ADD CONSTRAINT "product_variants_color_id_product_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "japan_underwear"."product_colors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "japan_underwear"."products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "japan_underwear"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "japan_underwear"."products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "japan_underwear"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_uidx" ON "japan_underwear"."brands" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "catalog_import_runs_status_idx" ON "japan_underwear"."catalog_import_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uidx" ON "japan_underwear"."categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "japan_underwear"."categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_colors_product_code_uidx" ON "japan_underwear"."product_colors" USING btree ("product_id","code");--> statement-breakpoint
CREATE INDEX "product_colors_product_idx" ON "japan_underwear"."product_colors" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_r2_key_uidx" ON "japan_underwear"."product_images" USING btree ("r2_key");--> statement-breakpoint
CREATE INDEX "product_images_product_sort_idx" ON "japan_underwear"."product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_images_color_idx" ON "japan_underwear"."product_images" USING btree ("color_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_color_size_uidx" ON "japan_underwear"."product_variants" USING btree ("product_id","color_id","size_code");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_uidx" ON "japan_underwear"."product_variants" USING btree ("sku") WHERE "japan_underwear"."product_variants"."sku" is not null;--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "japan_underwear"."product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_color_idx" ON "japan_underwear"."product_variants" USING btree ("color_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uidx" ON "japan_underwear"."products" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "products_brand_model_uidx" ON "japan_underwear"."products" USING btree ("brand_id","model_code");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "japan_underwear"."products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_active_idx" ON "japan_underwear"."products" USING btree ("is_active");