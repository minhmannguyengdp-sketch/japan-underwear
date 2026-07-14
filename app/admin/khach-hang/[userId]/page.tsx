import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AdminCustomerStatusControl } from "@/components/admin/admin-customer-status-control";
import { AdminCustomerError, getAdminCustomer } from "@/lib/admin-customers";
import { AuthorizationError, requireRole, STAFF_ROLES } from "@/lib/authz";

export const dynamic = "force-dynamic";

function formatVnd(value: number, currency = "VND") {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Chưa có";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function requireStaffPage(callbackUrl: string) {
  try {
    return await requireRole(STAFF_ROLES);
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect(`/dang-nhap?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
    if (error instanceof AuthorizationError && error.status === 403) {
      return null;
    }
    throw error;
  }
}

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const callbackUrl = `/admin/khach-hang/${userId}`;
  const context = await requireStaffPage(callbackUrl);
  if (!context) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f5fa] px-4 text-ink-950">
        <section className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-7 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            403 · Không đủ quyền
          </p>
          <h1 className="mt-2 text-3xl font-black">Tài khoản không có quyền staff</h1>
          <Link
            href="/"
            className="mt-5 inline-block rounded-xl bg-ink-950 px-5 py-3 font-black text-white"
          >
            Về catalog
          </Link>
        </section>
      </main>
    );
  }

  let customer;
  try {
    customer = await getAdminCustomer(userId);
  } catch (error) {
    if (error instanceof AdminCustomerError && error.status === 404) notFound();
    throw error;
  }

  const displayName =
    customer.storeName ?? customer.name ?? customer.email ?? customer.userId;

  return (
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-8 text-ink-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/khach-hang"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black shadow-sm"
          >
            ← Danh sách khách hàng
          </Link>
          <Link
            href="/admin"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black shadow-sm"
          >
            Quản lý đơn hàng
          </Link>
        </div>

        <header className="mt-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                Hồ sơ khách hàng
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                {displayName}
              </h1>
              <p className="mt-3 text-slate-600">{customer.email ?? "Chưa có email"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-3 py-1.5 text-xs font-black ${
                    customer.status === "active"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {customer.status === "active" ? "Đang hoạt động" : "Đã khóa"}
                </span>
                {customer.roles.map((role) => (
                  <span
                    key={role}
                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700"
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 p-4">
              <p className="mb-3 text-sm font-black">Quản trị truy cập</p>
              <AdminCustomerStatusControl
                userId={customer.userId}
                status={customer.status}
                canManage={context.roles.includes("admin")}
              />
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">Số đơn</p>
            <p className="mt-2 text-3xl font-black">{customer.orderCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">Tổng giá trị</p>
            <p className="mt-2 text-2xl font-black text-tt-purple-700">
              {formatVnd(customer.lifetimeValue)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">Session hiện tại</p>
            <p className="mt-2 text-3xl font-black">{customer.sessionCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">Đơn gần nhất</p>
            <p className="mt-2 font-black">{formatDate(customer.lastOrderAt)}</p>
          </div>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-2">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">
              Tài khoản
            </p>
            <dl className="mt-4 grid gap-4 text-sm">
              <div>
                <dt className="font-bold text-slate-500">Tên Google</dt>
                <dd className="mt-1 font-black">{customer.name ?? "Chưa có"}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">Đăng nhập gần nhất</dt>
                <dd className="mt-1 font-black">{formatDate(customer.lastLoginAt)}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">Ngày tạo tài khoản</dt>
                <dd className="mt-1 font-black">{formatDate(customer.createdAt)}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">User ID</dt>
                <dd className="mt-1 break-all font-mono text-xs">{customer.userId}</dd>
              </div>
            </dl>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">
              Hồ sơ đặt hàng
            </p>
            {customer.profileCompleted ? (
              <dl className="mt-4 grid gap-4 text-sm">
                <div>
                  <dt className="font-bold text-slate-500">Cửa hàng</dt>
                  <dd className="mt-1 font-black">{customer.storeName}</dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">Người liên hệ</dt>
                  <dd className="mt-1 font-black">{customer.contactName}</dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">Điện thoại</dt>
                  <dd className="mt-1 font-black">{customer.phone}</dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">Địa chỉ mặc định</dt>
                  <dd className="mt-1 leading-6">{customer.deliveryAddress}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                Khách hàng chưa hoàn tất onboarding.
              </p>
            )}
          </article>
        </section>

        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-xl font-black">Đơn hàng gần đây</h2>
          </div>
          {customer.orders.length === 0 ? (
            <p className="p-8 text-sm font-bold text-slate-500">Khách hàng chưa có đơn.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-4">Mã đơn</th>
                    <th className="px-6 py-4">Trạng thái</th>
                    <th className="px-6 py-4">Số lượng</th>
                    <th className="px-6 py-4">Giá trị</th>
                    <th className="px-6 py-4">Ngày tạo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customer.orders.map((order) => (
                    <tr key={order.orderCode}>
                      <td className="px-6 py-4 font-black">{order.orderCode}</td>
                      <td className="px-6 py-4">{order.status}</td>
                      <td className="px-6 py-4">{order.itemQuantity}</td>
                      <td className="px-6 py-4 font-black">
                        {formatVnd(order.subtotal, order.currency)}
                      </td>
                      <td className="px-6 py-4">{formatDate(order.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black">Audit tài khoản</h2>
          {customer.auditEvents.length === 0 ? (
            <p className="mt-4 text-sm font-bold text-slate-500">Chưa có audit event.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {customer.auditEvents.map((event) => (
                <article key={event.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-col justify-between gap-2 sm:flex-row">
                    <p className="font-black">{event.action}</p>
                    <p className="text-xs font-semibold text-slate-500">
                      {formatDate(event.createdAt)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Actor: {event.actor}</p>
                  <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                    {JSON.stringify(event.details, null, 2)}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
