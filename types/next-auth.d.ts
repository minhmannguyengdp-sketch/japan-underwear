import type { DefaultSession } from "next-auth";

export type SessionRole = "customer" | "sales" | "admin";
export type SessionUserStatus = "active" | "blocked";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      roles: SessionRole[];
      status: SessionUserStatus;
    } & DefaultSession["user"];
  }

  interface User {
    status?: SessionUserStatus;
  }
}

export {};
