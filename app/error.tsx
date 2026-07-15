"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="app-state-page">
      <img src="/brand/pensee-logo.png" alt="" className="app-state-logo" />
      <p className="app-state-kicker">Có lỗi xảy ra</p>
      <h1>Chưa tải được màn hình này.</h1>
      <p>{error.message || "Vui lòng thử lại. Dữ liệu đặt hàng chưa bị thay đổi."}</p>
      <button type="button" onClick={reset} className="app-state-button">
        Thử lại
      </button>
    </main>
  );
}
