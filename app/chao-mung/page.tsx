import Link from "next/link";

export default function WelcomePage() {
  return (
    <main className="welcome-screen">
      <div className="welcome-screen__art" aria-hidden="true" />

      <header className="welcome-screen__topbar">
        <img
          src="/brand/pensee-logo-transparent.svg"
          alt="Pensee"
          className="welcome-screen__mark"
        />
        <Link href="/dang-nhap?callbackUrl=/tai-khoan" className="welcome-screen__login">
          Đăng nhập
        </Link>
      </header>

      <section className="welcome-screen__content">
        <p className="welcome-screen__eyebrow">Tuấn Thủy · Đặt hàng sỉ</p>
        <h1>Vẻ đẹp bắt đầu từ lựa chọn vừa vặn.</h1>
        <p className="welcome-screen__copy">
          Khám phá Pensee và Winking, chọn đúng màu, đúng size/cup và theo dõi đơn ngay
          trên điện thoại.
        </p>

        <Link href="/" className="welcome-screen__button">
          <span>Bắt đầu</span>
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 12h14M14 7l5 5-5 5" />
          </svg>
        </Link>

        <p className="welcome-screen__footnote">
          Catalog và giá được đồng bộ từ hệ thống Tuấn Thủy.
        </p>
      </section>
    </main>
  );
}
