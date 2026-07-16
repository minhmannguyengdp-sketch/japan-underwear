"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, UIEvent } from "react";

import type { CatalogProduct } from "@/lib/catalog-types";
import type {
  CheckoutLocationInput,
  CreatedOrder,
  ServerCart,
} from "@/lib/order-types";

type SelectionRow = {
  id: string;
  colorId: string;
  variantId: string;
  quantity: number;
};

type CheckoutForm = {
  note: string;
};

type LocationState = "idle" | "loading" | "ready" | "error";

type CatalogOrderingProps = {
  products: CatalogProduct[];
  initialProductId?: string | null;
  initialCategory?: string | null;
  initialCartOpen?: boolean;
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
  if (product.orderingBlocker === "missing-color") return "Model chưa có danh sách màu.";
  if (product.orderingBlocker === "missing-size-cup") return "Model chưa có size/cup.";
  return "Model chưa thể đặt.";
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return "Bạn đã từ chối quyền vị trí.";
  if (error.code === error.POSITION_UNAVAILABLE) return "Thiết bị chưa xác định được vị trí.";
  if (error.code === error.TIMEOUT) return "Lấy vị trí quá lâu. Vui lòng thử lại.";
  return "Không lấy được vị trí hiện tại.";
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Không xử lý được yêu cầu.");
  return body;
}

export function CatalogOrdering({
  products,
  initialProductId = null,
  initialCategory = null,
  initialCartOpen = false,
}: CatalogOrderingProps) {
  const initialSelection =
    initialProductId && products.some((product) => product.id === initialProductId)
      ? initialProductId
      : null;
  const resolvedInitialCategory =
    initialCategory && products.some((product) => product.categorySlug === initialCategory)
      ? initialCategory
      : "";

  const galleryRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState(resolvedInitialCategory);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection);
  const [imageIndex, setImageIndex] = useState(0);
  const [rows, setRows] = useState<SelectionRow[]>([makeRow(1)]);
  const [nextRow, setNextRow] = useState(2);
  const [error, setError] = useState("");
  const [addedMessage, setAddedMessage] = useState("");
  const [cartOpen, setCartOpen] = useState(initialCartOpen);
  const [cart, setCart] = useState<ServerCart>(EMPTY_CART);
  const [cartBusy, setCartBusy] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutRequestId, setCheckoutRequestId] = useState("");
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [checkoutLocation, setCheckoutLocation] = useState<CheckoutLocationInput | null>(null);
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const [checkout, setCheckout] = useState<CheckoutForm>({ note: "" });

  const selected = products.find((product) => product.id === selectedId) ?? null;

  function applyCart(nextCart: ServerCart) {
    setCart(nextCart);
    window.dispatchEvent(
      new CustomEvent("cart:updated", {
        detail: { quantity: nextCart.quantity },
      }),
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadCart() {
      try {
        const response = await fetch("/api/cart", { cache: "no-store" });
        const body = await readJson<{ cart: ServerCart }>(response);
        if (!cancelled) applyCart(body.cart);
      } catch (loadError) {
        if (!cancelled) {
          setCheckoutError(
            loadError instanceof Error ? loadError.message : "Không đọc được giỏ hàng.",
          );
        }
      }
    }

    function handleOpenCart() {
      setSelectedId(null);
      setCartOpen(true);
    }

    void loadCart();
    window.addEventListener("cart:open", handleOpenCart);

    return () => {
      cancelled = true;
      window.removeEventListener("cart:open", handleOpenCart);
    };
  }, []);

  useEffect(() => {
    if (!addedMessage) return;
    const timer = window.setTimeout(() => setAddedMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [addedMessage]);

  useEffect(() => {
    if (!selectedId) return;
    window.requestAnimationFrame(() => {
      galleryRef.current?.scrollTo({ left: 0, behavior: "auto" });
    });
  }, [selectedId]);

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

  function openProduct(product: CatalogProduct) {
    setImageIndex(0);
    setSelectedId(product.id);
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

  function handleGalleryScroll(event: UIEvent<HTMLDivElement>) {
    const width = event.currentTarget.clientWidth;
    if (width <= 0) return;
    const nextIndex = Math.round(event.currentTarget.scrollLeft / width);
    if (nextIndex !== imageIndex) setImageIndex(nextIndex);
  }

  function scrollGalleryTo(index: number) {
    const gallery = galleryRef.current;
    if (!gallery) return;
    setImageIndex(index);
    gallery.scrollTo({ left: gallery.clientWidth * index, behavior: "smooth" });
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
      setError("Chọn đủ màu, size/cup và số lượng.");
      return;
    }

    const addedQuantity = resolved.reduce((total, item) => total + item.row.quantity, 0);
    const addedProductName = selected.name;

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
      applyCart(body.cart);
      setCheckoutRequestId(crypto.randomUUID());
      setSelectedId(null);
      setCartOpen(false);
      setAddedMessage(`Đã thêm ${addedQuantity} × ${addedProductName} vào giỏ.`);
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
      applyCart(body.cart);
      setCheckoutRequestId(crypto.randomUUID());
    } catch (updateError) {
      setCheckoutError(
        updateError instanceof Error ? updateError.message : "Không cập nhật được giỏ hàng.",
      );
    } finally {
      setBusyItemId(null);
    }
  }

  function requestCheckoutLocation() {
    setCheckoutError("");
    setLocationMessage("");

    if (typeof window === "undefined" || !window.isSecureContext) {
      setLocationState("error");
      setLocationMessage("Định vị cần HTTPS hoặc localhost.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setLocationState("error");
      setLocationMessage("Thiết bị không hỗ trợ định vị.");
      return;
    }

    setLocationState("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracyMeters = Math.max(position.coords.accuracy, 0.01);
        setCheckoutLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters,
          collectedAt: new Date(position.timestamp || Date.now()).toISOString(),
          source: "browser_geolocation",
        });
        setLocationState("ready");
        setLocationMessage(`Đã lấy vị trí · khoảng ${Math.round(accuracyMeters)} m.`);
      },
      (locationError) => {
        setCheckoutLocation(null);
        setLocationState("error");
        setLocationMessage(geolocationErrorMessage(locationError));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  function clearCheckoutLocation() {
    setCheckoutLocation(null);
    setLocationState("idle");
    setLocationMessage("Đã xóa vị trí.");
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cart.items.length === 0 || cartBusy) return;

    setCartBusy(true);
    setCheckoutError("");
    const requestId = checkoutRequestId || crypto.randomUUID();
    if (!checkoutRequestId) setCheckoutRequestId(requestId);

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: requestId,
          note: checkout.note,
          location: checkoutLocation,
        }),
      });
      const body = await readJson<{ order: CreatedOrder }>(response);
      setCreatedOrder(body.order);
      applyCart(EMPTY_CART);
      setCheckoutRequestId("");
      setCheckout({ note: "" });
      setCheckoutLocation(null);
      setLocationState("idle");
      setLocationMessage("");
    } catch (orderError) {
      setCheckoutError(
        orderError instanceof Error ? orderError.message : "Không tạo được đơn hàng.",
      );
    } finally {
      setCartBusy(false);
    }
  }

  return (
    <main className="customer-shop">
      {addedMessage ? (
        <button
          type="button"
          className="cart-added-toast"
          onClick={() => setCartOpen(true)}
          aria-label="Mở giỏ hàng"
        >
          <span>✓</span>
          <strong>{addedMessage}</strong>
          <small>Xem giỏ</small>
        </button>
      ) : null}

      <section className="shop-heading">
        <h1>Sản phẩm</h1>
      </section>

      <section className="shop-controls" aria-label="Tìm và lọc sản phẩm">
        <label className="shop-search">
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tìm mã hoặc tên"
          />
        </label>
        <div className="shop-filter-row">
          <select
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            aria-label="Lọc thương hiệu"
          >
            <option value="">Tất cả thương hiệu</option>
            {brandOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Lọc nhóm hàng"
          >
            <option value="">Tất cả nhóm hàng</option>
            {categoryOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="shop-results">
        <div className="shop-results__meta">
          <strong>{visible.length} sản phẩm</strong>
          {search || brand || category ? (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setBrand("");
                setCategory("");
              }}
            >
              Xóa lọc
            </button>
          ) : null}
        </div>

        {visible.length === 0 ? (
          <div className="customer-empty-card">
            <strong>Không tìm thấy sản phẩm</strong>
          </div>
        ) : (
          <div className="shop-product-grid">
            {visible.map((product) => {
              const cover = coverFor(product);
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => openProduct(product)}
                  className="shop-product-card"
                >
                  <div className="shop-product-card__image">
                    {cover?.src ? <img src={cover.src} alt={cover.alt} /> : <span>Chưa có ảnh</span>}
                    <em className={product.orderable ? "is-ready" : "is-waiting"}>
                      {product.orderable ? "Có thể đặt" : "Sắp có"}
                    </em>
                  </div>
                  <div className="shop-product-card__body">
                    <small>{product.brand} · {product.code}</small>
                    <strong>{product.name}</strong>
                    <b>{formatVnd(product.price)}</b>
                    <span>{product.colors.length} màu · {product.variants.length} size/cup</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selected ? (
        <div
          className="customer-sheet-layer"
          role="dialog"
          aria-modal="true"
          aria-label={`Chi tiết ${selected.name}`}
        >
          <div className="customer-sheet product-sheet">
            <header className="customer-sheet__header">
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Đóng chi tiết">
                ←
              </button>
              <div>
                <small>{selected.brand} · {selected.code}</small>
                <strong>Chi tiết sản phẩm</strong>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setCartOpen(true);
                }}
                aria-label="Mở giỏ hàng"
                className="sheet-cart-icon"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M3 4h2l2 11h10l3-8H6" />
                </svg>
                <span>{cart.quantity}</span>
              </button>
            </header>

            <div className="customer-sheet__body product-sheet__body">
              <section className="product-gallery">
                <div
                  ref={galleryRef}
                  className="product-gallery__main no-scrollbar"
                  onScroll={handleGalleryScroll}
                >
                  {selected.images.length > 0 ? (
                    selected.images.map((image) => (
                      <div key={image.id} className="product-gallery__slide">
                        {image.src ? (
                          <img src={image.src} alt={image.alt} />
                        ) : (
                          <span>Chưa có ảnh</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="product-gallery__slide">
                      <span>Chưa có ảnh</span>
                    </div>
                  )}
                </div>
                {selected.images.length > 1 ? (
                  <div className="product-gallery__thumbs no-scrollbar" aria-label="Chọn ảnh sản phẩm">
                    {selected.images.map((image, index) => (
                      <button
                        key={image.id}
                        type="button"
                        className={index === imageIndex ? "is-active" : undefined}
                        onClick={() => scrollGalleryTo(index)}
                        aria-label={`Xem ảnh ${index + 1}`}
                        aria-current={index === imageIndex ? "true" : undefined}
                      >
                        {image.src ? <img src={image.src} alt="" /> : <span>{index + 1}</span>}
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="product-info">
                <small>{selected.category ?? "Sản phẩm"}</small>
                <h2>{selected.name}</h2>
                <strong className="product-info__price">{formatVnd(selected.price)}</strong>
                {selected.description ? <p>{selected.description}</p> : null}
                <div className="product-info__facts">
                  <span>{selected.colors.length} màu</span>
                  <span>{selected.variants.length} size/cup</span>
                </div>
              </section>

              {!selected.orderable ? (
                <section className="product-blocker">
                  <strong>Chưa thể đặt model này</strong>
                  <p>{blockerMessage(selected)}</p>
                </section>
              ) : (
                <section className="product-selection">
                  <div className="product-selection__heading">
                    <h3>Màu, size/cup và số lượng</h3>
                    <span>{rows.length} dòng</span>
                  </div>
                  <div className="product-selection__rows">
                    {rows.map((row, index) => (
                      <article key={row.id} className="selection-row">
                        <header>
                          <strong>Lựa chọn {index + 1}</strong>
                          <button type="button" onClick={() => removeRow(row.id)}>Xóa</button>
                        </header>
                        <select
                          value={row.colorId}
                          onChange={(event) => updateRow(row.id, { colorId: event.target.value })}
                        >
                          <option value="">Chọn màu</option>
                          {selected.colors.map((color) => (
                            <option key={color.id} value={color.id}>{color.label}</option>
                          ))}
                        </select>
                        <select
                          value={row.variantId}
                          onChange={(event) => updateRow(row.id, { variantId: event.target.value })}
                        >
                          <option value="">Chọn size/cup</option>
                          {selected.variants.map((variant) => (
                            <option key={variant.id} value={variant.id}>{variant.label}</option>
                          ))}
                        </select>
                        <label>
                          <span>Số lượng</span>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={row.quantity}
                            onChange={(event) =>
                              updateRow(row.id, {
                                quantity: Math.min(999, Math.max(1, Number(event.target.value) || 1)),
                              })
                            }
                          />
                        </label>
                      </article>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="add-selection-row"
                    onClick={() => {
                      setRows((current) => [...current, makeRow(nextRow)]);
                      setNextRow((value) => value + 1);
                    }}
                  >
                    + Thêm lựa chọn
                  </button>
                </section>
              )}
              {error ? <p className="customer-alert customer-alert--error">{error}</p> : null}
            </div>

            <footer className="customer-sheet__footer">
              <div>
                <small>Giá từ</small>
                <strong>{formatVnd(selected.price)}</strong>
              </div>
              <button
                type="button"
                onClick={() => void addRowsToCart()}
                disabled={!selected.orderable || cartBusy}
              >
                {cartBusy ? "Đang thêm…" : selected.orderable ? "Thêm vào giỏ" : "Chưa thể đặt"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {cartOpen ? (
        <div
          className="customer-sheet-layer"
          role="dialog"
          aria-modal="true"
          aria-label="Giỏ hàng và checkout"
        >
          <div className="customer-sheet cart-sheet">
            <header className="customer-sheet__header">
              <button type="button" onClick={() => setCartOpen(false)} aria-label="Đóng giỏ hàng">
                ←
              </button>
              <div>
                <small>Giỏ hàng</small>
                <strong>{createdOrder ? "Đặt hàng thành công" : `${cart.quantity} sản phẩm`}</strong>
              </div>
              <span className="cart-sheet__step">{createdOrder ? "Xong" : "Thanh toán"}</span>
            </header>

            <div className="customer-sheet__body cart-sheet__body">
              {createdOrder ? (
                <section className="order-success">
                  <div className="order-success__icon">✓</div>
                  <h2>{createdOrder.orderCode}</h2>
                  <p>{createdOrder.itemCount} sản phẩm · {formatVnd(createdOrder.subtotal)}</p>
                  <div className="order-success__actions">
                    <Link href={`/don-hang/${encodeURIComponent(createdOrder.orderCode)}`}>
                      Xem chi tiết đơn
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        setCreatedOrder(null);
                        setCartOpen(false);
                      }}
                    >
                      Tiếp tục mua
                    </button>
                  </div>
                </section>
              ) : cart.items.length === 0 ? (
                <section className="cart-empty">
                  <span className="cart-empty__icon">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M5 5.5h14v15H5zM8 5.5a4 4 0 0 1 8 0" />
                    </svg>
                  </span>
                  <h2>Giỏ hàng đang trống</h2>
                  <button type="button" onClick={() => setCartOpen(false)}>
                    Quay lại
                  </button>
                </section>
              ) : (
                <>
                  <section className="cart-lines">
                    <div className="cart-section-heading">
                      <span>Sản phẩm đã chọn</span>
                      <strong>{cart.quantity} món</strong>
                    </div>
                    {cart.items.map((line) => (
                      <article key={line.id} className="cart-line">
                        <div className="cart-line__top">
                          <div>
                            <small>{line.productCode}</small>
                            <strong>{line.productName}</strong>
                            <span>Màu {line.colorLabel} · {line.variantLabel}</span>
                          </div>
                          <button
                            type="button"
                            disabled={busyItemId === line.id}
                            onClick={() => void changeCartQuantity(line.id, 0)}
                          >
                            Xóa
                          </button>
                        </div>
                        <div className="cart-line__bottom">
                          <div className="quantity-control">
                            <button
                              type="button"
                              disabled={busyItemId === line.id}
                              onClick={() => void changeCartQuantity(line.id, line.quantity - 1)}
                            >
                              −
                            </button>
                            <strong>{line.quantity}</strong>
                            <button
                              type="button"
                              disabled={busyItemId === line.id || line.quantity >= 999}
                              onClick={() => void changeCartQuantity(line.id, line.quantity + 1)}
                            >
                              +
                            </button>
                          </div>
                          <strong>{formatVnd(line.lineTotal)}</strong>
                        </div>
                      </article>
                    ))}
                  </section>

                  <form
                    id="customer-checkout-form"
                    onSubmit={submitOrder}
                    className="checkout-form"
                  >
                    <div className="cart-section-heading">
                      <span>Thông tin đặt hàng</span>
                      <strong>Bước cuối</strong>
                    </div>
                    <Link href="/tai-khoan" className="checkout-profile-link">
                      <div>
                        <small>Thông tin giao hàng</small>
                        <strong>Thông tin đã lưu</strong>
                      </div>
                      <span>Kiểm tra →</span>
                    </Link>
                    <section className="checkout-location">
                      <div>
                        <small>Vị trí hiện tại</small>
                        <strong>Tùy chọn</strong>
                      </div>
                      {checkoutLocation ? (
                        <button type="button" onClick={clearCheckoutLocation} className="is-remove">
                          Xóa vị trí
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={requestCheckoutLocation}
                          disabled={locationState === "loading" || cartBusy}
                        >
                          {locationState === "loading" ? "Đang lấy…" : "Lấy vị trí"}
                        </button>
                      )}
                      {locationMessage ? (
                        <p className={locationState === "error" ? "is-error" : "is-ready"}>
                          {locationMessage}
                        </p>
                      ) : null}
                    </section>
                    <label className="checkout-note">
                      <span>Ghi chú đơn hàng</span>
                      <textarea
                        maxLength={1000}
                        value={checkout.note}
                        onChange={(event) =>
                          setCheckout((current) => ({ ...current, note: event.target.value }))
                        }
                        placeholder="Ghi chú"
                      />
                    </label>
                    {checkoutError ? (
                      <p className="customer-alert customer-alert--error">{checkoutError}</p>
                    ) : null}
                  </form>
                </>
              )}
            </div>

            {!createdOrder && cart.items.length > 0 ? (
              <footer className="customer-sheet__footer cart-sheet__footer">
                <div>
                  <small>Tạm tính</small>
                  <strong>{formatVnd(cart.subtotal)}</strong>
                </div>
                <button type="submit" form="customer-checkout-form" disabled={cartBusy}>
                  {cartBusy ? "Đang tạo đơn…" : "Xác nhận đặt hàng"}
                </button>
              </footer>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
