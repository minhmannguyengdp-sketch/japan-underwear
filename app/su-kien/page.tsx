import Link from "next/link";

export default function CustomerEventsPage() {
  return (
    <main className="customer-events-page">
      <section className="events-intro">
        <p className="customer-kicker">Tin mới từ Tuấn Thủy</p>
        <h1>Sự kiện và ưu đãi</h1>
        <p>Các chương trình dành cho khách sỉ sẽ được công bố tại đây.</p>
      </section>

      <section className="events-feature-card" aria-hidden="true">
        <div className="events-feature-card__veil" />
      </section>

      <section className="events-empty-card">
        <span className="events-empty-card__icon">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 4h14v16H5zM8 2v4M16 2v4M5 9h14" />
            <path d="m9 14 2 2 4-4" />
          </svg>
        </span>
        <p className="customer-kicker">Chưa có sự kiện đang diễn ra</p>
        <h2>Thông báo mới sẽ xuất hiện ở đây.</h2>
        <p>Ứng dụng không hiển thị chương trình giả khi chưa có dữ liệu vận hành thật.</p>
        <Link href="/cua-hang" className="fashion-button fashion-button--secondary">
          Xem sản phẩm
        </Link>
      </section>
    </main>
  );
}
