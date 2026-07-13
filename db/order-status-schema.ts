import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { orders } from "./schema";

const catalogSchema = pgSchema("japan_underwear");

export type OrderStatus = "submitted" | "confirmed" | "cancelled";

export const orderStatusEvents = catalogSchema.table(
  "order_status_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<OrderStatus | null>(),
    toStatus: text("to_status").$type<OrderStatus>().notNull(),
    actorSource: text("actor_source").notNull(),
    actorLabel: text("actor_label").notNull(),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_status_events_order_created_idx").on(
      table.orderId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex("order_status_events_order_idempotency_uidx")
      .on(table.orderId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check(
      "order_status_events_status_chk",
      sql`(
        (${table.fromStatus} is null and ${table.toStatus} in ('submitted', 'confirmed', 'cancelled'))
        or (${table.fromStatus} = 'submitted' and ${table.toStatus} in ('confirmed', 'cancelled'))
      )`,
    ),
    check(
      "order_status_events_actor_source_nonempty_chk",
      sql`btrim(${table.actorSource}) <> ''`,
    ),
    check(
      "order_status_events_actor_label_nonempty_chk",
      sql`btrim(${table.actorLabel}) <> ''`,
    ),
    check(
      "order_status_events_reason_nonempty_chk",
      sql`${table.reason} is null or btrim(${table.reason}) <> ''`,
    ),
    check(
      "order_status_events_idempotency_nonempty_chk",
      sql`${table.idempotencyKey} is null or btrim(${table.idempotencyKey}) <> ''`,
    ),
  ],
);

export type OrderStatusEvent = typeof orderStatusEvents.$inferSelect;
