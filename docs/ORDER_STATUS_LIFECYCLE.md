# Order processing lifecycle

## Phạm vi

Order lifecycle là nguồn luật dùng chung cho:

- API và dashboard sales/admin;
- CLI vận hành nội bộ;
- lịch sử đơn của khách hàng;
- update trực tiếp vào `japan_underwear.orders`.

PostgreSQL function và trigger trong schema `japan_underwear` là nguồn luật duy nhất. Web, CLI và UI chỉ gọi hoặc hiển thị rule này; không tự triển khai một state machine khác.

## Transition matrix

```text
submitted ──> confirmed ──> processing ──> completed
    │              │
    └──────────────┴────────────────────> cancelled
```

| Trạng thái hiện tại | Transition hợp lệ |
| --- | --- |
| `submitted` | `confirmed`, `cancelled` |
| `confirmed` | `processing`, `cancelled` |
| `processing` | `completed` |
| `completed` | không có |
| `cancelled` | không có |

Quy tắc bổ sung:

- order mới luôn bắt đầu ở `submitted`;
- không được bỏ qua bước;
- không được quay ngược trạng thái;
- `completed` và `cancelled` là terminal statuses;
- không cho hủy khi đã `processing`;
- mọi transition sang `cancelled` bắt buộc có lý do không rỗng.

## Nguồn luật database

Các thành phần chuẩn:

```sql
japan_underwear.validate_order_status_transition()
japan_underwear.record_order_status_event()
japan_underwear.transition_order_status(
  order_code,
  target_status,
  actor_source,
  actor_label,
  reason,
  idempotency_key
)
```

`orders_status_transition_guard_trg` kiểm tra mọi insert/update status, kể cả câu lệnh SQL không đi qua ứng dụng.

`orders_status_audit_trg` ghi đúng một event sau mỗi thay đổi status thành công. Event lưu:

- `order_id`;
- `from_status` và `to_status`;
- `actor_source` và `actor_label`;
- lý do;
- idempotency key;
- thời điểm.

Order tạo từ checkout tự có event `∅ -> submitted`. Event lịch sử cũ tiếp tục được giữ nguyên.

## Idempotency và concurrent safety

`transition_order_status(...)`:

1. khóa order bằng `SELECT ... FOR UPDATE`;
2. kiểm tra idempotency key theo từng order;
3. đặt actor/reason/key vào transaction-local settings;
4. update bằng compare-and-set theo status đã khóa;
5. để trigger kiểm tra matrix và ghi audit trong cùng transaction.

Kết quả:

- replay cùng key và cùng target trả event cũ, không ghi event thứ hai;
- cùng key nhưng target khác bị từ chối;
- hai staff thao tác đồng thời trên cùng order được tuần tự hóa bằng row lock;
- request stale không thể tạo trạng thái mâu thuẫn;
- transition lỗi không đổi order và không sinh audit event.

## Quyền staff

Các route `/api/admin/orders*` kiểm tra role ở server:

- `sales` và `admin` được đọc và chuyển trạng thái;
- customer nhận `403`;
- chưa đăng nhập nhận `401`.

Actor audit của dashboard dùng:

- `actor_source = staff_web`;
- `actor_label = email`, fallback internal user UUID.

## Dashboard

Dashboard chỉ hiện action phù hợp status hiện tại:

- `submitted`: **Xác nhận đơn** hoặc **Hủy đơn**;
- `confirmed`: **Bắt đầu xử lý** hoặc **Hủy đơn**;
- `processing`: **Đánh dấu hoàn tất**;
- `completed`, `cancelled`: không còn action.

Ẩn nút không thay thế database guard. Request tự sửa bằng DevTools vẫn phải qua function và trigger.

## Customer history

Danh sách và chi tiết `/don-hang` hiển thị đủ:

- Đang chờ xác nhận;
- Đã xác nhận;
- Đang xử lý;
- Đã hoàn tất;
- Đã hủy.

Customer history chỉ trả thông tin trạng thái, lý do và thời điểm; không lộ actor staff hoặc idempotency key.

## Migration

Migration `0010_order_processing_lifecycle.sql`:

- mở rộng check constraint của `orders` và `order_status_events`;
- validate dữ liệu hiện có trước khi thay constraint cũ;
- giữ nguyên bảng, ID, order và history hiện hữu;
- thay function cùng chữ ký để caller cũ không phải đổi entry point;
- không tạo bảng hoặc function trong `public` hay `vlgn`.

State-aware runner:

```text
scripts/db/apply-order-processing-lifecycle.mjs
```

`db:migrate` không chạy lại runner 0005 sau khi 0010 đã active, tránh vô tình hạ lifecycle về matrix cũ.

## Runtime verifier

`verify-order-status-lifecycle.mjs` tạo fixture trong transaction và luôn rollback. Verifier kiểm tra:

- full path `submitted -> confirmed -> processing -> completed`;
- hủy từ `submitted` và `confirmed`;
- thiếu lý do hủy;
- các bước nhảy sai;
- terminal statuses;
- idempotency replay/conflict;
- đúng một event cho mỗi transition thành công;
- actor audit;
- `FOR UPDATE` và compare-and-set guard;
- toàn bộ order hiện có có history hợp lệ.

## CLI nội bộ

CLI mặc định dry-run:

```powershell
cd F:\1_A_Disk_D\TT\japan-underwear

npm run order:status -- list --status=all --limit=50
npm run order:status -- <ORDER_CODE_THẬT> history
npm run order:status -- <ORDER_CODE_THẬT> confirmed --actor=minh
npm run order:status -- <ORDER_CODE_THẬT> processing --actor=minh
npm run order:status -- <ORDER_CODE_THẬT> completed --actor=minh
npm run order:status -- <ORDER_CODE_THẬT> cancelled --actor=minh --reason="Khách yêu cầu hủy"
```

Muốn ghi database phải truyền lại idempotency key đã duyệt và thêm `--apply`.
