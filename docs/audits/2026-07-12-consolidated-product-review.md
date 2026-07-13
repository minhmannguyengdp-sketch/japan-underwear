# Consolidated Tuấn Thủy review — 2026-07-12

## Input

- Consolidated audit schema: `1`
- Raw source pages: `104`
- Canonical website products: `49`
- Website product identity: `brand + category + model`
- Price authority: `data/reference/price-list-2026-04-02.json`
- Database writes: none

The consolidated file is structurally valid. It contains no unresolved source pages and no duplicate product or variant keys.

## Scope

All 49 website products in this crawl are bras (`ao-nguc`):

- Pensee: 30 models
- Winking: 19 models

The file itself does not embed the current 108 active catalog keys. Exact active-catalog intersection must be computed against local `data/local/catalog-manifest.json`; do not assume every website product is active.

## Variant findings

- 32 models expose explicit size/cup lists in product descriptions.
- 199 unique size/cup candidates were parsed.
- No Cartesian products were generated.
- No duplicate variant keys were found.
- Sizes: 70, 75, 80, 85, 90, 95.
- Cups: A, B, C, D.
- All candidates use identity `product + size + cup`.
- All candidates require explicit approval because their evidence is free-form description text rather than a live variation control.

| Model | Candidate count | Explicit combinations |
|---|---:|---|
| 9501 | 8 | 70B, 75A, 75B, 80A, 80B, 85A, 85B, 90A |
| 9503 | 6 | 70B, 75A, 75B, 80A, 80B, 85A |
| 9504 | 6 | 70B, 75A, 75B, 80A, 80B, 85A |
| 9505 | 6 | 70B, 75A, 75B, 80A, 80B, 85A |
| 9506 | 7 | 75A, 75B, 80A, 80B, 85A, 85B, 90A |
| 9507 | 5 | 75A, 75B, 80A, 80B, 85A |
| 9508 | 6 | 75B, 80A, 80B, 85A, 85B, 90A |
| 9509 | 9 | 75B, 75C, 80A, 80B, 80C, 85A, 85B, 85C, 90A |
| 9510 | 9 | 75B, 75C, 80A, 80B, 80C, 85A, 85B, 85C, 90A |
| 9511 | 3 | 75B, 80B, 85B |
| 9512 | 3 | 75C, 80C, 85C |
| 9513 | 10 | 75B, 75C, 80A, 80B, 80C, 85A, 85B, 85C, 90A, 90B |
| 9514 | 7 | 75B, 80A, 80B, 85A, 85B, 90A, 90B |
| 9515 | 7 | 75B, 80A, 80B, 85A, 85B, 90A, 90B |
| 9517 | 11 | 75B, 75C, 80A, 80B, 80C, 85A, 85B, 85C, 90A, 90B, 95A |
| 9518 | 5 | 75A, 75B, 80A, 80B, 85A |
| 9519 | 3 | 75B, 80B, 85B |
| 9521 | 5 | 75A, 75B, 80A, 80B, 85A |
| 9523 | 6 | 75B, 80A, 80B, 85A, 85B, 90A |
| 9524 | 5 | 75A, 75B, 80A, 80B, 85A |
| 9525 | 3 | 75B, 80B, 85B |
| 9526 | 3 | 80C, 85C, 90C |
| 9529 | 13 | 75B, 75C, 80A, 80B, 80C, 85A, 85B, 85C, 90A, 90B, 90C, 95A, 95B |
| 9530 | 10 | 75B, 75C, 75D, 80B, 80C, 80D, 85B, 85C, 85D, 90C |
| 9531 | 5 | 75A, 75B, 80A, 80B, 85A |
| 9532 | 3 | 80C, 85C, 90C |
| 9535 | 3 | 80C, 85C, 90C |
| 9536 | 10 | 75B, 75C, 80A, 80B, 80C, 85A, 85B, 85C, 90A, 90B |
| 5001 | 5 | 75A, 75B, 80A, 80B, 85A |
| 5002 | 5 | 75A, 75B, 80A, 80B, 85A |
| 5003 | 5 | 75A, 75B, 80A, 80B, 85A |
| 9050 | 7 | 75A, 75B, 80A, 80B, 85A, 85B, 90A |

Special review notes:

- Pensee 9517 has a mistyped source URL ending in `95167`, while the product name and description explicitly identify model 9517. Keep the identity warning in provenance.
- Pensee 9506, 9508, 9509, 9510 and 9529 contain punctuation errors inside the size list. The parsed tokens still match explicit size/cup text; no missing or invented combination was observed.
- Winking 9050 contains promotional prose immediately after the size list. Only the seven explicit size/cup tokens are retained.

## Blocked models

Seventeen models have no size/cup source after color-page consolidation. They may display product information and color metadata but ordering must remain disabled.

| Model | Website title colors | Source pages |
|---|---|---:|
| 9502 | Da, Đen, Đỏ đô, Tím, Trắng, Xanh đen | 6 |
| 9516 | Da, Đen, Tím, Trắng | 4 |
| 9059 | Trắng Hồng, Xanh ngọc, Xanh Trắng | 3 |
| 9091 | Đen, Xanh | 2 |
| 9093 | Da, Đen, Đỏ, Tím, Xanh | 7 |
| 9099 | Da, Đen, Đỏ, Tím, Trắng, Xám, Xanh dương, Xanh ngọc | 8 |
| 9100 | Cam, Da, Đỏ, Tím, Xanh đen | 5 |
| 9102 | Da, Đen, Đỏ, Nâu, Tím | 5 |
| 9103 | Da, Đen | 2 |
| 9104 | Đen, Tím | 2 |
| 9107 | Da, Đen, Xanh đen | 3 |
| 9108 | Da, Đen, Trắng, Xanh đen | 4 |
| 9109 | Da, Đen, Tím, Trắng | 4 |
| 9110 | Da, Đen, Đỏ, Nâu | 4 |
| 9111 | Da, Đen, Đỏ, Nâu | 4 |
| 9112 | Da, Đen, Đỏ, Nâu | 4 |
| 9114 | Da, Đen | 2 |

Do not infer their variants from sibling products, category norms, images or Cartesian combinations.

## Color findings

- 19 models expose 71 color labels through color-specific page titles.
- Colors are product-level display metadata only.
- Colors do not control the gallery.
- Colors do not participate in variant, cart or order identity.
- No image-to-color mapping is created.
- Swatches remain null unless separately confirmed.

Notable source labels that should remain human-readable:

- `Da đậm`, `Da Nhạt`
- `Đỏ đô`
- `Trắng Hồng`
- `Xanh Trắng`
- `Xanh đen`
- `Xanh dương`
- `Xanh ngọc`

## Price findings

The authoritative base price is present for all 49 canonical products.

Thirty-two product descriptions contain stale prices:

- 25 differ from the authoritative price by 100,000 VND.
- 4 differ by 90,000 VND.
- 2 differ by 80,000 VND.
- Winking 5002 differs by 120,000 VND.

Description prices must never populate server pricing.

Winking 9099 has especially unreliable website price data:

- correct/current evidence: 499,000 VND on some color pages;
- conflicting pages: 399,000 VND and 49,900 VND;
- three color pages have no web price.

The authoritative price remains 499,000 VND.

## Source taxonomy issues

Website breadcrumb/category metadata is not authoritative:

- Winking 5001 appears under multiple website categories.
- Winking 9109 has a purple color page categorized as `Quần lót` even though the product title is an áo ngực.
- Product identity must continue to come from product name evidence plus the authoritative price reference.

## Content findings

- 13 models have no usable description.
- 15 models have no feature candidates.
- Raw website prose includes hotline, sales copy and stale prices; it is retained as provenance only.
- App copy must be reviewed and reduced to one concise summary plus 3–5 factual features.
- Do not infer materials, padding, wire, support or other functions when source text is absent.

## Active catalog review command

Use the active price-authoritative local manifest:

```powershell
npm run catalog:web:review -- `
  ".\data\local\tuan-thuy-product-audit-2026-07-12.consolidated.json"
```

The command reads `data/local/catalog-manifest.json` by default and creates:

```text
data/local/tuan-thuy-product-audit-2026-07-12.consolidated.review-plan.json
```

The review plan reports:

- exact intersection with the 108 active products;
- active products without website evidence;
- website products outside the active catalog;
- active reviewed variant candidates;
- active blockers;
- active product-level color candidates.

It performs no database write and keeps `importReadyProductCount = 0` until explicit approval.

## Import gate

No schema migration, variant import, color import or order-code change may run until:

1. The active-catalog review plan has been generated from the real local manifest.
2. Variant candidates are explicitly approved.
3. Missing-size models remain blocked.
4. The target schema uses variant identity `product + size + cup`.
5. Color is removed from variant/cart identity.
6. Changes are confined to schema `japan_underwear`; schemas `public` and `vlgn` remain untouched.
7. Login remains stopped at gate #2.
