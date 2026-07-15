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

Sau khi ghép theo đúng nguồn, baseline 30 mã áo ngực có size/cup nhưng thiếu màu được phủ đủ 30/30.

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
- Nếu PostgreSQL có màu active ngoài bộ màu đầy đủ của nguồn tương ứng, importer dừng để review và không tự xóa.
- Snapshot toàn bộ variant được so sánh trước và sau transaction.

## File local

Lưu ba file sau trong `data/local/`:

- `BẢNG MÔ TẢ SẢN PHẨM1.xlsx`
- `tuan-thuy-supplier-product-data-2026-07-15.json`
- `tuan-thuy-owner-color-supplement-2026-07-15.json`

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

## 3. Xác minh bổ sung bốn mã

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:owner-color:validate -- `
  ".\data\local\tuan-thuy-owner-color-supplement-2026-07-15.json" `
  --validate-only
```

## 4. Dry run bổ sung bốn mã

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:owner-color:import -- `
  ".\data\local\tuan-thuy-owner-color-supplement-2026-07-15.json"
```

Cả hai dry run phải báo không có màu active ngoài danh sách nguồn.

## 5. Apply theo thứ tự nguồn

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:import -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx" `
  --apply

npm run catalog:owner-color:import -- `
  ".\data\local\tuan-thuy-owner-color-supplement-2026-07-15.json" `
  --apply
```

## 6. Hậu kiểm

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
- mô tả rút gọn chỉ xuất hiện ở 71 mẫu có nguồn Excel;
- bốn mã bổ sung không bị ghi mô tả giả;
- chọn màu + size/cup và thêm giỏ thành công;
- đơn cũ không thay đổi.
