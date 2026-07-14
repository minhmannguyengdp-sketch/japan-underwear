ALTER TABLE "japan_underwear"."orders"
  DROP CONSTRAINT IF EXISTS "orders_status_processing_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  ADD CONSTRAINT "orders_status_processing_chk" CHECK (
    "status" IN ('submitted', 'confirmed', 'processing', 'completed', 'cancelled')
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  VALIDATE CONSTRAINT "orders_status_processing_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  DROP CONSTRAINT IF EXISTS "orders_status_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."orders"
  RENAME CONSTRAINT "orders_status_processing_chk" TO "orders_status_chk";
--> statement-breakpoint

ALTER TABLE "japan_underwear"."order_status_events"
  DROP CONSTRAINT IF EXISTS "order_status_events_status_processing_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."order_status_events"
  ADD CONSTRAINT "order_status_events_status_processing_chk" CHECK (
    ("from_status" IS NULL AND "to_status" IN (
      'submitted', 'confirmed', 'processing', 'completed', 'cancelled'
    ))
    OR ("from_status" = 'submitted' AND "to_status" IN ('confirmed', 'cancelled'))
    OR ("from_status" = 'confirmed' AND "to_status" IN ('processing', 'cancelled'))
    OR ("from_status" = 'processing' AND "to_status" = 'completed')
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "japan_underwear"."order_status_events"
  VALIDATE CONSTRAINT "order_status_events_status_processing_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."order_status_events"
  DROP CONSTRAINT IF EXISTS "order_status_events_status_chk";
--> statement-breakpoint
ALTER TABLE "japan_underwear"."order_status_events"
  RENAME CONSTRAINT "order_status_events_status_processing_chk"
  TO "order_status_events_status_chk";
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

  IF NEW.status = 'cancelled' THEN
    transition_reason := NULLIF(
      btrim(current_setting('japan_underwear.order_status_reason', true)),
      ''
    );
    IF transition_reason IS NULL THEN
      RAISE EXCEPTION 'Cancellation reason is required.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status IN ('confirmed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'confirmed' AND NEW.status IN ('processing', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'processing' AND NEW.status = 'completed' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid order status transition: % -> %.', OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$$;
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
     OR normalized_to_status NOT IN ('confirmed', 'processing', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'Target status must be confirmed, processing, completed, or cancelled.'
      USING ERRCODE = '22023';
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
    AND status = resolved_current_status;

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