# UI mobile shell — phạm vi đóng băng

Branch: `ui/mobile-app-shell-pensee`

## Baseline nghiệp vụ

- Giữ nguyên logic catalog hiện tại: sản phẩm order được khi có màu active và size/cup active.
- Baseline database đã nghiệm thu: 108 sản phẩm active, 62 sản phẩm order được.
- Không sửa schema PostgreSQL, migration, cart, checkout, giá, order writer hoặc lifecycle.
- Không thay đổi dữ liệu catalog trong phase UI.
- Hai asset được chủ catalog duyệt và dùng thật:
  - `public/brand/pensee-app-background.png`
  - `public/brand/pensee-logo.png`

## Public shell

- Khung app tối đa 480 px, giữa màn hình desktop.
- `100dvh`, safe-area, không tràn ngang.
- Header và bottom navigation cố định.
- Sheet/dialog bị giới hạn trong đúng khung app.
- Manifest standalone, service worker và màn offline.
- Loading, error, empty và 404 dùng cùng ngôn ngữ hình ảnh Pensee.

## Admin shell

- Shell riêng, mobile-first nhưng không ép vào khung 480 px.
- Nội dung quản trị được phép mở rộng tới 1180 px.
- Navigation nội bộ cuộn ngang trên màn nhỏ.

## Gate

Mọi PR của phase này phải chứng minh diff không chạm:

- `db/`, `drizzle/`, `lib/*ordering*`, `lib/*cart*`, `lib/*price*`;
- API cart/order;
- scripts import/migration;
- dữ liệu trong PostgreSQL.
