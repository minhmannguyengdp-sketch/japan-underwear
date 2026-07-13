CREATE TABLE IF NOT EXISTS "japan_underwear"."order_status_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "from_status" text,
  "to_status" text NOT NULL,
  "actor_source" text NOT NULL,
  "actor_label" text NOT NULL,
  "reason" text,
  "idempotency_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "order_status_events_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "japan_underwear"."orders"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "order_status_events_status_chk" CHECK (
    ("from_status" IS NULL AND "to_status" IN ('submitted', 'confirmed', 'cancelled'))
    OR ("from_status" = 'submitted' AND "to_status" IN ('confirmed', 'cancelled'))
  ),
  CONSTRAINT "order_status_events_actor_source_nonempty_chk" CHECK (
    char_length(btrim("actor_source")) BETWEEN 1 AND 80
  ),
  CONSTRAINT "order_status_events_actor_label_nonempty_chk" CHECK (
    char_length(btrim("actor_label")) BETWEEN 1 AND 120
  ),
  CONSTRAINT "order_status_events_reason_nonempty_chk" CHECK (
    "reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 1000
  ),
  CONSTRAINT "order_status_events_cancel_reason_chk" CHECK (
    "to_status" <> 'cancelled' OR "reason" IS NOT NULL
  ),
  CONSTRAINT "order_status_events_idempotency_nonempty_chk" CHECK (
    "idempotency_key" IS NULL
    OR char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_status_events_order_created_idx"
  ON "japan_underwear"."order_status_events" USING btree ("order_id", "created_at", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_status_events_order_idempotency_uidx"
  ON "japan_underwear"."order_status_events" USING btree ("order_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "japan_underwear"."validate_order_status_transition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transition_reason text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'submitted' THEN
      RAISE EXCEPTION 'New orders must start in submitted status.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status = 'cancelled' THEN
    transition_reason := NULLIF(
      btrim(current_setting('japan_underwear.order_status_reason', true)),
      ''
    );
    IF transition_reason IS NULL THEN
      RAISE EXCEPTION 'Cancellation reason is required.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid order status transition: % -> %.', OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "orders_status_transition_guard_trg"
  ON "japan_underwear"."orders";
--> statement-breakpoint
CREATE TRIGGER "orders_status_transition_guard_trg"
BEFORE INSERT OR UPDATE OF "status"
ON "japan_underwear"."orders"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."validate_order_status_transition"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "japan_underwear"."record_order_status_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_actor_source text;
  event_actor_label text;
  event_reason text;
  event_idempotency_key text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  event_actor_source := NULLIF(
    btrim(current_setting('japan_underwear.order_status_actor_source', true)),
    ''
  );
  event_actor_label := NULLIF(
    btrim(current_setting('japan_underwear.order_status_actor_label', true)),
    ''
  );
  event_reason := NULLIF(
    btrim(current_setting('japan_underwear.order_status_reason', true)),
    ''
  );
  event_idempotency_key := NULLIF(
    btrim(current_setting('japan_underwear.order_status_idempotency_key', true)),
    ''
  );

  IF TG_OP = 'INSERT' THEN
    event_actor_source := COALESCE(event_actor_source, 'checkout');
    event_actor_label := COALESCE(event_actor_label, 'customer-checkout');
    event_idempotency_key := COALESCE(
      event_idempotency_key,
      'checkout:' || NEW.source_cart_id::text
    );
  ELSE
    event_actor_source := COALESCE(event_actor_source, 'system');
    event_actor_label := COALESCE(event_actor_label, 'direct-database-update');
  END IF;

  INSERT INTO "japan_underwear"."order_status_events" (
    order_id,
    from_status,
    to_status,
    actor_source,
    actor_label,
    reason,
    idempotency_key
  )
  VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    event_actor_source,
    event_actor_label,
    event_reason,
    event_idempotency_key
  );

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "orders_status_audit_trg"
  ON "japan_underwear"."orders";
--> statement-breakpoint
CREATE TRIGGER "orders_status_audit_trg"
AFTER INSERT OR UPDATE OF "status"
ON "japan_underwear"."orders"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."record_order_status_event"();
--> statement-breakpoint

INSERT INTO "japan_underwear"."order_status_events" (
  order_id,
  from_status,
  to_status,
  actor_source,
  actor_label,
  reason,
  idempotency_key,
  created_at
)
SELECT
  orders.id,
  NULL,
  orders.status,
  'migration',
  '0005_order_status_lifecycle',
  'Baseline trạng thái hiện có trước khi bật lifecycle audit.',
  'migration-0005:' || orders.id::text,
  orders.created_at
FROM "japan_underwear"."orders" AS orders
WHERE NOT EXISTS (
  SELECT 1
  FROM "japan_underwear"."order_status_events" AS event
  WHERE event.order_id = orders.id
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "japan_underwear"."transition_order_status"(
  p_order_code text,
  p_to_status text,
  p_actor_source text,
  p_actor_label text,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  order_code text,
  previous_status text,
  current_status text,
  changed boolean,
  idempotent boolean,
  event_id uuid,
  changed_at timestamp with time zone
)
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_order_id uuid;
  resolved_order_code text;
  resolved_current_status text;
  resolved_event_id uuid;
  resolved_event_from_status text;
  resolved_event_to_status text;
  resolved_event_created_at timestamp with time zone;
  normalized_to_status text := lower(NULLIF(btrim(p_to_status), ''));
  normalized_actor_source text := NULLIF(btrim(p_actor_source), '');
  normalized_actor_label text := NULLIF(btrim(p_actor_label), '');
  normalized_reason text := NULLIF(btrim(p_reason), '');
  normalized_idempotency_key text := NULLIF(btrim(p_idempotency_key), '');
BEGIN
  IF NULLIF(btrim(p_order_code), '') IS NULL THEN
    RAISE EXCEPTION 'order_code is required.' USING ERRCODE = '22023';
  END IF;
  IF normalized_to_status IS NULL
     OR normalized_to_status NOT IN ('confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Target status must be confirmed or cancelled.' USING ERRCODE = '22023';
  END IF;
  IF normalized_actor_source IS NULL OR normalized_actor_label IS NULL THEN
    RAISE EXCEPTION 'actor_source and actor_label are required.' USING ERRCODE = '22023';
  END IF;
  IF char_length(normalized_actor_source) > 80
     OR char_length(normalized_actor_label) > 120 THEN
    RAISE EXCEPTION 'actor_source or actor_label is too long.' USING ERRCODE = '22023';
  END IF;
  IF normalized_reason IS NOT NULL AND char_length(normalized_reason) > 1000 THEN
    RAISE EXCEPTION 'reason is too long.' USING ERRCODE = '22023';
  END IF;
  IF normalized_idempotency_key IS NOT NULL
     AND char_length(normalized_idempotency_key) > 160 THEN
    RAISE EXCEPTION 'idempotency_key is too long.' USING ERRCODE = '22023';
  END IF;
  IF normalized_to_status = 'cancelled' AND normalized_reason IS NULL THEN
    RAISE EXCEPTION 'Cancellation reason is required.' USING ERRCODE = '22023';
  END IF;

  SELECT orders.id, orders.order_code, orders.status
    INTO resolved_order_id, resolved_order_code, resolved_current_status
  FROM "japan_underwear"."orders" AS orders
  WHERE orders.order_code = upper(btrim(p_order_code))
  LIMIT 1
  FOR UPDATE;

  IF resolved_order_id IS NULL THEN
    RAISE EXCEPTION 'Order not found: %.', p_order_code USING ERRCODE = 'P0002';
  END IF;

  IF normalized_idempotency_key IS NOT NULL THEN
    SELECT event.id, event.from_status, event.to_status, event.created_at
      INTO resolved_event_id, resolved_event_from_status, resolved_event_to_status,
           resolved_event_created_at
    FROM "japan_underwear"."order_status_events" AS event
    WHERE event.order_id = resolved_order_id
      AND event.idempotency_key = normalized_idempotency_key
    LIMIT 1;

    IF resolved_event_id IS NOT NULL THEN
      IF resolved_event_to_status <> normalized_to_status THEN
        RAISE EXCEPTION 'Idempotency key was already used for status %.', resolved_event_to_status
          USING ERRCODE = '23505';
      END IF;

      RETURN QUERY SELECT
        resolved_order_id,
        resolved_order_code,
        resolved_event_from_status,
        resolved_event_to_status,
        false,
        true,
        resolved_event_id,
        resolved_event_created_at;
      RETURN;
    END IF;
  END IF;

  IF resolved_current_status = normalized_to_status THEN
    SELECT event.id, event.created_at
      INTO resolved_event_id, resolved_event_created_at
    FROM "japan_underwear"."order_status_events" AS event
    WHERE event.order_id = resolved_order_id
      AND event.to_status = normalized_to_status
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1;

    RETURN QUERY SELECT
      resolved_order_id,
      resolved_order_code,
      resolved_current_status,
      resolved_current_status,
      false,
      false,
      resolved_event_id,
      resolved_event_created_at;
    RETURN;
  END IF;

  IF resolved_current_status <> 'submitted' THEN
    RAISE EXCEPTION 'Order status is terminal: %.', resolved_current_status
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config(
    'japan_underwear.order_status_actor_source',
    normalized_actor_source,
    true
  );
  PERFORM set_config(
    'japan_underwear.order_status_actor_label',
    normalized_actor_label,
    true
  );
  PERFORM set_config(
    'japan_underwear.order_status_reason',
    COALESCE(normalized_reason, ''),
    true
  );
  PERFORM set_config(
    'japan_underwear.order_status_idempotency_key',
    COALESCE(normalized_idempotency_key, ''),
    true
  );

  UPDATE "japan_underwear"."orders"
  SET status = normalized_to_status,
      updated_at = now()
  WHERE id = resolved_order_id
    AND status = 'submitted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Concurrent order status update detected.' USING ERRCODE = '40001';
  END IF;

  SELECT event.id, event.created_at
    INTO resolved_event_id, resolved_event_created_at
  FROM "japan_underwear"."order_status_events" AS event
  WHERE event.order_id = resolved_order_id
    AND event.to_status = normalized_to_status
    AND (
      normalized_idempotency_key IS NULL
      OR event.idempotency_key = normalized_idempotency_key
    )
  ORDER BY event.created_at DESC, event.id DESC
  LIMIT 1;

  RETURN QUERY SELECT
    resolved_order_id,
    resolved_order_code,
    resolved_current_status,
    normalized_to_status,
    true,
    false,
    resolved_event_id,
    resolved_event_created_at;
END;
$$;
