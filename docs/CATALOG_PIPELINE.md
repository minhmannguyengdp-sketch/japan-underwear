# Catalog pipeline: local images → R2 → PostgreSQL → UI

## Nguyên tắc nghiệp vụ đã chốt

- Khóa sản phẩm: `brand + category + model`.
- Gallery là gallery chung của model; chọn màu không đổi ảnh.
- Màu thuộc sản phẩm và là lựa chọn bắt buộc của từng dòng đặt hàng.
- Variant lưu trong DB theo `product + size + cup`; không chứa `color_id`.
- Khóa một dòng giỏ/đơn: `product + color + size + cup`.
- Không tạo sẵn phép nhân màu × size × cup trong `product_variants`.
- Không tự map ảnh theo màu và không suy diễn màu/size/cup từ tên ảnh.
- Product chỉ được mở đặt hàng khi có cả màu thật và tổ hợp size/cup thật.
- Giá bảng giá nội bộ là nguồn authoritative; giá website chỉ dùng làm bằng chứng audit.
- Login tiếp tục bị chặn tại stop gate #2.
- Local dùng port 3100, không dùng port 3000.

## Cấu trúc dữ liệu

```text
products                 # một model gốc
product_colors           # màu có thể chọn của model
product_variants         # size + cup; không gắn màu
product_images           # gallery chung; color_id vẫn nullable cho tương lai
catalog_import_runs      # log import/idempotency
```

Dòng đặt hàng được ghép tại cart/order layer:

```text
product_id + color_id + product_variant_id + quantity
```

`product_variant_id` đại diện cho `size_code + cup_code`. Cart phải xác minh màu và variant cùng thuộc một product.

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

## Giao diện

API trả màu và variant thành hai danh sách độc lập. UI hiển thị hai select trên cùng một dòng:

```text
Màu | Size/Cup | Số lượng
```

Cart key là tổ hợp `product + color + variant`, nên hai dòng `Da · 80B` và `Xanh · 80B` luôn tách biệt. Gallery không thay đổi khi chọn màu.
