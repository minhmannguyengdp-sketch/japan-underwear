"use client";

import { useMemo, useRef, useState } from "react";

type ColorOption = {
  id: string;
  label: string;
  swatch: string;
};

type SelectionRow = {
  id: string;
  colorId: string;
  size: string;
  quantity: number;
};

type CartLine = {
  key: string;
  colorId: string;
  colorLabel: string;
  size: string;
  quantity: number;
};

const product = {
  brand: "Winking",
  code: "9050",
  name: "Áo ngực Winking 9050",
  price: 399_000,
  description: "Mút mỏng, có gọng, cúp chéo và dây vai có thể tháo rời.",
  colors: [
    { id: "black", label: "Đen", swatch: "#231f20" },
    { id: "nude", label: "Da", swatch: "#d6aa88" },
    { id: "red", label: "Đỏ", swatch: "#b91c2b" },
    { id: "navy", label: "Xanh đen", swatch: "#23304f" },
  ] satisfies ColorOption[],
  sizes: ["75A", "80A", "85A", "90A", "75B", "80B", "85B"],
  images: [
    {
      src: "https://tuanthuy.com.vn/wp-content/uploads/2024/03/AL9050-1.png",
      alt: "Áo ngực Winking 9050 - ảnh sản phẩm 1",
    },
    {
      src: "https://tuanthuy.com.vn/wp-content/uploads/2024/03/9050.png",
      alt: "Áo ngực Winking 9050 - ảnh sản phẩm 2",
    },
    {
      src: "https://tuanthuy.com.vn/wp-content/uploads/2024/03/9050-8.png",
      alt: "Áo ngực Winking 9050 - ảnh sản phẩm 3",
    },
  ],
};

const initialRows: SelectionRow[] = [
  { id: "row-1", colorId: "", size: "", quantity: 1 },
];

function formatVnd(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function Icon({ name }: { name: "cart" | "plus" | "trash" | "close" | "search" }) {
  const paths = {
    cart: <path d="M3 4h2l2.1 9.1a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L20 7H6.1M10 20h.01M17 20h.01" />,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5M14 11v5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    search: <path d="m21 21-4.3-4.3m2.3-5.2A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round">
      {paths[name]}
    </svg>
  );
}

export function CatalogOrderingDemo() {
  const nextRowId = useRef(2);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const [rows, setRows] = useState<SelectionRow[]>(initialRows);
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [error, setError] = useState("");

  const totalQuantity = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.quantity, 0),
    [cartLines],
  );

  const selectedQuantity = rows.reduce(
    (sum, row) => sum + (row.colorId && row.size ? row.quantity : 0),
    0,
  );

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: `row-${nextRowId.current++}`,
        colorId: "",
        size: "",
        quantity: 1,
      },
    ]);
  }

  function updateRow(id: string, patch: Partial<SelectionRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setError("");
  }

  function removeRow(id: string) {
    setRows((current) =>
      current.length === 1
        ? [{ ...current[0], colorId: "", size: "", quantity: 1 }]
        : current.filter((row) => row.id !== id),
    );
  }

  function addAllToCart() {
    const validRows = rows.filter(
      (row) => row.colorId && row.size && row.quantity > 0,
    );

    if (!validRows.length || validRows.length !== rows.length) {
      setError("Chọn đủ màu, size và số lượng cho từng dòng trước khi thêm giỏ.");
      return;
    }

    setCartLines((current) => {
      const merged = new Map(current.map((line) => [line.key, { ...line }]));

      for (const row of validRows) {
        const color = product.colors.find((item) => item.id === row.colorId);
        if (!color) continue;

        const key = `${product.code}-${row.colorId}-${row.size}`;
        const existing = merged.get(key);

        if (existing) {
          existing.quantity += row.quantity;
        } else {
          merged.set(key, {
            key,
            colorId: row.colorId,
            colorLabel: color.label,
            size: row.size,
            quantity: row.quantity,
          });
        }
      }

      return [...merged.values()];
    });

    setRows([{ id: `row-${nextRowId.current++}`, colorId: "", size: "", quantity: 1 }]);
    setError("");
    setPreviewOpen(false);
  }

  return (
    <main className="min-h-screen pb-28">
      <header className="sticky top-0 z-30 border-b border-tt-purple-100/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-tt-purple-700 text-sm font-black text-white shadow-lg shadow-tt-purple-700/20">
              TT
            </div>
            <div>
              <p className="font-extrabold tracking-tight text-ink-950">Tuấn Thủy</p>
              <p className="text-xs text-slate-500">Đặt hàng theo mẫu</p>
            </div>
          </div>

          <button
            type="button"
            className="relative flex h-11 items-center gap-2 rounded-2xl border border-tt-purple-100 bg-tt-purple-50 px-4 font-bold text-tt-purple-800 transition hover:border-tt-purple-300 hover:bg-tt-purple-100"
          >
            <Icon name="cart" />
            <span className="hidden sm:inline">Giỏ hàng</span>
            <span className="grid min-w-6 place-items-center rounded-full bg-winking-red px-1.5 py-0.5 text-xs text-white">
              {totalQuantity}
            </span>
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-8 pt-8 sm:px-6 sm:pt-12">
        <div className="overflow-hidden rounded-[2rem] border border-tt-purple-100 bg-white shadow-[0_24px_80px_rgba(79,29,143,0.10)]">
          <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.35fr_0.65fr] lg:items-center">
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-tt-purple-100 px-3 py-1 text-xs font-extrabold uppercase tracking-[0.18em] text-tt-purple-800">
                  Catalog MVP
                </span>
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-winking-red">
                  Winking accent
                </span>
              </div>
              <h1 className="max-w-3xl text-3xl font-black leading-tight tracking-[-0.04em] text-ink-950 sm:text-5xl">
                Xem một mẫu, chọn nhiều màu và size, thêm cả cụm vào giỏ.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                Giao diện ưu tiên tốc độ đặt hàng: gallery chung theo mã mẫu, nhiều dòng phân loại và một nút thêm tất cả.
              </p>
            </div>

            <div className="rounded-3xl bg-tt-purple-700 p-5 text-white shadow-xl shadow-tt-purple-700/20">
              <p className="text-sm font-bold text-tt-purple-100">Luồng thao tác</p>
              <ol className="mt-3 space-y-3 text-sm leading-6">
                <li><strong>1.</strong> Mở preview và kéo ngang xem ảnh.</li>
                <li><strong>2.</strong> Thêm nhiều dòng màu · size · số lượng.</li>
                <li><strong>3.</strong> Đưa tất cả vào giỏ bằng một lần bấm.</li>
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_360px]">
        <div>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-tt-purple-700">Winking</p>
              <h2 className="text-2xl font-black tracking-tight text-ink-950">Sản phẩm nổi bật</h2>
            </div>
            <label className="hidden min-w-64 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-400 shadow-sm sm:flex">
              <Icon name="search" />
              <input aria-label="Tìm sản phẩm" className="w-full border-0 bg-transparent text-sm text-ink-950 outline-none" placeholder="Tìm mã sản phẩm" />
            </label>
          </div>

          <article className="max-w-md overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(32,21,45,0.08)] transition hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(79,29,143,0.14)]">
            <button type="button" onClick={() => setPreviewOpen(true)} className="block w-full text-left">
              <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-tt-purple-50 via-white to-red-50">
                <img
                  src={product.images[0].src}
                  alt={product.images[0].alt}
                  className="h-full w-full object-cover transition duration-500 hover:scale-[1.03]"
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                />
                <span className="absolute left-4 top-4 rounded-full bg-winking-red px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.16em] text-white shadow-lg">
                  Winking
                </span>
                <span className="absolute bottom-4 right-4 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-tt-purple-800 shadow-lg">
                  {product.images.length} ảnh
                </span>
              </div>

              <div className="p-5">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Mã {product.code}</p>
                <h3 className="mt-1 text-xl font-black text-ink-950">{product.name}</h3>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{product.description}</p>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <p className="text-xl font-black text-tt-purple-700">{formatVnd(product.price)}</p>
                  <span className="rounded-xl bg-tt-purple-700 px-4 py-2.5 text-sm font-bold text-white">Chọn phân loại</span>
                </div>
              </div>
            </button>
          </article>
        </div>

        <aside className="h-fit rounded-[1.75rem] border border-tt-purple-100 bg-white p-5 shadow-[0_18px_50px_rgba(79,29,143,0.08)] lg:sticky lg:top-24">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-sm font-bold text-tt-purple-700">Giỏ tạm</p>
              <h2 className="text-xl font-black text-ink-950">{totalQuantity} sản phẩm</h2>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-tt-purple-50 text-tt-purple-700"><Icon name="cart" /></div>
          </div>

          {cartLines.length === 0 ? (
            <div className="py-10 text-center">
              <p className="font-bold text-ink-950">Chưa có phân loại nào</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">Mở sản phẩm và chọn nhiều dòng màu · size · số lượng.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {cartLines.map((line) => (
                <div key={line.key} className="flex gap-3 py-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-tt-purple-50 text-xs font-black text-tt-purple-800">{product.code}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-ink-950">{product.name}</p>
                    <p className="mt-1 text-sm text-slate-500">{line.colorLabel} · {line.size} · SL {line.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Tạm tính</span>
              <strong className="text-lg text-ink-950">{formatVnd(product.price * totalQuantity)}</strong>
            </div>
            <button type="button" disabled={!cartLines.length} className="mt-4 w-full rounded-2xl bg-tt-purple-700 px-4 py-3.5 font-extrabold text-white shadow-lg shadow-tt-purple-700/20 transition hover:bg-tt-purple-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none">
              Xem giỏ hàng
            </button>
          </div>
        </aside>
      </section>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/55 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Chọn phân loại ${product.name}`}>
          <div className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-[2rem]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-winking-red">{product.brand} · {product.code}</p>
                <h2 className="text-lg font-black text-ink-950 sm:text-xl">{product.name}</h2>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} aria-label="Đóng preview" className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-600 transition hover:bg-tt-purple-100 hover:text-tt-purple-800">
                <Icon name="close" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid lg:grid-cols-[1fr_1fr]">
                <section className="border-b border-slate-100 bg-gradient-to-br from-tt-purple-50 via-white to-red-50 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                  <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto">
                    {product.images.map((image, index) => (
                      <figure key={image.src} className="relative aspect-square min-w-[88%] snap-center overflow-hidden rounded-[1.5rem] border border-white bg-white shadow-lg sm:min-w-[72%] lg:min-w-full">
                        <img
                          src={image.src}
                          alt={image.alt}
                          className="h-full w-full object-cover"
                          onError={(event) => { event.currentTarget.style.display = "none"; }}
                        />
                        <figcaption className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-tt-purple-800 shadow">Ảnh {index + 1}/{product.images.length}</figcaption>
                      </figure>
                    ))}
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-600">Kéo ngang xem toàn bộ ảnh trong thư mục mẫu {product.code}. Gallery dùng chung, không bắt buộc map từng ảnh theo màu.</p>
                </section>

                <section className="p-4 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-slate-500">Đơn giá hiện tại</p>
                      <p className="text-2xl font-black text-tt-purple-700">{formatVnd(product.price)}</p>
                    </div>
                    <span className="rounded-2xl bg-tt-purple-50 px-3 py-2 text-xs font-bold text-tt-purple-800">Nhiều phân loại</span>
                  </div>

                  <div className="mt-6 space-y-3">
                    {rows.map((row, index) => (
                      <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-extrabold text-ink-950">Dòng {index + 1}</p>
                          <button type="button" onClick={() => removeRow(row.id)} aria-label={`Xóa dòng ${index + 1}`} className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-winking-red">
                            <Icon name="trash" />
                          </button>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_132px]">
                          <label className="text-xs font-bold text-slate-500">
                            Màu
                            <select value={row.colorId} onChange={(event) => updateRow(row.id, { colorId: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-ink-950">
                              <option value="">Chọn màu</option>
                              {product.colors.map((color) => <option key={color.id} value={color.id}>{color.label}</option>)}
                            </select>
                          </label>

                          <label className="text-xs font-bold text-slate-500">
                            Size
                            <select value={row.size} onChange={(event) => updateRow(row.id, { size: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-ink-950">
                              <option value="">Chọn size</option>
                              {product.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                            </select>
                          </label>

                          <div>
                            <p className="text-xs font-bold text-slate-500">Số lượng</p>
                            <div className="mt-1.5 flex h-11 items-center overflow-hidden rounded-xl border border-slate-200">
                              <button type="button" onClick={() => updateRow(row.id, { quantity: Math.max(1, row.quantity - 1) })} className="grid h-full w-10 place-items-center text-lg font-bold text-tt-purple-700 hover:bg-tt-purple-50">−</button>
                              <input aria-label={`Số lượng dòng ${index + 1}`} type="number" min={1} value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} className="h-full min-w-0 flex-1 border-x border-slate-200 text-center text-sm font-extrabold text-ink-950 outline-none" />
                              <button type="button" onClick={() => updateRow(row.id, { quantity: row.quantity + 1 })} className="grid h-full w-10 place-items-center text-lg font-bold text-tt-purple-700 hover:bg-tt-purple-50">+</button>
                            </div>
                          </div>
                        </div>

                        {row.colorId && (
                          <div className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-500">
                            <span className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: product.colors.find((color) => color.id === row.colorId)?.swatch }} />
                            {product.colors.find((color) => color.id === row.colorId)?.label}
                            {row.size ? ` · ${row.size}` : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <button type="button" onClick={addRow} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-tt-purple-300 bg-tt-purple-50 px-4 py-3 font-extrabold text-tt-purple-800 transition hover:border-tt-purple-500 hover:bg-tt-purple-100">
                    <Icon name="plus" /> Thêm dòng phân loại
                  </button>

                  {error && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-winking-red">{error}</p>}
                </section>
              </div>
            </div>

            <footer className="border-t border-slate-100 bg-white px-4 py-4 sm:px-6">
              <div className="mx-auto flex max-w-4xl items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-500">Đã chọn</p>
                  <p className="truncate font-black text-ink-950">{rows.length} dòng · {selectedQuantity} sản phẩm</p>
                </div>
                <button type="button" onClick={addAllToCart} className="rounded-2xl bg-tt-purple-700 px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-tt-purple-700/25 transition hover:bg-tt-purple-800 sm:px-8">
                  Thêm tất cả vào giỏ
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
