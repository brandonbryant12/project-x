-- Hand-edited after drizzle-kit generate (see the design, §6 and follow-up 10).
-- 1. An individual value records when it was set; it applies only to work done
--    on or after that business date. A value already stored takes the time of
--    this migration, so it reaches only work from today on.
ALTER TABLE "activity_skill" ADD COLUMN "points_override_at" timestamp with time zone;--> statement-breakpoint
UPDATE "activity_skill" SET "points_override_at" = now() WHERE "points_override" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_skill" DROP CONSTRAINT "activity_skill_points_override_pair", ADD CONSTRAINT "activity_skill_points_override_pair" CHECK (("points_override" is null) = ("points_override_by_id" is null) and ("points_override" is null) = ("points_override_at" is null));--> statement-breakpoint
-- 2. One live engagement per pair of people, in either direction. Proposals
--    already refuse both directions inside their transaction, so legal data has
--    no such pair; a pair left by a race stops the migration, naming the tenant
--    and the people, to be ended by hand rather than changed silently here.
DO $$
DECLARE
  dup record;
BEGIN
  FOR dup IN
    SELECT "tenant_id", least("coach_id", "coachee_id") AS a, greatest("coach_id", "coachee_id") AS b
    FROM "engagement"
    WHERE "status" in ('proposed', 'active', 'paused')
    GROUP BY 1, 2, 3
    HAVING count(*) > 1
  LOOP
    RAISE EXCEPTION 'tenant %: people % and % have more than one live engagement; end all but one by hand', dup."tenant_id", dup.a, dup.b;
  END LOOP;
END $$;--> statement-breakpoint
DROP INDEX "engagement_open_pair_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_live_pair_unique" ON "engagement" ("tenant_id",least("coach_id", "coachee_id"),greatest("coach_id", "coachee_id")) WHERE "status" in ('proposed', 'active', 'paused');
