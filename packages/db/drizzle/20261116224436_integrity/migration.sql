-- Integrity rules drizzle-kit cannot express (docs/architecture/data-model.md).
-- Guarded by packages/db/src/integrity.test.ts, which asserts each one exists
-- and rejects the violation it exists to prevent.

-- 1. Circular FK: a skill's current version must be a version of that skill.
ALTER TABLE "skill" ADD CONSTRAINT "skill_current_version_fk"
  FOREIGN KEY ("tenant_id", "id", "current_version_id")
  REFERENCES "skill_version" ("tenant_id", "skill_id", "id");
--> statement-breakpoint

-- 2. Effective-dated directory edges never overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "reporting_line" ADD CONSTRAINT "reporting_line_no_overlap" EXCLUDE USING gist
  ("tenant_id" WITH =, "report_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_no_overlap" EXCLUDE USING gist
  ("tenant_id" WITH =, "person_id" WITH =, "role" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
--> statement-breakpoint

-- 3. Append-only tables (ADR 0007, 0012, 0015).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'credit_entry', 'credit_reversal', 'badge_award_credit', 'audit_event', 'advisory_label',
    'advisory_disposition', 'advisory_question_snapshot', 'skill_version', 'skill_level',
    'skill_indicator', 'question_set_release'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t || '_no_truncate', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- 4. A signed observation's ratings and ticks are frozen.
CREATE OR REPLACE FUNCTION forbid_change_after_sign() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obs_id text := CASE WHEN TG_OP = 'INSERT' THEN NEW.observation_id ELSE OLD.observation_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM observation o WHERE o.id = obs_id AND o.signed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'observation % is signed; % is frozen', obs_id, TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER observation_rating_frozen BEFORE INSERT OR UPDATE OR DELETE ON observation_rating
  FOR EACH ROW EXECUTE FUNCTION forbid_change_after_sign();
--> statement-breakpoint
CREATE TRIGGER observation_indicator_frozen BEFORE INSERT OR UPDATE OR DELETE ON observation_indicator
  FOR EACH ROW EXECUTE FUNCTION forbid_change_after_sign();
--> statement-breakpoint

-- 5. Once signed, an observation's attestation facts cannot change; only
--    lifecycle/acknowledgement/purge columns may.
CREATE OR REPLACE FUNCTION observation_signed_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
       NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.observer_id IS DISTINCT FROM OLD.observer_id
    OR NEW.interaction_id IS DISTINCT FROM OLD.interaction_id OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.basis IS DISTINCT FROM OLD.basis OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
    OR NEW.content_digest IS DISTINCT FROM OLD.content_digest
    OR (NEW.purged_at IS NULL AND (NEW.narrative_saw IS DISTINCT FROM OLD.narrative_saw
                                   OR NEW.narrative_next IS DISTINCT FROM OLD.narrative_next))
  ) THEN
    RAISE EXCEPTION 'observation % is signed; its attestation is immutable', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('signed', 'under_review') AND NEW.status NOT IN ('signed', 'under_review', 'voided') THEN
    RAISE EXCEPTION 'observation % cannot leave the signed lifecycle', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER observation_signed_immutable BEFORE UPDATE ON observation
  FOR EACH ROW EXECUTE FUNCTION observation_signed_immutable();
--> statement-breakpoint

-- 6. An advisory check is written once: only a pending check may be completed.
CREATE OR REPLACE FUNCTION advisory_check_write_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'advisory_check % is final', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER advisory_check_write_once BEFORE UPDATE OR DELETE ON advisory_check
  FOR EACH ROW EXECUTE FUNCTION advisory_check_write_once();
