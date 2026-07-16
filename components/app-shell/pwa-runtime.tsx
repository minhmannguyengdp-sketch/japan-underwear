"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

function subscribeToConnection(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);

  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function readOnlineState() {
  return navigator.onLine;
}

function readServerOnlineState() {
  return true;
}

export function PwaRuntime() {
  const pathname = usePathname();
  const online = useSyncExternalStore(
    subscribeToConnection,
    readOnlineState,
    readServerOnlineState,
  );

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));

        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key.startsWith("tuan-thuy-shell-"))
            .map((key) => caches.delete(key)),
        );
      })();
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error(
        "Service worker registration failed:",
        error instanceof Error ? error.message : String(error),
      );
    });
  }, []);

  if (online) return null;

  return (
    <div
      className={pathname.startsWith("/admin") ? "network-banner admin" : "network-banner"}
      role="status"
    >
      Đang offline · dữ liệu mới sẽ tải lại khi có mạng
    </div>
  );
}
