import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";

function safeCallbackUrl(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return "/admin";
  return candidate;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const session = await auth();
  if (
    session?.user?.status === "active" &&
    session.user.roles.some((role) => role === "sales" || role === "admin")
  ) {
    redirect(callbackUrl);
  }

  const hasError = Boolean(params.error);

  return (
    <main className="customer-signin-page">
      <section className="signin-brand-panel">
        <div className="signin-brand-panel__art" aria-hidden="true" />
        <img src="/brand/pensee-logo-transparent.svg" alt="Pensee" />
        <span>Tuấn Thủy · Đặt hàng sỉ</span>
        <h1>Chào mừng bạn trở lại.</h1>
        <p>Đăng nhập để lưu hồ sơ cửa hàng, đặt sản phẩm và theo dõi đúng đơn của mình.</p>
      </section>

      <section className="signin-card">
        <span className="customer-kicker">Tài khoản Google</span>
        <h2>Tiếp tục vào ứng dụng</h2>
        <p>Dùng đúng tài khoản đã đăng ký với Tuấn Thủy.</p>

        {hasError ? (
          <p className="customer-alert customer-alert--error">
            Không đăng nhập được. Kiểm tra tài khoản hoặc cấu hình Google OAuth rồi thử lại.
          </p>
        ) : null}

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl });
          }}
        >
          <button type="submit" className="signin-google-button">
            <span aria-hidden="true">G</span>
            Đăng nhập bằng Google
          </button>
        </form>
        <small>Ứng dụng chỉ dùng thông tin tài khoản để xác thực và gắn đúng đơn hàng.</small>
        <Link href="/" className="signin-back-link">← Trở về trang chủ</Link>
      </section>
    </main>
  );
}
