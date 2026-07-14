import Link from "next/link";

import { getAuthorizationContext } from "@/lib/authz";

export async function CustomerAccountShortcut() {
  const authorization = await getAuthorizationContext();

  return (
    <div className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur-xl">
      {authorization ? (
        <>
          <div className="hidden max-w-52 px-2 sm:block">
            <p className="truncate text-xs font-black text-slate-500">Đã đăng nhập</p>
            <p className="truncate text-sm font-black">
              {authorization.name ?? authorization.email ?? authorization.userId}
            </p>
          </div>
          <Link
            href="/tai-khoan"
            className="rounded-xl border border-tt-purple-200 bg-tt-purple-50 px-4 py-2.5 text-sm font-black text-tt-purple-700"
          >
            Hồ sơ
          </Link>
          <Link
            href="/don-hang"
            className="rounded-xl bg-tt-purple-700 px-4 py-2.5 text-sm font-black text-white"
          >
            Đơn của tôi
          </Link>
        </>
      ) : (
        <>
          <p className="hidden px-2 text-sm font-semibold text-slate-600 sm:block">
            Đăng nhập để tạo và theo dõi đơn
          </p>
          <Link
            href="/dang-nhap?callbackUrl=/"
            className="rounded-xl bg-ink-950 px-4 py-2.5 text-sm font-black text-white"
          >
            Đăng nhập
          </Link>
        </>
      )}
    </div>
  );
}
