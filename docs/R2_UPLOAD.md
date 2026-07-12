# Upload catalog images from local folders to Cloudflare R2

Ảnh luôn nằm ngoài Git repository. Script chỉ đọc manifest local và upload trực tiếp từ ổ đĩa lên R2.

## Biến môi trường

Đặt các giá trị thật trong `.env.local`, không đặt trong `.env.example`:

```env
R2_ACCOUNT_ID=...
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=https://cdn.example.com
R2_PREFIX=catalog
R2_UPLOAD_CONCURRENCY=4
```

`R2_PUBLIC_BASE_URL` có thể để trống khi bucket chưa có public/custom domain.

## 1. Cài dependency

```powershell
npm install
```

## 2. Kiểm tra key

```powershell
npm run r2:check
```

Lệnh ghi một object nhỏ dưới `_health/`, kiểm tra lại rồi xóa ngay. Nó xác nhận key có quyền ghi, đọc metadata và xóa object.

## 3. Tạo manifest mới nhất

```powershell
npm run catalog:manifest
```

Uploader dừng nếu `classificationWarningCount` lớn hơn 0. `classificationExceptions` không chặn upload vì đó là ngoại lệ hợp lệ đã được folder `AL/QL/QG` và `PS/WK` xác định.

## 4. Dry-run

```powershell
npm run catalog:r2:upload
```

Chưa có file nào được upload. Kế hoạch được ghi tại:

```text
data/local/r2-upload-plan.json
```

## 5. Thử một model

```powershell
npm run catalog:r2:upload -- --brand=winking --category=ao-nguc --model=9090 --apply
```

Có thể giới hạn số object:

```powershell
npm run catalog:r2:upload -- --model=9090 --limit=3 --apply
```

## 6. Upload toàn bộ

```powershell
npm run catalog:r2:upload -- --apply
```

Report được ghi tại:

```text
data/local/r2-upload-report.json
```

## Quy tắc key

Mỗi object có key ổn định theo nội dung file:

```text
catalog/{brand}/{category}/{modelCode}/{sha256-prefix}.{ext}
```

Ví dụ:

```text
catalog/winking/ao-nguc/9090/17f4a9b8c18e42df93bbf123.jpg
```

Đổi tên file local không tạo object mới nếu nội dung ảnh không đổi. Hai file trùng nội dung trong cùng model chỉ tạo một object.

## Tính chất an toàn

- Không upload 12 ảnh nằm trong `unmatchedFiles`.
- Không xóa object R2.
- Mặc định là dry-run; phải có `--apply` mới upload.
- Chạy lại sẽ bỏ qua key đã tồn tại.
- `--force` upload lại object trùng key nhưng vẫn không xóa gì.
- Secret không được ghi vào plan/report hoặc log.
- `.env.local`, `data/local` và ảnh local đều bị Git ignore.
