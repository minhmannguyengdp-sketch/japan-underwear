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

## Bước 2: lấy gallery và preview của đúng 30 mã

Lấy URL gallery:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

git pull --ff-only origin feat/catalog-price-management
Get-Content ".\scripts\browser-audit-missing-color-galleries.js" -Raw -Encoding UTF8 | Set-Clipboard
```

Lấy ảnh preview nhúng trực tiếp trong JSON:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

Get-Content ".\scripts\browser-export-missing-color-previews.js" -Raw -Encoding UTF8 | Set-Clipboard
```

Mở `https://tuanthuy.com.vn`, nhấn F12, chọn Console, dán và chạy từng script. Hai file kết quả:

- `tuan-thuy-missing-color-galleries-YYYY-MM-DD.json`;
- `tuan-thuy-missing-color-previews-YYYY-MM-DD.json`.

File ngày 2026-07-14 có đủ 30 mã, đủ 30 ảnh live và không lỗi. Không suy màu tự động từ tên file. Ảnh được xem trực tiếp và quyết định màu được lưu riêng để chủ catalog duyệt.

## Bước 3: quyết định màu đã review

File quyết định màu ngày 2026-07-14 phải có đúng:

- 30 mã;
- 30 màu;
- 0 mã chưa xử lý;
- mỗi màu có URL trang sản phẩm và URL ảnh live;
- mỗi màu có dấu `manual-live-image-review`;
- không dựa vào tên file ảnh để suy màu.

Kết quả review:

- 16 mã màu `Da`;
- 8 mã màu `Đỏ đô`;
- 2 mã màu `Đỏ`;
- 2 mã màu `Xanh đen`;
- 1 mã màu `Hồng`;
- 1 mã màu `Xanh rêu`.

Lưu file quyết định tại:

`data/local/tuan-thuy-missing-color-decisions-2026-07-14.json`

## Bước 4: tạo hồ sơ review khóa với 199 size/cup

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:image-review -- `
  ".\data\local\tuan-thuy-order-data.approved.json" `
  ".\data\local\tuan-thuy-missing-color-decisions-2026-07-14.json" `
  ".\data\local\tuan-thuy-missing-color-decisions-2026-07-14.review.json"
```

Chương trình dừng nếu:

- file size/cup không còn đúng 32 mã / 199 dòng;
- danh sách 30 mã màu lệch baseline;
- có mã trùng hoặc thiếu;
- thiếu URL trang, URL ảnh hoặc dấu review thủ công;
- số màu không đúng 30.

## Bước 5: chủ catalog duyệt màu

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:approve -- `
  ".\data\local\tuan-thuy-missing-color-decisions-2026-07-14.review.json" `
  --approve
```

File kết quả mặc định:

`tuan-thuy-missing-color-decisions-2026-07-14.review.approved.json`

Chương trình không cho duyệt khi còn mã chưa có màu, thiếu URL/bằng chứng hoặc không còn khóa đúng 199 size/cup.

## Bước 6: xem trước và nhập chỉ màu

Xem trước:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:import -- `
  ".\data\local\tuan-thuy-missing-color-decisions-2026-07-14.review.approved.json"
```

Khi kết quả xem trước đúng, mới ghi dữ liệu:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:import -- `
  ".\data\local\tuan-thuy-missing-color-decisions-2026-07-14.review.approved.json" `
  --apply
```

Importer này:

- chỉ thêm hoặc cập nhật `japan_underwear.product_colors`;
- không có câu lệnh cập nhật `product_variants`;
- đối chiếu chính xác toàn bộ 199 size/cup trước và sau giao dịch;
- lưu hash file nguồn vào `catalog_import_runs`;
- dừng nếu dữ liệu hiện tại khác với file đã duyệt;
- hậu kiểm cả 30 mã đã đủ điều kiện đặt hàng.

## Bước 7: kiểm tra toàn bộ hệ thống

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
- 30 mã vừa bổ sung màu chuyển từ “Chờ dữ liệu” sang “Đặt hàng”;
- tổng số mã đặt được tăng từ 2 lên 32;
- chọn màu + size/cup và thêm giỏ thành công;
- popup sửa sản phẩm hoạt động đúng;
- đơn cũ không thay đổi.

Không nhập PR vào `main` trước khi các bước trên đều đạt.
