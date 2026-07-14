import Link from "next/link";
import { redirect } from "next/navigation";

import { CatalogManagement } from "@/components/admin/catalog-management";
import { AuthorizationError, requireRole, STAFF_ROLES } from "@/lib/authz";
import { listManagedCatalog } from "@/lib/catalog-admin";
import type { CatalogAdminStatusFilter } from "@/lib/catalog-admin-types";

export const dynamic = "force-dynamic";

async function requireStaffPage() {
  try {
    return await requireRole(STAFF_ROLES);
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect("/dang-nhap?callbackUrl=/admin/catalog");
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

export default async function CatalogAdminPage({
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
            Chỉ sales hoặc admin được xem catalog nội bộ.
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
  const q = queryValue(params.q).trim();
  const statusValue = queryValue(params.status);
  const status: CatalogAdminStatusFilter =
    statusValue === "active" || statusValue === "inactive" ? statusValue : "all";
  const catalog = await listManagedCatalog({ q, status, limit: 200 });
  const activeProducts = catalog.products.filter((product) => product.isActive).length;
  const activeVariants = catalog.products.reduce(
    (total, product) =>
      total + product.variants.filter((variant) => variant.isActive).length,
    0,
  );
  const overrideCount = catalog.products.reduce(
    (total, product) =>
      total + product.variants.filter((variant) => variant.priceOverride !== null).length,
    0,
  );
  const canEdit = context.roles.includes("admin");

  return (
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-8 text-ink-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                Sales / Admin
              </p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">
                Catalog và bảng giá
              </h1>
              <p className="mt-3 max-w-3xl leading-7 text-slate-600">
                Sales được xem toàn bộ giá và trạng thái. Admin được sửa dữ liệu hiển thị,
                giá cơ bản, giá riêng theo biến thể và trạng thái bán. Mỗi thay đổi dùng
                optimistic concurrency và được ghi audit trong database.
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 lg:items-end">
              <div className="flex flex-wrap gap-2">
                <Link href="/admin" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black hover:bg-slate-50">Đơn hàng</Link>
                <Link href="/admin/tao-don" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black hover:bg-slate-50">Tạo đơn tay</Link>
                <Link href="/admin/khach-hang" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black hover:bg-slate-50">Khách hàng</Link>
                <Link href="/admin/catalog" className="rounded-xl bg-tt-purple-700 px-4 py-2.5 text-sm font-black text-white">Catalog</Link>
              </div>
              <div className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm">
                <strong>{context.email ?? context.userId}</strong>
                <span className="ml-2 text-slate-500">{context.roles.join(", ")}</span>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Sản phẩm trong kết quả</p><p className="mt-2 text-3xl font-black">{catalog.products.length}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Sản phẩm đang bán</p><p className="mt-2 text-3xl font-black text-emerald-700">{activeProducts}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Biến thể đang bán</p><p className="mt-2 text-3xl font-black text-tt-purple-700">{activeVariants}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-bold text-slate-500">Giá override</p><p className="mt-2 text-3xl font-black text-amber-700">{overrideCount}</p></div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <form className="grid gap-3 md:grid-cols-[1fr_180px_auto_auto]" method="get">
            <input type="search" name="q" defaultValue={q} maxLength={160} placeholder="Model, tên sản phẩm, brand hoặc category..." className="h-12 min-w-0 rounded-xl border border-slate-200 px-4 outline-none focus:border-tt-purple-500" />
            <select name="status" defaultValue={status} className="h-12 rounded-xl border border-slate-200 bg-white px-4 font-bold">
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang bán</option>
              <option value="inactive">Ngừng bán</option>
            </select>
            <button type="submit" className="h-12 rounded-xl bg-ink-950 px-6 font-black text-white">Lọc catalog</button>
            {(q || status !== "all") && <Link href="/admin/catalog" className="grid h-12 place-items-center rounded-xl border border-slate-200 px-5 font-black">Xóa lọc</Link>}
          </form>
        </section>

        <CatalogManagement
          initialProducts={catalog.products}
          auditEvents={catalog.auditEvents}
          canEdit={canEdit}
        />
      </div>
    </main>
  );
}
