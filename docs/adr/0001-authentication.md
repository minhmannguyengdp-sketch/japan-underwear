# ADR-0001: Authentication and authorization

- Status: accepted
- Date: 2026-07-13
- Decision owner: project owner
- Supersedes: STOP GATE #2

## Context

Ứng dụng cần hai vùng quyền:

- customer: catalog, checkout và lịch sử đơn của chính mình;
- sales/admin: vận hành đơn hàng và dữ liệu nội bộ.

Các yêu cầu bắt buộc là user UUID nội bộ, khóa user, thu hồi session, role guard ở server và không dùng ID nhà cung cấp làm khóa nghiệp vụ.

Repo chưa có domain production hoặc project Vercel. Kế hoạch hiện tại vẫn định hướng Heroku. Vì vậy không được hard-code callback production giả.

## Decision

Chọn **Auth.js v5 + Google OAuth + PostgreSQL database sessions**.

- Provider đầu tiên: Google OAuth.
- User nội bộ: `japan_underwear.users.id` UUID.
- External identity: `japan_underwear.auth_accounts(provider, provider_account_id)`.
- Session: `japan_underwear.auth_sessions`, có thể thu hồi theo user hoặc từng token.
- Role: `customer`, `sales`, `admin` trong `japan_underwear.user_roles`.
- User Google mới mặc định nhận role `customer` bằng trigger DB.
- `sales/admin` chỉ được cấp bằng CLI nội bộ có actor và audit; không có self-service role escalation.
- User `blocked` không được đăng nhập; khi chuyển sang blocked, DB tự xóa toàn bộ session của user.
- Mọi route/page nhạy cảm phải kiểm tra session và role ở server. Client state, cookie tự tạo và route visibility không phải authorization.

## Callback and origin

### Development

- App origin: `http://localhost:3100`
- Google callback: `http://localhost:3100/api/auth/callback/google`

### Production

Production OAuth chỉ được bật khi đã có domain HTTPS thật và cấu hình:

- `APP_ORIGIN=https://<production-domain>`
- callback Google: `${APP_ORIGIN}/api/auth/callback/google`
- `AUTH_TRUST_HOST=true` chỉ trên hạ tầng reverse proxy đã kiểm soát.

Không dùng preview URL làm callback production cố định.

## Environment

- `AUTH_SECRET`
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `APP_ORIGIN`
- `AUTH_TRUST_HOST`

Secret không được commit. `AUTH_SECRET` phải là giá trị ngẫu nhiên mạnh và độc lập theo môi trường.

## Authorization mapping

- `customer`: quyền khách hàng, không được gọi API staff.
- `sales`: đọc/xử lý đơn và thao tác nghiệp vụ được cấp.
- `admin`: quản trị hệ thống; không mặc định cấp cho user mới.

Role được đọc lại từ PostgreSQL khi tạo session response. Các service nhạy cảm phải dùng helper server `requireRole`.

## Onboarding

- Google trả email đã xác minh mới được đăng nhập.
- Lần đăng nhập đầu tạo user UUID + external account + customer role.
- Hồ sơ customer/store/address là phase tiếp theo, tách khỏi bảng auth.
- Việc checkout không login hiện tại tiếp tục hoạt động cho đến khi luồng customer ownership được triển khai và migrate rõ ràng.

## Provider migration

Khi đổi provider:

- giữ nguyên `users.id` và dữ liệu nghiệp vụ;
- thêm identity mới vào `auth_accounts`;
- không đổi FK nghiệp vụ sang provider ID;
- revoke session cũ khi cutover.

## Consequences

Ưu điểm:

- quyền và session nằm trong database do dự án kiểm soát;
- khóa user/revoke session rõ ràng;
- ít phụ thuộc provider hơn hosted auth;
- phù hợp PostgreSQL/Drizzle hiện có.

Đổi lại:

- dự án tự vận hành OAuth credentials, callback, secret rotation và session cleanup;
- production login chưa thể bật trước khi có domain HTTPS thật.

## Rejected options

- Clerk: triển khai nhanh nhưng tăng provider coupling và chi phí/di chuyển về sau.
- Phone OTP không login: phù hợp một số checkout nhưng không đủ cho sales/admin authorization và quản trị session hiện tại.
