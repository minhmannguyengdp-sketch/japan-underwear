# Hoàn tất màu cho các mã đã có size/cup

## Mục tiêu

Catalog hiện đã có 199 lựa chọn size/cup được duyệt trên 32 mã. Chỉ 2 mã trong số đó đã có màu, nên còn đúng 30 mã chưa thể đặt hàng.

Luồng này bổ sung màu cho 30 mã còn thiếu mà không chạy lại, không xóa và không cập nhật bảng size/cup.

## Nguyên tắc bắt buộc

- Giữ nguyên 199 size/cup đã duyệt.
- Chỉ nhận màu nhìn thấy hoặc được ghi rõ trên trang sản phẩm thật của `tuanthuy.com.vn`.
- Mỗi màu phải có URL và loại bằng chứng đi kèm.
- Không đoán màu từ tên file ảnh.
- Không tạo phép nhân màu × size × cup.
- File audit và file duyệt nằm trong `data/local/`, không đưa dữ liệu tạm lên GitHub.
- Chỉ ghi vào schema PostgreSQL `japan_underwear`.

## Bước 1: lấy màu từ website gốc

Mở `tuanthuy.com.vn` bằng Chrome hoặc Edge. Nhấn F12, chọn **Console**, dán toàn bộ nội dung file:

`scripts/browser-audit-product-colors.js`

Script chỉ đọc dữ liệu công khai trên website và tải xuống file:

`tuan-thuy-color-audit-YYYY-MM-DD.json`

Chép file vừa tải vào `data/local/`.

## Bước 2: tạo danh sách 30 mã cần duyệt

Dùng file approval cũ đã chứa đúng 199 size/cup và file màu mới:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:review -- `
  ".\data\local\tuan-thuy-product-audit-2026-07-12.consolidated.review-plan.approved.json" `
  ".\data\local\tuan-thuy-color-audit-YYYY-MM-DD.json"
```

Kết quả phải báo:

- 32 mã và 199 size/cup được giữ nguyên;
- 30 mã đang thiếu màu;
- không còn mã màu chưa xác định trước khi duyệt.

Nếu còn `Unresolved products`, dừng lại và mở trực tiếp các URL trong file review để đối chiếu. Không được tự điền đại.

## Bước 3: duyệt màu

Chỉ chạy khi đủ màu thật cho cả 30 mã:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:approve -- `
  ".\data\local\tuan-thuy-color-audit-YYYY-MM-DD.review.json" `
  --approve
```

Lệnh duyệt sẽ từ chối nếu:

- thiếu một trong 30 mã;
- màu không có URL bằng chứng;
- mã màu bị trùng;
- file không còn liên kết với đúng 199 size/cup cũ.

## Bước 4: xem trước rồi nhập chỉ màu

Chạy thử trước, chưa ghi dữ liệu:

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
- kiểm tra cả 30 mã vẫn còn size/cup active;
- lưu hash file nguồn vào `catalog_import_runs`;
- dừng nếu dữ liệu hiện tại khác với file đã duyệt;
- hậu kiểm cả 30 mã đã đủ điều kiện đặt hàng.

## Bước 5: kiểm tra toàn bộ hệ thống

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
- đơn cũ không thay đổi.

Không nhập PR vào `main` trước khi các bước trên đều đạt.
