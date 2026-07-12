"use client";

import { useMemo, useRef, useState } from "react";

import type { CatalogProduct } from "@/lib/catalog-types";

type SelectionRow = {
  id: string;
  colorId: string;
  size: string;
  quantity: number;
};

type CartLine = {
  key: string;
  productId: string;
  productCode: string;
  productName: string;
  colorLabel: string;
  size: string;
  quantity: number;
  unitPrice: number;
};

function createRow(id: string): SelectionRow {
  return { id, colorId: "", size: "", quantity: 1 };
}

function formatVnd(value: number) {
  if (value <= 0) return "Liên hệ";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function Icon({
  name,
}: {
  name: "cart" | "plus" | "trash" | "close" | "search";
}) {
  const paths = {
    cart: (
      <path d="M3 4h2l2.1 9.1a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L20 7H6.1M10 20h.01M17 20h.01" />
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    trash: (
      <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5M14 11v5" />
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    search: (
      <path d="m21 21-4.3-4.3m2.3-5.2A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />
    ),
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round"
    >
      {paths[name]}
    </svg>
  );
}

function ProductImage({
  product,
  className,
}: {
  product: CatalogProduct;
  className: string;
}) {
  const cover = product.images.find((image) => image.isCover) ?? product.images[0];

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-tt-purple-50 via-white to-red-50 ${className}`}>
      {cover?.src ? (
        <img
          src={cover.src}
          alt={cover.alt}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="grid h-full place-items-center px-6 text-center text-sm font-bold text-slate-400">
          Chưa cấu hình R2_PUBLIC_BASE_URL
        </div>
      )}
    </div>
  );
}

export function CatalogOrdering({ products }: { products: CatalogProduct[] }) {
  const nextRowId = useRef(2);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [rows, setRows] = useState<SelectionRow[]>([createRow("row-1")]);
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const selectedProduct = products.find(
    (product) => product.id === selectedProductId,
  );

  const brands = useMemo(
    () =>
      [...new Map(products.map((product) => [product.brandSlug, product.brand])).entries()].sort(
        (left, right) => left[1].localeCompare(right[1], "vi"),
      ),
    [products],
  );

  const categories = useMemo(
    () =>
      [
        ...new Map(
          products
            .filter((product) => product.categorySlug && product.category)
            .map((product) => [product.categorySlug as string, product.category as string]),
        ).entries(),
      ].sort((left, right) => left[1].localeCompare(right[1], "vi")),
    [products],
  );

  const visibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("vi");

    return products.filter((product) => {
      if (brandFilter && product.brandSlug !== brandFilter) return false;
      if (categoryFilter && product.categorySlug !== categoryFilter) return false;
      if (!normalizedSearch) return true;

      return [product.code, product.name, product.brand, product.category ?? ""]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(normalizedSearch);
    });
  }, [brandFilter, categoryFilter, products, search]);

  const totalQuantity = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.quantity, 0),
    [cartLines],
  );

  const cartTotal = useMemo(
    () =>
      cartLines.reduce(
        (sum, line) => sum + line.unitPrice * line.quantity,
        0,
      ),
    [cartLines],
  );

  const selectedQuantity = rows.reduce(
    (sum, row) => sum + (row.colorId && row.size ? row.quantity : 0),
    0,
  );

  function openProduct(productId: string) {
    setSelectedProductId(productId);
    setRows([createRow(`row-${nextRowId.current++}`)]);
    setError("");
  }

  function closeProduct() {
    setSelectedProductId(null);
    setError("");
  }

  function addRow() {
    setRows((current) => [
      ...current,
      createRow(`row-${nextRowId.current++}`),
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
        ? [createRow(current[0].id)]
        : current.filter((row) => row.id !== id),
    );
  }

  function sizesForColor(product: CatalogProduct, colorId: string) {
    return [
      ...new Set(
        product.variants
          .filter((variant) => variant.colorId === colorId)
          .map((variant) => variant.size),
      ),
    ];
  }

  function addAllToCart() {
    if (!selectedProduct) return;

    if (selectedProduct.variants.length === 0) {
      setError("Model này chưa có dữ liệu màu và size trong PostgreSQL.");
      return;
    }

    const resolvedRows = rows.map((row) => {
      const variant = selectedProduct.variants.find(
        (item) => item.colorId === row.colorId && item.size === row.size,
      );
      const color = selectedProduct.colors.find(
        (item) => item.id === row.colorId,
      );
      return { row, variant, color };
    });

    if (
      resolvedRows.some(
        ({ row, variant, color }) =>
          !row.colorId ||
          !row.size ||
          row.quantity < 1 ||
          !variant ||
          !color,
      )
    ) {
      setError("Chọn đúng màu, size và số lượng cho từng dòng.");
      return;
    }

    setCartLines((current) => {
      const merged = new Map(current.map((line) => [line.key, { ...line }]));

      for (const { row, variant, color } of resolvedRows) {
        if (!variant || !color) continue;
        const existing = merged.get(variant.id);

        if (existing) {
          existing.quantity += row.quantity;
        } else {
          merged.set(variant.id, {
            key: variant.id,
            productId: selectedProduct.id,
            productCode: selectedProduct.code,
            productName: selectedProduct.name,
            colorLabel: color.label,
            size: variant.size,
            quantity: row.quantity,
            unitPrice: variant.price,
          });
        }
      }

      return [...merged.values()];
    });

    setRows([createRow(`row-${nextRowId.current++}`)]);
    closeProduct();
  }

  return (
    <main className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 border-b border-tt-purple-100/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-tt-purple-700 text-sm font-black text-white shadow-lg shadow-tt-purple-700/20">
              TT
            </div>
            <div>
              <p className="font-extrabold tracking-tight text-ink-950">Tuấn Thủy</p>
              <p className="text-xs text-slate-500">Catalog PostgreSQL + R2</p>
            </div>
          </div>

          <div className="flex h-11 items-center gap-2 rounded-2xl border border-tt-purple-100 bg-tt-purple-50 px-4 font-bold text-tt-purple-800">
            <Icon name="cart" />
            <span className="hidden sm:inline">Giỏ hàng</span>
            <span className="grid min-w-6 place-items-center rounded-full bg-winking-red px-1.5 py-0.5 text-xs text-white">
              {totalQuantity}
            </span>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 pb-8 pt-8 sm:px-6 sm:pt-12">
        <div className="overflow-hidden rounded-[2rem] border border-tt-purple-100 bg-white p-6 shadow-[0_24px_80px_rgba(79,29,143,0.10)] sm:p-10">
          <p className="text-sm font-extrabold uppercase tracking-[0.18em] text-tt-purple-700">
            Catalog thật
          </p>
          <div className="mt-3 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <h1 className="max-w-3xl text-3xl font-black leading-tight tracking-[-0.04em] text-ink-950 sm:text-5xl">
                {products.length} model đang đọc trực tiếp từ PostgreSQL.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                Gallery lấy từ Cloudflare R2. Màu, size và giá chỉ hiện khi đã có dữ liệu variant thật trong database.
              </p>
            </div>
            <div className="rounded-3xl bg-tt-purple-700 px-5 py-4 text-white shadow-xl shadow-tt-purple-700/20">
              <p className="text-sm font-bold text-tt-purple-100">Đang hiển thị</p>
              <p className="mt-1 text-3xl font-black">{visibleProducts.length} model</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="mb-5 grid gap-3 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_180px_180px]">
            <label className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-slate-400">
              <Icon name="search" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Tìm sản phẩm"
                className="w-full border-0 bg-transparent text-sm text-ink-950 outline-none"
                placeholder="Tìm mã, tên, thương hiệu"
              />
            </label>

            <select
              value={brandFilter}
              onChange={(event) => setBrandFilter(event.target.value)}
              aria-label="Lọc thương hiệu"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ink-950"
            >
              <option value="">Mọi thương hiệu</option>
              {brands.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Lọc nhóm sản phẩm"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ink-950"
            >
              <option value="">Mọi nhóm</option>
              {categories.map(([slug, name]) => (
                <option key={slug} value={slug}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {visibleProducts.length === 0 ? (
            <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <p className="font-black text-ink-950">Không có model phù hợp</p>
              <p className="mt-2 text-sm text-slate-500">Đổi từ khóa hoặc bộ lọc.</p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {visibleProducts.map((product) => (
                <article
                  key={product.id}
                  className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(32,21,45,0.08)] transition hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(79,29,143,0.14)]"
                >
                  <button
                    type="button"
                    onClick={() => openProduct(product.id)}
                    className="block w-full text-left"
                  >
                    <div className="relative">
                      <ProductImage product={product} className="aspect-square" />
                      <span className="absolute left-4 top-4 rounded-full bg-winking-red px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-white shadow-lg">
                        {product.brand}
                      </span>
                      <span className="absolute bottom-4 right-4 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-tt-purple-800 shadow-lg">
                        {product.images.length} ảnh
                      </span>
                    </div>

                    <div className="p-5">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                        {product.category ?? "Sản phẩm"} · Mã {product.code}
                      </p>
                      <h2 className="mt-1 text-lg font-black text-ink-950">
                        {product.name}
                      </h2>
                      <p className="mt-2 line-clamp-2 min-h-12 text-sm leading-6 text-slate-600">
                        {product.description ?? "Thông tin sản phẩm đang cập nhật."}
                      </p>
                      <div className="mt-5 flex items-center justify-between gap-3">
                        <p className="text-lg font-black text-tt-purple-700">
                          {formatVnd(product.price)}
                        </p>
                        <span className="rounded-xl bg-tt-purple-700 px-3 py-2 text-xs font-bold text-white">
                          Xem mẫu
                        </span>
                      </div>
                    </div>
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="h-fit rounded-[1.75rem] border border-tt-purple-100 bg-white p-5 shadow-[0_18px_50px_rgba(79,29,143,0.08)] lg:sticky lg:top-24">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-sm font-bold text-tt-purple-700">Giỏ tạm</p>
              <h2 className="text-xl font-black text-ink-950">{totalQuantity} sản phẩm</h2>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-tt-purple-50 text-tt-purple-700">
              <Icon name="cart" />
            </div>
          </div>

          {cartLines.length === 0 ? (
            <div className="py-10 text-center">
              <p className="font-bold text-ink-950">Chưa có phân loại nào</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Chọn một model đã có màu và size trong database.
              </p>
            </div>
          ) : (
            <div className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto">
              {cartLines.map((line) => (
                <div key={line.key} className="flex gap-3 py-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-tt-purple-50 text-xs font-black text-tt-purple-800">
                    {line.productCode}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-ink-950">
                      {line.productName}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {line.colorLabel} · {line.size} · SL {line.quantity}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Tạm tính</span>
              <strong className="text-lg text-ink-950">{formatVnd(cartTotal)}</strong>
            </div>
            <button
              type="button"
              disabled={!cartLines.length}
              className="mt-4 w-full rounded-2xl bg-tt-purple-700 px-4 py-3.5 font-extrabold text-white shadow-lg shadow-tt-purple-700/20 transition hover:bg-tt-purple-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              Xem giỏ hàng
            </button>
          </div>
        </aside>
      </section>

      {selectedProduct && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/55 sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Chọn phân loại ${selectedProduct.name}`}
        >
          <div className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-[2rem]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-winking-red">
                  {selectedProduct.brand} · {selectedProduct.code}
                </p>
                <h2 className="text-lg font-black text-ink-950 sm:text-xl">
                  {selectedProduct.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeProduct}
                aria-label="Đóng preview"
                className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-600 transition hover:bg-tt-purple-100 hover:text-tt-purple-800"
              >
                <Icon name="close" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
                <section className="border-b border-slate-100 bg-gradient-to-br from-tt-purple-50 via-white to-red-50 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                  {selectedProduct.images.length > 0 ? (
                    <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto">
                      {selectedProduct.images.map((image, index) => (
                        <figure
                          key={image.id}
                          className="relative aspect-square min-w-[88%] snap-center overflow-hidden rounded-[1.5rem] border border-white bg-white shadow-lg sm:min-w-[72%] lg:min-w-full"
                        >
                          {image.src ? (
                            <img
                              src={image.src}
                              alt={image.alt}
                              className="h-full w-full object-cover"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="grid h-full place-items-center text-sm font-bold text-slate-400">
                              Thiếu R2_PUBLIC_BASE_URL
                            </div>
                          )}
                          <figcaption className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-tt-purple-800 shadow">
                            Ảnh {index + 1}/{selectedProduct.images.length}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <div className="grid aspect-square place-items-center rounded-[1.5rem] bg-white text-sm font-bold text-slate-400 shadow-lg">
                      Model chưa có ảnh
                    </div>
                  )}
                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    Gallery thật trên R2 của model {selectedProduct.code}.
                  </p>
                </section>

                <section className="p-4 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-slate-500">Đơn giá</p>
                      <p className="text-2xl font-black text-tt-purple-700">
                        {formatVnd(selectedProduct.price)}
                      </p>
                    </div>
                    <span className="rounded-2xl bg-tt-purple-50 px-3 py-2 text-xs font-bold text-tt-purple-800">
                      {selectedProduct.variants.length} variants
                    </span>
                  </div>

                  {selectedProduct.variants.length === 0 ? (
                    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                      Gallery và model đã nhập thật. Màu, size và giá chưa có trong nguồn manifest ảnh nên không được tự bịa; cần nhập từ bảng giá trước khi đặt hàng.
                    </div>
                  ) : (
                    <>
                      <div className="mt-6 space-y-3">
                        {rows.map((row, index) => {
                          const sizes = sizesForColor(
                            selectedProduct,
                            row.colorId,
                          );

                          return (
                            <div
                              key={row.id}
                              className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                            >
                              <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-extrabold text-ink-950">
                                  Dòng {index + 1}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => removeRow(row.id)}
                                  aria-label={`Xóa dòng ${index + 1}`}
                                  className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-red-50 hover:text-winking-red"
                                >
                                  <Icon name="trash" />
                                </button>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_132px]">
                                <label className="text-xs font-bold text-slate-500">
                                  Màu
                                  <select
                                    value={row.colorId}
                                    onChange={(event) =>
                                      updateRow(row.id, {
                                        colorId: event.target.value,
                                        size: "",
                                      })
                                    }
                                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-ink-950"
                                  >
                                    <option value="">Chọn màu</option>
                                    {selectedProduct.colors.map((color) => (
                                      <option key={color.id} value={color.id}>
                                        {color.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="text-xs font-bold text-slate-500">
                                  Size
                                  <select
                                    value={row.size}
                                    disabled={!row.colorId}
                                    onChange={(event) =>
                                      updateRow(row.id, {
                                        size: event.target.value,
                                      })
                                    }
                                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-ink-950 disabled:bg-slate-100"
                                  >
                                    <option value="">Chọn size</option>
                                    {sizes.map((size) => (
                                      <option key={size} value={size}>
                                        {size}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <div>
                                  <p className="text-xs font-bold text-slate-500">Số lượng</p>
                                  <div className="mt-1.5 flex h-11 items-center overflow-hidden rounded-xl border border-slate-200">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateRow(row.id, {
                                          quantity: Math.max(1, row.quantity - 1),
                                        })
                                      }
                                      className="grid h-full w-10 place-items-center text-lg font-bold text-tt-purple-700 hover:bg-tt-purple-50"
                                    >
                                      −
                                    </button>
                                    <input
                                      aria-label={`Số lượng dòng ${index + 1}`}
                                      type="number"
                                      min={1}
                                      value={row.quantity}
                                      onChange={(event) =>
                                        updateRow(row.id, {
                                          quantity: Math.max(
                                            1,
                                            Number(event.target.value) || 1,
                                          ),
                                        })
                                      }
                                      className="h-full min-w-0 flex-1 border-x border-slate-200 text-center text-sm font-extrabold text-ink-950 outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateRow(row.id, {
                                          quantity: row.quantity + 1,
                                        })
                                      }
                                      className="grid h-full w-10 place-items-center text-lg font-bold text-tt-purple-700 hover:bg-tt-purple-50"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={addRow}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-tt-purple-300 bg-tt-purple-50 px-4 py-3 font-extrabold text-tt-purple-800 transition hover:border-tt-purple-500 hover:bg-tt-purple-100"
                      >
                        <Icon name="plus" /> Thêm dòng phân loại
                      </button>
                    </>
                  )}

                  {error && (
                    <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-winking-red">
                      {error}
                    </p>
                  )}
                </section>
              </div>
            </div>

            <footer className="border-t border-slate-100 bg-white px-4 py-4 sm:px-6">
              <div className="mx-auto flex max-w-4xl items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-500">Đã chọn</p>
                  <p className="truncate font-black text-ink-950">
                    {rows.length} dòng · {selectedQuantity} sản phẩm
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addAllToCart}
                  disabled={selectedProduct.variants.length === 0}
                  className="rounded-2xl bg-tt-purple-700 px-5 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-tt-purple-700/25 transition hover:bg-tt-purple-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none sm:px-8"
                >
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
