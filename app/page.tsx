import { CatalogOrdering } from "@/components/catalog-ordering";
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
    console.error(
      "Catalog page failed:",
      error instanceof Error ? error.message : String(error),
    );
    return { products: [], failed: true };
  }
}

export default async function HomePage() {
  const result = await loadCatalogPage();

  if (!result.failed) {
    return <CatalogOrdering products={result.products} />;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <section className="w-full max-w-xl rounded-[2rem] border border-red-100 bg-white p-8 text-center shadow-xl">
        <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-winking-red">
          Catalog chưa sẵn sàng
        </p>
        <h1 className="mt-3 text-3xl font-black text-ink-950">
          Không đọc được PostgreSQL
        </h1>
        <p className="mt-4 leading-7 text-slate-600">
          Kiểm tra DATABASE_URL, migration và chạy catalog:db:import trước khi mở giao diện.
        </p>
      </section>
    </main>
  );
}
