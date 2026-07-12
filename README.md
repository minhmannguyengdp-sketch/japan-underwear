# Tuấn Thủy Ordering App

Ứng dụng đặt hàng B2B/PWA dành cho khách hàng và đội sales của Tuấn Thủy.

## Trạng thái

Repository đang ở giai đoạn lập kế hoạch và thiết kế nền tảng. Chưa chốt phương án đăng nhập.

## Kiến trúc dự kiến

- Next.js App Router: frontend, PWA và API
- Heroku: chạy ứng dụng
- Heroku Postgres: dữ liệu nghiệp vụ
- Cloudflare R2: ảnh và tài sản catalog
- Drizzle ORM + PostgreSQL transaction
- Auth: **deferred decision**; sẽ chốt tại checkpoint riêng trước khi làm tài khoản khách

## Tài liệu

- [Kế hoạch thực thi](docs/IMPLEMENTATION_PLAN.md)

## Nguyên tắc

- Không tin giá, tổng tiền hoặc thông tin sản phẩm gửi từ client.
- Mọi đơn hàng được tính lại và ghi bằng transaction phía server.
- Dữ liệu đơn hàng lưu snapshot để không bị thay đổi khi catalog cập nhật.
- Tách auth provider khỏi khóa chính nghiệp vụ.
- Không lưu file trên filesystem của Heroku dyno.
