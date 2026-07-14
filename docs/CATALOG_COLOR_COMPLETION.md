# Hoàn tất màu cho catalog có size/cup

## Mục tiêu

Giữ nguyên bộ size/cup đã duyệt và chỉ bổ sung màu có bằng chứng thật.

Baseline đã duyệt:

- 32 mã có size/cup;
- 199 dòng size/cup;
- 2 mã đã có cả màu và size/cup;
- 30 mã còn thiếu màu.

Không tạo màu giả, không nhân màu × size × cup, không sửa dữ liệu đơn cũ.

## Lỗi bảng mã đã phát hiện

Windows PowerShell 5.1 có thể đọc file JavaScript UTF-8 không BOM bằng bảng mã cũ nếu bỏ qua `-Encoding UTF8`. Khi đó ký tự `đ/Đ` trong bộ nhận màu bị hỏng và các màu như `Đen`, `Đỏ`, `Đỏ đô`, `Xanh đen`, `Da đậm` bị bỏ sót.

Mọi lệnh chép script sang clipboard phải ghi rõ `-Encoding UTF8`.

## Bước 1: quét màu công khai trên toàn website

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

git pull --ff-only origin feat/catalog-price-management
Get-Content ".\scripts\browser-audit-product-colors.js" -Raw -Encoding UTF8 | Set-Clipboard
```

Mở `https://tuanthuy.com.vn`, nhấn F12, chọn Console, dán và chạy. Trình duyệt tải file:

`tuan-thuy-color-audit-YYYY-MM-DD.json`

File quét ngày 2026-07-14 cho thấy:

- 104 trang sản phẩm;
- 24 trang danh mục;
- 0 lỗi;
- 0 trang sai identity;
- 44 màu được nhận ban đầu;
- 28 màu tên có `đ/Đ` bị bỏ sót do bảng mã clipboard;
- sau khi sửa từ chính tên trang: 72 màu công khai.

Các màu công khai này không nằm trên 30 mã đang có size/cup nhưng thiếu màu, nên không đủ để mở thêm mã đặt hàng.

## Bước 2: lấy gallery của đúng 30 mã còn thiếu màu

Dùng script ASCII-safe, không phụ thuộc bảng mã PowerShell:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

git pull --ff-only origin feat/catalog-price-management
Get-Content ".\scripts\browser-audit-missing-color-galleries.js" -Raw -Encoding UTF8 | Set-Clipboard
```

Mở `https://tuanthuy.com.vn`, nhấn F12, chọn Console, dán và chạy. Script chỉ đọc đúng 30 trang cần xử lý và tải file:

`tuan-thuy-missing-color-galleries-YYYY-MM-DD.json`

File chứa URL trang nguồn và URL ảnh gallery để review bằng hình ảnh. Không suy màu từ tên file.

## Bước 3: tạo danh sách review màu

Sau khi có file audit màu đã được review thành màu có bằng chứng thật:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:review -- `
  ".\data\local\tuan-thuy-order-data.approved.json" `
  ".\data\local\tuan-thuy-color-audit-YYYY-MM-DD.json"
```

Review phải còn đúng:

- 32 mã có size/cup;
- 199 size/cup;
- 30 mã mục tiêu thiếu màu;
- không có mã unresolved trước khi duyệt.

## Bước 4: duyệt màu

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:approve -- `
  ".\data\local\tuan-thuy-color-audit-YYYY-MM-DD.review.json" `
  --approve-all-reviewed
```

Chương trình không cho duyệt khi còn mã chưa có màu hoặc thiếu URL/bằng chứng.

## Bước 5: xem trước và nhập chỉ màu

Xem trước:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:import -- `
  ".\data\local\tuan-thuy-color-audit-YYYY-MM-DD.review.approved.json"
```

Khi kết quả xem trước đúng, mới ghi dữ liệu:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:import -- `
  ".\data\local\tuan-thuy-color-audit-YYYY-MM-DD.review.approved.json" `
  --apply
```

Importer này:

- chỉ thêm hoặc cập nhật `japan_underwear.product_colors`;
- không có câu lệnh cập nhật `product_variants`;
- đối chiếu chính xác toàn bộ 199 size/cup trước và sau giao dịch;
- lưu hash file nguồn vào `catalog_import_runs`;
- dừng nếu dữ liệu hiện tại khác với file đã duyệt;
- hậu kiểm cả 30 mã đã đủ điều kiện đặt hàng.

## Bước 6: kiểm tra toàn bộ hệ thống

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run db:verify
npm run lint
npm run build
npm run dev
```

Mở `http://localhost:3100` và kiểm tra:

- tổng số model vẫn là 108;
- 199 size/cup không đổi;
- mã có màu được duyệt chuyển từ “Chờ dữ liệu” sang “Đặt hàng”;
- chọn màu + size/cup và thêm giỏ thành công;
- đơn cũ không thay đổi.

Không nhập PR vào `main` trước khi các bước trên đều đạt.
