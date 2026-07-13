# Catalog pipeline: local images → R2 → PostgreSQL → UI

## Nguyên tắc nghiệp vụ đã chốt

- Khóa sản phẩm: `brand + category + model`.
- Gallery là gallery chung của model; chọn màu không đổi ảnh.
- Màu thuộc sản phẩm và là lựa chọn bắt buộc của từng dòng đặt hàng.
- Variant lưu trong DB theo `product + size + cup`; không chứa `color_id`.
- Cart/order row lưu `product_variant_id + color_id + quantity`.
- Unique selection của cart là `cart_id + product_variant_id + color_id`; thêm lại cùng selection sẽ cộng quantity.
- Unique selection của order là `order_id + product_variant_id + color_id`.
- Không tạo sẵn phép nhân màu × size × cup trong `product_variants`.
- Không tự map ảnh theo màu và không suy diễn màu/size/cup từ tên ảnh.
- Product chỉ được mở đặt hàng khi có cả màu thật và tổ hợp size/cup thật.
- Giá bảng giá nội bộ là nguồn authoritative; giá website chỉ dùng làm bằng chứng audit.
- Checkout đọc lại giá hiện hành từ PostgreSQL rồi snapshot vào `order_items`.
- Login tiếp tục bị chặn tại stop gate #2; giỏ hiện tại là guest cart bằng cookie HttpOnly.
- Local dùng port 3100, không dùng port 3000.

## Trạng thái catalog hiện tại

- 108 model active.
- 996 ảnh duy nhất sau SHA-256 dedupe.
- 199 variant size/cup đã duyệt trên 32 product.
- 66 product-color rows trên 17 product.
- 2 product hiện có đủ cả màu và size/cup để đặt hàng.

Các model thiếu màu hoặc thiếu size/cup vẫn hiển thị nhưng bị khóa đặt hàng.

## Cấu trúc dữ liệu

```text
products                 # một model gốc
product_colors           # màu có thể chọn của model
product_variants         # size + cup; không gắn màu
product_images           # gallery chung; color_id vẫn nullable cho tương lai
carts                    # guest cart, token UUID, trạng thái active/converted
cart_items               # variant + color + quantity + price snapshot
orders                   # đơn đã submit từ đúng một cart
order_items               # snapshot product/color/size/cup/price của từng dòng
catalog_import_runs      # log import/idempotency
```

Database trigger bắt buộc `product_variant_id` và `color_id` cùng thuộc một product. Trigger áp dụng cho cả `cart_items` và `order_items`.

## Local catalog

```powershell
Set-Location "F:\1_A_Disk_D\TT\japan-underwear"
git pull --ff-only origin feat/catalog-variant-ordering-ui
npm install
npm run catalog:manifest
npm run catalog:r2:upload -- --apply --concurrency=4
npm run catalog:db:import -- --apply
```

Các file local nằm trong `data/local/` và không commit.

## Audit website Tuấn Thủy

```powershell
npm run catalog:web:audit -- ".\data\local\tuan-thuy-product-audit-2026-07-12.json"
npm run catalog:web:review -- ".\data\local\tuan-thuy-product-audit-2026-07-12.consolidated.json"
```

Review plan v2 phân biệt rõ:

- model có size/cup nhưng thiếu màu;
- model có màu nhưng thiếu size/cup;
- model có cả hai và có thể mở đặt hàng;
- model website nằm ngoài catalog active.

## Approval và import order data

Approval chỉ sinh file local, không ghi DB:

```powershell
npm run catalog:web:approve -- `
  ".\data\local\tuan-thuy-product-audit-2026-07-12.consolidated.review-plan.json" `
  --approve `
  --accept-9517-url-typo
```

Dry-run import:

```powershell
npm run catalog:web:import -- `
  ".\data\local\tuan-thuy-product-audit-2026-07-12.consolidated.review-plan.approved.json"
```

Apply chỉ sau khi migration và verify thành công:

```powershell
npm run db:migrate
npm run db:verify
npm run catalog:web:import -- `
  ".\data\local\tuan-thuy-product-audit-2026-07-12.consolidated.review-plan.approved.json" `
  --apply
```

Importer đồng bộ chính xác 199 variant và 66 màu đã duyệt, không nhập 9059/9091, không tạo màu giả, không tạo Cartesian rows, và hậu kiểm số model có đủ cả màu lẫn size/cup.

## Server cart và orders

Guest cart dùng cookie `tt_cart`:

- UUID ngẫu nhiên;
- `HttpOnly`;
- `SameSite=Lax`;
- `Secure` ở production;
- lifetime 30 ngày.

API:

```text
GET    /api/cart
POST   /api/cart/items
PATCH  /api/cart/items/:itemId
DELETE /api/cart/items/:itemId
POST   /api/orders
```

`POST /api/orders` chạy trong một transaction:

1. khóa cart active;
2. khóa các cart item;
3. kiểm tra product, variant và color còn active;
4. kiểm tra variant và color cùng product;
5. đọc lại giá hiện hành;
6. tạo order và snapshot order items;
7. chuyển cart sang `converted` để không submit lặp.

Chi tiết và smoke test nằm ở `docs/SERVER_CART_ORDERS.md`.

## Giao diện

UI hiển thị ba control trên cùng một dòng:

```text
Màu | Size/Cup | Số lượng
```

Hai dòng `Da · 80B` và `Xanh · 80B` luôn tách biệt. Thêm lại đúng cùng màu và size/cup sẽ cộng quantity trên dòng hiện có. Reload trang vẫn giữ giỏ vì dữ liệu nằm ở server. Gallery không thay đổi khi chọn màu.

## Gate chạy local

```powershell
git pull --ff-only origin feat/catalog-variant-ordering-ui
npm run db:migrate
npm run db:verify
npm run lint
npm run build
npm run dev
```

Không thay đổi schema `public` hoặc `vlgn`; mọi table, function, trigger và constraint của dự án chỉ nằm trong `japan_underwear`.
