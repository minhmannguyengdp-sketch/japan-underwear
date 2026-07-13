# Order status lifecycle — backend only

## Phạm vi

Phase này chỉ dựng nền quản lý trạng thái đơn ở PostgreSQL và CLI nội bộ.

Không triển khai:

- màn hình quản trị;
- route `/api/admin/*`;
- route HTTP đổi trạng thái đơn;
- user, role, session hoặc authorization tạm;
- bất kỳ cách né STOP GATE #2 nào.

Issue #2 vẫn là nơi bắt buộc chốt auth ADR trước khi mở sales/admin workflow.

## State machine

```text
submitted ──> confirmed
     │
     └──────> cancelled
```

`confirmed` và `cancelled` là trạng thái cuối. Không được:

- `confirmed -> cancelled`;
- `cancelled -> confirmed`;
- quay lại `submitted`;
- tạo order mới ở trạng thái khác `submitted`.

Các rule được enforce bằng trigger PostgreSQL, không chỉ dựa vào CLI.

## Audit

Bảng `japan_underwear.order_status_events` lưu:

- `order_id`;
- trạng thái trước và sau;
- nguồn thao tác;
- nhãn người/thành phần thao tác;
- lý do;
- idempotency key;
- thời điểm.

Order tạo từ checkout được ghi event `∅ -> submitted` tự động. Các order đã tồn tại trước migration `0005` được backfill một baseline event.

Mọi update làm thay đổi `orders.status` đều kích hoạt audit trigger. Update trực tiếp ngoài lifecycle function vẫn bị state-machine trigger kiểm tra và được ghi với actor `system:direct-database-update`.

## Idempotency và concurrency

Function chuẩn:

```sql
japan_underwear.transition_order_status(
  order_code,
  target_status,
  actor_source,
  actor_label,
  reason,
  idempotency_key
)
```

Function khóa order bằng `FOR UPDATE`, kiểm tra idempotency key, rồi update và ghi audit trong cùng transaction.

- Dùng lại cùng key và cùng target: trả kết quả idempotent, không tạo event mới.
- Dùng lại cùng key cho target khác: từ chối.
- Hai thao tác đồng thời trên cùng order: được tuần tự hóa bằng row lock.
- Hủy đơn bắt buộc có lý do.

## Migration và verify

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

git switch feat/order-status-lifecycle
git pull --ff-only origin feat/order-status-lifecycle

npm run db:migrate
npm run db:verify
```

Kết quả mong đợi có thêm:

```text
Order status lifecycle migration OK.
Allowed transitions: submitted -> confirmed | cancelled.
confirmed và cancelled là trạng thái cuối.
Migration record 0005 reconciled.

Order status lifecycle verification OK.
Audit coverage: ... order(s), 0 missing history.
Admin UI/API: intentionally not implemented before STOP GATE #2.
```

## CLI nội bộ

### Xem lịch sử

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run order:status -- TT-YYYYMMDD-XXXXXXXX history
```

### Dry-run xác nhận đơn

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run order:status -- `
  TT-YYYYMMDD-XXXXXXXX `
  confirmed `
  --actor=minh
```

Dry-run không ghi database. CLI in idempotency key để có thể tái sử dụng khi apply.

### Apply xác nhận đơn

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run order:status -- `
  TT-YYYYMMDD-XXXXXXXX `
  confirmed `
  --actor=minh `
  --reason="Đã gọi xác nhận với khách" `
  --key=<KEY_TỪ_DRY_RUN> `
  --apply
```

### Apply hủy đơn

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run order:status -- `
  TT-YYYYMMDD-XXXXXXXX `
  cancelled `
  --actor=minh `
  --reason="Khách yêu cầu hủy" `
  --key=<KEY_TỪ_DRY_RUN> `
  --apply
```

Hủy đơn không có `--reason` sẽ bị từ chối ở cả CLI và database function.

## Mở admin workflow sau STOP GATE #2

Sau khi issue #2 được đóng bằng ADR auth đã duyệt, sales/admin API phải gọi lại đúng function `transition_order_status`; không được viết một state machine mới trong route handler.

Authorization tương lai phải xác định actor thật và truyền:

- `actor_source = future_admin` hoặc giá trị đã chốt trong ADR;
- `actor_label` là internal user UUID hoặc định danh audit đã duyệt;
- idempotency key theo request/action.
