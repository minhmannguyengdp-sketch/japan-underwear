# Checkout geolocation — explicit consent

## Phạm vi

Định vị giao hàng là dữ liệu tùy chọn gắn với snapshot của order. Không gắn vào cart và không phụ thuộc login.

Ứng dụng không tự gọi Geolocation API khi mở trang hoặc mở form. Trình duyệt chỉ hỏi quyền sau khi khách bấm **Lấy vị trí hiện tại**.

## Dữ liệu lưu

Các cột nullable trên `japan_underwear.orders`:

- `delivery_latitude`;
- `delivery_longitude`;
- `delivery_accuracy_meters`;
- `location_collected_at`;
- `location_source`.

Năm trường phải cùng có hoặc cùng null. `location_source` hiện chỉ chấp nhận `browser_geolocation`.

DB kiểm tra:

- latitude từ `-90` đến `90`;
- longitude từ `-180` đến `180`;
- accuracy lớn hơn `0` và không quá `100000` mét;
- timestamp từ năm 2000 trở đi;
- dữ liệu all-or-none.

API và service kiểm tra thêm timestamp không cũ quá 30 phút và không nằm quá 5 phút trong tương lai.

## Privacy và UX

- Không thu thập tự động.
- Không có vị trí vẫn tạo đơn bình thường.
- Khách có thể xóa vị trí trước khi gửi.
- Hiển thị độ chính xác ước tính.
- Geolocation chỉ hoạt động trên HTTPS hoặc localhost.
- Không reverse-geocode.
- Không gửi tọa độ sang dịch vụ bản đồ bên thứ ba.
- Không mở admin UI/API trước STOP GATE #2.

## Migration và verify

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

git switch feat/checkout-geolocation
git pull --ff-only origin feat/checkout-geolocation

npm run db:migrate
npm run db:verify
npm run lint
npm run build
```

Kết quả migration có thêm:

```text
Checkout geolocation migration OK.
Location fields are optional and all-or-none.
Location source: browser_geolocation only.
Migration record 0006 reconciled.
```

Verifier có thêm:

```text
Checkout geolocation verification OK.
Location is optional and stored as an order snapshot.
Consent model: browser geolocation only after an explicit user action.
```

## Smoke test

### Không chia sẻ vị trí

1. Thêm sản phẩm vào giỏ.
2. Điền tên và số điện thoại.
3. Không bấm nút lấy vị trí.
4. Tạo đơn.
5. Kết quả phải báo đơn không kèm vị trí.

### Có chia sẻ vị trí

1. Tạo giỏ mới.
2. Bấm **Lấy vị trí hiện tại** và cho phép trình duyệt.
3. Kiểm tra UI hiển thị độ chính xác và tọa độ rút gọn.
4. Tạo đơn.
5. Kết quả phải báo vị trí đã được lưu cùng đơn.
6. `npm run db:verify` phải báo số order có location tăng lên.

### Từ chối quyền

1. Tạo giỏ mới.
2. Bấm lấy vị trí rồi từ chối quyền.
3. UI phải hiện lỗi quyền truy cập.
4. Nút tạo đơn vẫn hoạt động và order được lưu không có vị trí.
