-- I2 (re-review bug 6): a credit is a copy of a signed rating. The composite FKs
-- already tie it to the observation and the rating row; this trigger also
-- requires the observation to be signed and the credit to carry the rated
-- level, mode and a credit-bearing rating. Signing writes credits after it
-- marks the observation signed, in the same transaction.
CREATE OR REPLACE FUNCTION credit_matches_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM observation o
    JOIN observation_rating r ON r.observation_id = o.id AND r.skill_id = NEW.skill_id
    WHERE o.id = NEW.observation_id
      AND o.signed_at IS NOT NULL
      AND o.mode = NEW.mode
      AND r.credit
      AND r.level = NEW.level
  ) THEN
    RAISE EXCEPTION 'credit for observation % does not match a signed, credited rating', NEW.observation_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER credit_matches_signature BEFORE INSERT ON credit_entry
  FOR EACH ROW EXECUTE FUNCTION credit_matches_signature();
