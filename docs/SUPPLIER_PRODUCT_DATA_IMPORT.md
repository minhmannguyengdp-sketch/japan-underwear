# Nhập màu và mô tả sản phẩm Tuấn Thủy

## Hai nguồn dữ liệu tách biệt

Quy trình dùng hai nguồn có phạm vi rõ ràng, không trộn bằng chứng:

1. `BẢNG MÔ TẢ SẢN PHẨM1.xlsx`
   - SHA-256: `2b1a73b4ce4b71a27e72949d6b90a24e0a0936ad05173a75bd86bbcd619f11bf`;
   - 71 mẫu áo ngực trong phạm vi app;
   - 320 màu được liệt kê theo từng dòng;
   - 71 mô tả rút gọn từ nội dung nhà cung cấp;
   - 11 mẫu đầm ngủ ngoài phạm vi catalog hiện tại.
2. Xác nhận trực tiếp của chủ catalog ngày 2026-07-15
   - 5002: Da, Đen, Tím;
   - 5003: Da, Đen;
   - 9512: Da, Xanh, Đỏ, Tím, Đen;
   - 9536: Da, Đen;
   - tổng 4 mẫu / 12 màu;
   - không có nguồn mô tả nên không cập nhật `short_description` cho bốn mã này.

Sau khi ghép đúng nguồn, baseline 30 mã áo ngực có size/cup nhưng thiếu màu được phủ đủ 30/30. Tổng dữ liệu màu dùng cho hai luồng là 332 màu: 320 từ Excel và 12 từ xác nhận của chủ catalog.

## Quy tắc mô tả trong app

`short_description` chỉ giữ các ý chính:

- chất liệu;
- có gọng/không gọng và kiểu cúp;
- loại đệm/mút;
- đặc điểm bản lưng hoặc dây vai.

Bỏ nội dung quảng cáo dài, câu lặp và lời kêu gọi mua hàng.

## Quy tắc bảo toàn

- Chỉ dùng schema PostgreSQL `japan_underwear`.
- Không tạo sản phẩm mới từ Excel hoặc xác nhận màu.
- Không cập nhật giá.
- Không cập nhật `product_variants`.
- Import Excel chỉ cập nhật màu và `short_description` của sản phẩm khớp catalog active.
- Import bổ sung của chủ catalog chỉ cập nhật màu của đúng bốn mã; tuyệt đối không cập nhật mô tả.
- Bốn mã bổ sung được khóa cứng đúng identity và đúng tổng 12 màu.
- Nếu PostgreSQL có màu active ngoài bộ màu đầy đủ của supplier, importer dừng để review.
- Màu ngoài supplier chỉ được chuyển sang `inactive` qua manifest reconciliation đã duyệt; không xóa bản ghi.
- Manifest reconciliation khóa SHA-256 của supplier manifest và conflict audit.
- Snapshot toàn bộ variant được so sánh trước và sau mỗi transaction.

## File local

Lưu các file sau trong `data/local/`:

- `BẢNG MÔ TẢ SẢN PHẨM1.xlsx`
- `tuan-thuy-supplier-product-data-2026-07-15.json`
- `tuan-thuy-owner-color-supplement-2026-07-15.json`
- `tuan-thuy-supplier-color-conflicts.json` — sinh từ PostgreSQL, chỉ đọc.

## 1. Xác minh nguồn Excel

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:validate -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx" `
  --validate-only
```

## 2. Dry run nguồn Excel

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:import -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx"
```

Nếu có màu active ngoài danh sách supplier, importer dừng. Không chạy `--apply`.

## 3. Audit xung đột màu

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:conflicts -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\tuan-thuy-supplier-color-conflicts.json"
```

Baseline audit ngày 2026-07-15:

- 57 supplier products khớp catalog active;
- 7 sản phẩm có màu active ngoài supplier;
- 10 màu cần chuyển `inactive`;
- 175 màu supplier còn thiếu trong PostgreSQL.

## 4. Tạo review reconciliation

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:reconcile:build -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\tuan-thuy-supplier-color-conflicts.json" `
  ".\data\local\tuan-thuy-supplier-color-reconciliation.review.json"
```

Review phải ghi đúng 7 sản phẩm / 10 màu. Chưa ghi PostgreSQL.

## 5. Chủ catalog duyệt reconciliation

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:reconcile:approve -- `
  ".\data\local\tuan-thuy-supplier-color-reconciliation.review.json" `
  --approve
```

File mặc định:

`data/local/tuan-thuy-supplier-color-reconciliation.review.approved.json`

## 6. Validate và dry run reconciliation

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:reconcile:import -- `
  ".\data\local\tuan-thuy-supplier-color-reconciliation.review.approved.json" `
  --validate-only

npm run catalog:supplier:reconcile:import -- `
  ".\data\local\tuan-thuy-supplier-color-reconciliation.review.approved.json"
```

Dry run phải xác nhận đúng 10 màu active hiện tại khớp manifest đã duyệt.

## 7. Apply reconciliation

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:reconcile:import -- `
  ".\data\local\tuan-thuy-supplier-color-reconciliation.review.approved.json" `
  --apply
```

Transaction này chỉ đặt `product_colors.is_active=false` cho đúng 10 màu. Không xóa bản ghi và không thay đổi sản phẩm, mô tả, giá hoặc variant.

## 8. Chạy lại supplier dry run và apply

Sau reconciliation, supplier dry run phải báo `Unexpected active colors: 0`.

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:import -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx"

npm run catalog:supplier:import -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx" `
  --apply
```

## 9. Xác minh, dry run và apply bổ sung bốn mã

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:owner-color:validate -- `
  ".\data\local\tuan-thuy-owner-color-supplement-2026-07-15.json" `
  --validate-only

npm run catalog:owner-color:import -- `
  ".\data\local\tuan-thuy-owner-color-supplement-2026-07-15.json"

npm run catalog:owner-color:import -- `
  ".\data\local\tuan-thuy-owner-color-supplement-2026-07-15.json" `
  --apply
```

Nếu supplier apply thất bại thì dừng, không chạy bổ sung bốn mã.

## 10. Hậu kiểm

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run db:verify
npm run lint
npm run build
npm run dev
```

Kiểm tra thật:

- 108 model không đổi;
- 199 size/cup không đổi;
- 30 mã mục tiêu có màu đầy đủ;
- 10 màu cũ ngoài supplier không còn active nhưng bản ghi vẫn tồn tại;
- mô tả rút gọn chỉ xuất hiện ở 71 mẫu có nguồn Excel;
- bốn mã bổ sung không bị ghi mô tả giả;
- chọn màu + size/cup và thêm giỏ thành công;
- đơn cũ không thay đổi.
