# Kế hoạch thực thi ứng dụng đặt hàng Tuấn Thủy

## 1. Mục tiêu

Xây dựng một ứng dụng đặt hàng B2B/PWA cho khách hàng Tuấn Thủy, kế thừa các luồng nghiệp vụ tốt của app F&B tham chiếu nhưng viết lại nền tảng dữ liệu và backend theo hướng an toàn, dễ vận hành và không chắp vá.

Ứng dụng gồm hai khu vực:

1. **Khách hàng**: xem catalog, tìm kiếm/lọc, chọn biến thể, thêm giỏ, gửi đơn, xem lịch sử và trạng thái đơn.
2. **Sales/Admin**: nhận đơn, xử lý trạng thái, tạo đơn tay, quản lý catalog/khách hàng và xuất báo cáo.

## 2. Kiến trúc đã chốt

```text
Next.js App Router (PWA + API)
        |
        +-- Heroku Basic: web app
        +-- Heroku Postgres: dữ liệu nghiệp vụ
        +-- Cloudflare R2: ảnh/catalog assets
        +-- Auth provider: CHƯA CHỐT
```

### Nguyên tắc kiến trúc

- Một Next.js app chạy cả giao diện và API trong giai đoạn đầu.
- PostgreSQL là nguồn dữ liệu chuẩn cho sản phẩm, giá, khách hàng và đơn hàng.
- R2 chỉ giữ object; database lưu `object_key`, không lưu phụ thuộc cứng vào URL CDN.
- Client chỉ gửi định danh biến thể và số lượng; server tự đọc giá và tính tiền.
- Tạo đơn, order items, lịch sử trạng thái và outbox thông báo trong transaction.
- User nghiệp vụ dùng UUID nội bộ; không lấy ID của Clerk/Auth.js làm khóa chính toàn hệ thống.
- Mọi dependency production phải pin version và commit lockfile.

## 3. Phạm vi MVP

### Khách hàng

- Catalog theo nhóm hàng, thương hiệu và biến thể/SKU.
- Tìm theo tên, SKU, thuộc tính biến thể và thương hiệu.
- Giỏ hàng theo `variant_id`, tăng/giảm/xóa đúng từng dòng.
- Gửi đơn chống trùng bằng `client_request_id`.
- Ghi chú giao hàng.
- Xem danh sách, chi tiết và trạng thái đơn.
- PWA cài lên màn hình chính.

### Sales/Admin

- Dashboard đơn mới, đang xử lý, hoàn tất, hủy.
- Nhận đơn và chuyển trạng thái có kiểm soát.
- Tạo đơn thủ công cho khách.
- Quản lý khách và địa chỉ giao hàng.
- Import/cập nhật catalog.
- Xuất CSV đơn hàng.

### Chưa nằm trong MVP

- Thanh toán trực tuyến.
- Đồng bộ tồn kho thời gian thực với ERP.
- Tối ưu tuyến giao hàng.
- Chương trình tích điểm/khuyến mại phức tạp.
- Multi-tenant cho nhiều công ty.

## 4. Mô hình dữ liệu nền

### Identity và khách hàng

- `users`
- `user_roles`
- `customers`
- `customer_addresses`

### Catalog và giá

- `categories`
- `brands`
- `products`
- `product_variants`
- `product_images`
- `price_lists`
- `price_list_items`
- `catalog_import_runs`

### Đơn hàng

- `orders`
- `order_items`
- `order_status_history`
- `order_events`

### Hệ thống

- `notifications`
- `notification_outbox`
- `webhook_events`
- `audit_logs`

### Snapshot bắt buộc trong `order_items`

- `product_id`
- `variant_id`
- `product_name`
- `sku`
- `options_json`
- `unit_price`
- `quantity`
- `line_total`

Giá hoặc tên sản phẩm đổi sau này không được làm thay đổi đơn cũ.

## 5. Luồng tạo đơn chuẩn

```text
1. Xác thực người dùng (khi auth được chốt)
2. Validate payload bằng Zod
3. Nhận variantId + quantity + clientRequestId
4. Đọc variant đang active từ PostgreSQL
5. Xác định price list của khách
6. Tính giá và tổng tiền hoàn toàn ở server
7. BEGIN TRANSACTION
8. Tạo order
9. Tạo order_items snapshot
10. Tạo order_status_history
11. Ghi notification_outbox
12. COMMIT
13. Trả mã đơn
```

Các trường sau không được tin từ trình duyệt: `unit_price`, `line_total`, `total`, `sku`, `product_name`, `role`.

## 6. Các phase triển khai

### Phase 0 — Discovery và chốt dữ liệu nguồn

**Mục tiêu:** hiểu catalog thật trước khi viết schema/importer.

Công việc:

- Kiểm kê danh mục, SKU, biến thể, thương hiệu, giá và ảnh từ nguồn Tuấn Thủy.
- Xác định nguồn chuẩn: website, Excel, ERP hoặc manifest trên R2.
- Chốt cách xử lý sản phẩm hết bán, đổi SKU và ảnh trùng.
- Lập mapping từ dữ liệu nguồn sang schema nội bộ.
- Ghi sample catalog tối thiểu 20 sản phẩm có đủ các trường hợp khó.

**Nghiệm thu:** có tài liệu mapping và sample data được duyệt.

### Phase 1 — Bootstrap repository và nền tảng deploy

Công việc:

- Khởi tạo Next.js App Router + TypeScript.
- Cài Tailwind, Zod, Drizzle ORM và `pg`.
- Pin phiên bản Node/dependencies.
- Thêm lint, typecheck, test và build scripts.
- Tạo Heroku app staging.
- Gắn Heroku Postgres Essential-0.
- Cấu hình pool PostgreSQL tối đa 5 connections cho một dyno.
- Tạo `.env.example`, không commit secret.
- Thiết lập GitHub Actions chạy lint, typecheck và build.

**Nghiệm thu:** main build xanh; staging trả health check; migration chạy được.

### Phase 2 — Database schema và data access

Công việc:

- Viết schema Drizzle và migration.
- Tạo repository/service layer; route handler không query DB rải rác.
- Tạo transaction helper.
- Tạo seed data cho role, trạng thái và catalog mẫu.
- Thêm index cho SKU, category, order code, customer và created_at.
- Thêm unique constraint cho idempotency đơn hàng.

**Nghiệm thu:** migration up/down có kiểm tra; seed chạy lặp lại không nhân bản dữ liệu.

### Phase 3 — Catalog và R2

Công việc:

- API đọc catalog, phân trang, tìm kiếm và filter.
- Admin upload ảnh qua presigned PUT URL.
- Kiểm tra quyền, MIME type, dung lượng và object key.
- Lưu `object_key` trong DB; dựng URL hiển thị từ config CDN.
- Viết importer idempotent theo SKU/variant key.
- Sản phẩm biến mất khỏi nguồn được chuyển `inactive`, không xóa cứng.
- Ghi log mỗi lần import và số dòng thành công/lỗi.

**Nghiệm thu:** import cùng dữ liệu hai lần không sinh bản ghi trùng; ảnh hiển thị qua R2/CDN.

### Phase 4 — Giao diện khách không yêu cầu đăng nhập

Công việc:

- Trang catalog mobile-first.
- Tìm kiếm, nhóm lớn, nhóm con, thương hiệu.
- Hiển thị biến thể và giá đúng theo dữ liệu server.
- Cart store dùng `cart_line_key = product_id + variant_id`.
- Persist giỏ local an toàn theo phiên bản schema.
- Trang giỏ và tổng tạm tính chỉ để hiển thị; server vẫn tính lại khi đặt.
- PWA manifest, icons và install flow.

**Nghiệm thu:** các thao tác thêm/tăng/giảm/xóa variant đúng dòng; refresh không mất giỏ.

### Phase 5 — CHECKPOINT CHỐT LOGIN

> **DỪNG tại đây và nhắc chủ dự án chốt phương án đăng nhập trước khi triển khai tiếp.**

Các phương án cần so sánh tại thời điểm này:

- Clerk + custom domain.
- Auth.js + Google OAuth + database sessions.
- Đặt hàng không login, xác minh bằng số điện thoại/OTP nếu nghiệp vụ phù hợp.

Các tiêu chí quyết định:

- Domain production thực tế.
- Google Login hay phone OTP.
- Chi phí sau ưu đãi.
- Quản trị session, khóa user và phân quyền.
- Mức độ phụ thuộc provider.

Dù chọn phương án nào, bảng `users` vẫn dùng UUID nội bộ và có cột external identity riêng.

**Nghiệm thu:** có ADR ghi lựa chọn auth, lý do, callback/domain và cách mapping role.

### Phase 6 — Tài khoản khách và đặt hàng

Công việc:

- Tích hợp auth theo ADR đã duyệt.
- Onboarding thông tin cửa hàng, liên hệ và địa chỉ.
- API tạo đơn theo transaction và idempotency.
- Lịch sử/chi tiết đơn theo quyền sở hữu.
- Không cho khách đọc đơn của user khác.
- Thông báo kết quả đặt đơn rõ ràng; lỗi không được làm mất giỏ.

**Nghiệm thu:** sửa request trong DevTools không thể đổi giá; gửi lại cùng `client_request_id` không tạo đơn thứ hai.

### Phase 7 — Sales/Admin

Công việc:

- Role guard ở server cho `sales` và `admin`.
- Dashboard trạng thái.
- State machine: `new -> confirmed -> processing -> completed`; hủy theo rule.
- Ghi lịch sử người thao tác và thời điểm.
- Tạo đơn tay nhưng vẫn dùng chung service tính giá.
- Quản lý catalog, khách, price list.
- Xuất CSV có filter thời gian/trạng thái.

**Nghiệm thu:** không thể nhảy trạng thái trái rule; customer không gọi được API staff.

### Phase 8 — Hardening và production release

Công việc:

- Rate limit endpoint nhạy cảm.
- Security headers, CSRF/origin checks theo auth đã chọn.
- Structured logging và request ID.
- Health/readiness endpoint.
- Error monitoring.
- Backup PostgreSQL định kỳ ra nơi độc lập.
- Smoke test trên mạng di động Việt Nam.
- Kiểm tra cold start, latency và giới hạn connections.
- Gắn custom domain và HTTPS.
- Viết runbook rollback, migration và restore.

**Nghiệm thu:** checklist release hoàn thành; restore thử thành công; production smoke test đạt.

## 7. Thứ tự issue đề xuất

1. Epic: MVP ordering app.
2. Discovery: catalog source và field mapping.
3. Bootstrap Next.js/Heroku/Postgres.
4. Database schema và migration.
5. Catalog importer + R2 upload.
6. Customer catalog + cart PWA.
7. **Decision checkpoint: authentication.**
8. Customer onboarding + checkout.
9. Order history/status.
10. Sales dashboard + workflow.
11. Admin catalog/customer/price list.
12. Reports, notifications và production hardening.

## 8. Definition of Done chung

Một hạng mục chỉ được xem là hoàn thành khi:

- Có code review hoặc self-review theo checklist.
- Lint, typecheck, test và build đều xanh.
- Có migration nếu thay schema.
- Không commit secret hoặc dữ liệu khách thật.
- Có xử lý loading, empty, error và retry hợp lý.
- API validate input và kiểm tra quyền phía server.
- Có tiêu chí nghiệm thu được kiểm tra trên staging.
- Tài liệu thay đổi được cập nhật.

## 9. Rủi ro chính và cách chặn

| Rủi ro | Cách chặn |
|---|---|
| Client sửa giá | Server đọc giá từ DB và tính lại toàn bộ |
| Tạo đơn dở dang | PostgreSQL transaction |
| Gửi đơn trùng | Unique `(customer_id, client_request_id)` |
| Variant tăng/giảm sai | Cart line dùng variant ID cố định |
| Cạn 20 DB connections | Pool nhỏ, một dyno, theo dõi connection usage |
| Ảnh mất khi dyno restart | Upload thẳng R2, không ghi filesystem |
| Auth khóa chặt provider | UUID nội bộ + external identity mapping |
| Import làm mất dữ liệu | Upsert idempotent, inactive thay vì hard delete |
| Đổi giá làm sai đơn cũ | Snapshot trong order items |
| Deploy migration lỗi | Release checklist, backup và rollback runbook |

## 10. Quyết định đang hoãn

- Nhà cung cấp đăng nhập.
- Domain production cuối cùng.
- Nguồn catalog chuẩn và lịch đồng bộ.
- Có cần price list theo từng khách ngay MVP hay phase sau.
- Kênh notification: in-app, email, push hay Zalo.

Các quyết định này phải được ghi thành ADR trước khi code phần phụ thuộc tương ứng.
