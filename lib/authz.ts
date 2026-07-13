import { auth } from "@/auth";
import type { AppRole } from "@/db/auth-schema";

export type AuthorizationContext = {
  userId: string;
  email: string | null;
  name: string | null;
  roles: AppRole[];
};

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
    public readonly code: "unauthenticated" | "forbidden",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function getAuthorizationContext(): Promise<AuthorizationContext | null> {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== "active") return null;

  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    roles: session.user.roles,
  };
}

export async function requireAuthenticatedUser() {
  const context = await getAuthorizationContext();
  if (!context) {
    throw new AuthorizationError("Bạn cần đăng nhập.", 401, "unauthenticated");
  }
  return context;
}

export async function requireRole(allowedRoles: readonly AppRole[]) {
  const context = await requireAuthenticatedUser();
  if (!context.roles.some((role) => allowedRoles.includes(role))) {
    throw new AuthorizationError("Tài khoản không có quyền truy cập.", 403, "forbidden");
  }
  return context;
}

export const STAFF_ROLES = ["sales", "admin"] as const satisfies readonly AppRole[];
