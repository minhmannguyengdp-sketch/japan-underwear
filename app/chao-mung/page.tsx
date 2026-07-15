import Link from "next/link";

export default function WelcomePage() {
  return (
    <main className="welcome-screen">
      <div className="welcome-screen__art" aria-hidden="true" />
      <div className="welcome-screen__content">
        <img src="/brand/pensee-logo.png" alt="Pensee" className="welcome-screen__logo" />
        <p className="welcome-screen__eyebrow">Tuấn Thủy · Đặt hàng sỉ</p>
        <h1>Đẹp hơn trong từng lựa chọn.</h1>
        <p className="welcome-screen__copy">
          Khám phá catalog Pensee và Winking, chọn đúng màu, đúng size/cup và theo dõi đơn ngay trên điện thoại.
        </p>
        <Link href="/" className="welcome-screen__button">
          Bắt đầu
          <span aria-hidden="true">→</span>
        </Link>
        <small>Catalog và giá được cập nhật từ hệ thống Tuấn Thủy.</small>
      </div>
    </main>
  );
}
