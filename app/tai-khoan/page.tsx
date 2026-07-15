import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/auth";
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
  const displayName = authorization.name ?? authorization.email ?? authorization.userId;

  return (
    <main className="customer-account-page">
      <section className="account-summary-card">
        <div className="account-summary-card__avatar">
          {displayName.slice(0, 1).toLocaleUpperCase("vi")}
        </div>
        <div>
          <span>Tài khoản khách hàng</span>
          <h1>{displayName}</h1>
          {authorization.email ? <p>{authorization.email}</p> : null}
        </div>
      </section>

      <section className="account-quick-links">
        <Link href="/don-hang">
          <span className="account-quick-links__icon">🧾</span>
          <div><strong>Đơn hàng của tôi</strong><small>Xem trạng thái và chi tiết đơn</small></div>
          <b>→</b>
        </Link>
        <Link href="/cua-hang">
          <span className="account-quick-links__icon">🛍️</span>
          <div><strong>Tiếp tục mua hàng</strong><small>Mở catalog Pensee và Winking</small></div>
          <b>→</b>
        </Link>
      </section>

      <section className="account-profile-card">
        <div className="customer-section-heading">
          <div>
            <span>Hồ sơ đặt hàng</span>
            <h2>{profile ? "Thông tin giao hàng" : "Hoàn tất hồ sơ"}</h2>
          </div>
          <em>{profile ? "Đã lưu" : "Cần bổ sung"}</em>
        </div>
        <p className="account-profile-card__intro">
          Hệ thống dùng thông tin này làm snapshot cho từng đơn. Cart và checkout không nhận lại tên, điện thoại hay địa chỉ từ trình duyệt.
        </p>
        <CustomerProfileForm initialProfile={profile} defaultContactName={authorization.name ?? ""} />
      </section>

      <form
        className="account-signout"
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit">Đăng xuất khỏi tài khoản</button>
      </form>
    </main>
  );
}
