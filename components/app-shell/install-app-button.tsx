"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function isIosDevice() {
  return typeof window !== "undefined" && /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

export function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showGuide, setShowGuide] = useState(false);
  const [isIos] = useState(isIosDevice);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    }

    function handleInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
      setShowGuide(false);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function install() {
    if (installed) return;

    if (!installPrompt) {
      setShowGuide((current) => !current);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  return (
    <div className="welcome-install">
      <button
        type="button"
        className="welcome-install__button"
        onClick={() => void install()}
        aria-expanded={showGuide}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        <span>{installed ? "Đã cài ứng dụng" : "Cài ứng dụng"}</span>
      </button>

      {!installed ? (
        <p className="welcome-install__iphone">
          iPhone: Safari → Chia sẻ → Thêm vào Màn hình chính → Thêm.
        </p>
      ) : null}

      {showGuide && !installed ? (
        <div className="welcome-install__guide" role="status">
          {isIos
            ? "Mở trang này bằng Safari, bấm Chia sẻ, chọn Thêm vào Màn hình chính rồi bấm Thêm."
            : "Mở menu trình duyệt và chọn Cài ứng dụng hoặc Thêm vào màn hình chính."}
        </div>
      ) : null}
    </div>
  );
}
