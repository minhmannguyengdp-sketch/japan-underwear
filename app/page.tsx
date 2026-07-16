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
  bannerSrc: string;
  tone: "lilac" | "rose" | "plum";
};

const HOME_CATEGORIES: HomeCategory[] = [
  {
    slug: "ao-nguc",
    label: "Áo ngực",
    title: "Phom nâng đỡ",
    bannerSrc: "/brand/pensee-home-banner-ao-nguc.png",
    tone: "lilac",
  },
  {
    slug: "quan-lot",
    label: "Quần lót",
    title: "Mềm nhẹ mỗi ngày",
    bannerSrc: "/brand/pensee-home-banner-quan-lot.png",
    tone: "rose",
  },
  {
    slug: "quan-gen",
    label: "Quần gen",
    title: "Định hình tinh tế",
    bannerSrc: "/brand/pensee-home-banner-quan-gen.png",
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

function ProductTile({ product }: { product: CatalogProduct }) {
  const cover = coverFor(product);

  return (
    <Link
      href={`/cua-hang?san-pham=${encodeURIComponent(product.id)}`}
      className="home-category-card"
    >
      <div className="home-category-card__image">
        {cover?.src ? <img src={cover.src} alt={cover.alt} /> : <span>Chưa có ảnh</span>}
        <em className={product.orderable ? "is-ready" : "is-waiting"}>
          {product.orderable ? "Có thể đặt" : "Đang bổ sung"}
        </em>
      </div>
      <div className="home-category-card__body">
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
        <h1>Bộ sưu tập</h1>
      </section>

      <Link href="/cua-hang" className="home-hero" aria-label="Mở bộ sưu tập Pensee">
        <img src="/brand/pensee-welcome-current.png" alt="Bộ sưu tập Pensee" />
      </Link>

      {failed ? (
        <section className="customer-empty-card home-catalog-error">
          <strong>Không tải được sản phẩm</strong>
        </section>
      ) : (
        HOME_CATEGORIES.map((category) => {
          const categoryProducts = products
            .filter(
              (product) =>
                product.categorySlug === category.slug && Boolean(coverFor(product)?.src),
            )
            .slice(0, 3);

          return (
            <section
              key={category.slug}
              className={`home-category-section home-category-section--${category.tone}`}
            >
              <header className="home-category-section__heading">
                <div>
                  <span>{category.label}</span>
                  <h2>{category.title}</h2>
                </div>
              </header>

              <Link
                href={`/cua-hang?nhom=${encodeURIComponent(category.slug)}`}
                className="home-category-banner"
                aria-label={`Xem ${category.label}`}
              >
                <img src={category.bannerSrc} alt={`Banner ${category.label}`} />
              </Link>

              {categoryProducts.length > 0 ? (
                <div className="home-category-grid">
                  {categoryProducts.map((product) => (
                    <ProductTile key={product.id} product={product} />
                  ))}
                </div>
              ) : (
                <div className="home-category-empty">
                  <strong>Chưa có sản phẩm</strong>
                </div>
              )}

              <Link
                href={`/cua-hang?nhom=${encodeURIComponent(category.slug)}`}
                className="home-category-section__link"
              >
                Xem tất cả
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
          <h2>Ưu đãi mới</h2>
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
