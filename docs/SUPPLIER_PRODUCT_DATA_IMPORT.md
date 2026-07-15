# Nhập dữ liệu supplier Tuấn Thủy

## Nguồn và phạm vi

File `BẢNG MÔ TẢ SẢN PHẨM1.xlsx` được khóa bằng SHA-256:

`2b1a73b4ce4b71a27e72949d6b90a24e0a0936ad05173a75bd86bbcd619f11bf`

Nguồn này cung cấp:

- 71 mẫu áo ngực trong phạm vi app;
- 320 dòng màu;
- 71 mô tả rút gọn;
- 1.837 quan hệ màu–size/cup chính xác;
- 412 variant identity theo sản phẩm;
- 30/30 mã áo ngực đang có màu nhưng thiếu size/cup được phủ nguồn;
- 11 mẫu đầm ngủ ngoài phạm vi app.

Xác nhận riêng của chủ catalog ngày 2026-07-15 cung cấp 12 màu cho bốn mã `5002`, `5003`, `9512`, `9536`. Xác nhận này không có size/cup theo màu và không có mô tả, nên không được dùng để tự sinh quan hệ màu–size/cup.

## Logic đặt hàng

Một sản phẩm chỉ đặt được khi tồn tại ít nhất một dòng active trong:

`japan_underwear.product_color_variants`

Mỗi dòng liên kết đúng:

- một sản phẩm;
- một màu của sản phẩm đó;
- một variant size/cup của chính sản phẩm đó.

Không dùng tích Descartes giữa toàn bộ màu và toàn bộ size/cup. Giao diện chỉ hiện size/cup hợp lệ sau khi chọn màu. Database trigger chặn cặp sai ở cả `cart_items` và `order_items`, kể cả khi gọi API trực tiếp.

Bảy mã có bộ size thay đổi theo màu trong nguồn hiện tại:

`9501`, `9502`, `9504`, `9510`, `9515`, `9517`, `9525`.

Mã Winking `9100` có ô nguồn `75A,80A,85A70B,75B,80B`. Manifest ghi rõ correction thành `75A, 80A, 85A, 70B, 75B, 80B` vì hai token `85A` và `70B` bị thiếu dấu phẩy.

## Quy tắc bảo toàn

- Chỉ dùng schema `japan_underwear`.
- Không tạo sản phẩm hoặc màu mới trong importer màu–size/cup.
- Không cập nhật giá, mô tả hoặc dữ liệu đơn lịch sử.
- Chỉ tạo/reactivate `product_variants` có trong hợp size/cup của Excel.
- Chỉ tạo quan hệ màu–size/cup có trong đúng dòng màu của Excel.
- Nếu DB có variant active ngoài hợp đầy đủ của Excel, importer dừng để review.
- Nếu DB có quan hệ active ngoài Excel, importer dừng để review.
- Product, color, price và lịch sử đơn được hash trước–sau transaction.
- Mọi import được ghi trong `japan_underwear.catalog_import_runs`.

## File local

Lưu trong `data/local/`:

- `BẢNG MÔ TẢ SẢN PHẨM1.xlsx`
- `tuan-thuy-supplier-product-data-2026-07-15.json`
- `tuan-thuy-owner-color-supplement-2026-07-15.json`
- `tuan-thuy-supplier-color-variants-2026-07-15.json`

## Quy trình màu và mô tả

Luồng màu/mô tả và reconciliation đã chạy riêng trước luồng size/cup. Các lệnh chính:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:validate -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx" `
  --validate-only

npm run catalog:supplier:import -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx"
```

Nếu có màu active ngoài supplier, dùng audit và reconciliation đã duyệt; không tự xóa màu. Supplier apply chỉ chạy khi dry run báo `Unexpected active colors: 0`.

## Quy trình quan hệ màu–size/cup

### 1. Migration

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run db:migrate
```

Migration `0013_color_variant_availability` tạo bảng quan hệ và trigger bảo vệ giỏ/đơn.

### 2. Validate manifest

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:variants:validate -- `
  ".\data\local\tuan-thuy-supplier-color-variants-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx" `
  --validate-only
```

Kết quả nguồn chuẩn phải có:

- 71 supplier bras;
- 320 màu;
- 1.837 quan hệ màu–size/cup;
- 412 variant identity;
- 7 sản phẩm có size thay đổi theo màu;
- baseline 30 thiếu size/cup: có nguồn 30, còn thiếu 0.

### 3. Dry run PostgreSQL

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:variants:import -- `
  ".\data\local\tuan-thuy-supplier-color-variants-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx"
```

Chỉ apply khi cả hai số đều bằng 0:

- `Unexpected active variants`
- `Unexpected active mappings`

### 4. Apply

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:variants:import -- `
  ".\data\local\tuan-thuy-supplier-color-variants-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx" `
  --apply
```

Nguồn hiện tại khớp 57 mẫu áo ngực active. Sau import, 57 mẫu này có thể đặt theo đúng cặp màu–size/cup. Năm mã áo ngực active `5001`, `5002`, `5003`, `9512`, `9536` không có dữ liệu kích cỡ theo từng màu trong Excel nên vẫn bị khóa quan hệ, không được mở sáng bằng nhân chéo.

## Hậu kiểm

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run db:verify
if ($LASTEXITCODE -ne 0) { throw "db:verify thất bại." }

npm run lint
if ($LASTEXITCODE -ne 0) { throw "lint thất bại." }

npm run build
if ($LASTEXITCODE -ne 0) { throw "build thất bại." }
```

Smoke test bắt buộc:

- chọn từng màu và xác nhận dropdown chỉ hiện size/cup của màu đó;
- mã có size khác theo màu không cho chọn cặp ngoài Excel;
- API giỏ trả `409 invalid_color_variant_selection` với cặp sai;
- checkout khách và tạo đơn tay dùng chung quy tắc;
- đơn cũ và snapshot giá không thay đổi;
- 43 mã quần và 3 áo ngực `9079`, `9120`, `9121` vẫn chờ dữ liệu thật;
- PR giữ draft cho tới khi local migration, import và smoke test đạt.
