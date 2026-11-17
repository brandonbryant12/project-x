-- Integrity rules for the hub round that drizzle-kit cannot express.
-- Guarded by packages/db/src/integrity-hub.test.ts, by attempted violation.

-- 1. A person holds one position at a time (ADR 0017).
ALTER TABLE "person_position" ADD CONSTRAINT "person_position_no_overlap" EXCLUDE USING gist
  ("tenant_id" WITH =, "person_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
--> statement-breakpoint

-- 2. No overlapping designations between the same two people, in EITHER
--    direction (ADR 0020): two peers cannot be designated to credit each other.
ALTER TABLE "observer_designation" ADD CONSTRAINT "observer_designation_no_overlap" EXCLUDE USING gist
  ("tenant_id" WITH =,
   (least("observer_id", "subject_id")) WITH =,
   (greatest("observer_id", "subject_id")) WITH =,
   daterange("valid_from", coalesce("ended_on", "valid_to"), '[)') WITH &&);
--> statement-breakpoint

-- 3. A designation is a fact: it may only be ended early, once.
CREATE OR REPLACE FUNCTION observer_designation_end_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.ended_on IS NOT NULL
     OR (to_jsonb(NEW) - 'ended_on') IS DISTINCT FROM (to_jsonb(OLD) - 'ended_on') THEN
    RAISE EXCEPTION 'observer_designation % can only be ended, once', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER observer_designation_end_only BEFORE UPDATE OR DELETE ON observer_designation
  FOR EACH ROW EXECUTE FUNCTION observer_designation_end_only();
--> statement-breakpoint

-- 4. A signed observation's basis edge is part of its attestation (replaces
--    the function from the first integrity migration; adds the edge ids).
CREATE OR REPLACE FUNCTION observation_signed_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL AND (
       NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.observer_id IS DISTINCT FROM OLD.observer_id
    OR NEW.interaction_id IS DISTINCT FROM OLD.interaction_id OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.basis IS DISTINCT FROM OLD.basis OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
    OR NEW.basis_reporting_line_id IS DISTINCT FROM OLD.basis_reporting_line_id
    OR NEW.basis_engagement_id IS DISTINCT FROM OLD.basis_engagement_id
    OR NEW.basis_designation_id IS DISTINCT FROM OLD.basis_designation_id
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
