"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type {
  CatalogChangeAuditEvent,
  ManagedCatalogColor,
  ManagedCatalogProduct,
  ManagedCatalogVariant,
} from "@/lib/catalog-admin-types";

type ApiResult<T> = {
  entity?: T;
  changed?: boolean;
  error?: string;
};

type Notice = { tone: "success" | "error"; message: string };

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function patchEntity<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;
  if (!response.ok || !payload.entity) {
    throw new Error(payload.error ?? "Không lưu được thay đổi catalog.");
  }
  return payload as Required<Pick<ApiResult<T>, "entity">> & ApiResult<T>;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-black ${
        active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
      }`}
    >
      {active ? "Đang bán" : "Ngừng bán"}
    </span>
  );
}

function NoticeBox({ notice }: { notice: Notice }) {
  return (
    <div
      role="status"
      className={`rounded-2xl border px-5 py-4 text-sm font-bold ${
        notice.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      {notice.message}
    </div>
  );
}

export function CatalogManagement({
  initialProducts,
  auditEvents,
  canEdit,
}: {
  initialProducts: ManagedCatalogProduct[];
  auditEvents: CatalogChangeAuditEvent[];
  canEdit: boolean;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const selectedProduct =
    products.find((product) => product.id === selectedProductId) ?? null;

  useEffect(() => {
    if (!selectedProduct) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingKey === null) {
        setSelectedProductId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pendingKey, selectedProduct]);

  async function runUpdate<T>(
    key: string,
    work: () => Promise<ApiResult<T> & { entity: T }>,
    apply: (entity: T) => void,
    successMessage: string,
  ) {
    if (!canEdit || pendingKey) return;
    setPendingKey(key);
    setNotice(null);
    try {
      const result = await work();
      apply(result.entity);
      setNotice({
        tone: "success",
        message: result.changed ? successMessage : "Không có dữ liệu thực tế thay đổi.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Không lưu được catalog.",
      });
    } finally {
      setPendingKey(null);
    }
  }

  function saveProduct(event: FormEvent<HTMLFormElement>, product: ManagedCatalogProduct) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runUpdate(
      `product:${product.id}`,
      () =>
        patchEntity<ManagedCatalogProduct>(`/api/admin/catalog/products/${product.id}`, {
          requestId: crypto.randomUUID(),
          expectedVersion: product.rowVersion,
          name: String(form.get("name") ?? ""),
          shortDescription: String(form.get("shortDescription") ?? "").trim() || null,
          basePrice: Number(form.get("basePrice")),
          isActive: form.get("isActive") === "on",
        }),
      (entity) =>
        setProducts((current) =>
          current.map((row) =>
            row.id === product.id
              ? {
                  ...row,
                  ...entity,
                  colors: row.colors,
                  variants: row.variants.map((variant) => ({
                    ...variant,
                    effectivePrice:
                      variant.priceOverride === null ? entity.basePrice : variant.priceOverride,
                  })),
                }
              : row,
          ),
        ),
      `Đã cập nhật ${product.modelCode}. Giá mới chỉ áp dụng cho đơn tạo sau khi lưu.`,
    );
  }

  function saveColor(
    event: FormEvent<HTMLFormElement>,
    productId: string,
    color: ManagedCatalogColor,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runUpdate(
      `color:${color.id}`,
      () =>
        patchEntity<ManagedCatalogColor>(`/api/admin/catalog/colors/${color.id}`, {
          requestId: crypto.randomUUID(),
          expectedVersion: color.rowVersion,
          name: String(form.get("name") ?? ""),
          swatch: String(form.get("swatch") ?? "").trim() || null,
          sortOrder: Number(form.get("sortOrder")),
          isActive: form.get("isActive") === "on",
        }),
      (entity) =>
        setProducts((current) =>
          current.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  colors: product.colors
                    .map((row) => (row.id === color.id ? entity : row))
                    .sort((left, right) =>
                      left.sortOrder === right.sortOrder
                        ? left.code.localeCompare(right.code)
                        : left.sortOrder - right.sortOrder,
                    ),
                }
              : product,
          ),
        ),
      `Đã cập nhật màu ${color.code}.`,
    );
  }

  function saveVariant(
    event: FormEvent<HTMLFormElement>,
    productId: string,
    variant: ManagedCatalogVariant,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const price = String(form.get("priceOverride") ?? "").trim();
    void runUpdate(
      `variant:${variant.id}`,
      () =>
        patchEntity<ManagedCatalogVariant>(`/api/admin/catalog/variants/${variant.id}`, {
          requestId: crypto.randomUUID(),
          expectedVersion: variant.rowVersion,
          sku: String(form.get("sku") ?? "").trim() || null,
          priceOverride: price === "" ? null : Number(price),
          isActive: form.get("isActive") === "on",
        }),
      (entity) =>
        setProducts((current) =>
          current.map((product) =>
            product.id === productId
              ? {
                  ...product,
                  variants: product.variants.map((row) =>
                    row.id === variant.id ? entity : row,
                  ),
                }
              : product,
          ),
        ),
      `Đã cập nhật biến thể ${variant.label}.`,
    );
  }

  const disabled = !canEdit || pendingKey !== null;

  return (
    <>
      {notice && !selectedProduct && (
        <div className="mt-5">
          <NoticeBox notice={notice} />
        </div>
      )}

      {!canEdit && (
        <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm font-bold text-sky-900">
          Sales đang ở chế độ chỉ xem. Chỉ admin được sửa giá, dữ liệu hiển thị và trạng
          thái bán.
        </div>
      )}

      <section className="mt-5">
        {products.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500 shadow-sm">
            Không tìm thấy sản phẩm phù hợp.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => {
                  setNotice(null);
                  setSelectedProductId(product.id);
                }}
                className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-tt-purple-300 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-tt-purple-100"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-black">{product.modelCode}</h2>
                      <StatusBadge active={product.isActive} />
                    </div>
                    <p className="mt-2 line-clamp-2 font-bold text-slate-800">{product.name}</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {product.brandName} · {product.categoryName}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-xl bg-tt-purple-50 px-3 py-2 text-xs font-black text-tt-purple-700">
                    Sửa
                  </span>
                </div>
                <div className="mt-5 flex items-end justify-between gap-3 border-t border-slate-100 pt-4">
                  <div>
                    <p className="font-black text-tt-purple-700">
                      {formatMoney(product.basePrice, product.currency)}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      Cập nhật {formatDate(product.updatedAt)}
                    </p>
                  </div>
                  <p className="text-right text-xs font-bold text-slate-500">
                    {product.colors.length} màu<br />
                    {product.variants.length} size/cup
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedProduct && (
        <div className="fixed inset-0 z-[70] grid place-items-end sm:place-items-center sm:p-5">
          <button
            type="button"
            aria-label="Đóng cửa sổ sửa sản phẩm"
            onClick={() => {
              if (!pendingKey) setSelectedProductId(null);
            }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-editor-title"
            className="relative z-10 flex max-h-[96vh] w-full max-w-7xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="catalog-editor-title" className="text-xl font-black sm:text-2xl">
                    {selectedProduct.modelCode} · {selectedProduct.name}
                  </h2>
                  <StatusBadge active={selectedProduct.isActive} />
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  {selectedProduct.brandName} · {selectedProduct.categoryName} · phiên bản {selectedProduct.rowVersion}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProductId(null)}
                disabled={pendingKey !== null}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-2xl font-bold disabled:opacity-50"
                aria-label="Đóng"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              {notice && (
                <div className="mb-5">
                  <NoticeBox notice={notice} />
                </div>
              )}

              <div className="space-y-7">
                <form
                  key={`product:${selectedProduct.id}:${selectedProduct.rowVersion}`}
                  onSubmit={(event) => saveProduct(event, selectedProduct)}
                  className="grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-2"
                >
                  <div>
                    <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
                      Tên sản phẩm
                    </label>
                    <input
                      name="name"
                      defaultValue={selectedProduct.name}
                      maxLength={240}
                      disabled={disabled}
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
                      Giá cơ bản
                    </label>
                    <input
                      name="basePrice"
                      type="number"
                      min={0}
                      max={2147483647}
                      step={1}
                      defaultValue={selectedProduct.basePrice}
                      disabled={disabled}
                      className="h-11 w-full rounded-xl border border-slate-200 px-3 disabled:bg-slate-100"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">
                      Mô tả ngắn
                    </label>
                    <textarea
                      name="shortDescription"
                      defaultValue={selectedProduct.shortDescription ?? ""}
                      maxLength={2000}
                      rows={3}
                      disabled={disabled}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 disabled:bg-slate-100"
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 font-bold">
                    <input
                      name="isActive"
                      type="checkbox"
                      defaultChecked={selectedProduct.isActive}
                      disabled={disabled}
                    />
                    Cho phép bán sản phẩm
                  </label>
                  {canEdit && (
                    <button
                      type="submit"
                      disabled={disabled}
                      className="rounded-xl bg-ink-950 px-5 py-2.5 font-black text-white disabled:opacity-50 md:justify-self-end"
                    >
                      {pendingKey === `product:${selectedProduct.id}`
                        ? "Đang lưu..."
                        : "Lưu sản phẩm"}
                    </button>
                  )}
                  <p className="text-xs leading-5 text-slate-500 md:col-span-2">
                    Mã model, thương hiệu, nhóm hàng, mã màu và size/cup không đổi tại màn hình này. Đơn cũ luôn giữ nguyên thông tin và giá đã chốt.
                  </p>
                </form>

                <div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black">Màu</h3>
                      <p className="mt-1 text-sm text-slate-500">Chỉ sửa các màu đã được đối chiếu từ nguồn thật.</p>
                    </div>
                    <span className="text-sm font-black text-slate-400">{selectedProduct.colors.length} màu</span>
                  </div>
                  {selectedProduct.colors.length === 0 ? (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                      Mã này chưa có màu đã duyệt. Cần bổ sung qua quy trình audit nguồn, không nhập đoán tại đây.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {selectedProduct.colors.map((color) => (
                        <form
                          key={`${color.id}:${color.rowVersion}`}
                          onSubmit={(event) => saveColor(event, selectedProduct.id, color)}
                          className="grid gap-2 rounded-2xl border border-slate-200 p-3 md:grid-cols-[90px_1fr_150px_100px_100px_auto] md:items-center"
                        >
                          <strong>{color.code}</strong>
                          <input name="name" aria-label={`Tên màu ${color.code}`} defaultValue={color.name} maxLength={160} disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                          <input name="swatch" aria-label={`Mã hiển thị màu ${color.code}`} defaultValue={color.swatch ?? ""} maxLength={64} placeholder="#ffffff" disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                          <input name="sortOrder" aria-label={`Thứ tự màu ${color.code}`} type="number" min={0} max={100000} defaultValue={color.sortOrder} disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                          <label className="inline-flex items-center gap-2 font-bold"><input name="isActive" type="checkbox" defaultChecked={color.isActive} disabled={disabled} /> Bán</label>
                          {canEdit ? <button type="submit" disabled={disabled} className="rounded-lg border border-slate-300 px-3 py-2 font-black disabled:opacity-50">{pendingKey === `color:${color.id}` ? "Lưu..." : "Lưu"}</button> : <span className="text-xs text-slate-400">v{color.rowVersion}</span>}
                        </form>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-black">Size/cup và giá riêng</h3>
                      <p className="mt-1 text-sm text-slate-500">Để trống giá riêng thì hệ thống dùng giá cơ bản.</p>
                    </div>
                    <span className="text-sm font-black text-slate-400">{selectedProduct.variants.length} lựa chọn</span>
                  </div>
                  {selectedProduct.variants.length === 0 ? (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                      Mã này chưa có size/cup đã duyệt.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {selectedProduct.variants.map((variant) => (
                        <form
                          key={`${variant.id}:${variant.rowVersion}`}
                          onSubmit={(event) => saveVariant(event, selectedProduct.id, variant)}
                          className="grid gap-2 rounded-2xl border border-slate-200 p-3 md:grid-cols-[100px_1fr_160px_180px_100px_auto] md:items-center"
                        >
                          <strong>{variant.label}</strong>
                          <input name="sku" aria-label={`SKU ${variant.label}`} defaultValue={variant.sku ?? ""} maxLength={160} placeholder="SKU" disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                          <input name="priceOverride" aria-label={`Giá riêng ${variant.label}`} type="number" min={0} max={2147483647} step={1} defaultValue={variant.priceOverride ?? ""} placeholder="Dùng giá cơ bản" disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                          <span className="font-black text-tt-purple-700">{formatMoney(variant.effectivePrice, selectedProduct.currency)}</span>
                          <label className="inline-flex items-center gap-2 font-bold"><input name="isActive" type="checkbox" defaultChecked={variant.isActive} disabled={disabled} /> Bán</label>
                          {canEdit ? <button type="submit" disabled={disabled} className="rounded-lg border border-slate-300 px-3 py-2 font-black disabled:opacity-50">{pendingKey === `variant:${variant.id}` ? "Lưu..." : "Lưu"}</button> : <span className="text-xs text-slate-400">v{variant.rowVersion}</span>}
                        </form>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Thay đổi catalog gần đây</h2>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          Lịch sử mới xuất hiện sau khi tải lại trang.
        </p>
        {auditEvents.length === 0 ? (
          <p className="mt-4 text-sm font-bold text-slate-500">Chưa có thay đổi được ghi.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-3">Thời gian</th><th className="px-3 py-3">Người thao tác</th><th className="px-3 py-3">Đối tượng</th><th className="px-3 py-3">Version</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-3 py-3 text-slate-600">{formatDate(event.createdAt)}</td>
                    <td className="px-3 py-3 font-bold">{event.actorLabel}</td>
                    <td className="px-3 py-3">{event.entityType} · {event.entityId.slice(0, 8)}</td>
                    <td className="px-3 py-3 text-slate-600">{String(event.beforeSnapshot.row_version ?? "?")} → {String(event.afterSnapshot.row_version ?? "?")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
