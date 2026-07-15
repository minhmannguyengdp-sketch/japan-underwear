import Link from "next/link";

export default function WelcomePage() {
  return (
    <main className="fashion-welcome">
      <div className="fashion-welcome__backdrop" aria-hidden="true" />

      <section className="fashion-welcome__brand">
        <img
          src="/brand/pensee-logo-current.png"
          alt="Pensee"
          className="fashion-welcome__logo"
        />
        <p className="fashion-welcome__eyebrow">Tuấn Thủy · Đặt hàng sỉ</p>
        <h1>
          Welcome to <strong>Pensee</strong>
        </h1>
        <p>Nội y tôn vinh vẻ đẹp, sự tự tin và cảm giác vừa vặn của bạn.</p>
      </section>

      <section className="fashion-welcome__visual" aria-label="Bộ sưu tập Pensee">
        <img
          src="/brand/pensee-welcome-current.png"
          alt="Bộ sưu tập nội y Pensee"
          className="fashion-welcome__hero-image"
        />
        <div className="fashion-welcome__mist" aria-hidden="true" />
      </section>

      <section className="fashion-welcome__panel">
        <div className="fashion-welcome__panel-copy">
          <span>Tuấn Thủy · Đặt hàng sỉ</span>
          <h2>Chọn đẹp. Đặt nhanh.</h2>
          <p>Catalog thật, giá thật và phân loại màu · size/cup rõ ràng.</p>
        </div>

        <div className="fashion-welcome__actions">
          <Link
            href="/dang-nhap?callbackUrl=/tai-khoan"
            className="fashion-welcome__primary"
          >
            <span>
              <small>Tài khoản khách hàng</small>
              <strong>Đăng nhập</strong>
            </span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h14M14 7l5 5-5 5" />
            </svg>
          </Link>

          <Link href="/cua-hang" className="fashion-welcome__secondary">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 5.5h14v15H5z" />
              <path d="M8 5.5a4 4 0 0 1 8 0" />
            </svg>
            <span>Khám phá bộ sưu tập</span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h14M14 7l5 5-5 5" />
            </svg>
          </Link>
        </div>

        <div className="fashion-welcome__trust" aria-label="Cam kết dịch vụ">
          <span>Chính hãng</span>
          <i />
          <span>Đặt hàng an toàn</span>
          <i />
          <span>Theo dõi đơn</span>
        </div>
      </section>
    </main>
  );
}
