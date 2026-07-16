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
  campaignTitle: string;
  campaignCopy: string;
  tone: "lilac" | "rose" | "plum";
};

const HOME_CATEGORIES: HomeCategory[] = [
  {
    slug: "ao-nguc",
    label: "Áo ngực",
    title: "Phom nâng đỡ cho từng dáng mặc",
    description: "Các mẫu Pensee và Winking có hình ảnh, màu và size/cup rõ ràng.",
    campaignTitle: "Nâng đỡ mềm mại, phom đẹp tự nhiên",
    campaignCopy: "Khám phá dòng áo ngực dành cho nhu cầu mặc hằng ngày và lên đơn sỉ.",
    tone: "lilac",
  },
  {
    slug: "quan-lot",
    label: "Quần lót",
    title: "Nhẹ, gọn và dễ phối theo bộ",
    description: "Tách riêng nhóm quần để tìm mẫu nhanh hơn khi lên đơn sỉ.",
    campaignTitle: "Nhẹ nhàng trong từng chuyển động",
    campaignCopy: "Bộ sưu tập quần lót được sắp theo nhóm để chọn nhanh và phối đồng bộ.",
    tone: "rose",
  },
  {
    slug: "quan-gen",
    label: "Quần gen",
    title: "Định hình gọn cho nhu cầu chuyên biệt",
    description: "Nhóm sản phẩm gen được trình bày riêng, không trộn với quần lót thường.",
    campaignTitle: "Định hình tinh tế, tự tin cả ngày",
    campaignCopy: "Xem riêng các mẫu gen và sản phẩm định hình khi dữ liệu nguồn được bổ sung.",
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
        <p className="customer-kicker">Pensee · Winking</p>
        <h1>Nội y đẹp, tìm đúng nhóm ngay từ đầu.</h1>
        <p>Catalog được chia rõ theo áo ngực, quần lót và quần gen để thao tác nhanh trên điện thoại.</p>
      </section>

      <Link href="/cua-hang" className="home-hero" aria-label="Khám phá bộ sưu tập Pensee">
        <img src="/brand/pensee-welcome-current.png" alt="Bộ sưu tập Pensee" />
        <span className="home-hero__veil" aria-hidden="true" />
        <div className="home-hero__copy">
          <span>Bộ sưu tập Pensee</span>
          <strong>Đặt hàng sỉ ngay trên điện thoại</strong>
          <small>Xem sản phẩm →</small>
        </div>
      </Link>

      {failed ? (
        <section className="customer-empty-card home-catalog-error">
          <strong>Chưa đọc được catalog</strong>
          <p>Kết nối dữ liệu đang chậm. Tải lại trang sau khi PostgreSQL sẵn sàng.</p>
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
                  <p>{category.description}</p>
                </div>
                <b>{products.filter((product) => product.categorySlug === category.slug).length}</b>
              </header>

              <Link
                href={`/cua-hang?nhom=${encodeURIComponent(category.slug)}`}
                className="home-category-banner"
                aria-label={`Xem bộ sưu tập ${category.label}`}
              >
                <img src="/brand/pensee-app-background.png" alt="" />
                <span className="home-category-banner__glow" aria-hidden="true" />
                <div>
                  <small>{category.label}</small>
                  <strong>{category.campaignTitle}</strong>
                  <p>{category.campaignCopy}</p>
                  <b>Xem bộ sưu tập →</b>
                </div>
              </Link>

              {categoryProducts.length > 0 ? (
                <div className="home-category-grid">
                  {categoryProducts.map((product) => (
                    <ProductTile key={product.id} product={product} />
                  ))}
                </div>
              ) : (
                <div className="home-category-empty">
                  <strong>Chưa có sản phẩm có ảnh</strong>
                  <p>Banner chủng loại vẫn hoạt động; card sản phẩm sẽ xuất hiện khi dữ liệu nguồn sẵn sàng.</p>
                </div>
              )}

              <Link
                href={`/cua-hang?nhom=${encodeURIComponent(category.slug)}`}
                className="home-category-section__link"
              >
                Xem toàn bộ {category.label.toLocaleLowerCase("vi")}
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
