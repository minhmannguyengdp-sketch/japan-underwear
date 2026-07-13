# Kết nối local Windows với GitHub nhưng không đưa ảnh lên repo

## Cấu trúc local chính thức

Thư mục `TT` là workspace chứa ảnh, bảng giá và repository code. Không chạy `git init` tại thư mục `TT`.

```text
F:\1_A_Disk_D\TT\
├── japan-underwear\                 # repository code
│   ├── app\
│   ├── components\
│   ├── scripts\
│   └── .git\
├── WK_1600\                         # ảnh Winking, ngoài Git
├── pensee_1600\                     # ảnh Pensee, ngoài Git
├── QL\                              # ảnh quần lót, ngoài Git
└── Bang_bao_gia_Winking_Pensee.xlsx # bảng giá, ngoài Git
```

Git chỉ quản lý nội dung bên trong `japan-underwear`. Các folder ảnh và file Excel nằm ở thư mục cha nên không thể bị `git add` hoặc push nhầm từ repository.

## Clone repository

```powershell
Set-Location "F:\1_A_Disk_D\TT"

git clone --branch feat/catalog-variant-ordering-ui --single-branch `
  https://github.com/minhmannguyengdp-sketch/japan-underwear.git `
  japan-underwear

Set-Location "F:\1_A_Disk_D\TT\japan-underwear"
npm install
```

## Cấu hình đường dẫn local

Tạo file `F:\1_A_Disk_D\TT\japan-underwear\.env.local`:

```env
LOCAL_CATALOG_ROOT=F:\1_A_Disk_D\TT
LOCAL_WINKING_IMAGES=F:\1_A_Disk_D\TT\WK_1600
LOCAL_PENSEE_IMAGES=F:\1_A_Disk_D\TT\pensee_1600
LOCAL_QL_IMAGES=F:\1_A_Disk_D\TT\QL
LOCAL_PRICE_FILE=F:\1_A_Disk_D\TT\Bang_bao_gia_Winking_Pensee.xlsx
```

`.env.local` đã bị Git bỏ qua.

## Chính sách port

Port `3000` được giữ riêng và tuyệt đối không dùng cho dự án này.

Chạy local bằng:

```powershell
Set-Location "F:\1_A_Disk_D\TT\japan-underwear"
npm run dev
```

Địa chỉ mặc định:

```text
http://localhost:3100
```

Script `scripts/dev-server.mjs` sẽ dừng ngay nếu `DEV_PORT=3000`.

Có thể dùng port khác khi cần, ngoại trừ 3000:

```powershell
$env:DEV_PORT = "3101"
npm run dev
```

Heroku không dùng cấu hình local này. Lệnh production `npm start` tiếp tục nhận biến `PORT` động do Heroku cấp.

## Quy trình làm việc hằng ngày

```powershell
Set-Location "F:\1_A_Disk_D\TT\japan-underwear"
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

## Kiểm tra phạm vi Git

```powershell
Set-Location "F:\1_A_Disk_D\TT\japan-underwear"
git rev-parse --show-toplevel
git status --short
```

`git rev-parse --show-toplevel` phải trả về:

```text
F:/1_A_Disk_D/TT/japan-underwear
```

Không được trả về `F:/1_A_Disk_D/TT`.

## Luồng ảnh sang R2

```text
F:\1_A_Disk_D\TT\WK_1600\...
F:\1_A_Disk_D\TT\pensee_1600\...
F:\1_A_Disk_D\TT\QL\...
        ↓ importer đọc local
Cloudflare R2 catalog/<brand>/<model>/*
        ↓ lưu metadata
PostgreSQL product_images
```

GitHub chỉ chứa code và metadata. Ảnh sản phẩm đi từ local sang R2, không đi qua repository.
