# Catalog pipeline: local images → manifest → PostgreSQL → R2

## Nguyên tắc đã chốt

- Một model sản phẩm có gallery ảnh chung.
- Khách chọn nhiều dòng `màu + size + số lượng` rồi thêm cả cụm vào giỏ.
- Ảnh local không nằm trong repository và không được commit.
- Slug chỉ dùng cho URL; khóa nghiệp vụ là UUID/model/variant.
- Login tiếp tục bị chặn tại stop gate #2.
- Local tuyệt đối không sử dụng port 3000; mặc định là 3100.

## Cấu trúc máy local

```text
F:\1_A_Disk_D\TT\
├── japan-underwear\                 # repository code
├── WK_1600\                         # ảnh Winking
├── pensee_1600\                     # ảnh Pensee
├── QL\                              # ảnh quần lót
└── Bang_bao_gia_Winking_Pensee.xlsx
```

## Tạo manifest ảnh

Tại repository:

```powershell
Set-Location "F:\1_A_Disk_D\TT\japan-underwear"
git pull --ff-only origin feat/catalog-variant-ordering-ui
npm install
Copy-Item .env.example .env.local -ErrorAction SilentlyContinue
npm run catalog:manifest
```

Kết quả local:

```text
data/local/catalog-manifest.json
```

`data/local/` đã bị Git ignore. Manifest chỉ chứa metadata đường dẫn, model và kích thước file; không chứa bytes ảnh.

## Quy tắc nhận diện

- `WK_1600` mặc định là brand `winking`.
- `pensee_1600` mặc định là brand `pensee`.
- `QL` có category hint `quan-lot`; brand được suy ra từ `WK`, `Winking`, `PS` hoặc `Pensee` trong đường dẫn.
- Model lấy từ mã 4 chữ số trong tên folder hoặc tên file.
- Các số kích thước ảnh phổ biến như `1080`, `1200`, `1600`, `1920` không được coi là model.
- File không nhận diện được nằm trong `unmatchedFiles`, không bị gán bừa.

## Schema catalog

```text
brands
categories
products                # một model gốc
product_colors          # màu của model
product_variants        # màu + size
product_images          # gallery chung; color_id nullable
catalog_import_runs     # log import và idempotency
```

MVP không bắt buộc map ảnh theo màu. `product_images.color_id` được để nullable để có thể bổ sung ảnh đại diện màu về sau mà không đổi schema.

## PostgreSQL

Cấu hình `DATABASE_URL` trong `.env.local`, sau đó:

```powershell
npm run db:generate
npm run db:migrate
```

Pool mặc định tối đa 5 connection bằng `DB_POOL_MAX=5`, phù hợp gói Heroku Postgres nhỏ.

## Các bước tiếp theo

1. Chạy manifest trên máy chứa ảnh và kiểm tra `unmatchedFiles`.
2. Đọc bảng giá Excel, chuẩn hóa brand/model/giá/size.
3. Hợp nhất dữ liệu website với manifest local theo brand + model.
4. Import PostgreSQL bằng upsert và ghi `catalog_import_runs`.
5. Upload gallery model lên R2, lưu `r2_key` trong `product_images`.
6. Thay dữ liệu demo trên UI bằng catalog từ database.
