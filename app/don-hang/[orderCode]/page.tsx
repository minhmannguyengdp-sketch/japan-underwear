import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthorizationError, requireAuthenticatedUser } from "@/lib/authz";
import type { CustomerOrderStatus } from "@/lib/customer-order-types";
import { CustomerOrderError, getCustomerOrder } from "@/lib/customer-orders";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  submitted: "Đang chờ xác nhận",
  confirmed: "Đã xác nhận",
  cancelled: "Đã hủy",
};

const STATUS_CLASSES: Record<CustomerOrderStatus, string> = {
  submitted: "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-200 text-slate-700",
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
    dateStyle: "medium",
    timeStyle: "short",
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
    if (error instanceof CustomerOrderError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-8 text-ink-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap gap-3">
          <Link
            href="/don-hang"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black shadow-sm"
          >
            ← Đơn hàng của tôi
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black shadow-sm"
          >
            Catalog
          </Link>
        </div>

        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                Chi tiết đơn hàng
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">{order.orderCode}</h1>
              <p className="mt-2 text-sm text-slate-500">Tạo lúc {formatDate(order.createdAt)}</p>
            </div>
            <div className="sm:text-right">
              <span
                className={`inline-flex rounded-full px-4 py-2 text-sm font-black ${STATUS_CLASSES[order.status]}`}
              >
                {STATUS_LABELS[order.status]}
              </span>
              <p className="mt-3 text-2xl font-black text-tt-purple-700">
                {formatMoney(order.subtotal, order.currency)}
              </p>
            </div>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-black">Sản phẩm</h2>
            <div className="mt-4 divide-y divide-slate-100">
              {order.items.map((item) => (
                <article key={item.id} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-tt-purple-700">
                        Mã {item.productCode}
                      </p>
                      <h3 className="mt-1 font-black">{item.productName}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Màu {item.colorName} ({item.colorCode}) · Size/cup {variantLabel(item.sizeCode, item.cupCode)}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-600">
                        {item.quantity} × {formatMoney(item.unitPrice, order.currency)}
                      </p>
                    </div>
                    <p className="shrink-0 font-black">
                      {formatMoney(item.lineTotal, order.currency)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">Giao hàng</h2>
              <dl className="mt-4 space-y-4 text-sm">
                <div>
                  <dt className="font-black text-slate-500">Người nhận</dt>
                  <dd className="mt-1 font-semibold">{order.customerName}</dd>
                </div>
                <div>
                  <dt className="font-black text-slate-500">Số điện thoại</dt>
                  <dd className="mt-1 font-semibold">{order.customerPhone}</dd>
                </div>
                <div>
                  <dt className="font-black text-slate-500">Địa chỉ</dt>
                  <dd className="mt-1 leading-6">{order.deliveryAddress ?? "Chưa cung cấp"}</dd>
                </div>
                {order.location ? (
                  <div>
                    <dt className="font-black text-slate-500">Vị trí đã chia sẻ</dt>
                    <dd className="mt-1 break-all leading-6">
                      {order.location.latitude.toFixed(6)}, {order.location.longitude.toFixed(6)}
                      <br />
                      Độ chính xác khoảng {Math.round(order.location.accuracyMeters)} m
                    </dd>
                  </div>
                ) : null}
                {order.note ? (
                  <div>
                    <dt className="font-black text-slate-500">Ghi chú</dt>
                    <dd className="mt-1 whitespace-pre-wrap leading-6">{order.note}</dd>
                  </div>
                ) : null}
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">Lịch sử trạng thái</h2>
              <ol className="mt-4 space-y-4">
                {order.history.map((event) => (
                  <li key={event.id} className="border-l-2 border-tt-purple-200 pl-4">
                    <p className="font-black">{STATUS_LABELS[event.toStatus]}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(event.createdAt)}</p>
                    {event.reason ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {event.reason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
