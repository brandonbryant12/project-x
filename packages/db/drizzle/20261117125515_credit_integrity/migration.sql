-- Integrity rules for weighted credit that drizzle-kit cannot express.
-- Guarded by packages/db/src/integrity.test.ts.

-- I2 extended: a credit is a copy of a signed rating, including the rating's
-- role (which decides its points), and no new credit may claim to be legacy:
-- neither source 'legacy' nor role 'unclassified'. Same rule as *_integrity
-- rule 10, plus the role and source conditions. The trigger fires on INSERT
-- only, so legacy credits are not re-validated.
CREATE OR REPLACE FUNCTION credit_matches_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.points_source = 'legacy' OR NEW.role = 'unclassified' THEN
    RAISE EXCEPTION 'credit for observation % cannot be written as legacy', NEW.observation_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM observation o
    JOIN observation_rating r ON r.observation_id = o.id AND r.skill_id = NEW.skill_id
    WHERE o.id = NEW.observation_id
      AND o.signed_at IS NOT NULL
      AND o.mode = NEW.mode
      AND r.credit
      AND r.level = NEW.level
      AND r.role = NEW.role
  ) THEN
    RAISE EXCEPTION 'credit for observation % does not match a signed, credited rating', NEW.observation_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
