"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import type { CatalogProduct } from "@/lib/catalog-types";
import type { CreatedOrder } from "@/lib/order-types";

type ManualOrderCustomerOption = {
  userId: string;
  label: string;
  phone: string;
  deliveryAddress: string;
};

type ManualOrderFormProps = {
  customers: ManualOrderCustomerOption[];
  products: CatalogProduct[];
};

type OrderLine = {
  id: string;
  productId: string;
  productVariantId: string;
  colorId: string;
  quantity: number;
};

type ApiErrorPayload = {
  error?: unknown;
};

function newLine(products: CatalogProduct[]): OrderLine {
  const product = products.find((item) => item.orderable) ?? products[0];
  return {
    id: globalThis.crypto.randomUUID(),
    productId: product?.id ?? "",
    productVariantId: product?.variants[0]?.id ?? "",
    colorId: product?.colors[0]?.id ?? "",
    quantity: 1,
  };
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toLocaleString("vi-VN")} ${currency}`;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null;
    throw new Error(
      typeof errorPayload?.error === "string"
        ? errorPayload.error
        : "Không tạo được đơn tay.",
    );
  }
  return payload as T;
}

export function ManualOrderForm({ customers, products }: ManualOrderFormProps) {
  const [customerMode, setCustomerMode] = useState<"linked" | "guest">("linked");
  const [customerUserId, setCustomerUserId] = useState(customers[0]?.userId ?? "");
  const [guestStoreName, setGuestStoreName] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestAddress, setGuestAddress] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<OrderLine[]>(() => [newLine(products)]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCustomer = customers.find((customer) => customer.userId === customerUserId);
  const currencies = new Set<string>();
  let estimatedSubtotal = 0;
  for (const line of lines) {
    const product = products.find((item) => item.id === line.productId);
    const variant = product?.variants.find((item) => item.id === line.productVariantId);
    if (product && variant) {
      currencies.add(product.currency);
      estimatedSubtotal += variant.price * line.quantity;
    }
  }
  const estimateCurrency = currencies.size === 1 ? [...currencies][0] : "VND";

  function updateLine(lineId: string, patch: Partial<OrderLine>) {
    setLines((current) =>
      current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    );
  }

  function changeLineProduct(lineId: string, productId: string) {
    const product = products.find((item) => item.id === productId);
    updateLine(lineId, {
      productId,
      productVariantId: product?.variants[0]?.id ?? "",
      colorId: product?.colors[0]?.id ?? "",
    });
  }

  function addLine() {
    setLines((current) => [...current, newLine(products)]);
  }

  function removeLine(lineId: string) {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.id !== lineId),
    );
  }

  function resetAfterSuccess() {
    setNote("");
    setLines([newLine(products)]);
    setRequestId(null);
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreatedOrder(null);

    if (customerMode === "linked" && !customerUserId) {
      setError("Chưa chọn tài khoản khách hàng.");
      return;
    }
    if (
      customerMode === "guest" &&
      (!guestName.trim() || !guestPhone.trim())
    ) {
      setError("Khách vãng lai bắt buộc có tên và số điện thoại.");
      return;
    }
    if (
      lines.some(
        (line) =>
          !line.productVariantId ||
          !line.colorId ||
          !Number.isInteger(line.quantity) ||
          line.quantity < 1 ||
          line.quantity > 999,
      )
    ) {
      setError("Mỗi dòng phải có sản phẩm, size/cup, màu và số lượng hợp lệ.");
      return;
    }

    const activeRequestId = requestId ?? globalThis.crypto.randomUUID();
    setRequestId(activeRequestId);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/orders/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: activeRequestId,
          customerUserId: customerMode === "linked" ? customerUserId : null,
          guestCustomer:
            customerMode === "guest"
              ? {
                  storeName: guestStoreName.trim() || null,
                  name: guestName.trim(),
                  phone: guestPhone.trim(),
                  deliveryAddress: guestAddress.trim() || null,
                }
              : null,
          note: note.trim() || null,
          items: lines.map((line) => ({
            productVariantId: line.productVariantId,
            colorId: line.colorId,
            quantity: line.quantity,
          })),
        }),
      });
      const payload = await readJson<{ order: CreatedOrder }>(response);
      setCreatedOrder(payload.order);
      resetAfterSuccess();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Không tạo được đơn tay.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="mt-8 space-y-6" onSubmit={(event) => void submitOrder(event)}>
      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
          {error}
        </div>
      )}

      {createdOrder && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <p className="text-xs font-black uppercase tracking-[0.12em]">Đã tạo đơn</p>
          <p className="mt-1 text-2xl font-black">{createdOrder.orderCode}</p>
          <p className="mt-2 text-sm font-semibold">
            {createdOrder.itemCount} sản phẩm · {formatMoney(createdOrder.subtotal, createdOrder.currency)}
            {createdOrder.idempotentReplay ? " · kết quả retry idempotent" : ""}
          </p>
          <Link className="mt-3 inline-block text-sm font-black underline" href="/admin">
            Mở danh sách đơn
          </Link>
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">
          Khách hàng
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCustomerMode("linked")}
            className={`rounded-full border px-4 py-2 text-sm font-black ${
              customerMode === "linked"
                ? "border-ink-950 bg-ink-950 text-white"
                : "border-slate-200 bg-white"
            }`}
          >
            Tài khoản hiện có
          </button>
          <button
            type="button"
            onClick={() => setCustomerMode("guest")}
            className={`rounded-full border px-4 py-2 text-sm font-black ${
              customerMode === "guest"
                ? "border-ink-950 bg-ink-950 text-white"
                : "border-slate-200 bg-white"
            }`}
          >
            Khách vãng lai
          </button>
        </div>

        {customerMode === "linked" ? (
          <div className="mt-4">
            <label className="block text-sm font-black text-slate-700">
              Tài khoản khách
              <select
                value={customerUserId}
                onChange={(event) => setCustomerUserId(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 font-semibold"
              >
                <option value="">Chọn khách hàng</option>
                {customers.map((customer) => (
                  <option key={customer.userId} value={customer.userId}>
                    {customer.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedCustomer && (
              <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-bold">{selectedCustomer.phone}</p>
                <p className="mt-1">{selectedCustomer.deliveryAddress}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-black text-slate-700">
              Cửa hàng
              <input
                value={guestStoreName}
                onChange={(event) => setGuestStoreName(event.target.value)}
                maxLength={160}
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-semibold"
              />
            </label>
            <label className="text-sm font-black text-slate-700">
              Người nhận *
              <input
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                maxLength={160}
                required
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-semibold"
              />
            </label>
            <label className="text-sm font-black text-slate-700">
              Điện thoại *
              <input
                value={guestPhone}
                onChange={(event) => setGuestPhone(event.target.value)}
                maxLength={24}
                required
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-semibold"
              />
            </label>
            <label className="text-sm font-black text-slate-700">
              Địa chỉ giao hàng
              <input
                value={guestAddress}
                onChange={(event) => setGuestAddress(event.target.value)}
                maxLength={1000}
                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 font-semibold"
              />
            </label>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">
              Sản phẩm
            </p>
            <h2 className="mt-1 text-2xl font-black">Dòng đơn hàng</h2>
          </div>
          <button
            type="button"
            onClick={addLine}
            disabled={lines.length >= 200 || products.length === 0}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black disabled:opacity-50"
          >
            Thêm dòng
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {lines.map((line, index) => {
            const product = products.find((item) => item.id === line.productId);
            const variant = product?.variants.find(
              (item) => item.id === line.productVariantId,
            );
            return (
              <div key={line.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black">Dòng {index + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length === 1}
                    className="text-sm font-black text-rose-700 disabled:opacity-30"
                  >
                    Xóa
                  </button>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_8rem]">
                  <label className="text-sm font-black text-slate-700">
                    Sản phẩm
                    <select
                      value={line.productId}
                      onChange={(event) => changeLineProduct(line.id, event.target.value)}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
                    >
                      {products
                        .filter((item) => item.orderable)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.code} · {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-sm font-black text-slate-700">
                    Size / cup
                    <select
                      value={line.productVariantId}
                      onChange={(event) =>
                        updateLine(line.id, { productVariantId: event.target.value })
                      }
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
                    >
                      {product?.variants.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label} · {formatMoney(item.price, product.currency)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-black text-slate-700">
                    Màu
                    <select
                      value={line.colorId}
                      onChange={(event) => updateLine(line.id, { colorId: event.target.value })}
                      className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
                    >
                      {product?.colors.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.code} · {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-black text-slate-700">
                    Số lượng
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.id, { quantity: Number(event.target.value) })
                      }
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3"
                    />
                  </label>
                </div>
                {variant && product && (
                  <p className="mt-3 text-right text-sm font-black text-slate-700">
                    Tạm tính: {formatMoney(variant.price * line.quantity, product.currency)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-black text-slate-700">
          Ghi chú đơn
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={1000}
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3"
          />
        </label>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-slate-500">Tạm tính trên giao diện</p>
            <p className="text-2xl font-black">
              {formatMoney(estimatedSubtotal, estimateCurrency)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Server sẽ đọc lại giá hiện tại trước khi ghi snapshot.
            </p>
          </div>
          <button
            type="submit"
            disabled={isSubmitting || products.length === 0}
            className="rounded-xl bg-emerald-700 px-6 py-3 font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Đang tạo đơn…" : "Tạo đơn tay"}
          </button>
        </div>
      </section>
    </form>
  );
}