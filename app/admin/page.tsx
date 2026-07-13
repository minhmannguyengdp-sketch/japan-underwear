import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { getAuthorizationContext, STAFF_ROLES } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const context = await getAuthorizationContext();
  if (!context) {
    redirect("/dang-nhap?callbackUrl=/admin");
  }

  const hasStaffRole = context.roles.some((role) => STAFF_ROLES.includes(role as "sales" | "admin"));
  if (!hasStaffRole) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f5fa] px-4 text-ink-950">
        <section className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-7 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">403 · Không đủ quyền</p>
          <h1 className="mt-2 text-3xl font-black">Tài khoản chưa có quyền staff</h1>
          <p className="mt-3 leading-7 text-slate-600">
            User đã đăng nhập nhưng chỉ có role customer. Quyền sales/admin phải được cấp bằng công cụ nội bộ có audit.
          </p>
          <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold">
            {context.email ?? context.userId}
          </p>
          <form
            className="mt-5"
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="rounded-xl bg-ink-950 px-5 py-3 font-black text-white" type="submit">
              Đăng xuất
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-10 text-ink-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-7 shadow-xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
              Admin authorization shell
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Đăng nhập và role guard đã hoạt động</h1>
            <p className="mt-3 max-w-2xl leading-7 text-slate-600">
              Đây chưa phải dashboard đơn hàng. Shell này chỉ nghiệm thu session database và quyền sales/admin trước khi mở API quản trị.
            </p>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-black" type="submit">
              Đăng xuất
            </button>
          </form>
        </div>

        <dl className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-100 p-4">
            <dt className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">User</dt>
            <dd className="mt-2 break-all font-black">{context.email ?? context.userId}</dd>
          </div>
          <div className="rounded-2xl bg-slate-100 p-4">
            <dt className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Roles</dt>
            <dd className="mt-2 font-black">{context.roles.join(", ")}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
