"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type CartResponse = {
  cart?: {
    quantity?: number;
  };
};

type CartUpdatedEvent = CustomEvent<{ quantity?: number }>;

async function readCartQuantity() {
  const response = await fetch("/api/cart", { cache: "no-store" });
  if (!response.ok) return 0;
  const body = (await response.json().catch(() => ({}))) as CartResponse;
  return Math.max(0, Number(body.cart?.quantity ?? 0));
}

export function HeaderCartButton() {
  const pathname = usePathname();
  const router = useRouter();
  const [quantity, setQuantity] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadQuantity() {
      const nextQuantity = await readCartQuantity().catch(() => 0);
      if (!cancelled) setQuantity(nextQuantity);
    }

    function handleCartUpdated(event: Event) {
      const nextQuantity = Number((event as CartUpdatedEvent).detail?.quantity);
      if (Number.isFinite(nextQuantity) && nextQuantity >= 0) {
        setQuantity(nextQuantity);
        return;
      }
      void loadQuantity();
    }

    void loadQuantity();
    window.addEventListener("cart:updated", handleCartUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener("cart:updated", handleCartUpdated);
    };
  }, []);

  function openCart() {
    if (pathname.startsWith("/cua-hang")) {
      window.dispatchEvent(new Event("cart:open"));
      return;
    }
    router.push("/cua-hang?gio-hang=1");
  }

  return (
    <button
      type="button"
      className="public-cart-button"
      onClick={openCart}
      aria-label={`Mở giỏ hàng${quantity && quantity > 0 ? `, ${quantity} sản phẩm` : ""}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M3 4h2l2 11h10l3-8H6M9 20h.01M17 20h.01" />
      </svg>
      {quantity !== null && quantity > 0 ? <span>{quantity}</span> : null}
    </button>
  );
}
