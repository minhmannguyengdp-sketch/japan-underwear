import { CatalogOrdering } from "@/components/catalog-ordering";
import { listCatalogProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  try {
    const products = await listCatalogProducts({ limit: 200 });
    return <CatalogOrdering products={products} />;
  } catch (error) {
    console.error(
      "Catalog page failed:",
      error instanceof Error ? error.message : String(error),
    );

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
}
