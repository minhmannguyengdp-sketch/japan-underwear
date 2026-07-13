import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import type { Adapter } from "next-auth/adapters";
import Google from "next-auth/providers/google";

import { getAuthDb } from "@/db/auth-client";
import {
  authAccounts,
  authSessions,
  users,
  type AppRole,
  type UserStatus,
} from "@/db/auth-schema";
import { getPool } from "@/db/client";

let resolvedAdapter: Adapter | null = null;

function getResolvedAdapter() {
  if (resolvedAdapter) return resolvedAdapter;
  resolvedAdapter = DrizzleAdapter(getAuthDb(), {
    usersTable: users,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
  });
  return resolvedAdapter;
}

const lazyAdapter = new Proxy({} as Adapter, {
  get(_target, property) {
    return (...args: unknown[]) => {
      const adapter = getResolvedAdapter();
      const method = Reflect.get(adapter, property);
      if (typeof method !== "function") {
        return method;
      }
      return Reflect.apply(method, adapter, args);
    };
  },
});

async function loadUserAuthorization(userId: string) {
  const result = await getPool().query(
    `
      SELECT auth_user.status,
             COALESCE(
               array_agg(role.role ORDER BY role.role)
                 FILTER (WHERE role.role IS NOT NULL),
               ARRAY[]::text[]
             ) AS roles
      FROM japan_underwear.users AS auth_user
      LEFT JOIN japan_underwear.user_roles AS role
        ON role.user_id = auth_user.id
      WHERE auth_user.id = $1::uuid
      GROUP BY auth_user.id, auth_user.status
    `,
    [userId],
  );

  if (result.rowCount !== 1) return null;
  return {
    status: String(result.rows[0].status) as UserStatus,
    roles: (result.rows[0].roles as string[]).filter((role): role is AppRole =>
      role === "customer" || role === "sales" || role === "admin",
    ),
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: lazyAdapter,
  secret: process.env.AUTH_SECRET,
  trustHost:
    process.env.NODE_ENV !== "production" || process.env.AUTH_TRUST_HOST === "true",
  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  providers: [Google],
  pages: {
    signIn: "/dang-nhap",
    error: "/dang-nhap",
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false;

      const googleProfile = profile as
        | { email?: string | null; email_verified?: boolean }
        | undefined;
      const email = googleProfile?.email?.trim().toLowerCase();
      if (!email || googleProfile?.email_verified !== true) return false;

      const existing = await getPool().query(
        `SELECT status FROM japan_underwear.users WHERE lower(email) = $1 LIMIT 1`,
        [email],
      );
      return existing.rowCount === 0 || existing.rows[0].status === "active";
    },
    async session({ session, user }) {
      const authorization = await loadUserAuthorization(user.id);
      session.user.id = user.id;
      session.user.status = authorization?.status ?? "blocked";
      session.user.roles =
        authorization?.status === "active" ? authorization.roles : [];
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await getPool().query(
        `UPDATE japan_underwear.users SET last_login_at = now(), updated_at = now() WHERE id = $1::uuid`,
        [user.id],
      );
    },
  },
});
