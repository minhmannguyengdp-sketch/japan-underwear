# Full Tuấn Thủy product web audit — 2026-07-12

## Input

Raw audit generated from `https://tuanthuy.com.vn` with schema version 3.

The uploaded audit contained:

- 104 product pages
- 33 listing pages visited
- 0 crawl errors
- 32 pages with size/cup candidates
- 72 pages without size/cup candidates
- 0 structured color lists

This raw page-level file is not a product import manifest. Tuấn Thủy frequently publishes one page per color, so the pages must first be consolidated against the authoritative price identity.

## Model-level result

Deterministic grouping of the raw file by product model produced:

- 49 canonical web models
- 55 additional color pages merged into their parent model
- 19 models with explicit color labels in page titles
- 32 models with size/cup candidates
- 199 unique size/cup candidate combinations
- 17 models still missing a size/cup source after page consolidation
- 34 models with at least one feature candidate
- all 49 models with at least one image across their source pages
- 6 individual color pages without an extracted image

All 32 models with variants currently derive those variants from explicit `Size:` text in the product description. They remain review-required and must not be imported automatically.

## Correct identity rule

Canonical identity remains:

`brand + category + model`

The website breadcrumb and JSON-LD brand are evidence only:

- Model 5001 appears under `Mút mỏng`, `Không đường may`, and generic `Áo ngực` across its color pages.
- One model 9109 color page is incorrectly breadcrumbed as `Quần lót`, although the product title is `Áo ngực Winking 9109`.
- Five color pages have a blank structured brand.

The model-level consolidator therefore:

1. Resolves the model from the explicit product name when possible.
2. Normalizes the brand from the structured brand plus product name.
3. Infers the web product kind from `Áo ngực`, `Quần lót`, or `Quần gen` in the title.
4. Resolves the final identity against the authoritative price reference.
5. Stops with an unresolved-page record when the price identity is not unique.

## Color handling

Color remains product-level display data only.

- It is not part of variant identity.
- It does not control the gallery.
- It does not create a color × size × cup matrix.
- Images are not renamed or assigned to colors.
- Page-title colors are retained with their source URLs as evidence.

Observed title colors:

| Model | Colors from page titles |
|---|---|
| 5001 | Da, Xanh |
| 9059 | Xanh ngọc, Xanh Trắng, Trắng Hồng |
| 9091 | Xanh, Đen |
| 9093 | Da, Đỏ, Xanh, Đen, Tím |
| 9099 | Da, Đen, Đỏ, Tím, Trắng, Xám, Xanh dương, Xanh ngọc |
| 9100 | Da, Tím, Cam, Đỏ, Xanh đen |
| 9102 | Đỏ, Tím, Đen, Da, Nâu |
| 9103 | Da, Đen |
| 9104 | Đen, Tím |
| 9107 | Đen, Da, Xanh đen |
| 9108 | Đen, Trắng, Da, Xanh đen |
| 9109 | Da, Đen, Tím, Trắng |
| 9110 | Da, Đen, Đỏ, Nâu |
| 9111 | Da, Đen, Đỏ, Nâu |
| 9112 | Da, Đen, Đỏ, Nâu |
| 9114 | Da, Đen |
| 9502 | Da, Đen, Đỏ đô, Tím, Xanh đen, Trắng |
| 9516 | Da, Đen, Tím, Trắng |
| 9521 | Da đậm, Da Nhạt |

Models with no explicit title color remain valid with an empty `product_colors` collection. A later image audit may add colors, but it must not overwrite stronger page-title evidence.

## Size/cup result

The audit found 199 unique candidate variants across 32 models. Observed values are limited to:

- Sizes: `70`, `75`, `80`, `85`, `90`, `95`
- Cups: `A`, `B`, `C`, `D`

Models with size/cup candidates:

`5001, 5002, 5003, 9050, 9501, 9503, 9504, 9505, 9506, 9507, 9508, 9509, 9510, 9511, 9512, 9513, 9514, 9515, 9517, 9518, 9519, 9521, 9523, 9524, 9525, 9526, 9529, 9530, 9531, 9532, 9535, 9536`

Models still missing size/cup evidence:

`9059, 9091, 9093, 9099, 9100, 9102, 9103, 9104, 9107, 9108, 9109, 9110, 9111, 9112, 9114, 9502, 9516`

Missing size/cup remains a model-level blocker. Size/cup must not be copied from a visually similar model or inferred by creating a Cartesian product.

## Price findings

Website prices are audit evidence only. The authoritative price reference remains the pricing source for catalog and future server-side order validation.

For all 32 description-derived variant models, the price embedded in prose differs from the current structured page price:

- 25 differ by 100,000 VND
- 4 differ by 90,000 VND
- 2 differ by 80,000 VND
- 1 differs by 120,000 VND

Model 9099 has especially unreliable color-page prices:

- expected authoritative base price: 499,000 VND
- several pages report 499,000 VND
- one page reports 399,000 VND
- one page reports 49,900 VND
- three pages have no structured price

No page price or description price is copied into a variant record by the model-level consolidator. Variant price is left unresolved until the server applies the authoritative price rule.

## Identity anomalies

### Pensee 9517

The source URL ends in `ao-nguc-pensee-95167`, causing scraper candidates `9517` and `9516`. The visible product name and description code are 9517. The consolidator uses the explicit product name and records the extra candidate as a review flag.

### Winking 9109

One color page has a `Quần lót` breadcrumb while the product title says `Áo ngực Winking 9109`. The breadcrumb is ignored for identity; the price reference decides the category.

### Winking 5001

Three color/base pages expose three different breadcrumb categories. They are consolidated only after the price identity resolves to one canonical product.

## Content handling

The raw audit found feature candidates for 42 pages, representing 34 models after consolidation.

The app copy pipeline remains:

1. Select the best source page for the canonical model.
2. Preserve the original description as evidence.
3. Review and rewrite into one short description plus 3–5 factual features.
4. Remove price, hotline, delivery, policy, generic advertising, and stale claims.
5. Do not automatically publish generated copy.

## Tooling added

Run the model-level audit with:

```powershell
npm run catalog:web:audit -- <raw-audit.json> [output.json]
```

The script:

- reads the raw browser audit;
- reads `data/reference/price-list-2026-04-02.json`;
- resolves canonical product identities;
- merges color-specific pages;
- extracts title colors with URL evidence;
- merges size/cup candidates by product;
- ignores website prices for import pricing;
- emits blockers and review flags;
- performs no database writes.

## Stop gate

No variant migration or import should run yet.

Required before migration:

- model-level output has zero unresolved pages;
- 32 description-derived variant sets are reviewed and explicitly approved;
- 17 missing-size/cup models are either resolved from a real source or remain ordering-disabled;
- model 9099 price-page anomalies are treated as source defects, not imported values;
- concise content is reviewed separately;
- no login or order implementation is started from this audit.
