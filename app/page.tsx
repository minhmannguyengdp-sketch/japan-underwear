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

function StateCard({ failed }: { failed: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f5fa] px-5 py-12 text-ink-950">
      <section className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-purple-900/10">
        <div className="border-b border-slate-100 p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-tt-purple-700 text-sm font-black text-white">
              TT
            </div>
            <div>
              <p className="font-black">Tuấn Thủy</p>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                Catalog PostgreSQL + R2
              </p>
            </div>
          </div>

          <p className={`mt-8 text-xs font-black uppercase tracking-[0.16em] ${failed ? "text-winking-red" : "text-tt-purple-700"}`}>
            {failed ? "Lỗi kết nối dữ liệu" : "Catalog chưa được nạp"}
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            {failed ? "Không đọc được PostgreSQL." : "Database vẫn đang có 0 model."}
          </h1>
          <p className="mt-4 max-w-xl leading-7 text-slate-600">
            {failed
              ? "Dev server chưa thể kết nối hoặc chuẩn bị catalog. Xem lỗi cụ thể trong terminal."
              : "Bản mới sẽ tự migrate và import catalog trước khi mở dev server. Trạng thái này thường nghĩa là anh vẫn đang chạy process cũ."}
          </p>
        </div>

        <div className="bg-[#fbfaff] p-6 sm:p-8">
          <p className="text-sm font-black">Dừng process cũ, cập nhật code rồi chạy một lệnh:</p>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-ink-950 p-4 text-sm leading-7 text-white"><code>{`git pull --ff-only origin feat/catalog-variant-ordering-ui\nnpm run dev`}</code></pre>
          <p className="mt-4 text-sm leading-6 text-slate-500">
            <strong>npm run dev</strong> giờ tự kiểm tra DB; nếu đang 0 model, nó sẽ tự chạy migrate, verify và import trước khi mở cổng 3100.
          </p>
        </div>
      </section>
    </main>
  );
}

export default async function HomePage() {
  const result = await loadCatalogPage();

  if (result.failed) return <StateCard failed />;
  if (result.products.length === 0) return <StateCard failed={false} />;

  return <CatalogOrdering products={result.products} />;
}
