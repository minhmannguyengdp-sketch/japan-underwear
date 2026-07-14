import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/authz";
import type { CustomerOrderStatus } from "@/lib/customer-order-types";
import { listCustomerOrders } from "@/lib/customer-orders";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  submitted: "Đang chờ xác nhận",
  confirmed: "Đã xác nhận",
  processing: "Đang xử lý",
  completed: "Đã hoàn tất",
  cancelled: "Đã hủy",
};

const STATUS_CLASSES: Record<CustomerOrderStatus, string> = {
  submitted: "bg-amber-100 text-amber-800",
  confirmed: "bg-sky-100 text-sky-800",
  processing: "bg-violet-100 text-violet-800",
  completed: "bg-emerald-100 text-emerald-800",
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
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-8 text-ink-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                Tài khoản khách hàng
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Đơn hàng của tôi</h1>
              <p className="mt-3 max-w-2xl leading-7 text-slate-600">
                Chỉ các đơn được tạo từ tài khoản đang đăng nhập mới xuất hiện tại đây.
                Đơn cũ trước khi có tài khoản vẫn được giữ cho staff xử lý nhưng không tự gán nhầm owner.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/"
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black hover:bg-slate-50"
              >
                Tiếp tục đặt hàng
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="rounded-xl bg-ink-950 px-4 py-2.5 text-sm font-black text-white"
                >
                  Đăng xuất
                </button>
              </form>
            </div>
          </div>
          <div className="mt-5 rounded-2xl bg-slate-100 px-4 py-3 text-sm">
            <p className="font-black">{authorization.name ?? authorization.email ?? authorization.userId}</p>
            {authorization.email && authorization.name ? (
              <p className="mt-1 text-slate-500">{authorization.email}</p>
            ) : null}
          </div>
        </header>

        {orders.length === 0 ? (
          <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-4xl">🧾</p>
            <h2 className="mt-4 text-2xl font-black">Chưa có đơn nào</h2>
            <p className="mx-auto mt-3 max-w-xl leading-7 text-slate-600">
              Thêm sản phẩm vào giỏ và đăng nhập bằng tài khoản này khi tạo đơn. Đơn mới sẽ
              xuất hiện ngay sau khi checkout thành công.
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex rounded-xl bg-tt-purple-700 px-5 py-3 font-black text-white"
            >
              Mở catalog
            </Link>
          </section>
        ) : (
          <section className="mt-6 space-y-4">
            {orders.map((order) => (
              <Link
                key={order.orderCode}
                href={`/don-hang/${encodeURIComponent(order.orderCode)}`}
                className="block rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-xl font-black">{order.orderCode}</h2>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${STATUS_CLASSES[order.status]}`}
                      >
                        {STATUS_LABELS[order.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{formatDate(order.createdAt)}</p>
                    <p className="mt-3 text-sm font-semibold text-slate-600">
                      {order.itemQuantity} sản phẩm · {order.customerName} · {order.customerPhone}
                    </p>
                    {order.deliveryAddress ? (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-500">
                        {order.deliveryAddress}
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:text-right">
                    <p className="text-xl font-black text-tt-purple-700">
                      {formatMoney(order.subtotal, order.currency)}
                    </p>
                    <p className="mt-2 text-sm font-black text-slate-500">Xem chi tiết →</p>
                  </div>
                </div>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
