# Catalog pipeline: local images → manifest → R2 → PostgreSQL → UI

## Nguyên tắc đã chốt

- Một model sản phẩm có gallery ảnh chung.
- Màu là metadata cấp sản phẩm để hiển thị tham khảo; không click, không đổi gallery và không tham gia khóa giỏ hàng.
- Khách chỉ chọn `size + cup + số lượng`; với sản phẩm không có cup thì chọn `size + số lượng`.
- Không tạo tích Descartes `màu × size × cup`.
- Ảnh local không nằm trong repository và không được commit.
- Slug chỉ dùng cho URL; khóa nghiệp vụ sản phẩm là `brand + category + model`.
- Login tiếp tục bị chặn tại stop gate #2.
- Local tuyệt đối không sử dụng port 3000; mặc định là 3100.
- Không tự suy diễn giá, màu hoặc size từ tên ảnh.
- Giá bảng giá là nguồn authoritative; giá website và giá trong mô tả chỉ là bằng chứng audit.

## Cấu trúc máy local

```text
F:\1_A_Disk_D\TT\
├── japan-underwear\                 # repository code
├── WK_1600\                         # ảnh Winking
├── pensee_1600\                     # ảnh Pensee
├── QL\                              # ảnh quần lót
└── Bang_bao_gia_Winking_Pensee.xlsx
```

## 1. Tạo manifest ảnh

Tại repository:

```powershell
Set-Location "F:\1_A_Disk_D\TT\japan-underwear"
git pull --ff-only origin feat/catalog-variant-ordering-ui
npm install
npm run catalog:manifest
```

Kết quả local:

```text
data/local/catalog-manifest.json
```

`data/local/` đã bị Git ignore. Manifest chỉ chứa metadata đường dẫn, model và kích thước file; không chứa bytes ảnh.

## 2. Upload gallery lên R2

Dry-run:

```powershell
npm run catalog:r2:upload
```

Apply:

```powershell
npm run catalog:r2:upload -- --apply --concurrency=4
```

Kết quả local:

```text
data/local/r2-upload-plan.json
data/local/r2-upload-report.json
```

Importer chỉ chấp nhận apply report có `failed = 0` và tổng `uploaded + skippedExisting` bằng đúng tổng object trong report.

## 3. Import model và R2 key vào PostgreSQL

Dry-run:

```powershell
npm run catalog:db:import
```

Apply:

```powershell
npm run catalog:db:import -- --apply
```

Importer:

- kiểm tra manifest và R2 report trước khi mở transaction;
- upsert brand, category và product theo khóa nghiệp vụ;
- upsert gallery bằng `r2_key`;
- đặt lại cover image theo thứ tự manifest;
- giữ nguyên giá đã tồn tại khi nguồn ảnh không có giá;
- không tạo màu hoặc size giả;
- ghi `catalog_import_runs` và hậu kiểm số product/image trước khi commit;
- chạy lại an toàn, không nhân đôi dữ liệu.

## 4. Catalog thật trên giao diện

Trang chủ đọc trực tiếp từ schema `japan_underwear` và dựng URL ảnh từ:

```text
R2_PUBLIC_BASE_URL + product_images.r2_key
```

API đọc catalog:

```text
GET /api/catalog
GET /api/catalog?q=9501
GET /api/catalog?brand=pensee&category=ao-nguc
```

Khi product chưa có variant thật, UI vẫn hiển thị model, gallery, giá và màu tham khảo nhưng khóa thao tác thêm giỏ. Đây là trạng thái đúng vì khách chỉ được đặt hàng khi có tổ hợp size/cup đã kiểm chứng.

## 5. Audit website Tuấn Thủy

Tạo audit thô bằng browser scraper, sau đó hợp nhất các trang màu về một model:

```powershell
npm run catalog:web:audit -- \
  ".\data\local\tuan-thuy-product-audit-2026-07-12.json"
```

Đối chiếu audit đã hợp nhất với catalog active local:

```powershell
npm run catalog:web:review -- \
  ".\data\local\tuan-thuy-product-audit-2026-07-12.consolidated.json"
```

Lệnh review mặc định đọc `data/local/catalog-manifest.json` và tạo file `*.review-plan.json`. Nó chỉ sinh kế hoạch review, không ghi PostgreSQL.

## Quy tắc nhận diện ảnh

- `WK_1600` mặc định là brand `winking`.
- `pensee_1600` mặc định là brand `pensee`.
- `QL` có category hint `quan-lot`; brand được suy ra từ `WK`, `Winking`, `PS` hoặc `Pensee` trong đường dẫn.
- Model lấy từ mã 4 chữ số trong tên folder hoặc tên file.
- Các số kích thước ảnh phổ biến như `1080`, `1200`, `1600`, `1920` không được coi là model.
- File không nhận diện được nằm trong `unmatchedFiles`, không bị gán bừa.

## Schema catalog mục tiêu

```text
brands
categories
products                # một model gốc; identity brand + category + model
product_colors          # metadata màu tham khảo cấp sản phẩm
product_variants        # size + cup; cup nullable cho sản phẩm chỉ có size
product_images          # gallery chung, không bắt buộc map ảnh theo màu
catalog_import_runs     # log import và idempotency
```

MVP không map ảnh theo màu. Màu không điều khiển gallery và không tham gia identity của variant hoặc cart line.

## Bước dữ liệu tiếp theo

- Duyệt `*.review-plan.json` theo catalog active thật.
- Chỉ import các variant có tổ hợp size/cup rõ ràng và đã được phê duyệt.
- Giữ 17 model thiếu size/cup ở trạng thái khóa đặt hàng.
- Upsert màu website như metadata hiển thị cấp sản phẩm sau khi đối chiếu active catalog.
- Thiết kế migration trong schema `japan_underwear` để variant có identity `product + size + cup`; không đụng `public` hoặc `vlgn`.
- Login vẫn giữ stop gate #2 cho tới khi issue #7 có quyết định.
