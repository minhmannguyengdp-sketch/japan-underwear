import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthorizationError, requireAuthenticatedUser } from "@/lib/authz";
import type { CustomerOrderStatus } from "@/lib/customer-order-types";
import { CustomerOrderError, getCustomerOrder } from "@/lib/customer-orders";

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

function variantLabel(size: string, cup: string | null) {
  return cup ? `${size}${cup}` : size;
}

type PageProps = {
  params: Promise<{ orderCode: string }>;
};

export default async function CustomerOrderDetailPage({ params }: PageProps) {
  const { orderCode } = await params;
  let authorization;
  try {
    authorization = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect(`/dang-nhap?callbackUrl=${encodeURIComponent(`/don-hang/${orderCode}`)}`);
    }
    throw error;
  }

  let order;
  try {
    order = await getCustomerOrder(authorization.userId, orderCode);
  } catch (error) {
    if (error instanceof CustomerOrderError) notFound();
    throw error;
  }

  return (
    <main className="customer-order-detail">
      <Link href="/don-hang" className="customer-back-link">← Danh sách đơn</Link>

      <section className="order-detail-hero">
        <div><span className="customer-kicker">Chi tiết đơn hàng</span><h1>{order.orderCode}</h1><p>Tạo lúc {formatDate(order.createdAt)}</p></div>
        <em data-status={order.status}>{STATUS_LABELS[order.status]}</em>
        <strong>{formatMoney(order.subtotal, order.currency)}</strong>
      </section>

      <section className="order-detail-section">
        <div className="customer-section-heading"><div><span>Sản phẩm</span><h2>{order.items.length} dòng hàng</h2></div></div>
        <div className="order-detail-items">
          {order.items.map((item) => (
            <article key={item.id}>
              <div className="order-detail-items__top"><div><small>{item.productCode}</small><strong>{item.productName}</strong><span>Màu {item.colorName} · {variantLabel(item.sizeCode, item.cupCode)}</span></div><b>{formatMoney(item.lineTotal, order.currency)}</b></div>
              <p>{item.quantity} × {formatMoney(item.unitPrice, order.currency)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="order-detail-section">
        <div className="customer-section-heading"><div><span>Giao hàng</span><h2>Thông tin nhận hàng</h2></div></div>
        <dl className="order-delivery-grid">
          <div><dt>Người nhận</dt><dd>{order.customerName}</dd></div>
          <div><dt>Số điện thoại</dt><dd>{order.customerPhone}</dd></div>
          <div className="is-wide"><dt>Địa chỉ</dt><dd>{order.deliveryAddress ?? "Chưa cung cấp"}</dd></div>
          {order.location ? <div className="is-wide"><dt>Vị trí đã chia sẻ</dt><dd>{order.location.latitude.toFixed(6)}, {order.location.longitude.toFixed(6)} · khoảng {Math.round(order.location.accuracyMeters)} m</dd></div> : null}
          {order.note ? <div className="is-wide"><dt>Ghi chú</dt><dd>{order.note}</dd></div> : null}
        </dl>
      </section>

      <section className="order-detail-section">
        <div className="customer-section-heading"><div><span>Tiến trình</span><h2>Lịch sử trạng thái</h2></div></div>
        <ol className="order-timeline">
          {order.history.map((event) => (
            <li key={event.id}>
              <span />
              <div><strong>{STATUS_LABELS[event.toStatus]}</strong><small>{formatDate(event.createdAt)}</small>{event.reason ? <p>{event.reason}</p> : null}</div>
            </li>
          ))}
        </ol>
      </section>

      <Link href="/cua-hang" className="customer-button customer-button--primary customer-order-detail__shop">Tiếp tục mua hàng</Link>
    </main>
  );
}
