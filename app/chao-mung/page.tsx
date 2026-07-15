import Link from "next/link";

import { listCatalogProducts } from "@/lib/catalog";
import type { CatalogProduct } from "@/lib/catalog-types";

export const dynamic = "force-dynamic";

function coverFor(product: CatalogProduct) {
  return product.images.find((image) => image.isCover) ?? product.images[0] ?? null;
}

async function loadWelcomeProducts() {
  try {
    const products = await listCatalogProducts({ limit: 120 });
    return products.filter(
      (product) =>
        product.orderable &&
        product.brand.toLowerCase() === "pensee" &&
        Boolean(coverFor(product)?.src),
    );
  } catch (error) {
    console.error(
      "Welcome catalog failed:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

export default async function WelcomePage() {
  const products = await loadWelcomeProducts();
  const featured = products[0] ?? null;
  const secondary = products[1] ?? null;
  const featuredCover = featured ? coverFor(featured) : null;
  const secondaryCover = secondary ? coverFor(secondary) : null;

  return (
    <main className="fashion-welcome">
      <div className="fashion-welcome__backdrop" aria-hidden="true" />

      <section className="fashion-welcome__brand">
        <img
          src="/brand/pensee-logo-transparent.svg"
          alt="Pensee"
          className="fashion-welcome__logo"
        />
        <h1>
          Welcome to <strong>Pensee</strong>
        </h1>
        <p>Nội y tôn vinh vẻ đẹp, sự tự tin và cảm giác vừa vặn của bạn.</p>
      </section>

      <section className="fashion-welcome__visual" aria-label="Sản phẩm Pensee nổi bật">
        {featuredCover?.src ? (
          <img
            src={featuredCover.src}
            alt={featuredCover.alt || featured?.name || "Sản phẩm Pensee"}
            className="fashion-welcome__hero-image"
          />
        ) : (
          <div className="fashion-welcome__visual-placeholder" aria-hidden="true" />
        )}

        <div className="fashion-welcome__visual-shade" aria-hidden="true" />

        {featured ? (
          <div className="fashion-welcome__product-copy">
            <span>Pensee · {featured.code}</span>
            <strong>{featured.name}</strong>
          </div>
        ) : null}

        {secondary && secondaryCover?.src ? (
          <div className="fashion-welcome__mini-card" aria-hidden="true">
            <img src={secondaryCover.src} alt="" />
            <span>{secondary.code}</span>
          </div>
        ) : null}
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
