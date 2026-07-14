"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import type { CustomerProfile } from "@/lib/customer-profile";

type ProfileFormState = {
  storeName: string;
  contactName: string;
  phone: string;
  deliveryAddress: string;
};

export function CustomerProfileForm({
  initialProfile,
  defaultContactName,
}: {
  initialProfile: CustomerProfile | null;
  defaultContactName: string;
}) {
  const [form, setForm] = useState<ProfileFormState>({
    storeName: initialProfile?.storeName ?? "",
    contactName: initialProfile?.contactName ?? defaultContactName,
    phone: initialProfile?.phone ?? "",
    deliveryAddress: initialProfile?.deliveryAddress ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/account/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await response.json().catch(() => ({}))) as {
        profile?: CustomerProfile;
        error?: string;
      };
      if (!response.ok || !body.profile) {
        throw new Error(body.error || "Không lưu được hồ sơ.");
      }
      setForm({
        storeName: body.profile.storeName,
        contactName: body.profile.contactName,
        phone: body.profile.phone,
        deliveryAddress: body.profile.deliveryAddress,
      });
      setMessage("Đã lưu hồ sơ. Checkout sẽ lấy thông tin này làm snapshot đơn hàng.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được hồ sơ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-5">
      <label className="block">
        <span className="text-sm font-black text-slate-700">Tên cửa hàng</span>
        <input
          required
          minLength={2}
          maxLength={160}
          value={form.storeName}
          onChange={(event) =>
            setForm((current) => ({ ...current, storeName: event.target.value }))
          }
          className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-tt-purple-500"
          placeholder="Ví dụ: Nội y Minh Anh"
        />
      </label>

      <label className="block">
        <span className="text-sm font-black text-slate-700">Người liên hệ</span>
        <input
          required
          minLength={2}
          maxLength={120}
          value={form.contactName}
          onChange={(event) =>
            setForm((current) => ({ ...current, contactName: event.target.value }))
          }
          className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-tt-purple-500"
          placeholder="Họ và tên người nhận hàng"
        />
      </label>

      <label className="block">
        <span className="text-sm font-black text-slate-700">Điện thoại</span>
        <input
          required
          minLength={8}
          maxLength={24}
          value={form.phone}
          onChange={(event) =>
            setForm((current) => ({ ...current, phone: event.target.value }))
          }
          className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:border-tt-purple-500"
          placeholder="Số điện thoại liên hệ"
        />
      </label>

      <label className="block">
        <span className="text-sm font-black text-slate-700">Địa chỉ giao hàng mặc định</span>
        <textarea
          required
          minLength={5}
          maxLength={500}
          value={form.deliveryAddress}
          onChange={(event) =>
            setForm((current) => ({ ...current, deliveryAddress: event.target.value }))
          }
          className="mt-2 min-h-28 w-full rounded-xl border border-slate-200 p-4 outline-none focus:border-tt-purple-500"
          placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
        />
      </label>

      {error ? (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-xl bg-ink-950 px-5 py-3.5 font-black text-white disabled:bg-slate-300"
      >
        {saving ? "Đang lưu..." : initialProfile ? "Cập nhật hồ sơ" : "Hoàn tất onboarding"}
      </button>
    </form>
  );
}
