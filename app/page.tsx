import Link from "next/link";

import { listCatalogProducts } from "@/lib/catalog";
import type { CatalogProduct } from "@/lib/catalog-types";

export const dynamic = "force-dynamic";

type HomeData = {
  products: CatalogProduct[];
  failed: boolean;
};

type HomeCategory = {
  slug: "ao-nguc" | "quan-lot" | "quan-gen";
  label: string;
  title: string;
  description: string;
  tone: "lilac" | "rose" | "plum";
};

const HOME_CATEGORIES: HomeCategory[] = [
  {
    slug: "ao-nguc",
    label: "Áo ngực",
    title: "Phom nâng đỡ cho từng dáng mặc",
    description: "Các mẫu Pensee và Winking có hình ảnh, màu và size/cup rõ ràng.",
    tone: "lilac",
  },
  {
    slug: "quan-lot",
    label: "Quần lót",
    title: "Nhẹ, gọn và dễ phối theo bộ",
    description: "Tách riêng nhóm quần để tìm mẫu nhanh hơn khi lên đơn sỉ.",
    tone: "rose",
  },
  {
    slug: "quan-gen",
    label: "Quần gen",
    title: "Định hình gọn cho nhu cầu chuyên biệt",
    description: "Nhóm sản phẩm gen được trình bày riêng, không trộn với quần lót thường.",
    tone: "plum",
  },
];

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

function ProductTile({ product, featured = false }: { product: CatalogProduct; featured?: boolean }) {
  const cover = coverFor(product);

  return (
    <Link
      href={`/cua-hang?san-pham=${encodeURIComponent(product.id)}`}
      className={featured ? "home-category-feature" : "home-category-card"}
    >
      <div className={featured ? "home-category-feature__image" : "home-category-card__image"}>
        {cover?.src ? <img src={cover.src} alt={cover.alt} /> : <span>Chưa có ảnh</span>}
        <em className={product.orderable ? "is-ready" : "is-waiting"}>
          {product.orderable ? "Có thể đặt" : "Đang bổ sung"}
        </em>
      </div>
      <div className={featured ? "home-category-feature__body" : "home-category-card__body"}>
        <small>{product.brand} · {product.code}</small>
        <strong>{product.name}</strong>
        <b>{formatVnd(product.price)}</b>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const { products, failed } = await loadHomeData();

  return (
    <main className="customer-home">
      <section className="home-intro">
        <p className="customer-kicker">Pensee · Winking</p>
        <h1>Nội y đẹp, tìm đúng nhóm ngay từ đầu.</h1>
        <p>Catalog được chia rõ theo áo ngực, quần lót và quần gen để thao tác nhanh trên điện thoại.</p>
      </section>

      <section className="home-campaign-slot" aria-label="Vị trí ảnh chiến dịch đang chờ cập nhật">
        <span aria-hidden="true" />
      </section>

      {failed ? (
        <section className="customer-empty-card home-catalog-error">
          <strong>Chưa đọc được catalog</strong>
          <p>Kết nối dữ liệu đang chậm. Tải lại trang sau khi PostgreSQL sẵn sàng.</p>
        </section>
      ) : (
        HOME_CATEGORIES.map((category) => {
          const categoryProducts = products.filter(
            (product) => product.categorySlug === category.slug && Boolean(coverFor(product)?.src),
          );
          const featured = categoryProducts[0] ?? null;
          const preview = categoryProducts.slice(1, 4);

          return (
            <section
              key={category.slug}
              className={`home-category-section home-category-section--${category.tone}`}
            >
              <header className="home-category-section__heading">
                <div>
                  <span>{category.label}</span>
                  <h2>{category.title}</h2>
                  <p>{category.description}</p>
                </div>
                <b>{categoryProducts.length}</b>
              </header>

              {featured ? (
                <>
                  <ProductTile product={featured} featured />
                  {preview.length > 0 ? (
                    <div className="home-category-grid">
                      {preview.map((product) => (
                        <ProductTile key={product.id} product={product} />
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="home-category-empty">
                  <strong>Chưa có ảnh đại diện</strong>
                  <p>Nhóm này sẽ được hoàn thiện sau khi dữ liệu nguồn được bổ sung.</p>
                </div>
              )}

              <Link href="/cua-hang" className="home-category-section__link">
                Xem toàn bộ sản phẩm
                <span aria-hidden="true">→</span>
              </Link>
            </section>
          );
        })
      )}

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
    </main>
  );
}
