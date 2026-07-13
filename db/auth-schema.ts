import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";

export const authSchema = pgSchema("japan_underwear");

export type UserStatus = "active" | "blocked";
export type AppRole = "customer" | "sales" | "admin";

export const users = authSchema.table(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name"),
    email: text("email"),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    status: text("status").$type<UserStatus>().notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_lower_uidx")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
    index("users_status_idx").on(table.status),
    check("users_status_chk", sql`${table.status} in ('active', 'blocked')`),
    check(
      "users_email_nonempty_chk",
      sql`${table.email} is null or btrim(${table.email}) <> ''`,
    ),
  ],
);

export const authAccounts = authSchema.table(
  "auth_accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({
      name: "auth_accounts_provider_account_pk",
      columns: [table.provider, table.providerAccountId],
    }),
    index("auth_accounts_user_idx").on(table.userId),
    check("auth_accounts_provider_nonempty_chk", sql`btrim(${table.provider}) <> ''`),
    check(
      "auth_accounts_provider_account_nonempty_chk",
      sql`btrim(${table.providerAccountId}) <> ''`,
    ),
  ],
);

export const authSessions = authSchema.table(
  "auth_sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expires_idx").on(table.expires),
    check("auth_sessions_token_nonempty_chk", sql`btrim(${table.sessionToken}) <> ''`),
  ],
);

export const userRoles = authSchema.table(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<AppRole>().notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "user_roles_user_role_pk", columns: [table.userId, table.role] }),
    index("user_roles_role_idx").on(table.role),
    check("user_roles_role_chk", sql`${table.role} in ('customer', 'sales', 'admin')`),
  ],
);

export const authAuditEvents = authSchema.table(
  "auth_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_audit_events_target_created_idx").on(table.targetUserId, table.createdAt),
    check("auth_audit_events_actor_nonempty_chk", sql`btrim(${table.actor}) <> ''`),
    check("auth_audit_events_action_nonempty_chk", sql`btrim(${table.action}) <> ''`),
  ],
);

export type AuthUser = typeof users.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
