"use client";

import { useState } from "react";
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
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<
    { tone: "success" | "error"; message: string } | null
  >(null);

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
      {notice && (
        <div
          role="status"
          className={`mt-5 rounded-2xl border px-5 py-4 text-sm font-bold ${
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notice.message}
        </div>
      )}

      {!canEdit && (
        <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sm font-bold text-sky-900">
          Sales đang ở chế độ chỉ xem. Chỉ admin được sửa giá, dữ liệu hiển thị và trạng
          thái bán.
        </div>
      )}

      <section className="mt-5 space-y-4">
        {products.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center font-bold text-slate-500 shadow-sm">
            Không tìm thấy sản phẩm phù hợp.
          </div>
        ) : (
          products.map((product) => (
            <details
              key={product.id}
              className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <summary className="cursor-pointer list-none p-5 hover:bg-slate-50">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-black">
                        {product.modelCode} · {product.name}
                      </h2>
                      <StatusBadge active={product.isActive} />
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {product.brandName} · {product.categoryName} · v{product.rowVersion} · {formatDate(product.updatedAt)}
                    </p>
                  </div>
                  <div className="font-black text-tt-purple-700">
                    {formatMoney(product.basePrice, product.currency)}
                  </div>
                </div>
              </summary>

              <div className="space-y-6 border-t border-slate-200 p-5">
                <form
                  key={`product:${product.id}:${product.rowVersion}`}
                  onSubmit={(event) => saveProduct(event, product)}
                  className="grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-2"
                >
                  <input
                    name="name"
                    aria-label="Tên sản phẩm"
                    defaultValue={product.name}
                    maxLength={240}
                    disabled={disabled}
                    className="h-11 rounded-xl border border-slate-200 px-3 disabled:bg-slate-100"
                  />
                  <input
                    name="basePrice"
                    aria-label="Giá cơ bản"
                    type="number"
                    min={0}
                    max={2147483647}
                    step={1}
                    defaultValue={product.basePrice}
                    disabled={disabled}
                    className="h-11 rounded-xl border border-slate-200 px-3 disabled:bg-slate-100"
                  />
                  <textarea
                    name="shortDescription"
                    aria-label="Mô tả ngắn"
                    defaultValue={product.shortDescription ?? ""}
                    maxLength={2000}
                    rows={3}
                    disabled={disabled}
                    className="rounded-xl border border-slate-200 px-3 py-2 disabled:bg-slate-100 md:col-span-2"
                  />
                  <label className="inline-flex items-center gap-2 font-bold">
                    <input
                      name="isActive"
                      type="checkbox"
                      defaultChecked={product.isActive}
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
                      {pendingKey === `product:${product.id}` ? "Đang lưu..." : "Lưu sản phẩm"}
                    </button>
                  )}
                  <p className="text-xs leading-5 text-slate-500 md:col-span-2">
                    Model, brand, category, slug, color code và size/cup là identity nhập liệu,
                    không sửa ở workflow này. Order snapshot cũ không bị cập nhật.
                  </p>
                </form>

                <div>
                  <h3 className="text-lg font-black">Màu</h3>
                  <div className="mt-3 space-y-2">
                    {product.colors.map((color) => (
                      <form
                        key={`${color.id}:${color.rowVersion}`}
                        onSubmit={(event) => saveColor(event, product.id, color)}
                        className="grid gap-2 rounded-2xl border border-slate-200 p-3 md:grid-cols-[90px_1fr_150px_100px_100px_auto] md:items-center"
                      >
                        <strong>{color.code}</strong>
                        <input name="name" defaultValue={color.name} maxLength={160} disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                        <input name="swatch" defaultValue={color.swatch ?? ""} maxLength={64} placeholder="#ffffff" disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                        <input name="sortOrder" type="number" min={0} max={100000} defaultValue={color.sortOrder} disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                        <label className="inline-flex items-center gap-2 font-bold"><input name="isActive" type="checkbox" defaultChecked={color.isActive} disabled={disabled} /> Bán</label>
                        {canEdit ? <button type="submit" disabled={disabled} className="rounded-lg border border-slate-300 px-3 py-2 font-black disabled:opacity-50">{pendingKey === `color:${color.id}` ? "Lưu..." : "Lưu"}</button> : <span className="text-xs text-slate-400">v{color.rowVersion}</span>}
                      </form>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-black">Biến thể và price override</h3>
                  <div className="mt-3 space-y-2">
                    {product.variants.map((variant) => (
                      <form
                        key={`${variant.id}:${variant.rowVersion}`}
                        onSubmit={(event) => saveVariant(event, product.id, variant)}
                        className="grid gap-2 rounded-2xl border border-slate-200 p-3 md:grid-cols-[100px_1fr_160px_180px_100px_auto] md:items-center"
                      >
                        <strong>{variant.label}</strong>
                        <input name="sku" defaultValue={variant.sku ?? ""} maxLength={160} placeholder="SKU" disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                        <input name="priceOverride" type="number" min={0} max={2147483647} step={1} defaultValue={variant.priceOverride ?? ""} placeholder="Dùng giá cơ bản" disabled={disabled} className="h-10 rounded-lg border border-slate-200 px-3 disabled:bg-slate-100" />
                        <span className="font-black text-tt-purple-700">{formatMoney(variant.effectivePrice, product.currency)}</span>
                        <label className="inline-flex items-center gap-2 font-bold"><input name="isActive" type="checkbox" defaultChecked={variant.isActive} disabled={disabled} /> Bán</label>
                        {canEdit ? <button type="submit" disabled={disabled} className="rounded-lg border border-slate-300 px-3 py-2 font-black disabled:opacity-50">{pendingKey === `variant:${variant.id}` ? "Lưu..." : "Lưu"}</button> : <span className="text-xs text-slate-400">v{variant.rowVersion}</span>}
                      </form>
                    ))}
                  </div>
                </div>
              </div>
            </details>
          ))
        )}
      </section>

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
