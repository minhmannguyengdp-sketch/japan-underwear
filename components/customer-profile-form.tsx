"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import type { CustomerProfile, ShopLocation } from "@/lib/customer-profile";

type ProfileFormState = {
  storeName: string;
  contactName: string;
  phone: string;
  deliveryAddress: string;
};

type LocationState = "idle" | "loading" | "ready" | "error";

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Bạn đã từ chối quyền vị trí. Hãy cấp quyền trình duyệt rồi thử lại.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Thiết bị chưa xác định được vị trí. Hãy bật GPS hoặc thử lại ngoài trời.";
  }
  if (error.code === error.TIMEOUT) {
    return "Lấy vị trí quá lâu. Vui lòng thử lại.";
  }
  return "Không lấy được vị trí cửa hàng.";
}

export function CustomerProfileForm({
  initialProfile,
  defaultContactName,
  shopLocationAvailable,
}: {
  initialProfile: CustomerProfile | null;
  defaultContactName: string;
  shopLocationAvailable: boolean;
}) {
  const [form, setForm] = useState<ProfileFormState>({
    storeName: initialProfile?.storeName ?? "",
    contactName: initialProfile?.contactName ?? defaultContactName,
    phone: initialProfile?.phone ?? "",
    deliveryAddress: initialProfile?.deliveryAddress ?? "",
  });
  const [shopLocation, setShopLocation] = useState<ShopLocation | null>(
    shopLocationAvailable ? initialProfile?.shopLocation ?? null : null,
  );
  const [locationState, setLocationState] = useState<LocationState>(
    shopLocationAvailable && initialProfile?.shopLocation ? "ready" : "idle",
  );
  const [locationMessage, setLocationMessage] = useState(
    shopLocationAvailable && initialProfile?.shopLocation
      ? `Đã lưu vị trí shop, độ chính xác khoảng ${Math.round(initialProfile.shopLocation.accuracyMeters)} m.`
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function requestShopLocation() {
    if (!shopLocationAvailable) return;

    setError("");
    setMessage("");
    setLocationMessage("");

    if (typeof window === "undefined" || !window.isSecureContext) {
      setLocationState("error");
      setLocationMessage("Trình duyệt chỉ cho lấy vị trí trên HTTPS hoặc localhost.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setLocationState("error");
      setLocationMessage("Thiết bị hoặc trình duyệt này không hỗ trợ định vị.");
      return;
    }

    setLocationState("loading");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracyMeters = Math.max(position.coords.accuracy, 0.01);
        setShopLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters,
          collectedAt: new Date(position.timestamp || Date.now()).toISOString(),
          source: "browser_geolocation",
        });
        setLocationState("ready");
        setLocationMessage(
          `Đã lấy vị trí shop, độ chính xác khoảng ${Math.round(accuracyMeters)} m. Nhấn lưu hồ sơ để ghi nhận.`,
        );
      },
      (locationError) => {
        setShopLocation(null);
        setLocationState("error");
        setLocationMessage(geolocationErrorMessage(locationError));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  function clearShopLocation() {
    setShopLocation(null);
    setLocationState("idle");
    setLocationMessage("Đã bỏ vị trí shop khỏi hồ sơ. Nhấn lưu để xác nhận thay đổi.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setMessage("");
    setError("");
    try {
      const payload = shopLocationAvailable ? { ...form, shopLocation } : form;
      const response = await fetch("/api/account/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      setShopLocation(shopLocationAvailable ? body.profile.shopLocation : null);
      setLocationState(
        shopLocationAvailable && body.profile.shopLocation ? "ready" : "idle",
      );
      setLocationMessage(
        shopLocationAvailable && body.profile.shopLocation
          ? `Đã lưu vị trí shop, độ chính xác khoảng ${Math.round(body.profile.shopLocation.accuracyMeters)} m.`
          : "",
      );
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

      {shopLocationAvailable ? (
        <section className="profile-shop-location">
          <div>
            <span>Vị trí cửa hàng</span>
            <strong>{shopLocation ? "Đã ghi nhận trên thiết bị" : "Chưa có vị trí"}</strong>
            <p>Vị trí giúp xác nhận shop và hỗ trợ giao hàng; chỉ lưu khi bạn chủ động cấp quyền.</p>
          </div>
          {shopLocation ? (
            <button type="button" onClick={clearShopLocation} className="is-remove">
              Xóa vị trí
            </button>
          ) : (
            <button
              type="button"
              onClick={requestShopLocation}
              disabled={locationState === "loading" || saving}
            >
              {locationState === "loading" ? "Đang lấy…" : "Lấy định vị shop"}
            </button>
          )}
          {locationMessage ? (
            <p className={locationState === "error" ? "is-error" : "is-ready"}>
              {locationMessage}
            </p>
          ) : null}
        </section>
      ) : null}

      {error ? <p className="customer-alert customer-alert--error">{error}</p> : null}
      {message ? <p className="customer-alert customer-alert--success">{message}</p> : null}

      <button type="submit" disabled={saving} className="customer-profile-form__submit">
        {saving ? "Đang lưu…" : initialProfile ? "Cập nhật hồ sơ" : "Hoàn tất hồ sơ"}
      </button>
    </form>
  );
}
