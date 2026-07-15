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
      setMessage("Đã lưu hồ sơ. Đơn mới sẽ dùng thông tin này.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được hồ sơ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="customer-profile-form">
      <label>
        <span>Tên cửa hàng</span>
        <input
          required
          minLength={2}
          maxLength={160}
          value={form.storeName}
          onChange={(event) => setForm((current) => ({ ...current, storeName: event.target.value }))}
          placeholder="Ví dụ: Nội y Minh Anh"
        />
      </label>

      <label>
        <span>Người liên hệ</span>
        <input
          required
          minLength={2}
          maxLength={120}
          value={form.contactName}
          onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))}
          placeholder="Họ và tên người nhận hàng"
        />
      </label>

      <label>
        <span>Điện thoại</span>
        <input
          required
          minLength={8}
          maxLength={24}
          inputMode="tel"
          value={form.phone}
          onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          placeholder="Số điện thoại liên hệ"
        />
      </label>

      <label>
        <span>Địa chỉ giao hàng mặc định</span>
        <textarea
          required
          minLength={5}
          maxLength={500}
          value={form.deliveryAddress}
          onChange={(event) => setForm((current) => ({ ...current, deliveryAddress: event.target.value }))}
          placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành"
        />
      </label>

      {error ? <p className="customer-alert customer-alert--error">{error}</p> : null}
      {message ? <p className="customer-alert customer-alert--success">{message}</p> : null}

      <button type="submit" disabled={saving} className="customer-profile-form__submit">
        {saving ? "Đang lưu…" : initialProfile ? "Cập nhật hồ sơ" : "Hoàn tất hồ sơ"}
      </button>
    </form>
  );
}
