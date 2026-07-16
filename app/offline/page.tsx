import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="app-state-page">
      <img src="/brand/pensee-logo.png" alt="" className="app-state-logo" />
      <p className="app-state-kicker">Đang offline</p>
      <h1>Chưa có kết nối mạng.</h1>
      <p>
        Các thao tác tạo đơn cần kết nối để kiểm tra lại giá và lưu dữ liệu an toàn trên
        server.
      </p>
      <Link href="/" className="app-state-button">
        Thử tải lại
      </Link>
    </main>
  );
}
