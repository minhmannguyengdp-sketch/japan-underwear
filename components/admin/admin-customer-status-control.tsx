"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  AdminCustomerStatus,
  AdminCustomerStatusChange,
} from "@/lib/admin-customer-types";

type Props = {
  userId: string;
  status: AdminCustomerStatus;
  canManage: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || "Không cập nhật được trạng thái khách hàng.");
  }
  return body;
}

export function AdminCustomerStatusControl({
  userId,
  status,
  canManage,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  if (!canManage) {
    return (
      <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-600">
        Sales chỉ được xem. Cần role admin để khóa hoặc mở khóa tài khoản.
      </p>
    );
  }

  const targetStatus: AdminCustomerStatus =
    status === "active" ? "blocked" : "active";

  async function updateStatus() {
    const confirmed = window.confirm(
      targetStatus === "blocked"
        ? "Khóa tài khoản này? Toàn bộ session hiện tại sẽ bị thu hồi."
        : "Mở khóa tài khoản này? Người dùng có thể đăng nhập lại.",
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/customers/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      });
      const body = await readJson<{ change: AdminCustomerStatusChange }>(response);
      setMessage(
        body.change.changed
          ? targetStatus === "blocked"
            ? `Đã khóa tài khoản và thu hồi ${body.change.revokedSessions} session.`
            : "Đã mở khóa tài khoản."
          : "Trạng thái đã đúng, không cần thay đổi.",
      );
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Không cập nhật được trạng thái khách hàng.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void updateStatus()}
        className={`w-full rounded-xl px-5 py-3.5 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${
          targetStatus === "blocked" ? "bg-red-700" : "bg-emerald-700"
        }`}
      >
        {busy
          ? "Đang cập nhật..."
          : targetStatus === "blocked"
            ? "Khóa tài khoản"
            : "Mở khóa tài khoản"}
      </button>
      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          {message}
        </p>
      )}
    </div>
  );
}
