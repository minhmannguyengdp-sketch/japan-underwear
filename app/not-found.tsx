import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-state-page">
      <img src="/brand/pensee-logo.png" alt="" className="app-state-logo" />
      <p className="app-state-kicker">404</p>
      <h1>Không tìm thấy màn hình.</h1>
      <p>Đường dẫn này không tồn tại hoặc đã được thay đổi.</p>
      <Link href="/" className="app-state-button">
        Về cửa hàng
      </Link>
    </main>
  );
}
