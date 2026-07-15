# Hoàn tất màu cho catalog có size/cup

## Mục tiêu

Giữ nguyên bộ size/cup đã duyệt và chỉ bổ sung **toàn bộ màu đang bán** khi có bằng chứng đầy đủ.

Baseline:

- 32 mã có size/cup;
- 199 dòng size/cup;
- 2 mã đã có cả màu và size/cup;
- 30 mã còn thiếu bộ màu được duyệt.

Không tạo màu giả, không nhân màu × size × cup và không sửa dữ liệu đơn cũ.

## Quy tắc bằng chứng bắt buộc

Một ảnh sản phẩm chỉ chứng minh màu đang xuất hiện trong ảnh. Ảnh không chứng minh:

- sản phẩm chỉ có một màu;
- không còn màu khác đang bán;
- bộ màu đã thu thập là đầy đủ.

Vì vậy, review ảnh live có thể dùng để nhận diện từng màu nhìn thấy, nhưng không được dùng một mình để hoàn tất bộ màu.

Mỗi product chỉ được duyệt khi có thêm một trong các bằng chứng đầy đủ sau:

- danh sách màu công khai, rõ ràng trên website (`explicit-public-color-list`); hoặc
- danh sách màu do nhà cung cấp xác nhận (`supplier-confirmed-color-list`).

Bằng chứng phải có nội dung và URL/tệp nguồn truy xuất được.

## Trạng thái dữ liệu ngày 2026-07-14

Đã thu thập:

- 30/30 trang sản phẩm;
- 30/30 ảnh preview live;
- 0 lỗi tải;
- mỗi mã chỉ có một ảnh đại diện được tìm thấy.

Các ảnh này cho phép ghi nhận 30 **màu quan sát được**, nhưng chưa chứng minh đó là toàn bộ màu của 30 mã.

Do đó các file sau là bằng chứng quan sát, **không phải manifest màu hoàn chỉnh**:

- `tuan-thuy-missing-color-decisions-2026-07-14.json`;
- `tuan-thuy-missing-color-decisions-2026-07-14.review.json`;
- `tuan-thuy-missing-color-decisions-2026-07-14.review.approved.json`.

Không được dùng các file này với `--apply`.

## Cơ chế chặn trong code

Ba lệnh chính thức đều đi qua lớp kiểm chứng bộ màu đầy đủ:

- `catalog:web:color:image-review`;
- `catalog:web:color:approve`;
- `catalog:web:color:import`.

Lớp kiểm chứng yêu cầu:

- `observedImagesAloneDoNotProveCompleteness: true`;
- `colorSetCompletenessVerified: true`;
- đúng 30 product có `colorSetComplete: true`;
- mỗi product có loại, nội dung và URL bằng chứng bộ màu đầy đủ.

Manifest cũ chỉ có ảnh đại diện sẽ bị từ chối trước khi duyệt hoặc ghi PostgreSQL.

## Dữ liệu cần lấy tiếp

Với từng mã trong 30 mã mục tiêu, cần một danh sách màu đầy đủ từ một trong các nguồn:

1. Website Tuấn Thủy hiển thị lựa chọn màu hoặc mô tả màu đầy đủ.
2. Catalog/bảng giá/tệp do Tuấn Thủy cung cấp.
3. Tin nhắn hoặc văn bản xác nhận từ nhà cung cấp, có thể lưu làm bằng chứng nội bộ.

Mỗi dòng cần có:

- `brand + category + model`;
- tên và mã màu chuẩn hóa;
- nguồn chứng minh danh sách đầy đủ;
- ảnh minh họa cho từng màu khi có.

## Luồng nhập sau khi đủ bằng chứng

Tạo hồ sơ review:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:image-review -- `
  ".\data\local\tuan-thuy-product-audit-2026-07-12.consolidated.review-plan.approved.json" `
  ".\data\local\tuan-thuy-complete-color-decisions.json" `
  ".\data\local\tuan-thuy-complete-color-decisions.review.json"
```

Duyệt:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:approve -- `
  ".\data\local\tuan-thuy-complete-color-decisions.review.json" `
  --approve
```

Chạy thử importer:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:web:color:import -- `
  ".\data\local\tuan-thuy-complete-color-decisions.review.approved.json"
```

Chỉ chạy `--apply` sau khi review chứng minh đầy đủ toàn bộ màu cho cả 30 mã.

Importer vẫn phải:

- chỉ ghi `japan_underwear.product_colors`;
- không cập nhật `product_variants`;
- đối chiếu chính xác 199 size/cup trước và sau giao dịch;
- rollback khi có sai lệch;
- không thay đổi đơn hàng lịch sử.

Không nhập PR vào `main` trước khi có dữ liệu màu đầy đủ, CI xanh và smoke test thật đạt.
