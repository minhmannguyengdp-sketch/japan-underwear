export default function Loading() {
  return (
    <main className="app-state-page" aria-busy="true" aria-live="polite">
      <img src="/brand/pensee-logo.png" alt="" className="app-state-logo" />
      <div className="app-state-spinner" />
      <p>Đang tải dữ liệu...</p>
    </main>
  );
}
