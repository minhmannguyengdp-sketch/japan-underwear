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

type IconName =
  | "bag"
  | "search"
  | "close"
  | "plus"
  | "minus"
  | "trash"
  | "image"
  | "grid"
  | "filter";

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    bag: <path d="M6 8h12l1 12H5L6 8Zm3 0V6a3 3 0 0 1 6 0v2" />,
    search: <path d="m21 21-4.3-4.3m2.3-5.2A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    trash: <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5M14 11v5" />,
    image: <path d="M4 5h16v14H4V5Zm0 10 4-4 4 4 2-2 6 6M15 9h.01" />,
    grid: <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />,
    filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`${className} fill-none stroke-current stroke-2 stroke-linecap-round stroke-linejoin-round`}
    >
      {paths[name]}
    </svg>
  );
}

function createRow(id: string): SelectionRow {
  return { id, colorId: "", size: "", quantity: 1 };
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

function ProductArtwork({ product }: { product: CatalogProduct }) {
  const cover = coverFor(product);

  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-gradient-to-br from-[#f5f0ff] via-white to-[#fff0f1]">
      {cover?.src ? (
        <img
          src={cover.src}
          alt={cover.alt}
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <div className="grid h-full place-items-center px-8 text-center text-sm font-semibold text-slate-400">
          <div>
            <Icon name="image" className="mx-auto mb-3 h-8 w-8" />
            Chưa có ảnh hiển thị
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/35 to-transparent" />
      <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-ink-950 shadow-sm backdrop-blur">
        {product.brand}
      </span>
      <span className="absolute bottom-3 right-3 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur">
        {product.images.length} ảnh
      </span>
    </div>
  );
}

export function CatalogOrdering({ products }: { products: CatalogProduct[] }) {
  const nextRowId = useRef(2);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sort, setSort] = useState("code");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [rows, setRows] = useState<SelectionRow[]>([createRow("row-1")]);
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [formError, setFormError] = useState("");

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;

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

  const totalImages = useMemo(
    () => products.reduce((sum, product) => sum + product.images.length, 0),
    [products],
  );

  const orderableProducts = useMemo(
    () => products.filter((product) => product.variants.length > 0).length,
    [products],
  );

  const visibleProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("vi");
    const filtered = products.filter((product) => {
      if (brandFilter && product.brandSlug !== brandFilter) return false;
      if (categoryFilter && product.categorySlug !== categoryFilter) return false;
      if (!normalizedSearch) return true;

      return [product.code, product.name, product.brand, product.category ?? ""]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(normalizedSearch);
    });

    return [...filtered].sort((left, right) => {
      if (sort === "brand") {
        return left.brand.localeCompare(right.brand, "vi") || left.code.localeCompare(right.code, "vi");
      }
      if (sort === "images") {
        return right.images.length - left.images.length || left.code.localeCompare(right.code, "vi");
      }
      return left.code.localeCompare(right.code, "vi", { numeric: true });
    });
  }, [brandFilter, categoryFilter, products, search, sort]);

  const cartQuantity = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.quantity, 0),
    [cartLines],
  );

  const cartTotal = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [cartLines],
  );

  function openProduct(productId: string) {
    setSelectedProductId(productId);
    setActiveImageIndex(0);
    setRows([createRow(`row-${nextRowId.current++}`)]);
    setFormError("");
  }

  function closeProduct() {
    setSelectedProductId(null);
    setFormError("");
  }

  function updateRow(id: string, patch: Partial<SelectionRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setFormError("");
  }

  function removeRow(id: string) {
    setRows((current) =>
      current.length === 1 ? [createRow(current[0].id)] : current.filter((row) => row.id !== id),
    );
  }

  function sizesForColor(product: CatalogProduct, colorId: string) {
    return [
      ...new Set(
        product.variants
          .filter((variant) => variant.colorId === colorId)
          .map((variant) => variant.size),
      ),
    ].sort((left, right) => left.localeCompare(right, "vi", { numeric: true }));
  }

  function addRowsToCart() {
    if (!selectedProduct) return;
    if (selectedProduct.variants.length === 0) {
      setFormError("Model này chưa có bảng giá, màu và size để đặt hàng.");
      return;
    }

    const resolved = rows.map((row) => ({
      row,
      color: selectedProduct.colors.find((color) => color.id === row.colorId),
      variant: selectedProduct.variants.find(
        (variant) => variant.colorId === row.colorId && variant.size === row.size,
      ),
    }));

    if (
      resolved.some(
        ({ row, color, variant }) =>
          !row.colorId || !row.size || row.quantity < 1 || !color || !variant,
      )
    ) {
      setFormError("Chọn đủ màu, size và số lượng cho từng dòng.");
      return;
    }

    setCartLines((current) => {
      const merged = new Map(current.map((line) => [line.key, { ...line }]));
      for (const item of resolved) {
        if (!item.color || !item.variant) continue;
        const existing = merged.get(item.variant.id);
        if (existing) {
          existing.quantity += item.row.quantity;
        } else {
          merged.set(item.variant.id, {
            key: item.variant.id,
            productId: selectedProduct.id,
            productCode: selectedProduct.code,
            productName: selectedProduct.name,
            colorLabel: item.color.label,
            size: item.variant.size,
            quantity: item.row.quantity,
            unitPrice: item.variant.price,
          });
        }
      }
      return [...merged.values()];
    });

    closeProduct();
    setCartOpen(true);
  }

  function changeCartQuantity(key: string, quantity: number) {
    setCartLines((current) =>
      current
        .map((line) => (line.key === key ? { ...line, quantity: Math.max(0, quantity) } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function clearFilters() {
    setSearch("");
    setBrandFilter("");
    setCategoryFilter("");
  }

  return (
    <main className="min-h-screen bg-[#f7f5fa] pb-20 text-ink-950">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-tt-purple-700 text-sm font-black text-white shadow-md shadow-purple-900/15">
              TT
            </div>
            <div>
              <p className="font-black leading-none tracking-tight">Tuấn Thủy</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Catalog bán sỉ
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-extrabold shadow-sm transition hover:border-tt-purple-300 hover:text-tt-purple-700"
          >
            <Icon name="bag" />
            <span className="hidden sm:inline">Giỏ tạm</span>
            <span className="grid min-w-6 place-items-center rounded-full bg-winking-red px-1.5 py-0.5 text-xs text-white">
              {cartQuantity}
            </span>
          </button>
        </div>
      </header>

      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-11">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_480px] lg:items-end">
            <div>
              <span className="inline-flex rounded-full bg-tt-purple-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                Dữ liệu thật · PostgreSQL + R2
              </span>
              <h1 className="mt-4 max-w-4xl text-4xl font-black leading-[1.05] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                Chọn mẫu nhanh, xem ảnh rõ, đặt nhiều phân loại trong một lần.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                Catalog được nhóm đúng theo thương hiệu, nhóm hàng và mã model. Không dùng dữ liệu demo, không đoán màu hoặc size.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
              {[
                [products.length, "model"],
                [totalImages, "ảnh R2"],
                [brands.length, "thương hiệu"],
                [orderableProducts, "đã có biến thể"],
              ].map(([value, label]) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-[#fbfaff] p-4">
                  <p className="text-2xl font-black tracking-tight text-tt-purple-700">{value}</p>
                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-22">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-black">
                <Icon name="filter" /> Bộ lọc
              </div>
              {(search || brandFilter || categoryFilter) && (
                <button type="button" onClick={clearFilters} className="text-xs font-bold text-tt-purple-700">
                  Xóa lọc
                </button>
              )}
            </div>

            <label className="mt-4 block text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">
              Tìm model
              <span className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-slate-400 focus-within:border-tt-purple-300">
                <Icon name="search" className="h-4 w-4" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="min-w-0 flex-1 border-0 bg-transparent text-sm font-semibold text-ink-950 outline-none"
                  placeholder="Ví dụ: 9505"
                />
              </span>
            </label>

            <label className="mt-4 block text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">
              Thương hiệu
              <select
                value={brandFilter}
                onChange={(event) => setBrandFilter(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"
              >
                <option value="">Tất cả</option>
                {brands.map(([slug, name]) => (
                  <option key={slug} value={slug}>{name}</option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">
              Nhóm hàng
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"
              >
                <option value="">Tất cả</option>
                {categories.map(([slug, name]) => (
                  <option key={slug} value={slug}>{name}</option>
                ))}
              </select>
            </label>

            <div className="mt-5 rounded-xl bg-tt-purple-50 p-3 text-sm leading-6 text-tt-purple-900">
              <strong>{visibleProducts.length}</strong> model phù hợp trong tổng số <strong>{products.length}</strong> model.
            </div>
          </aside>

          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon name="grid" />
                <h2 className="text-xl font-black">Danh sách model</h2>
              </div>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sắp xếp sản phẩm"
                className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold shadow-sm"
              >
                <option value="code">Mã tăng dần</option>
                <option value="brand">Theo thương hiệu</option>
                <option value="images">Nhiều ảnh trước</option>
              </select>
            </div>

            {visibleProducts.length === 0 ? (
              <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <div>
                  <Icon name="search" className="mx-auto h-9 w-9 text-slate-300" />
                  <p className="mt-4 text-lg font-black">Không có model phù hợp</p>
                  <p className="mt-2 text-sm text-slate-500">Đổi từ khóa hoặc xóa bộ lọc đang chọn.</p>
                  <button type="button" onClick={clearFilters} className="mt-5 rounded-xl bg-tt-purple-700 px-4 py-2.5 text-sm font-bold text-white">
                    Xóa bộ lọc
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleProducts.map((product) => (
                  <article key={product.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-purple-900/10">
                    <button type="button" onClick={() => openProduct(product.id)} className="block w-full text-left">
                      <ProductArtwork product={product} />
                      <div className="p-4">
                        <div className="flex items-center justify-between gap-3 text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
                          <span>{product.category ?? "Sản phẩm"}</span>
                          <span>Mã {product.code}</span>
                        </div>
                        <h3 className="mt-2 line-clamp-2 min-h-12 text-lg font-black leading-6">{product.name}</h3>
                        <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">Giá</p>
                            <p className="mt-1 font-black text-tt-purple-700">{formatVnd(product.price)}</p>
                          </div>
                          <span className="rounded-lg bg-ink-950 px-3 py-2 text-xs font-bold text-white">
                            Xem chi tiết
                          </span>
                        </div>
                      </div>
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={selectedProduct.name}>
          <div className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-3xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
                  {selectedProduct.brand} · {selectedProduct.category} · {selectedProduct.code}
                </p>
                <h2 className="mt-1 truncate text-xl font-black sm:text-2xl">{selectedProduct.name}</h2>
              </div>
              <button type="button" onClick={closeProduct} aria-label="Đóng" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200">
                <Icon name="close" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
                <section className="border-b border-slate-200 bg-[#f7f5fa] p-4 sm:p-6 lg:border-b-0 lg:border-r">
                  <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
                    {selectedProduct.images[activeImageIndex]?.src ? (
                      <img
                        src={selectedProduct.images[activeImageIndex].src ?? ""}
                        alt={selectedProduct.images[activeImageIndex].alt}
                        className="aspect-square w-full object-contain"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="grid aspect-square place-items-center text-sm font-bold text-slate-400">Chưa có ảnh</div>
                    )}
                  </div>

                  {selectedProduct.images.length > 1 && (
                    <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
                      {selectedProduct.images.map((image, index) => (
                        <button
                          type="button"
                          key={image.id}
                          onClick={() => setActiveImageIndex(index)}
                          aria-label={`Xem ảnh ${index + 1}`}
                          className={`h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 bg-white ${activeImageIndex === index ? "border-tt-purple-600" : "border-transparent"}`}
                        >
                          {image.src ? <img src={image.src} alt="" className="h-full w-full object-cover" /> : <Icon name="image" className="mx-auto h-full w-5 text-slate-300" />}
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="p-5 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-400">Đơn giá</p>
                      <p className="mt-1 text-2xl font-black text-tt-purple-700">{formatVnd(selectedProduct.price)}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
                      {selectedProduct.variants.length} biến thể
                    </span>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    {selectedProduct.description ?? "Thông tin sản phẩm đang cập nhật."}
                  </p>

                  {selectedProduct.variants.length === 0 ? (
                    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                      <p className="font-black">Đã có model và gallery thật.</p>
                      <p className="mt-1">Giá, màu và size chưa được nhập từ bảng giá nên chức năng đặt hàng đang khóa để tránh dữ liệu sai.</p>
                    </div>
                  ) : (
                    <div className="mt-6 space-y-3">
                      {rows.map((row, index) => {
                        const sizes = sizesForColor(selectedProduct, row.colorId);
                        return (
                          <div key={row.id} className="rounded-2xl border border-slate-200 p-3">
                            <div className="mb-3 flex items-center justify-between">
                              <p className="text-sm font-black">Phân loại {index + 1}</p>
                              <button type="button" onClick={() => removeRow(row.id)} aria-label={`Xóa phân loại ${index + 1}`} className="text-slate-400 hover:text-winking-red">
                                <Icon name="trash" className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_126px]">
                              <select
                                value={row.colorId}
                                onChange={(event) => updateRow(row.id, { colorId: event.target.value, size: "" })}
                                aria-label={`Màu phân loại ${index + 1}`}
                                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"
                              >
                                <option value="">Chọn màu</option>
                                {selectedProduct.colors.map((color) => <option key={color.id} value={color.id}>{color.label}</option>)}
                              </select>
                              <select
                                value={row.size}
                                disabled={!row.colorId}
                                onChange={(event) => updateRow(row.id, { size: event.target.value })}
                                aria-label={`Size phân loại ${index + 1}`}
                                className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold disabled:bg-slate-100"
                              >
                                <option value="">Chọn size</option>
                                {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                              </select>
                              <div className="flex h-11 overflow-hidden rounded-xl border border-slate-200">
                                <button type="button" onClick={() => updateRow(row.id, { quantity: Math.max(1, row.quantity - 1) })} className="grid w-10 place-items-center hover:bg-slate-50"><Icon name="minus" className="h-4 w-4" /></button>
                                <input type="number" min={1} value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: Math.max(1, Number(event.target.value) || 1) })} aria-label={`Số lượng phân loại ${index + 1}`} className="min-w-0 flex-1 border-x border-slate-200 text-center text-sm font-black outline-none" />
                                <button type="button" onClick={() => updateRow(row.id, { quantity: row.quantity + 1 })} className="grid w-10 place-items-center hover:bg-slate-50"><Icon name="plus" className="h-4 w-4" /></button>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <button type="button" onClick={() => setRows((current) => [...current, createRow(`row-${nextRowId.current++}`)])} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-tt-purple-300 bg-tt-purple-50 px-4 py-3 text-sm font-black text-tt-purple-700">
                        <Icon name="plus" className="h-4 w-4" /> Thêm phân loại
                      </button>
                    </div>
                  )}

                  {formError && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-winking-red">{formError}</p>}

                  <button
                    type="button"
                    onClick={addRowsToCart}
                    disabled={selectedProduct.variants.length === 0}
                    className="mt-6 w-full rounded-xl bg-tt-purple-700 px-5 py-3.5 font-black text-white shadow-lg shadow-purple-900/15 transition hover:bg-tt-purple-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                  >
                    {selectedProduct.variants.length > 0 ? "Thêm tất cả vào giỏ" : "Chưa thể đặt hàng"}
                  </button>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-[60] bg-ink-950/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Giỏ tạm">
          <button type="button" aria-label="Đóng giỏ" onClick={() => setCartOpen(false)} className="absolute inset-0 h-full w-full" />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">Giỏ tạm</p>
                <h2 className="mt-1 text-xl font-black">{cartQuantity} sản phẩm</h2>
              </div>
              <button type="button" onClick={() => setCartOpen(false)} aria-label="Đóng giỏ" className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><Icon name="close" /></button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              {cartLines.length === 0 ? (
                <div className="grid h-full place-items-center py-16 text-center">
                  <div>
                    <Icon name="bag" className="mx-auto h-10 w-10 text-slate-300" />
                    <p className="mt-4 font-black">Giỏ đang trống</p>
                    <p className="mt-2 text-sm text-slate-500">Chọn model có biến thể để thêm hàng.</p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {cartLines.map((line) => (
                    <div key={line.key} className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase tracking-[0.12em] text-tt-purple-700">Mã {line.productCode}</p>
                          <p className="mt-1 truncate font-black">{line.productName}</p>
                          <p className="mt-1 text-sm text-slate-500">{line.colorLabel} · {line.size}</p>
                        </div>
                        <button type="button" onClick={() => changeCartQuantity(line.key, 0)} aria-label="Xóa sản phẩm" className="text-slate-400 hover:text-winking-red"><Icon name="trash" className="h-4 w-4" /></button>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex h-9 overflow-hidden rounded-lg border border-slate-200">
                          <button type="button" onClick={() => changeCartQuantity(line.key, line.quantity - 1)} className="grid w-9 place-items-center"><Icon name="minus" className="h-3.5 w-3.5" /></button>
                          <span className="grid min-w-10 place-items-center border-x border-slate-200 text-sm font-black">{line.quantity}</span>
                          <button type="button" onClick={() => changeCartQuantity(line.key, line.quantity + 1)} className="grid w-9 place-items-center"><Icon name="plus" className="h-3.5 w-3.5" /></button>
                        </div>
                        <p className="font-black text-tt-purple-700">{formatVnd(line.unitPrice * line.quantity)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <footer className="border-t border-slate-200 p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-500">Tạm tính</span>
                <strong className="text-xl">{formatVnd(cartTotal)}</strong>
              </div>
              <button type="button" disabled={cartLines.length === 0} className="mt-4 w-full rounded-xl bg-ink-950 px-5 py-3.5 font-black text-white disabled:bg-slate-200 disabled:text-slate-400">
                Tiếp tục đặt hàng
              </button>
            </footer>
          </aside>
        </div>
      )}
    </main>
  );
}
