import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { CustomerProfileForm } from "@/components/customer-profile-form";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/authz";
import {
  getCustomerProfile,
  getCustomerProfileCapabilities,
} from "@/lib/customer-profile";

export const dynamic = "force-dynamic";

const WELCOME_URL = "https://japan-underwear.vercel.app/chao-mung";

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

  const [profile, profileCapabilities] = await Promise.all([
    getCustomerProfile(authorization.userId),
    getCustomerProfileCapabilities(),
  ]);
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
        <Link href="/cua-hang">
          <span className="account-quick-links__icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 5.5h14v15H5zM8 5.5a4 4 0 0 1 8 0" />
            </svg>
          </span>
          <div><strong>Mở cửa hàng</strong><small>Xem sản phẩm Pensee và Winking</small></div>
          <b>→</b>
        </Link>
        <Link href="/don-hang">
          <span className="account-quick-links__icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
            </svg>
          </span>
          <div><strong>Đơn hàng của tôi</strong><small>Xem trạng thái và chi tiết đơn</small></div>
          <b>→</b>
        </Link>
        <Link href="/su-kien">
          <span className="account-quick-links__icon">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 4h14v16H5zM8 2v4M16 2v4M5 9h14" />
            </svg>
          </span>
          <div><strong>Sự kiện</strong><small>Xem ưu đãi và thông báo mới</small></div>
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
          Hệ thống dùng thông tin này làm snapshot cho từng đơn hàng. Hãy giữ số điện thoại,
          địa chỉ và vị trí shop luôn chính xác.
        </p>
        <CustomerProfileForm
          initialProfile={profile}
          defaultContactName={authorization.name ?? ""}
          shopLocationAvailable={profileCapabilities.shopLocation}
        />
      </section>

      <section className="account-qr-card">
        <div className="account-qr-card__copy">
          <span>Mã QR ứng dụng</span>
          <h2>Mở thẳng trang chào mừng</h2>
          <p>Quét mã bằng camera điện thoại để mở đúng bản live của ứng dụng.</p>
          <a href={WELCOME_URL} target="_blank" rel="noreferrer">
            {WELCOME_URL}
          </a>
        </div>
        <div className="account-qr-card__image">
          <img
            src="/brand/japan-underwear-welcome-qr.svg"
            alt="Mã QR mở trang chào mừng Japan Underwear"
          />
          <a href="/brand/japan-underwear-welcome-qr.svg" download>
            Tải mã QR
          </a>
        </div>
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
