import Link from "next/link";
import { redirect } from "next/navigation";

import { listAdminCustomers } from "@/lib/admin-customers";
import { AuthorizationError, requireRole, STAFF_ROLES } from "@/lib/authz";

export const dynamic = "force-dynamic";

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
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

async function requireStaffPage() {
  try {
    return await requireRole(STAFF_ROLES);
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect("/dang-nhap?callbackUrl=/admin/khach-hang");
    }
    if (error instanceof AuthorizationError && error.status === 403) {
      return null;
    }
    throw error;
  }
}

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireStaffPage();
  if (!context) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f5fa] px-4 text-ink-950">
        <section className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-7 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            403 · Không đủ quyền
          </p>
          <h1 className="mt-2 text-3xl font-black">Tài khoản không có quyền staff</h1>
          <p className="mt-3 leading-7 text-slate-600">
            Chỉ sales hoặc admin được xem dữ liệu khách hàng nội bộ.
          </p>
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

  const params = await searchParams;
  const search = queryValue(params.q).trim();
  const customers = await listAdminCustomers(search);
  const activeCount = customers.filter((customer) => customer.status === "active").length;
  const profileCount = customers.filter((customer) => customer.profileCompleted).length;

  return (
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-8 text-ink-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                Sales / Admin
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Khách hàng</h1>
              <p className="mt-3 max-w-3xl leading-7 text-slate-600">
                Tra cứu tài khoản, hồ sơ cửa hàng, số đơn và lịch sử hoạt động. Sales chỉ xem;
                admin mới được khóa hoặc mở khóa tài khoản.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black hover:bg-slate-50"
              >
                Đơn hàng
              </Link>
              <Link
                href="/admin/khach-hang"
                className="rounded-xl bg-tt-purple-700 px-4 py-2.5 text-sm font-black text-white"
              >
                Khách hàng
              </Link>
              <div className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm">
                <strong>{context.email ?? context.userId}</strong>
                <span className="ml-2 text-slate-500">{context.roles.join(", ")}</span>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">Kết quả</p>
            <p className="mt-2 text-3xl font-black">{customers.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">Đang hoạt động</p>
            <p className="mt-2 text-3xl font-black text-emerald-700">{activeCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">Đã hoàn tất hồ sơ</p>
            <p className="mt-2 text-3xl font-black text-tt-purple-700">{profileCount}</p>
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <form className="flex flex-col gap-3 sm:flex-row" method="get">
            <input
              type="search"
              name="q"
              defaultValue={search}
              maxLength={160}
              placeholder="Email, cửa hàng, người liên hệ, điện thoại, địa chỉ..."
              className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-4 outline-none focus:border-tt-purple-500"
            />
            <button
              type="submit"
              className="h-12 rounded-xl bg-ink-950 px-6 font-black text-white"
            >
              Tìm khách hàng
            </button>
            {search && (
              <Link
                href="/admin/khach-hang"
                className="grid h-12 place-items-center rounded-xl border border-slate-200 px-5 font-black"
              >
                Xóa lọc
              </Link>
            )}
          </form>
        </section>

        <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {customers.length === 0 ? (
            <div className="p-10 text-center text-sm font-bold text-slate-500">
              Không tìm thấy khách hàng phù hợp.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Khách hàng</th>
                    <th className="px-5 py-4">Trạng thái</th>
                    <th className="px-5 py-4">Đơn hàng</th>
                    <th className="px-5 py-4">Hoạt động gần nhất</th>
                    <th className="px-5 py-4 text-right">Chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {customers.map((customer) => (
                    <tr key={customer.userId} className="align-top hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <p className="font-black">
                          {customer.storeName ?? customer.name ?? customer.email ?? customer.userId}
                        </p>
                        <p className="mt-1 text-slate-500">
                          {customer.contactName ?? "Chưa có người liên hệ"}
                          {customer.phone ? ` · ${customer.phone}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">{customer.email ?? "Chưa có email"}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${
                            customer.status === "active"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {customer.status === "active" ? "Hoạt động" : "Đã khóa"}
                        </span>
                        <p className="mt-2 text-xs font-semibold text-slate-500">
                          {customer.roles.join(", ")}
                        </p>
                        {!customer.profileCompleted && (
                          <p className="mt-1 text-xs font-bold text-amber-700">Chưa hoàn tất hồ sơ</p>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-black">{customer.orderCount} đơn</p>
                        <p className="mt-1 text-slate-500">{formatVnd(customer.lifetimeValue)}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        <p>Đơn: {formatDate(customer.lastOrderAt)}</p>
                        <p className="mt-1">Đăng nhập: {formatDate(customer.lastLoginAt)}</p>
                        <p className="mt-1 text-xs text-slate-400">{customer.sessionCount} session</p>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Link
                          href={`/admin/khach-hang/${customer.userId}`}
                          className="inline-flex rounded-xl border border-slate-200 px-4 py-2 font-black hover:bg-white"
                        >
                          Xem
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
