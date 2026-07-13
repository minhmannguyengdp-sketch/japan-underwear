# First product web audit — 2026-07-12

## Input

File audit generated from `https://tuanthuy.com.vn` on 2026-07-12.

The first run is evidence for improving the scraper, but it is **not import-ready**.

## Findings

### Crawl scope was wrong

The output contained one product while `sourceUrl` was the site root and `sourceKey` was empty. The home page exposed product JSON-LD for Winking 5002, and the old scraper incorrectly treated that as proof that the home page itself was a product page.

Required fix:

- Start from the current page instead of always forcing the site root.
- Require product-page markers such as `single-product`, a cart form, product title and product summary.
- Do not classify a listing or home page as a product page only because it contains a `Product` JSON-LD object.

### Winking 5002 identity

Observed values:

- Product candidate: `winking + ao-nguc + 5002`
- Web name: `Áo ngực Winking 5002`
- Web category breadcrumb: `Sản phẩm > Áo ngực > Mút mỏng`
- Current web price: `449000 VND`
- Colors published by the page: none

The missing color list is valid and is not an ordering blocker.

### Size/cup evidence is inside the description

The page did not expose orderable variation controls in the first scrape. Its description explicitly included:

- `75A`
- `80A`
- `85A`
- `75B`
- `80B`

These are size/cup candidates with evidence type `description-explicit-size-cup-list`.

They should produce candidate variant identities:

- `75::A`
- `80::A`
- `85::A`
- `75::B`
- `80::B`

Because the evidence comes from free-form description text rather than current variation controls, the audit must add `variants-derived-from-description` for review before import.

### Description price is stale

The description still says `329000 VND`, while the current page data and the authoritative price reference say `449000 VND`.

Rules confirmed:

- Never use a price parsed from product prose as the server price.
- Current page structured price is audit evidence only.
- The authoritative price list remains the source used for catalog and order pricing.
- Record `description-price-conflicts-current-price` when prose and current structured price differ.

### Image extraction was too broad

The first output included:

- The site root as if it were an image.
- Multiple WordPress thumbnail derivatives of the same image.
- An unrelated image containing model `9516`.

Required fix:

- Read only product-gallery and structured product images.
- Accept only actual image extensions.
- Collapse WordPress size derivatives.
- Exclude image filenames that explicitly contain a different product model.

## Concise app content candidate for model 5002

Short description candidate:

> Áo ngực mút mỏng 1,5 cm, có gọng và bản lưng to, hỗ trợ nâng đỡ và tạo phom vòng một.

Feature candidates:

- Cotton phối ren mềm mịn.
- Mút mỏng nhẹ, độ dày khoảng 1,5 cm.
- Thiết kế có gọng, cúp chéo và bản lưng to.
- Dây áo điều chỉnh linh hoạt, có thể tháo rời.

This content is still reviewable app copy. It is not imported automatically from the raw website prose.

## Acceptance criteria for the next run

For Winking 5002, the new audit should return:

- A canonical product URL, not `https://tuanthuy.com.vn/`.
- A non-empty `sourceKey`.
- `modelCandidates: ["5002"]`.
- Five size/cup variants from the explicit description list.
- `variantSource: "description-explicit-list"`.
- Review flags for description-derived variants and stale description price.
- No site-root image and no image explicitly belonging to model `9516`.
- Non-empty concise `featureCandidates`.

No database migration or variant import should run until a broader crawl is reviewed and active-product identity mapping has zero ambiguity.
