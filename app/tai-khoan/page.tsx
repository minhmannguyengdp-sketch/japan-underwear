import Link from "next/link";
import { redirect } from "next/navigation";

import { CustomerProfileForm } from "@/components/customer-profile-form";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/authz";
import { getCustomerProfile } from "@/lib/customer-profile";

export const dynamic = "force-dynamic";

export default async function CustomerProfilePage() {
  let authorization;
  try {
    authorization = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 401) {
      redirect("/dang-nhap?callbackUrl=/tai-khoan");
    }
    throw error;
  }

  const profile = await getCustomerProfile(authorization.userId);

  return (
    <main className="min-h-screen bg-[#f7f5fa] px-4 py-8 text-ink-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black shadow-sm"
          >
            ← Catalog
          </Link>
          <Link
            href="/don-hang"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black shadow-sm"
          >
            Đơn hàng của tôi
          </Link>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
            Hồ sơ đặt hàng
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight">
            {profile ? "Thông tin cửa hàng" : "Hoàn tất onboarding"}
          </h1>
          <p className="mt-3 leading-7 text-slate-600">
            Checkout không tin dữ liệu tên, điện thoại hay địa chỉ gửi từ trình duyệt. Hệ thống đọc
            hồ sơ này ở server và lưu snapshot vào từng đơn hàng.
          </p>

          <CustomerProfileForm
            initialProfile={profile}
            defaultContactName={authorization.name ?? ""}
          />
        </section>
      </div>
    </main>
  );
}
