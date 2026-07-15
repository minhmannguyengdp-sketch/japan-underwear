"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const SHELL_CACHE_PREFIX = "tuan-thuy-shell-";

async function clearDevelopmentPwaState() {
  if (!("serviceWorker" in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(SHELL_CACHE_PREFIX))
        .map((key) => caches.delete(key)),
    );
  }
}

export function PwaRuntime() {
  const pathname = usePathname();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);

    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    if (process.env.NODE_ENV === "production") {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch((error) => {
          console.error(
            "Service worker registration failed:",
            error instanceof Error ? error.message : String(error),
          );
        });
      }
    } else {
      clearDevelopmentPwaState().catch((error) => {
        console.error(
          "Development PWA cleanup failed:",
          error instanceof Error ? error.message : String(error),
        );
      });
    }

    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
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
