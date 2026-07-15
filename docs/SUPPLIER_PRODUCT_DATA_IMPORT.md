# Nhập màu và mô tả từ bảng sản phẩm nhà cung cấp

## Nguồn dữ liệu

File nhà cung cấp đã đối chiếu:

- tên file: `BẢNG MÔ TẢ SẢN PHẨM1.xlsx`;
- SHA-256: `2b1a73b4ce4b71a27e72949d6b90a24e0a0936ad05173a75bd86bbcd619f11bf`;
- sheet: `Pensee`, `Winking`, `DN-Winking`.

Kết quả chuẩn hóa:

- 82 model trong file;
- 71 model áo ngực thuộc phạm vi catalog hiện tại;
- 11 model đầm ngủ nằm ngoài phạm vi app hiện tại;
- 320 màu áo ngực;
- 71 mô tả ngắn;
- 26/30 model đang thiếu màu được file nhà cung cấp bao phủ;
- 4 model chưa có trong file: `5002`, `5003`, `9512`, `9536`.

Không dùng ảnh đại diện để kết luận bộ màu. Mỗi màu được lấy từ đồng thuận giữa:

- tên sản phẩm;
- cột `Màu`;
- mã sản phẩm/SKU.

## Quy tắc mô tả trong app

`short_description` chỉ giữ các ý chính:

- chất liệu;
- có gọng/không gọng và kiểu cúp;
- loại đệm/mút;
- đặc điểm bản lưng hoặc dây vai.

Bỏ nội dung quảng cáo dài, câu lặp và lời kêu gọi mua hàng.

## File local bắt buộc

Lưu hai file vào `data/local/`:

- `BẢNG MÔ TẢ SẢN PHẨM1.xlsx`;
- `tuan-thuy-supplier-product-data-2026-07-15.json`.

Manifest JSON khóa chính xác SHA-256 của file Excel. Thay đổi bất kỳ byte nào trong Excel sẽ làm quy trình dừng.

## Kiểm tra manifest, chưa kết nối PostgreSQL

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:validate -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx" `
  --validate-only
```

## Dry run với catalog thật

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:import -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx"
```

Dry run báo rõ:

- số áo ngực active trong PostgreSQL;
- số model khớp file nhà cung cấp;
- model có trong file nhưng không active trong app;
- model active trong app nhưng thiếu trong file;
- tổng màu dự kiến;
- tổng mô tả cần cập nhật;
- màu active hiện có nhưng nằm ngoài danh sách đầy đủ của nhà cung cấp.

Nếu PostgreSQL có màu active ngoài manifest, importer dừng để review; không tự xóa màu.

## Nhập thật

Chỉ chạy sau khi dry run được duyệt:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run catalog:supplier:import -- `
  ".\data\local\tuan-thuy-supplier-product-data-2026-07-15.json" `
  ".\data\local\BẢNG MÔ TẢ SẢN PHẨM1.xlsx" `
  --apply
```

Importer:

- chỉ cập nhật `japan_underwear.products.short_description`;
- chỉ thêm/cập nhật `japan_underwear.product_colors`;
- không tạo product mới;
- không nhập 11 model đầm ngủ;
- không cập nhật giá;
- không cập nhật `product_variants`;
- chụp và đối chiếu toàn bộ snapshot variant trước/sau transaction;
- rollback nếu mô tả, bộ màu hoặc variant hậu kiểm không đúng;
- ghi hash nguồn và kết quả vào `japan_underwear.catalog_import_runs`.

Bốn model `5002`, `5003`, `9512`, `9536` tiếp tục giữ trạng thái thiếu màu cho đến khi có nguồn đầy đủ riêng.
