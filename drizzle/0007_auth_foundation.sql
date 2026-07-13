CREATE TABLE IF NOT EXISTS "japan_underwear"."users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text,
  "email" text,
  "email_verified" timestamptz,
  "image" text,
  "status" text DEFAULT 'active' NOT NULL,
  "last_login_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "users_status_chk" CHECK ("status" IN ('active', 'blocked')),
  CONSTRAINT "users_email_nonempty_chk" CHECK ("email" IS NULL OR btrim("email") <> '')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_uidx"
  ON "japan_underwear"."users" (lower("email"))
  WHERE "email" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_status_idx"
  ON "japan_underwear"."users" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "japan_underwear"."auth_accounts" (
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  CONSTRAINT "auth_accounts_provider_account_pk" PRIMARY KEY ("provider", "provider_account_id"),
  CONSTRAINT "auth_accounts_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "japan_underwear"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "auth_accounts_provider_nonempty_chk" CHECK (btrim("provider") <> ''),
  CONSTRAINT "auth_accounts_provider_account_nonempty_chk" CHECK (btrim("provider_account_id") <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_accounts_user_idx"
  ON "japan_underwear"."auth_accounts" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "japan_underwear"."auth_sessions" (
  "session_token" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "expires" timestamptz NOT NULL,
  CONSTRAINT "auth_sessions_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "japan_underwear"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "auth_sessions_token_nonempty_chk" CHECK (btrim("session_token") <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx"
  ON "japan_underwear"."auth_sessions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_sessions_expires_idx"
  ON "japan_underwear"."auth_sessions" ("expires");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "japan_underwear"."user_roles" (
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "granted_by" uuid,
  "granted_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "user_roles_user_role_pk" PRIMARY KEY ("user_id", "role"),
  CONSTRAINT "user_roles_user_fk" FOREIGN KEY ("user_id")
    REFERENCES "japan_underwear"."users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_roles_granted_by_fk" FOREIGN KEY ("granted_by")
    REFERENCES "japan_underwear"."users"("id") ON DELETE SET NULL,
  CONSTRAINT "user_roles_role_chk" CHECK ("role" IN ('customer', 'sales', 'admin'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_roles_role_idx"
  ON "japan_underwear"."user_roles" ("role");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "japan_underwear"."auth_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor" text NOT NULL,
  "action" text NOT NULL,
  "target_user_id" uuid,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "auth_audit_events_target_user_fk" FOREIGN KEY ("target_user_id")
    REFERENCES "japan_underwear"."users"("id") ON DELETE SET NULL,
  CONSTRAINT "auth_audit_events_actor_nonempty_chk" CHECK (btrim("actor") <> ''),
  CONSTRAINT "auth_audit_events_action_nonempty_chk" CHECK (btrim("action") <> '')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_audit_events_target_created_idx"
  ON "japan_underwear"."auth_audit_events" ("target_user_id", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."normalize_auth_user"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := lower(btrim(NEW.email));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_normalize_trg" ON "japan_underwear"."users";
--> statement-breakpoint
CREATE TRIGGER "users_normalize_trg"
BEFORE INSERT OR UPDATE ON "japan_underwear"."users"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."normalize_auth_user"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."audit_auth_role_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  audit_actor text := COALESCE(
    NULLIF(current_setting('app.auth_actor', true), ''),
    'database'
  );
  target_id uuid;
  target_role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_id := NEW.user_id;
    target_role := NEW.role;
  ELSE
    target_id := OLD.user_id;
    target_role := OLD.role;
  END IF;

  INSERT INTO "japan_underwear"."auth_audit_events" (
    actor,
    action,
    target_user_id,
    details
  ) VALUES (
    audit_actor,
    CASE WHEN TG_OP = 'INSERT' THEN 'role.granted' ELSE 'role.revoked' END,
    target_id,
    jsonb_build_object('role', target_role)
  );

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "user_roles_audit_trg" ON "japan_underwear"."user_roles";
--> statement-breakpoint
CREATE TRIGGER "user_roles_audit_trg"
AFTER INSERT OR DELETE ON "japan_underwear"."user_roles"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."audit_auth_role_change"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."grant_default_customer_role"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.auth_actor', 'system:onboarding', true);
  INSERT INTO "japan_underwear"."user_roles" (user_id, role, granted_by)
  VALUES (NEW.id, 'customer', NULL)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_default_customer_role_trg" ON "japan_underwear"."users";
--> statement-breakpoint
CREATE TRIGGER "users_default_customer_role_trg"
AFTER INSERT ON "japan_underwear"."users"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."grant_default_customer_role"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "japan_underwear"."enforce_auth_user_status"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  audit_actor text := COALESCE(
    NULLIF(current_setting('app.auth_actor', true), ''),
    'database'
  );
  revoked_sessions integer := 0;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'blocked' THEN
      DELETE FROM "japan_underwear"."auth_sessions" WHERE user_id = NEW.id;
      GET DIAGNOSTICS revoked_sessions = ROW_COUNT;
    END IF;

    INSERT INTO "japan_underwear"."auth_audit_events" (
      actor,
      action,
      target_user_id,
      details
    ) VALUES (
      audit_actor,
      CASE WHEN NEW.status = 'blocked' THEN 'user.blocked' ELSE 'user.unblocked' END,
      NEW.id,
      jsonb_build_object(
        'from', OLD.status,
        'to', NEW.status,
        'revoked_sessions', revoked_sessions
      )
    );
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_status_guard_trg" ON "japan_underwear"."users";
--> statement-breakpoint
CREATE TRIGGER "users_status_guard_trg"
BEFORE UPDATE OF status ON "japan_underwear"."users"
FOR EACH ROW EXECUTE FUNCTION "japan_underwear"."enforce_auth_user_status"();
