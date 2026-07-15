import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthorizationError, requireAuthenticatedUser } from "@/lib/authz";
import type { CustomerOrderStatus } from "@/lib/customer-order-types";
import { listCustomerOrders } from "@/lib/customer-orders";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  submitted: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  processing: "Đang xử lý",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
};

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
}

async function requireCustomerPage() {
  try {
    return await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect("/dang-nhap?callbackUrl=/don-hang");
    }
    throw error;
  }
}

export default async function CustomerOrdersPage() {
  const authorization = await requireCustomerPage();
  const orders = await listCustomerOrders(authorization.userId);

  return (
    <main className="customer-orders-page">
      <section className="orders-hero">
        <span className="customer-kicker">Lịch sử mua hàng</span>
        <h1>Đơn hàng của tôi</h1>
        <p>Theo dõi trạng thái các đơn được tạo từ tài khoản này.</p>
        <div className="orders-hero__account">
          <div>{(authorization.name ?? authorization.email ?? "K").slice(0, 1).toLocaleUpperCase("vi")}</div>
          <span>
            <strong>{authorization.name ?? authorization.email ?? authorization.userId}</strong>
            {authorization.email && authorization.name ? <small>{authorization.email}</small> : null}
          </span>
        </div>
      </section>

      {orders.length === 0 ? (
        <section className="orders-empty">
          <span className="orders-empty__icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
            </svg>
          </span>
          <h2>Chưa có đơn nào</h2>
          <p>Đơn mới sẽ xuất hiện ở đây ngay sau khi đặt hàng thành công.</p>
          <Link href="/cua-hang">Xem sản phẩm</Link>
        </section>
      ) : (
        <section className="orders-list">
          <div className="customer-section-heading">
            <div><span>Danh sách đơn</span><h2>{orders.length} đơn gần nhất</h2></div>
          </div>
          {orders.map((order) => (
            <Link
              key={order.orderCode}
              href={`/don-hang/${encodeURIComponent(order.orderCode)}`}
              className="customer-order-card"
            >
              <div className="customer-order-card__top">
                <div><small>Mã đơn</small><strong>{order.orderCode}</strong></div>
                <em data-status={order.status}>{STATUS_LABELS[order.status]}</em>
              </div>
              <div className="customer-order-card__meta">
                <span>{formatDate(order.createdAt)}</span>
                <span>{order.itemQuantity} sản phẩm</span>
              </div>
              <div className="customer-order-card__bottom">
                <div><small>Giao cho</small><strong>{order.customerName}</strong><span>{order.customerPhone}</span></div>
                <b>{formatMoney(order.subtotal, order.currency)}</b>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
