"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type { CatalogProduct } from "@/lib/catalog-types";
import type { CreatedOrder, ServerCart } from "@/lib/order-types";

type SelectionRow = {
  id: string;
  colorId: string;
  variantId: string;
  quantity: number;
};

type CheckoutForm = {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  note: string;
};

const EMPTY_CART: ServerCart = {
  items: [],
  quantity: 0,
  subtotal: 0,
  currency: "VND",
};

function formatVnd(value: number) {
  if (value <= 0) return "Đang cập nhật";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function makeRow(index: number): SelectionRow {
  return { id: `row-${index}`, colorId: "", variantId: "", quantity: 1 };
}

function coverFor(product: CatalogProduct) {
  return product.images.find((image) => image.isCover) ?? product.images[0] ?? null;
}

function blockerMessage(product: CatalogProduct) {
  if (product.orderingBlocker === "missing-color") {
    return "Model đã có size/cup nhưng chưa có danh sách màu được xác nhận. Đặt hàng đang khóa để kho không nhận đơn thiếu màu.";
  }
  if (product.orderingBlocker === "missing-size-cup") {
    return "Model đã có màu nhưng chưa có tổ hợp size/cup được xác nhận. Đặt hàng đang khóa để tránh tạo biến thể không có nguồn.";
  }
  return "Model chưa đủ dữ liệu đặt hàng.";
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || "Không xử lý được yêu cầu.");
  }
  return body;
}

export function CatalogOrdering({ products }: { products: CatalogProduct[] }) {
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [rows, setRows] = useState<SelectionRow[]>([makeRow(1)]);
  const [nextRow, setNextRow] = useState(2);
  const [error, setError] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<ServerCart>(EMPTY_CART);
  const [cartLoading, setCartLoading] = useState(true);
  const [cartBusy, setCartBusy] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [checkout, setCheckout] = useState<CheckoutForm>({
    customerName: "",
    customerPhone: "",
    deliveryAddress: "",
    note: "",
  });

  const selected = products.find((product) => product.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;
    async function loadCart() {
      try {
        const response = await fetch("/api/cart", { cache: "no-store" });
        const body = await readJson<{ cart: ServerCart }>(response);
        if (!cancelled) setCart(body.cart);
      } catch (loadError) {
        if (!cancelled) {
          setCheckoutError(loadError instanceof Error ? loadError.message : "Không đọc được giỏ hàng.");
        }
      } finally {
        if (!cancelled) setCartLoading(false);
      }
    }
    void loadCart();
    return () => {
      cancelled = true;
    };
  }, []);

  const brandOptions = useMemo(
    () =>
      [...new Map(products.map((product) => [product.brandSlug, product.brand])).entries()].sort(
        (a, b) => a[1].localeCompare(b[1], "vi"),
      ),
    [products],
  );

  const categoryOptions = useMemo(
    () =>
      [
        ...new Map(
          products
            .filter((product) => product.categorySlug && product.category)
            .map((product) => [product.categorySlug as string, product.category as string]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1], "vi")),
    [products],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("vi");
    return products.filter((product) => {
      if (brand && product.brandSlug !== brand) return false;
      if (category && product.categorySlug !== category) return false;
      if (!needle) return true;
      return [product.code, product.name, product.brand, product.category ?? ""]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(needle);
    });
  }, [brand, category, products, search]);

  const orderableCount = products.filter((product) => product.orderable).length;

  function openProduct(product: CatalogProduct) {
    setSelectedId(product.id);
    setImageIndex(0);
    setRows([makeRow(1)]);
    setNextRow(2);
    setError("");
  }

  function updateRow(id: string, patch: Partial<SelectionRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError("");
  }

  function removeRow(id: string) {
    setRows((current) =>
      current.length === 1 ? [makeRow(1)] : current.filter((row) => row.id !== id),
    );
    setError("");
  }

  async function addRowsToCart() {
    if (!selected || !selected.orderable || cartBusy) return;

    const resolved = rows.map((row) => ({
      row,
      color: selected.colors.find((color) => color.id === row.colorId) ?? null,
      variant: selected.variants.find((variant) => variant.id === row.variantId) ?? null,
    }));

    if (
      resolved.some(
        ({ row, color, variant }) =>
          !row.colorId || !row.variantId || row.quantity < 1 || !color || !variant,
      )
    ) {
      setError("Chọn đủ màu, size/cup và số lượng cho từng dòng.");
      return;
    }

    setCartBusy(true);
    setError("");
    setCreatedOrder(null);
    try {
      const response = await fetch("/api/cart/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: resolved.map(({ row }) => ({
            productVariantId: row.variantId,
            colorId: row.colorId,
            quantity: row.quantity,
          })),
        }),
      });
      const body = await readJson<{ cart: ServerCart }>(response);
      setCart(body.cart);
      setSelectedId(null);
      setCartOpen(true);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Không thêm được vào giỏ.");
    } finally {
      setCartBusy(false);
    }
  }

  async function changeCartQuantity(itemId: string, quantity: number) {
    if (busyItemId) return;
    setBusyItemId(itemId);
    setCheckoutError("");
    try {
      const deleting = quantity < 1;
      const response = await fetch(`/api/cart/items/${itemId}`, {
        method: deleting ? "DELETE" : "PATCH",
        headers: deleting ? undefined : { "Content-Type": "application/json" },
        body: deleting ? undefined : JSON.stringify({ quantity }),
      });
      const body = await readJson<{ cart: ServerCart }>(response);
      setCart(body.cart);
    } catch (updateError) {
      setCheckoutError(
        updateError instanceof Error ? updateError.message : "Không cập nhật được giỏ hàng.",
      );
    } finally {
      setBusyItemId(null);
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cart.items.length === 0 || cartBusy) return;
    setCartBusy(true);
    setCheckoutError("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkout),
      });
      const body = await readJson<{ order: CreatedOrder }>(response);
      setCreatedOrder(body.order);
      setCart(EMPTY_CART);
      setCheckout({ customerName: "", customerPhone: "", deliveryAddress: "", note: "" });
    } catch (orderError) {
      setCheckoutError(orderError instanceof Error ? orderError.message : "Không tạo được đơn hàng.");
    } finally {
      setCartBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f5fa] pb-20 text-ink-950">
      <header className="sticky top-0 z-30 border-b border-black/5 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-tt-purple-700 text-sm font-black text-white">TT</div>
            <div>
              <p className="font-black leading-none">Tuấn Thủy</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Catalog bán sỉ</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black shadow-sm"
          >
            {cartLoading ? "Đang tải giỏ..." : `Giỏ hàng · ${cart.quantity}`}
          </button>
        </div>
      </header>

      <section className="border-b border-black/5 bg-white">
        <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">Catalog thật</p>
          <div className="mt-3 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Chọn đúng màu, đúng size/cup.</h1>
              <p className="mt-3 max-w-3xl leading-7 text-slate-600">
                Giỏ được lưu tại server. Mỗi dòng có identity riêng theo sản phẩm, màu và size/cup; giá được kiểm tra lại khi tạo đơn.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-slate-100 px-4 py-3"><strong className="block text-xl">{products.length}</strong>model</div>
              <div className="rounded-xl bg-slate-100 px-4 py-3"><strong className="block text-xl">{orderableCount}</strong>đặt được</div>
              <div className="rounded-xl bg-slate-100 px-4 py-3"><strong className="block text-xl">{products.reduce((sum, product) => sum + product.images.length, 0)}</strong>ảnh</div>
            </div>
          </div>

          <div className="mt-7 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm theo mã, tên, thương hiệu..."
              className="h-12 rounded-xl border border-slate-200 bg-white px-4 outline-none focus:border-tt-purple-500"
            />
            <select value={brand} onChange={(event) => setBrand(event.target.value)} className="h-12 rounded-xl border border-slate-200 bg-white px-4">
              <option value="">Tất cả thương hiệu</option>
              {brandOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="h-12 rounded-xl border border-slate-200 bg-white px-4">
              <option value="">Tất cả nhóm hàng</option>
              {categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((product) => {
            const cover = coverFor(product);
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => openProduct(product)}
                className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl"
              >
                <div className="relative aspect-[4/5] overflow-hidden bg-slate-100">
                  {cover?.src ? <img src={cover.src} alt={cover.alt} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <div className="grid h-full place-items-center text-sm font-bold text-slate-400">Chưa có ảnh</div>}
                  <span className={`absolute left-3 top-3 rounded-full px-3 py-1.5 text-[11px] font-black ${product.orderable ? "bg-emerald-600 text-white" : "bg-white/95 text-slate-600"}`}>
                    {product.orderable ? "Đặt hàng" : "Chờ dữ liệu"}
                  </span>
                </div>
                <div className="p-4">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-tt-purple-700">{product.brand} · {product.code}</p>
                  <h2 className="mt-2 line-clamp-2 font-black">{product.name}</h2>
                  <p className="mt-3 text-lg font-black">{formatVnd(product.price)}</p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">{product.colors.length} màu · {product.variants.length} size/cup</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 sm:place-items-center sm:p-5" role="dialog" aria-modal="true">
          <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">{selected.brand} · {selected.category} · {selected.code}</p>
                <h2 className="mt-1 text-xl font-black">{selected.name}</h2>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className="h-10 w-10 rounded-xl bg-slate-100 text-xl">×</button>
            </div>

            <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
              <section className="border-b border-slate-200 bg-[#f7f5fa] p-4 lg:border-b-0 lg:border-r lg:p-6">
                <div className="overflow-hidden rounded-2xl bg-white">
                  {selected.images[imageIndex]?.src ? <img src={selected.images[imageIndex].src ?? ""} alt={selected.images[imageIndex].alt} className="aspect-square w-full object-contain" /> : <div className="grid aspect-square place-items-center text-slate-400">Chưa có ảnh</div>}
                </div>
                {selected.images.length > 1 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto">
                    {selected.images.map((image, index) => (
                      <button key={image.id} type="button" onClick={() => setImageIndex(index)} className={`h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 bg-white ${index === imageIndex ? "border-tt-purple-600" : "border-transparent"}`}>
                        {image.src ? <img src={image.src} alt="" className="h-full w-full object-cover" /> : null}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="p-5 lg:p-6">
                <p className="text-2xl font-black text-tt-purple-700">{formatVnd(selected.price)}</p>
                <p className="mt-4 text-sm leading-6 text-slate-600">{selected.description ?? "Thông tin sản phẩm đang cập nhật."}</p>

                {!selected.orderable ? (
                  <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                    <p className="font-black">Chưa thể đặt hàng.</p>
                    <p className="mt-1">{blockerMessage(selected)}</p>
                    <p className="mt-2 font-semibold">Hiện có {selected.colors.length} màu và {selected.variants.length} tổ hợp size/cup.</p>
                  </div>
                ) : (
                  <div className="mt-6 space-y-3">
                    {rows.map((row, index) => (
                      <div key={row.id} className="rounded-2xl border border-slate-200 p-3">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-sm font-black">Dòng đặt hàng {index + 1}</p>
                          <button type="button" onClick={() => removeRow(row.id)} className="text-sm font-bold text-slate-400 hover:text-red-600">Xóa</button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_126px]">
                          <select value={row.colorId} onChange={(event) => updateRow(row.id, { colorId: event.target.value })} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                            <option value="">Chọn màu</option>
                            {selected.colors.map((color) => <option key={color.id} value={color.id}>{color.label}</option>)}
                          </select>
                          <select value={row.variantId} onChange={(event) => updateRow(row.id, { variantId: event.target.value })} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                            <option value="">Chọn size/cup</option>
                            {selected.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}
                          </select>
                          <input type="number" min={1} max={999} value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: Math.min(999, Math.max(1, Number(event.target.value) || 1)) })} className="h-11 rounded-xl border border-slate-200 px-3 text-center font-black" aria-label={`Số lượng dòng ${index + 1}`} />
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => { setRows((current) => [...current, makeRow(nextRow)]); setNextRow((value) => value + 1); }} className="w-full rounded-xl border border-dashed border-tt-purple-300 bg-tt-purple-50 px-4 py-3 text-sm font-black text-tt-purple-700">+ Thêm dòng đặt hàng</button>
                  </div>
                )}

                {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>}
                <button type="button" onClick={() => void addRowsToCart()} disabled={!selected.orderable || cartBusy} className="mt-6 w-full rounded-xl bg-tt-purple-700 px-5 py-3.5 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                  {cartBusy ? "Đang lưu vào giỏ..." : selected.orderable ? "Thêm các dòng vào giỏ" : "Chưa thể đặt hàng"}
                </button>
              </section>
            </div>
          </div>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-[60] bg-black/50" role="dialog" aria-modal="true">
          <button type="button" aria-label="Đóng giỏ" onClick={() => setCartOpen(false)} className="absolute inset-0" />
          <aside className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">Giỏ hàng server</p><h2 className="mt-1 text-xl font-black">{cart.quantity} sản phẩm</h2></div>
              <button type="button" onClick={() => setCartOpen(false)} className="h-10 w-10 rounded-xl bg-slate-100 text-xl">×</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              {createdOrder ? (
                <div className="my-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Đã tạo đơn</p>
                  <p className="mt-2 text-2xl font-black">{createdOrder.orderCode}</p>
                  <p className="mt-2 text-sm leading-6">Đơn đã được lưu tại server với {createdOrder.itemCount} sản phẩm, tổng {formatVnd(createdOrder.subtotal)}.</p>
                </div>
              ) : cart.items.length === 0 ? (
                <div className="grid h-56 place-items-center text-sm font-bold text-slate-400">Giỏ đang trống</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {cart.items.map((line) => (
                    <div key={line.id} className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div><p className="text-xs font-black uppercase tracking-[0.12em] text-tt-purple-700">Mã {line.productCode}</p><p className="mt-1 font-black">{line.productName}</p><p className="mt-1 text-sm text-slate-500">Màu {line.colorLabel} · {line.variantLabel}</p></div>
                        <button type="button" disabled={busyItemId === line.id} onClick={() => void changeCartQuantity(line.id, 0)} className="text-sm font-bold text-red-600 disabled:opacity-40">Xóa</button>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2"><button type="button" disabled={busyItemId === line.id} onClick={() => void changeCartQuantity(line.id, line.quantity - 1)} className="h-8 w-8 rounded-lg border disabled:opacity-40">−</button><strong>{line.quantity}</strong><button type="button" disabled={busyItemId === line.id || line.quantity >= 999} onClick={() => void changeCartQuantity(line.id, line.quantity + 1)} className="h-8 w-8 rounded-lg border disabled:opacity-40">+</button></div>
                        <p className="font-black text-tt-purple-700">{formatVnd(line.lineTotal)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!createdOrder && cart.items.length > 0 && (
                <form onSubmit={submitOrder} className="mb-6 border-t border-slate-200 pt-5">
                  <p className="font-black">Thông tin tạo đơn</p>
                  <div className="mt-3 grid gap-3">
                    <input required minLength={2} maxLength={120} value={checkout.customerName} onChange={(event) => setCheckout((current) => ({ ...current, customerName: event.target.value }))} placeholder="Tên khách hàng" className="h-11 rounded-xl border border-slate-200 px-3" />
                    <input required minLength={8} maxLength={24} value={checkout.customerPhone} onChange={(event) => setCheckout((current) => ({ ...current, customerPhone: event.target.value }))} placeholder="Số điện thoại" className="h-11 rounded-xl border border-slate-200 px-3" />
                    <textarea maxLength={500} value={checkout.deliveryAddress} onChange={(event) => setCheckout((current) => ({ ...current, deliveryAddress: event.target.value }))} placeholder="Địa chỉ giao hàng (có thể bổ sung sau)" className="min-h-20 rounded-xl border border-slate-200 p-3" />
                    <textarea maxLength={1000} value={checkout.note} onChange={(event) => setCheckout((current) => ({ ...current, note: event.target.value }))} placeholder="Ghi chú" className="min-h-20 rounded-xl border border-slate-200 p-3" />
                  </div>
                  {checkoutError && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{checkoutError}</p>}
                  <button type="submit" disabled={cartBusy} className="mt-4 w-full rounded-xl bg-ink-950 px-5 py-3.5 font-black text-white disabled:bg-slate-200 disabled:text-slate-400">
                    {cartBusy ? "Đang tạo đơn..." : "Tạo đơn hàng"}
                  </button>
                </form>
              )}
            </div>
            {!createdOrder && (
              <footer className="border-t border-slate-200 p-5"><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-500">Tạm tính</span><strong className="text-xl">{formatVnd(cart.subtotal)}</strong></div></footer>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
