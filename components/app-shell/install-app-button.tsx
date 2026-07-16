"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type GuideStep = {
  title: string;
  detail: string;
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

const IOS_STEPS: GuideStep[] = [
  {
    title: "Bấm Chia sẻ",
    detail: "Biểu tượng hình vuông có mũi tên hướng lên trong thanh Safari.",
  },
  {
    title: "Thêm vào Màn hình chính",
    detail: "Kéo danh sách tác vụ xuống và chọn mục này.",
  },
  {
    title: "Bấm Thêm",
    detail: "Ứng dụng sẽ xuất hiện trên màn hình chính như một app thông thường.",
  },
];

const BROWSER_STEPS: GuideStep[] = [
  {
    title: "Mở menu trình duyệt",
    detail: "Bấm biểu tượng menu ở góc trên của trình duyệt.",
  },
  {
    title: "Chọn Cài ứng dụng",
    detail: "Một số máy hiển thị là Thêm vào màn hình chính.",
  },
  {
    title: "Xác nhận cài đặt",
    detail: "Ứng dụng sẽ được thêm vào màn hình chính của thiết bị.",
  },
];

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

  useEffect(() => {
    if (!showGuide) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowGuide(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showGuide]);

  async function install() {
    if (installed) return;

    if (!installPrompt) {
      setShowGuide(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  const steps = isIos ? IOS_STEPS : BROWSER_STEPS;

  return (
    <div className="welcome-install">
      <button
        type="button"
        className="welcome-install__button"
        onClick={() => void install()}
        aria-expanded={showGuide}
        aria-controls="install-app-guide"
        disabled={installed}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        <span>{installed ? "Đã cài ứng dụng" : "Cài ứng dụng"}</span>
      </button>

      {showGuide && !installed ? (
        <div className="install-guide-layer">
          <button
            type="button"
            className="install-guide-layer__backdrop"
            onClick={() => setShowGuide(false)}
            aria-label="Đóng hướng dẫn cài ứng dụng"
          />

          <section
            id="install-app-guide"
            className="install-guide-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-guide-title"
          >
            <div className="install-guide-sheet__handle" aria-hidden="true" />
            <header className="install-guide-sheet__header">
              <div>
                <small>{isIos ? "IPHONE · SAFARI" : "CÀI TRÊN THIẾT BỊ"}</small>
                <h2 id="install-guide-title">Thêm Pensee vào màn hình chính</h2>
              </div>
              <button
                type="button"
                className="install-guide-sheet__close"
                onClick={() => setShowGuide(false)}
                aria-label="Đóng"
              >
                ×
              </button>
            </header>

            {isIos ? (
              <p className="install-guide-sheet__note">
                Mở trang này bằng Safari trước khi thực hiện ba bước dưới đây.
              </p>
            ) : null}

            <ol className="install-guide-steps">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <small>{step.detail}</small>
                  </div>
                </li>
              ))}
            </ol>

            <button
              type="button"
              className="install-guide-sheet__done"
              onClick={() => setShowGuide(false)}
            >
              Đã hiểu
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
