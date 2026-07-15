import Link from "next/link";

export default function WelcomePage() {
  return (
    <main className="fashion-welcome">
      <div className="fashion-welcome__backdrop" aria-hidden="true" />

      <header className="fashion-welcome__topbar">
        <span aria-hidden="true" />
        <Link href="/dang-nhap?callbackUrl=/tai-khoan" className="fashion-welcome__login">
          Đăng nhập
        </Link>
      </header>

      <section className="fashion-welcome__brand">
        <img src="/brand/pensee-logo.png" alt="Pensee" className="fashion-welcome__logo" />
        <h1>
          <span>Welcome to</span>
          <strong>Pensee</strong>
        </h1>
        <div className="fashion-welcome__divider" aria-hidden="true">
          <span />
          <b>✦</b>
          <span />
        </div>
        <p>Nội y tôn vinh vẻ đẹp của bạn.</p>
        <small>Thoải mái. Tự tin. Là chính bạn.</small>
      </section>

      <section className="fashion-welcome__visual" aria-label="Bộ sưu tập Pensee">
        <div className="fashion-welcome__product-art" aria-hidden="true" />
        <div className="fashion-welcome__visual-fade" aria-hidden="true" />
      </section>

      <section className="fashion-welcome__actions">
        <Link href="/cua-hang" className="fashion-welcome__primary">
          <span>Mua ngay</span>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 12h14M14 7l5 5-5 5" />
          </svg>
        </Link>
        <Link href="/su-kien" className="fashion-welcome__secondary">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="fashion-welcome__hanger">
            <path d="M12 5a2 2 0 1 0-2-2M12 5v3l-8 6h16l-8-6" />
          </svg>
          <span>Khám phá bộ sưu tập</span>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 12h14M14 7l5 5-5 5" />
          </svg>
        </Link>
      </section>

      <footer className="fashion-welcome__trust">
        <span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 21c5-3 8-7 8-12-5 0-8-3-8-3S9 9 4 9c0 5 3 9 8 12Z" /></svg>
          Chất lượng
        </span>
        <i />
        <span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3 8 8 9 5-1 8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
          Đặt hàng an toàn
        </span>
        <i />
        <span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><path d="M12 5v14M5 12h14" /></svg>
          Dành cho bạn
        </span>
      </footer>
    </main>
  );
}
