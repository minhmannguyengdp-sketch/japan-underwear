import Link from "next/link";

import { listCatalogProducts } from "@/lib/catalog";
import type { CatalogProduct } from "@/lib/catalog-types";

export const dynamic = "force-dynamic";

type HomeData = {
  products: CatalogProduct[];
  failed: boolean;
};

async function loadHomeData(): Promise<HomeData> {
  try {
    return { products: await listCatalogProducts({ limit: 200 }), failed: false };
  } catch (error) {
    console.error("Home catalog failed:", error instanceof Error ? error.message : String(error));
    return { products: [], failed: true };
  }
}

function formatVnd(value: number) {
  if (value <= 0) return "Đang cập nhật";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function coverFor(product: CatalogProduct) {
  return product.images.find((image) => image.isCover) ?? product.images[0] ?? null;
}

export default async function HomePage() {
  const { products, failed } = await loadHomeData();
  const featured = products.filter((product) => product.orderable).slice(0, 6);

  return (
    <main className="customer-home">
      <section className="home-intro">
        <p className="customer-kicker">Pensee · Winking</p>
        <h1>Nội y đẹp cho từng nhịp sống.</h1>
        <p>Chọn mẫu, màu và size/cup từ catalog bán sỉ đã được xác nhận.</p>
      </section>

      <section className="home-campaign-slot" aria-label="Vị trí ảnh chiến dịch đang chờ cập nhật">
        <span aria-hidden="true" />
      </section>

      <section className="home-section home-section--products">
        <div className="home-section__heading">
          <div>
            <span>Gợi ý hôm nay</span>
            <h2>Sản phẩm nổi bật</h2>
          </div>
          <Link href="/cua-hang">Xem tất cả</Link>
        </div>

        {failed ? (
          <div className="customer-empty-card">
            <strong>Chưa đọc được catalog</strong>
            <p>Kiểm tra kết nối dữ liệu rồi tải lại trang.</p>
          </div>
        ) : featured.length === 0 ? (
          <div className="customer-empty-card">
            <strong>Chưa có mẫu đặt được</strong>
            <p>Catalog hiện chưa có sản phẩm đủ màu và size/cup.</p>
          </div>
        ) : (
          <div className="home-product-rail no-scrollbar">
            {featured.map((product) => {
              const cover = coverFor(product);
              return (
                <Link
                  key={product.id}
                  href={`/cua-hang?san-pham=${encodeURIComponent(product.id)}`}
                  className="home-product-card"
                >
                  <div className="home-product-card__image">
                    {cover?.src ? (
                      <img src={cover.src} alt={cover.alt} />
                    ) : (
                      <span>Chưa có ảnh</span>
                    )}
                  </div>
                  <div className="home-product-card__body">
                    <small>{product.brand} · {product.code}</small>
                    <strong>{product.name}</strong>
                    <span>{formatVnd(product.price)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="home-event-card">
        <div className="home-event-card__ornament" aria-hidden="true" />
        <div>
          <span>Sự kiện</span>
          <h2>Ưu đãi và thông báo mới</h2>
          <p>Mọi chương trình dành cho khách sỉ sẽ được cập nhật tại một nơi.</p>
        </div>
        <Link href="/su-kien" aria-label="Mở trang sự kiện">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M5 12h14M14 7l5 5-5 5" />
          </svg>
        </Link>
      </section>

      <section className="home-guide">
        <div className="home-section__heading">
          <div>
            <span>Đặt sỉ dễ dàng</span>
            <h2>Ba bước rõ ràng</h2>
          </div>
        </div>
        <ol>
          <li>
            <b>01</b>
            <div><strong>Chọn sản phẩm</strong><p>Tìm theo mã, thương hiệu hoặc nhóm hàng.</p></div>
          </li>
          <li>
            <b>02</b>
            <div><strong>Chọn phân loại</strong><p>Mỗi dòng có màu, size/cup và số lượng riêng.</p></div>
          </li>
          <li>
            <b>03</b>
            <div><strong>Xác nhận đơn</strong><p>Thông tin giao hàng lấy từ hồ sơ đã lưu.</p></div>
          </li>
        </ol>
      </section>
    </main>
  );
}
