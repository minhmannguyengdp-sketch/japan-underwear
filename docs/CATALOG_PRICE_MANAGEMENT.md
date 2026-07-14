# Catalog and price-list management

## Scope

The staff page is `/admin/catalog`.

- `sales` may list, search, filter, and inspect all active or inactive catalog rows and recent audit events.
- `admin` may update product display data, product base price, product active status, color display data/status, and variant SKU/price override/status.
- Product model code, brand, category, slug, color code, product ownership, and size/cup identity are intentionally not editable in this workflow. Those fields belong to the catalog import identity and require a separate controlled migration/import process.

The APIs re-check authorization on the server:

- `GET /api/admin/catalog` — sales/admin.
- `PATCH /api/admin/catalog/products/:productId` — admin only.
- `PATCH /api/admin/catalog/colors/:colorId` — admin only.
- `PATCH /api/admin/catalog/variants/:variantId` — admin only.

## Pricing and historical orders

The authoritative current unit price remains:

`COALESCE(product_variants.price_override, products.base_price)`

The shared order writer already reads that value while locking the selected product, color, and variant rows with `FOR SHARE`. Catalog updates use normal row updates in a transaction, so PostgreSQL serializes an order creation against a concurrent price/status change. A committed order keeps its own `order_items.unit_price`, totals, and product/color/size snapshots. Catalog administration never updates historical order rows.

Consequently:

- a new price applies only to orders priced after the catalog change commits;
- an order that commits first keeps the earlier price snapshot;
- inactive product/color/variant rows are rejected by the shared order writer;
- existing orders remain readable with their original snapshots.

## Optimistic concurrency

Migration `0012_catalog_price_management` adds `row_version` to products, colors, and variants. Every API update includes `expectedVersion` and uses a compare-and-set update:

`WHERE id = ... AND row_version = expectedVersion`

A database trigger increments `row_version` and refreshes `updated_at` only when business data actually changes. A stale editor receives HTTP `409` instead of silently overwriting a newer update. A no-op update keeps the same version and creates no audit event.

## Audit

`japan_underwear.catalog_change_audit` stores:

- actor user and display label;
- request UUID;
- entity type/id and owning product id;
- before/after JSONB snapshots;
- timestamp.

Audit is written by PostgreSQL triggers, not only by the web handler. Direct import or maintenance updates therefore remain visible. Web transactions set actor/request context through transaction-local PostgreSQL settings. A direct database update without that context is labeled as a direct database update.

## Migration and verification

The state-aware runner is `scripts/db/apply-catalog-price-management.mjs`. The runtime verifier is rollback-only and checks product/color/variant versioning, stale-write protection, no-op behavior, audit snapshots, and historical order snapshot stability.

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear
npm run db:migrate
npm run db:verify
npm run lint
npm run build
```

Functional smoke should cover:

1. Sales can open `/admin/catalog` but all edit controls are disabled and PATCH returns `403`.
2. Admin changes a base price and sees a successful save/version increment.
3. Admin changes a variant override and can clear it back to the product base price.
4. A stale tab receives `409` and does not overwrite the newer value.
5. A new checkout/manual order uses the new price, while an older order detail remains unchanged.
6. Product/color/variant deactivation prevents new order selection but does not alter order history.
