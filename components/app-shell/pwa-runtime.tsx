"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

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

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error(
          "Service worker registration failed:",
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
