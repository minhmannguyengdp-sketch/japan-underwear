import { CatalogOrdering } from "@/components/catalog-ordering-v2";
import { listCatalogProducts } from "@/lib/catalog";
import type { CatalogProduct } from "@/lib/catalog-types";

export const dynamic = "force-dynamic";

type CatalogPageResult =
  | { products: CatalogProduct[]; failed: false }
  | { products: []; failed: true };

async function loadCatalogPage(): Promise<CatalogPageResult> {
  try {
    const products = await listCatalogProducts({ limit: 200 });
    return { products, failed: false };
  } catch (error) {
    console.error("Catalog page failed:", error instanceof Error ? error.message : String(error));
    return { products: [], failed: true };
  }
}

function StateCard({ failed }: { failed: boolean }) {
  return (
    <main className="app-state-page">
      <img src="/brand/pensee-logo-transparent.svg" alt="" className="app-state-logo" />
      <p className={`app-state-kicker ${failed ? "is-error" : ""}`}>
        {failed ? "Lỗi kết nối dữ liệu" : "Sản phẩm chưa được nạp"}
      </p>
      <h1>{failed ? "Không đọc được PostgreSQL." : "Chưa có sản phẩm active."}</h1>
      <p>
        {failed
          ? "Ứng dụng chưa thể kết nối dữ liệu. Hãy kiểm tra server rồi thử lại."
          : "Danh sách sản phẩm hiện chưa có dữ liệu để hiển thị."}
      </p>
    </main>
  );
}

type ShopPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const params = await searchParams;
  const rawProductId = params["san-pham"];
  const initialProductId = Array.isArray(rawProductId) ? rawProductId[0] : rawProductId;
  const result = await loadCatalogPage();

  if (result.failed) return <StateCard failed />;
  if (result.products.length === 0) return <StateCard failed={false} />;

  return (
    <CatalogOrdering
      products={result.products}
      initialProductId={initialProductId ?? null}
    />
  );
}
