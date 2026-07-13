import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";

function safeCallbackUrl(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/admin";
  }
  return candidate;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const session = await auth();
  if (session?.user?.status === "active" && session.user.roles.some((role) => role === "sales" || role === "admin")) {
    redirect(callbackUrl);
  }

  const hasError = Boolean(params.error);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f5fa] px-4 py-12 text-ink-950">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-tt-purple-700 font-black text-white">
          TT
        </div>
        <p className="mt-6 text-xs font-black uppercase tracking-[0.16em] text-tt-purple-700">
          Khu vực nội bộ
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Đăng nhập Tuấn Thủy</h1>
        <p className="mt-3 leading-7 text-slate-600">
          Dùng tài khoản Google đã được cấp quyền sales hoặc admin. Tài khoản mới chỉ có quyền customer và không tự vào được khu quản trị.
        </p>

        {hasError && (
          <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            Không đăng nhập được. Kiểm tra tài khoản đã xác minh, trạng thái user và cấu hình Google OAuth.
          </p>
        )}

        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-xl bg-ink-950 px-5 py-3.5 font-black text-white hover:bg-slate-800"
          >
            Đăng nhập bằng Google
          </button>
        </form>

        <p className="mt-5 text-xs leading-5 text-slate-500">
          Development callback: http://localhost:3100/api/auth/callback/google. Production chỉ bật sau khi có domain HTTPS thật.
        </p>
      </section>
    </main>
  );
}
