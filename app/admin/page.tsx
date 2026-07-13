import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { StaffOrderDashboard } from "@/components/admin/staff-order-dashboard";
import {
  AuthorizationError,
  requireRole,
  STAFF_ROLES,
} from "@/lib/authz";
import { listStaffOrders } from "@/lib/staff-orders";

export const dynamic = "force-dynamic";

async function requireStaffPage() {
  try {
    return await requireRole(STAFF_ROLES);
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect("/dang-nhap?callbackUrl=/admin");
    }
    if (error instanceof AuthorizationError && error.status === 403) {
      return null;
    }
    throw error;
  }
}

export default async function AdminPage() {
  const context = await requireStaffPage();

  if (!context) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f5fa] px-4 text-ink-950">
        <section className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-7 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            403 · Không đủ quyền
          </p>
          <h1 className="mt-2 text-3xl font-black">
            Tài khoản không có quyền staff
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            Customer không được xem dữ liệu đơn nội bộ hoặc gọi API quản lý đơn.
            Quyền sales/admin phải được cấp bằng công cụ nội bộ có audit.
          </p>
          <form
            className="mt-5"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              className="rounded-xl bg-ink-950 px-5 py-3 font-black text-white"
              type="submit"
            >
              Đăng xuất
            </button>
          </form>
        </section>
      </main>
    );
  }

  const orders = await listStaffOrders(null);

  return (
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-8 text-ink-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                Sales / Admin
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">
                Quản lý đơn hàng
              </h1>
              <p className="mt-3 max-w-2xl leading-7 text-slate-600">
                Xem đơn, kiểm tra snapshot và chuyển đơn chờ xử lý sang xác nhận
                hoặc hủy. Mọi thao tác được kiểm tra quyền ở server và ghi audit.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm">
                <p className="font-black">{context.email ?? context.userId}</p>
                <p className="mt-1 text-slate-500">
                  {context.roles.join(", ")}
                </p>
              </div>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black hover:bg-slate-50"
                  type="submit"
                >
                  Đăng xuất
                </button>
              </form>
            </div>
          </div>
        </header>

        <StaffOrderDashboard initialOrders={orders} />
      </div>
    </main>
  );
}
