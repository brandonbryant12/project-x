CREATE TABLE "job_family" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_family_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "job_family_status_check" CHECK ("status" in ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"tenant_id" text NOT NULL,
	"person_id" text PRIMARY KEY,
	"channel" text DEFAULT 'email' NOT NULL,
	"weekly_digest" boolean DEFAULT true NOT NULL,
	"observe_capacity" integer DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preference_channel_check" CHECK ("channel" in ('email', 'teams', 'off')),
	CONSTRAINT "notification_preference_capacity" CHECK ("observe_capacity" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "person_position" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"person_id" text NOT NULL,
	"job_family_id" text,
	"title" text,
	"business_function_id" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" text DEFAULT 'directory' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_position_person_key" UNIQUE("tenant_id","id","person_id"),
	CONSTRAINT "person_position_interval" CHECK ("valid_to" is null or "valid_to" > "valid_from"),
	CONSTRAINT "person_position_source_check" CHECK ("source" in ('directory', 'import', 'seed'))
);
--> statement-breakpoint
CREATE TABLE "skill_profile" (
	"tenant_id" text NOT NULL,
	"skill_version_id" text,
	"key" text,
	"name" text NOT NULL,
	"capacity" text NOT NULL,
	"job_family_id" text,
	CONSTRAINT "skill_profile_pkey" PRIMARY KEY("skill_version_id","key"),
	CONSTRAINT "skill_profile_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,31}$'),
	CONSTRAINT "skill_profile_capacity_check" CHECK ("capacity" in ('any', 'leader', 'coach', 'job_family')),
	CONSTRAINT "skill_profile_job_family_shape" CHECK (("capacity" = 'job_family') = ("job_family_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "observer_designation" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"observer_id" text NOT NULL,
	"designated_by_id" text NOT NULL,
	"designator_basis" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"ended_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observer_designation_parties_key" UNIQUE("tenant_id","id","observer_id","subject_id"),
	CONSTRAINT "observer_designation_not_self" CHECK ("observer_id" <> "subject_id"),
	CONSTRAINT "observer_designation_distinct_designator" CHECK ("designated_by_id" not in ("observer_id", "subject_id")),
	CONSTRAINT "observer_designation_window" CHECK ("valid_to" > "valid_from" and "valid_to" <= "valid_from" + 90),
	CONSTRAINT "observer_designation_ended" CHECK ("ended_on" is null or ("ended_on" >= "valid_from" and "ended_on" < "valid_to")),
	CONSTRAINT "observer_designation_basis_check" CHECK ("designator_basis" in ('leader', 'coach'))
);
--> statement-breakpoint
CREATE TABLE "coaching_conversation" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"coachee_id" text NOT NULL,
	"host_id" text NOT NULL,
	"basis" text NOT NULL,
	"basis_engagement_id" text,
	"basis_reporting_line_id" text,
	"created_by_id" text NOT NULL,
	"status" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"held_on" date,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coaching_conversation_coachee_key" UNIQUE("tenant_id","id","coachee_id"),
	CONSTRAINT "coaching_conversation_basis_check" CHECK ("basis" in ('coach', 'leader')),
	CONSTRAINT "coaching_conversation_basis_shape" CHECK ((("basis" = 'coach') = ("basis_engagement_id" is not null)) and (("basis" = 'leader') = ("basis_reporting_line_id" is not null))),
	CONSTRAINT "coaching_conversation_status_check" CHECK ("status" in ('scheduled', 'held', 'missed', 'cancelled')),
	CONSTRAINT "coaching_conversation_not_self" CHECK ("host_id" <> "coachee_id"),
	CONSTRAINT "coaching_conversation_creator_is_party" CHECK ("created_by_id" in ("host_id", "coachee_id")),
	CONSTRAINT "coaching_conversation_held_shape" CHECK (("status" = 'held') = ("held_on" is not null)),
	CONSTRAINT "coaching_conversation_closed_shape" CHECK (("status" = 'scheduled') = ("closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "commitment" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"body" text,
	"purged_at" timestamp with time zone,
	"source_observation_id" text,
	"conversation_id" text,
	"due_on" date,
	"status" text NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commitment_status_check" CHECK ("status" in ('open', 'done', 'dropped')),
	CONSTRAINT "commitment_body_length" CHECK ("body" is null or char_length("body") between 1 and 280),
	CONSTRAINT "commitment_purge_shape" CHECK (("purged_at" is null) = ("body" is not null)),
	CONSTRAINT "commitment_closed_shape" CHECK (("status" = 'open') = ("closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"actor_id" text,
	"due_on" date,
	"item_count" integer,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"channel" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"send_after" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_kind_check" CHECK ("kind" in ('observation_requested', 'observation_signed', 'observation_returned', 'plan_proposed', 'engagement_proposed', 'request_expiring', 'weekly_digest')),
	CONSTRAINT "notification_entity_type_check" CHECK ("entity_type" in ('observation', 'plan', 'engagement', 'digest')),
	CONSTRAINT "notification_status_check" CHECK ("status" in ('pending', 'sent', 'skipped', 'failed')),
	CONSTRAINT "notification_channel_check" CHECK ("channel" is null or "channel" in ('email', 'teams', 'log')),
	CONSTRAINT "notification_entity_shape" CHECK (("entity_type" = 'digest') = ("entity_id" is null) and ("entity_id" is null or "entity_id" ~ '^[a-z]{3}_[0-9a-z]+$')),
	CONSTRAINT "notification_dedupe_key_shape" CHECK ("dedupe_key" ~ '^[a-z_]+(:[0-9a-z_-]+)+$'),
	CONSTRAINT "notification_item_count" CHECK ("item_count" is null or "item_count" between 0 and 999),
	CONSTRAINT "notification_sent_shape" CHECK (("status" = 'sent') = ("sent_at" is not null)),
	CONSTRAINT "notification_attempts" CHECK ("attempts" between 0 and 20)
);
--> statement-breakpoint
ALTER TABLE "plan_skill" ADD COLUMN "profile_key" text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE "badge_award" ADD COLUMN "profile_key" text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD COLUMN "profile_key" text DEFAULT 'core' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_entry" ADD COLUMN "subject_position_id" text;--> statement-breakpoint
ALTER TABLE "observation" ADD COLUMN "basis_designation_id" text;--> statement-breakpoint
ALTER TABLE "observation_rating" ADD COLUMN "profile_key" text DEFAULT 'core' NOT NULL;--> statement-breakpoint
DROP INDEX "badge_award_one_active";--> statement-breakpoint
CREATE UNIQUE INDEX "badge_award_one_active" ON "badge_award" ("tenant_id","person_id","skill_id","profile_key","level") WHERE "status" = 'awarded';--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_subject_key" UNIQUE("tenant_id","id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_family_tenant_name_unique" ON "job_family" ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "person_position_one_open" ON "person_position" ("tenant_id","person_id") WHERE "valid_to" is null;--> statement-breakpoint
CREATE INDEX "observer_designation_subject_idx" ON "observer_designation" ("tenant_id","subject_id");--> statement-breakpoint
CREATE INDEX "observer_designation_observer_idx" ON "observer_designation" ("tenant_id","observer_id");--> statement-breakpoint
CREATE INDEX "coaching_conversation_host_idx" ON "coaching_conversation" ("tenant_id","host_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "coaching_conversation_coachee_idx" ON "coaching_conversation" ("tenant_id","coachee_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "commitment_owner_idx" ON "commitment" ("tenant_id","owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_unique" ON "notification" ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_dispatch_idx" ON "notification" ("status","send_after");--> statement-breakpoint
CREATE INDEX "notification_recipient_idx" ON "notification" ("tenant_id","recipient_id","created_at");--> statement-breakpoint
ALTER TABLE "job_family" ADD CONSTRAINT "job_family_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "person_position" ADD CONSTRAINT "person_position_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "person_position" ADD CONSTRAINT "person_position_job_family_fk" FOREIGN KEY ("tenant_id","job_family_id") REFERENCES "job_family"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "person_position" ADD CONSTRAINT "person_position_business_function_fk" FOREIGN KEY ("tenant_id","business_function_id") REFERENCES "business_function"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "skill_profile" ADD CONSTRAINT "skill_profile_version_fk" FOREIGN KEY ("tenant_id","skill_version_id") REFERENCES "skill_version"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "skill_profile" ADD CONSTRAINT "skill_profile_job_family_fk" FOREIGN KEY ("tenant_id","job_family_id") REFERENCES "job_family"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "observer_designation" ADD CONSTRAINT "observer_designation_subject_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "observer_designation" ADD CONSTRAINT "observer_designation_observer_fk" FOREIGN KEY ("tenant_id","observer_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "observer_designation" ADD CONSTRAINT "observer_designation_designated_by_fk" FOREIGN KEY ("tenant_id","designated_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_position_fk" FOREIGN KEY ("tenant_id","subject_position_id","person_id") REFERENCES "person_position"("tenant_id","id","person_id");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_basis_designation_fk" FOREIGN KEY ("tenant_id","basis_designation_id","observer_id","subject_id") REFERENCES "observer_designation"("tenant_id","id","observer_id","subject_id");--> statement-breakpoint
ALTER TABLE "coaching_conversation" ADD CONSTRAINT "coaching_conversation_coachee_fk" FOREIGN KEY ("tenant_id","coachee_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "coaching_conversation" ADD CONSTRAINT "coaching_conversation_host_fk" FOREIGN KEY ("tenant_id","host_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "coaching_conversation" ADD CONSTRAINT "coaching_conversation_created_by_fk" FOREIGN KEY ("tenant_id","created_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "coaching_conversation" ADD CONSTRAINT "coaching_conversation_engagement_fk" FOREIGN KEY ("tenant_id","basis_engagement_id","host_id","coachee_id") REFERENCES "engagement"("tenant_id","id","coach_id","coachee_id");--> statement-breakpoint
ALTER TABLE "coaching_conversation" ADD CONSTRAINT "coaching_conversation_line_fk" FOREIGN KEY ("tenant_id","basis_reporting_line_id","host_id","coachee_id") REFERENCES "reporting_line"("tenant_id","id","manager_id","report_id");--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_owner_fk" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_created_by_fk" FOREIGN KEY ("tenant_id","created_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_observation_fk" FOREIGN KEY ("tenant_id","source_observation_id","owner_id") REFERENCES "observation"("tenant_id","id","subject_id");--> statement-breakpoint
ALTER TABLE "commitment" ADD CONSTRAINT "commitment_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id","owner_id") REFERENCES "coaching_conversation"("tenant_id","id","coachee_id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_fk" FOREIGN KEY ("tenant_id","recipient_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "plan_skill" ADD CONSTRAINT "plan_skill_profile_key_check" CHECK ("profile_key" ~ '^[a-z][a-z0-9_]{0,31}$');--> statement-breakpoint
ALTER TABLE "badge_award" ADD CONSTRAINT "badge_award_profile_key_check" CHECK ("profile_key" ~ '^[a-z][a-z0-9_]{0,31}$');--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_profile_key_check" CHECK ("profile_key" ~ '^[a-z][a-z0-9_]{0,31}$');--> statement-breakpoint
ALTER TABLE "observation_rating" ADD CONSTRAINT "observation_rating_profile_key_check" CHECK ("profile_key" ~ '^[a-z][a-z0-9_]{0,31}$');--> statement-breakpoint
ALTER TABLE "role_grant" DROP CONSTRAINT "role_grant_role_check", ADD CONSTRAINT "role_grant_role_check" CHECK ("role" in ('coach', 'catalog_keeper', 'tenant_admin', 'compliance_reviewer', 'program_owner'));--> statement-breakpoint
ALTER TABLE "observation" DROP CONSTRAINT "observation_basis_shape", ADD CONSTRAINT "observation_basis_shape" CHECK ((("basis" = 'leader') = ("basis_reporting_line_id" is not null)) and (("basis" = 'coach') = ("basis_engagement_id" is not null)) and (("basis" = 'designated') = ("basis_designation_id" is not null)));--> statement-breakpoint
ALTER TABLE "observation" DROP CONSTRAINT "observation_basis_check", ADD CONSTRAINT "observation_basis_check" CHECK ("basis" in ('leader', 'coach', 'designated'));