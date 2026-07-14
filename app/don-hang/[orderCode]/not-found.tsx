import Link from "next/link";

export default function CustomerOrderNotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f5fa] px-4 text-ink-950">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
          Không tìm thấy đơn
        </p>
        <h1 className="mt-3 text-3xl font-black">Đơn không thuộc tài khoản này</h1>
        <p className="mt-3 leading-7 text-slate-600">
          Mã đơn không tồn tại hoặc được tạo bởi tài khoản khác. Hệ thống không tiết lộ
          thông tin đơn của khách hàng khác.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/don-hang"
            className="rounded-xl bg-ink-950 px-5 py-3 font-black text-white"
          >
            Đơn hàng của tôi
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-slate-200 px-5 py-3 font-black"
          >
            Về catalog
          </Link>
        </div>
      </section>
    </main>
  );
}
