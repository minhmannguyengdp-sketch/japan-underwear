import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { ManualOrderForm } from "@/components/admin/manual-order-form";
import { listAdminCustomers } from "@/lib/admin-customers";
import {
  AuthorizationError,
  requireRole,
  STAFF_ROLES,
} from "@/lib/authz";
import { listCatalogProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

async function requireStaffPage() {
  try {
    return await requireRole(STAFF_ROLES);
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect("/dang-nhap?callbackUrl=/admin/tao-don");
    }
    if (error instanceof AuthorizationError && error.status === 403) {
      return null;
    }
    throw error;
  }
}

export default async function ManualOrderPage() {
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
            Chỉ sales hoặc admin được tạo đơn tay. Quyền được kiểm tra lại tại API.
          </p>
        </section>
      </main>
    );
  }

  const [customerRows, productRows] = await Promise.all([
    listAdminCustomers(null),
    listCatalogProducts({ limit: 200 }),
  ]);
  const customers = customerRows
    .filter(
      (customer) =>
        customer.status === "active" &&
        customer.profileCompleted &&
        customer.contactName &&
        customer.phone &&
        customer.deliveryAddress,
    )
    .map((customer) => ({
      userId: customer.userId,
      label: [customer.storeName, customer.contactName, customer.email]
        .filter(Boolean)
        .join(" · "),
      phone: customer.phone as string,
      deliveryAddress: customer.deliveryAddress as string,
    }));
  const products = productRows.filter((product) => product.orderable);

  return (
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-8 text-ink-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                Sales / Admin
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Tạo đơn tay</h1>
              <p className="mt-3 max-w-2xl leading-7 text-slate-600">
                Đơn tay và checkout khách dùng chung một service tính giá, kiểm tra catalog,
                chụp snapshot item và ghi outbox trong cùng transaction.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/admin"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black hover:bg-slate-50"
                >
                  Đơn hàng
                </Link>
                <Link
                  href="/admin/tao-don"
                  className="rounded-xl bg-tt-purple-700 px-4 py-2.5 text-sm font-black text-white"
                >
                  Tạo đơn tay
                </Link>
                <Link
                  href="/admin/khach-hang"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black hover:bg-slate-50"
                >
                  Khách hàng
                </Link>
              </div>
              <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm">
                <p className="font-black">{context.email ?? context.userId}</p>
                <p className="mt-1 text-slate-500">{context.roles.join(", ")}</p>
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

        <ManualOrderForm customers={customers} products={products} />
      </div>
    </main>
  );
}