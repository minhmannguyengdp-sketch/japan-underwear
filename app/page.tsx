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
  const orderable = products.filter((product) => product.orderable);
  const featured = orderable.slice(0, 4);
  const imageCount = products.reduce((sum, product) => sum + product.images.length, 0);

  return (
    <main className="customer-home">
      <section className="home-hero">
        <div className="home-hero__veil" />
        <div className="home-hero__content">
          <span className="home-hero__eyebrow">Pensee · Winking chính hãng</span>
          <h1>Đặt hàng sỉ nhanh, đúng màu và đúng size/cup.</h1>
          <p>Catalog thật, giá thật và giỏ hàng được lưu an toàn trên server.</p>
          <div className="home-hero__actions">
            <Link href="/cua-hang" className="customer-button customer-button--primary">
              Mở cửa hàng
            </Link>
            <Link href="/don-hang" className="customer-button customer-button--ghost">
              Xem đơn hàng
            </Link>
          </div>
        </div>
      </section>

      <section className="home-stats" aria-label="Tổng quan catalog">
        <article>
          <strong>{products.length}</strong>
          <span>model</span>
        </article>
        <article>
          <strong>{orderable.length}</strong>
          <span>đặt được</span>
        </article>
        <article>
          <strong>{imageCount}</strong>
          <span>ảnh thật</span>
        </article>
      </section>

      <section className="home-section">
        <div className="home-section__heading">
          <div>
            <span>Sản phẩm nổi bật</span>
            <h2>Mẫu đang có thể đặt</h2>
          </div>
          <Link href="/cua-hang">Xem tất cả</Link>
        </div>

        {failed ? (
          <div className="customer-empty-card">
            <strong>Chưa đọc được catalog</strong>
            <p>Kiểm tra kết nối PostgreSQL rồi tải lại trang.</p>
          </div>
        ) : featured.length === 0 ? (
          <div className="customer-empty-card">
            <strong>Chưa có mẫu đặt được</strong>
            <p>Catalog hiện chưa có sản phẩm đủ màu và size/cup.</p>
          </div>
        ) : (
          <div className="home-featured-grid">
            {featured.map((product) => {
              const cover = coverFor(product);
              return (
                <Link key={product.id} href="/cua-hang" className="home-product-card">
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

      <section className="home-guide">
        <span>Đặt sỉ trong 3 bước</span>
        <ol>
          <li><b>1</b><div><strong>Chọn mẫu</strong><p>Tìm theo mã, thương hiệu hoặc nhóm hàng.</p></div></li>
          <li><b>2</b><div><strong>Chọn màu và size/cup</strong><p>Mỗi dòng đặt hàng có số lượng riêng.</p></div></li>
          <li><b>3</b><div><strong>Xác nhận đơn</strong><p>Thông tin giao hàng lấy từ hồ sơ đã lưu.</p></div></li>
        </ol>
      </section>
    </main>
  );
}
