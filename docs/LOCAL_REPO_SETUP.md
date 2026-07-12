# Kết nối local Windows với GitHub nhưng không đưa ảnh lên repo

## Mục tiêu

- Code tại `F:\1_A_Disk_D\TT` đồng bộ với GitHub.
- Ảnh catalog chỉ tồn tại trên máy local hoặc được upload sang Cloudflare R2.
- GitHub chỉ chứa code, schema, script và metadata; không chứa ảnh sản phẩm.

## Cấu trúc local đề xuất

```text
F:\1_A_Disk_D\TT\
├── app\
├── components\
├── scripts\
├── local-assets\                 # Git bỏ qua toàn bộ
│   └── catalog\
│       ├── winking\
│       │   ├── 9090\
│       │   │   ├── 001.jpg
│       │   │   └── 002.jpg
│       │   └── 9099\
│       └── pensee\
│           └── 9502\
├── imports\
│   └── images\                    # Git bỏ qua
└── data\
    └── local\                     # Git bỏ qua
```

Folder theo `brand/model`; không cần đổi tên ảnh theo màu ở MVP.

## Cách 1: thư mục TT đang trống

Mở PowerShell ở thư mục bất kỳ và chạy:

```powershell
git clone --branch feat/catalog-variant-ordering-ui --single-branch `
  https://github.com/minhmannguyengdp-sketch/japan-underwear.git `
  "F:\1_A_Disk_D\TT"

Set-Location "F:\1_A_Disk_D\TT"
New-Item -ItemType Directory -Force "local-assets\catalog\winking" | Out-Null
New-Item -ItemType Directory -Force "local-assets\catalog\pensee" | Out-Null
```

Hoặc sau khi tải script về, chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\connect-local-repo.ps1
```

## Cách 2: thư mục TT đang chứa ảnh

Không chạy `git init` chồng thẳng lên thư mục ảnh hiện tại.

1. Đổi tên thư mục hiện tại, ví dụ `TT-images-backup`.
2. Clone repository vào đúng `F:\1_A_Disk_D\TT`.
3. Tạo `local-assets\catalog\...`.
4. Chuyển ảnh từ thư mục backup vào `local-assets\catalog\brand\model\`.
5. Xóa backup sau khi đã kiểm tra đủ ảnh.

Cách này tránh Git vô tình nhận diện hàng nghìn ảnh là file mới.

## Kiểm tra ảnh đã được bỏ qua

```powershell
Set-Location "F:\1_A_Disk_D\TT"

git check-ignore -v "local-assets\catalog\winking\9090\001.jpg"
git status --short --ignored
```

Kết quả `git status --short --ignored` sẽ hiện ảnh bằng tiền tố `!!`, nghĩa là Git đang bỏ qua.

## Quy trình làm việc hằng ngày

Lấy code mới:

```powershell
Set-Location "F:\1_A_Disk_D\TT"
git pull --ff-only origin feat/catalog-variant-ordering-ui
npm install
npm run dev
```

Đẩy thay đổi code:

```powershell
git status --short
git add app components scripts docs package.json
git commit -m "feat: update catalog ordering"
git push origin feat/catalog-variant-ordering-ui
```

Không dùng:

```powershell
git add -f local-assets
```

`-f` sẽ cưỡng ép Git đưa ảnh đã ignore vào commit.

## Nếu ảnh từng bị Git track trước đó

Chạy một lần:

```powershell
git rm -r --cached --ignore-unmatch `
  local-assets `
  catalog-images `
  imports/images `
  public/catalog-local `
  data/local

git commit -m "chore: stop tracking local catalog assets"
git push
```

Lệnh chỉ xóa ảnh khỏi Git index; file vật lý trên máy vẫn còn.

## Luồng R2 sau này

```text
local-assets/catalog/winking/9090/*
        ↓ script upload
R2 catalog/winking/9090/*
        ↓ importer ghi metadata
PostgreSQL product_images
```

GitHub không tham gia lưu ảnh. Database chỉ lưu `r2_key`, thứ tự ảnh và ảnh bìa của model.
