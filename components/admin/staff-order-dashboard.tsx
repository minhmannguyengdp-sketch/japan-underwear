"use client";

import { useState } from "react";

import type {
  StaffOrderDetail,
  StaffOrderFilter,
  StaffOrderStatus,
  StaffOrderSummary,
} from "@/lib/staff-order-types";

type StaffOrderDashboardProps = {
  initialOrders: StaffOrderSummary[];
};

type ApiErrorPayload = {
  error?: unknown;
};

const FILTERS: Array<{ value: StaffOrderFilter; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "submitted", label: "Chờ xử lý" },
  { value: "confirmed", label: "Đã xác nhận" },
  { value: "cancelled", label: "Đã hủy" },
];

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(value));
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

function statusLabel(status: StaffOrderStatus) {
  if (status === "submitted") return "Chờ xử lý";
  if (status === "confirmed") return "Đã xác nhận";
  return "Đã hủy";
}

function statusTone(status: StaffOrderStatus) {
  if (status === "submitted") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "confirmed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  return "border-rose-200 bg-rose-50 text-rose-800";
}

async function readJson<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null;
    throw new Error(
      typeof errorPayload?.error === "string"
        ? errorPayload.error
        : "Yêu cầu không thành công.",
    );
  }
  return payload as T;
}

function makeIdempotencyKey(
  orderCode: string,
  targetStatus: Exclude<StaffOrderStatus, "submitted">,
) {
  return `staff-web:${orderCode}:${targetStatus}:${globalThis.crypto.randomUUID()}`;
}

export function StaffOrderDashboard({
  initialOrders,
}: StaffOrderDashboardProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState<StaffOrderFilter>("all");
  const [selectedOrder, setSelectedOrder] =
    useState<StaffOrderDetail | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayedCount = orders.length;

  async function loadOrders(nextFilter: StaffOrderFilter) {
    setIsLoadingList(true);
    setError(null);
    try {
      const query =
        nextFilter === "all"
          ? ""
          : `?status=${encodeURIComponent(nextFilter)}`;
      const response = await fetch(`/api/admin/orders${query}`, {
        cache: "no-store",
      });
      const payload = await readJson<{ orders: StaffOrderSummary[] }>(response);
      setOrders(payload.orders);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không tải được danh sách đơn.",
      );
    } finally {
      setIsLoadingList(false);
    }
  }

  async function changeFilter(nextFilter: StaffOrderFilter) {
    setFilter(nextFilter);
    setSelectedOrder(null);
    setCancelReason("");
    await loadOrders(nextFilter);
  }

  async function openOrder(orderCode: string) {
    setIsLoadingDetail(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(orderCode)}`,
        { cache: "no-store" },
      );
      const payload = await readJson<{ order: StaffOrderDetail }>(response);
      setSelectedOrder(payload.order);
      setCancelReason("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Không tải được chi tiết đơn.",
      );
    } finally {
      setIsLoadingDetail(false);
    }
  }

  async function transitionOrder(
    targetStatus: Exclude<StaffOrderStatus, "submitted">,
  ) {
    if (!selectedOrder || selectedOrder.status !== "submitted") return;

    const reason = targetStatus === "cancelled" ? cancelReason.trim() : null;
    if (targetStatus === "cancelled" && !reason) {
      setError("Hủy đơn bắt buộc có lý do.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(selectedOrder.orderCode)}/status`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: targetStatus,
            reason,
            idempotencyKey: makeIdempotencyKey(
              selectedOrder.orderCode,
              targetStatus,
            ),
          }),
        },
      );
      const payload = await readJson<{ order: StaffOrderDetail }>(response);
      setSelectedOrder(payload.order);
      setCancelReason("");
      await loadOrders(filter);
    } catch (transitionError) {
      setError(
        transitionError instanceof Error
          ? transitionError.message
          : "Không chuyển được trạng thái đơn.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">
              Danh sách đơn
            </p>
            <h2 className="mt-1 text-2xl font-black">Đơn gần nhất</h2>
            <p className="mt-1 text-sm text-slate-500">
              Tối đa 100 đơn theo bộ lọc hiện tại.
            </p>
          </div>
          <div className="rounded-2xl bg-amber-50 px-3 py-2 text-right">
            <p className="text-xs font-bold text-amber-700">Đang hiển thị</p>
            <p className="text-xl font-black text-amber-900">{displayedCount}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              disabled={isLoadingList}
              onClick={() => void changeFilter(item.value)}
              className={`rounded-full border px-3 py-2 text-sm font-black transition ${
                filter === item.value
                  ? "border-ink-950 bg-ink-950 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {isLoadingList && (
            <p className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600">
              Đang tải danh sách đơn…
            </p>
          )}

          {!isLoadingList && orders.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              Không có đơn phù hợp bộ lọc.
            </p>
          )}

          {!isLoadingList &&
            orders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => void openOrder(order.orderCode)}
                className={`w-full rounded-2xl border p-4 text-left transition hover:border-tt-purple-400 hover:shadow-md ${
                  selectedOrder?.id === order.id
                    ? "border-tt-purple-500 ring-2 ring-tt-purple-100"
                    : "border-slate-200"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-black">{order.orderCode}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">
                      {order.customerName} · {order.customerPhone}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusTone(order.status)}`}
                  >
                    {statusLabel(order.status)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm text-slate-500">
                  <span>{order.itemQuantity} sản phẩm</span>
                  <span className="font-black text-slate-800">
                    {formatMoney(order.subtotal, order.currency)}
                  </span>
                  <span>{formatDateTime(order.createdAt)}</span>
                </div>
              </button>
            ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        {error && (
          <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">
            {error}
          </div>
        )}

        {isLoadingDetail && (
          <div className="grid min-h-80 place-items-center rounded-2xl bg-slate-50 text-sm font-bold text-slate-500">
            Đang tải chi tiết đơn…
          </div>
        )}

        {!isLoadingDetail && !selectedOrder && (
          <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
            <div>
              <p className="text-2xl font-black text-slate-800">
                Chọn một đơn để xử lý
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Chi tiết khách hàng, địa chỉ, item snapshot và toàn bộ lịch sử
                trạng thái sẽ hiển thị ở đây.
              </p>
            </div>
          </div>
        )}

        {!isLoadingDetail && selectedOrder && (
          <div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-tt-purple-700">
                  Chi tiết đơn
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {selectedOrder.orderCode}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Tạo {formatDateTime(selectedOrder.createdAt)} · cập nhật{" "}
                  {formatDateTime(selectedOrder.updatedAt)}
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1.5 text-sm font-black ${statusTone(selectedOrder.status)}`}
              >
                {statusLabel(selectedOrder.status)}
              </span>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  Khách hàng
                </p>
                <p className="mt-2 font-black">{selectedOrder.customerName}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {selectedOrder.customerPhone}
                </p>
                {selectedOrder.note && (
                  <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm leading-6 text-slate-600">
                    Ghi chú: {selectedOrder.note}
                  </p>
                )}
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  Giao hàng
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {selectedOrder.deliveryAddress ?? "Khách chưa nhập địa chỉ."}
                </p>
                {selectedOrder.location && (
                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-600">
                    <p className="font-bold">
                      {selectedOrder.location.latitude.toFixed(6)},{" "}
                      {selectedOrder.location.longitude.toFixed(6)}
                    </p>
                    <p className="mt-1">
                      Sai số khoảng{" "}
                      {Math.round(selectedOrder.location.accuracyMeters)} m ·{" "}
                      {formatDateTime(selectedOrder.location.collectedAt)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                    Item snapshot
                  </p>
                  <h3 className="mt-1 text-xl font-black">
                    {selectedOrder.itemQuantity} sản phẩm
                  </h3>
                </div>
                <p className="text-xl font-black">
                  {formatMoney(
                    selectedOrder.subtotal,
                    selectedOrder.currency,
                  )}
                </p>
              </div>

              <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                {selectedOrder.items.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-3 border-b border-slate-200 p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div>
                      <p className="font-black">
                        {item.productCode} · {item.productName}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Màu {item.colorCode} — {item.colorName} · Size{" "}
                        {item.sizeCode}
                        {item.cupCode ?? ""}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatMoney(item.unitPrice, selectedOrder.currency)} ×{" "}
                        {item.quantity}
                      </p>
                    </div>
                    <p className="font-black">
                      {formatMoney(item.lineTotal, selectedOrder.currency)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {selectedOrder.status === "submitted" && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-700">
                  Xử lý đơn
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void transitionOrder("confirmed")}
                    className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Xác nhận đơn
                  </button>
                </div>
                <label className="mt-4 block">
                  <span className="text-sm font-black text-slate-700">
                    Lý do hủy
                  </span>
                  <textarea
                    value={cancelReason}
                    disabled={isSubmitting}
                    onChange={(event) => setCancelReason(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="Bắt buộc khi hủy đơn"
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                  />
                </label>
                <button
                  type="button"
                  disabled={isSubmitting || !cancelReason.trim()}
                  onClick={() => void transitionOrder("cancelled")}
                  className="mt-3 rounded-xl border border-rose-300 bg-white px-4 py-3 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Hủy đơn
                </button>
              </div>
            )}

            <div className="mt-6">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Lịch sử trạng thái
              </p>
              <div className="mt-3 space-y-3">
                {selectedOrder.history.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="font-black">
                        {event.fromStatus
                          ? `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}`
                          : `Khởi tạo → ${statusLabel(event.toStatus)}`}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatDateTime(event.createdAt)}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {event.actorSource} · {event.actorLabel}
                    </p>
                    {event.reason && (
                      <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        {event.reason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
