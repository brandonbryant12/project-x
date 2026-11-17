CREATE TABLE "business_function" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "business_function_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"entra_object_id" text,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"location" text,
	"business_function_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "person_status_check" CHECK ("status" in ('active', 'on_leave', 'departed'))
);
--> statement-breakpoint
CREATE TABLE "reporting_line" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"manager_id" text NOT NULL,
	"report_id" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" text DEFAULT 'directory' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reporting_line_parties_key" UNIQUE("tenant_id","id","manager_id","report_id"),
	CONSTRAINT "reporting_line_not_self" CHECK ("manager_id" <> "report_id"),
	CONSTRAINT "reporting_line_interval" CHECK ("valid_to" is null or "valid_to" > "valid_from")
);
--> statement-breakpoint
CREATE TABLE "role_grant" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"person_id" text NOT NULL,
	"role" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" text DEFAULT 'entra' NOT NULL,
	CONSTRAINT "role_grant_role_check" CHECK ("role" in ('coach', 'catalog_keeper', 'tenant_admin', 'compliance_reviewer'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"person_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_method_check" CHECK ("method" in ('entra', 'dev'))
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"entra_tenant_id" text,
	"time_zone" text DEFAULT 'America/New_York' NOT NULL,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_template" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"observation_tip" text,
	"typical_minutes" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_template_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "activity_template_status_check" CHECK ("status" in ('draft', 'published', 'retired', 'discarded')),
	CONSTRAINT "activity_template_kind_check" CHECK ("kind" in ('client_meeting', 'book_review', 'team_conversation', 'prospect_meeting', 'presentation', 'other'))
);
--> statement-breakpoint
CREATE TABLE "activity_template_skill" (
	"tenant_id" text NOT NULL,
	"template_id" text,
	"skill_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_template_skill_pkey" PRIMARY KEY("template_id","skill_id"),
	CONSTRAINT "activity_template_skill_position" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"domain" text NOT NULL,
	"outcome" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft_definition" jsonb,
	"current_version_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "skill_status_check" CHECK ("status" in ('draft', 'published', 'retired', 'discarded')),
	CONSTRAINT "skill_domain_check" CHECK ("domain" in ('client_discovery', 'planning_advice', 'behavioral_coaching', 'trust_integrity', 'communication', 'relationship_growth', 'leadership'))
);
--> statement-breakpoint
CREATE TABLE "skill_indicator" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"skill_version_id" text NOT NULL,
	"level" integer NOT NULL,
	"lineage_key" text NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "skill_indicator_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "skill_indicator_version_key" UNIQUE("tenant_id","skill_version_id","id")
);
--> statement-breakpoint
CREATE TABLE "skill_level" (
	"tenant_id" text NOT NULL,
	"skill_version_id" text,
	"level" integer,
	"summary" text NOT NULL,
	CONSTRAINT "skill_level_pkey" PRIMARY KEY("skill_version_id","level"),
	CONSTRAINT "skill_level_tenant_key" UNIQUE("tenant_id","skill_version_id","level"),
	CONSTRAINT "skill_level_level_check" CHECK ("level" in (1, 2, 3, 4))
);
--> statement-breakpoint
CREATE TABLE "skill_version" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"number" integer NOT NULL,
	"change_note" text,
	"published_by_id" text,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "skill_version_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "skill_version_skill_key" UNIQUE("tenant_id","skill_id","id")
);
--> statement-breakpoint
CREATE TABLE "engagement" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"coach_id" text NOT NULL,
	"coachee_id" text NOT NULL,
	"proposed_by_id" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"accepted_on" date,
	"ended_on" date,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "engagement_parties_key" UNIQUE("tenant_id","id","coach_id","coachee_id"),
	CONSTRAINT "engagement_status_check" CHECK ("status" in ('proposed', 'active', 'paused', 'ended', 'declined', 'withdrawn', 'expired')),
	CONSTRAINT "engagement_not_self" CHECK ("coach_id" <> "coachee_id"),
	CONSTRAINT "engagement_proposer_is_party" CHECK ("proposed_by_id" in ("coach_id", "coachee_id")),
	CONSTRAINT "engagement_ended_shape" CHECK (("status" = 'ended') = ("ended_on" is not null)),
	CONSTRAINT "engagement_interval" CHECK ("ended_on" is null or "ended_on" >= "accepted_on"),
	CONSTRAINT "engagement_accepted_when_live" CHECK (("status" in ('active', 'paused', 'ended')) = ("accepted_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"plan_id" text,
	"owner_id" text NOT NULL,
	"template_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"due_on" date,
	"origin" text DEFAULT 'planned' NOT NULL,
	"intended_observer_id" text,
	"intended_mode" text,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "activity_owner_key" UNIQUE("tenant_id","id","owner_id"),
	CONSTRAINT "activity_status_check" CHECK ("status" in ('planned', 'underway', 'done', 'canceled', 'expired')),
	CONSTRAINT "activity_origin_check" CHECK ("origin" in ('planned', 'ad_hoc')),
	CONSTRAINT "activity_intended_mode_check" CHECK ("intended_mode" is null or "intended_mode" in ('saw_it', 'reviewed_work', 'discussed')),
	CONSTRAINT "activity_plan_or_ad_hoc" CHECK ("plan_id" is not null or "origin" = 'ad_hoc')
);
--> statement-breakpoint
CREATE TABLE "activity_skill" (
	"tenant_id" text NOT NULL,
	"activity_id" text,
	"skill_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_skill_pkey" PRIMARY KEY("activity_id","skill_id")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"interaction_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text,
	"content_digest" text NOT NULL,
	"purged_at" timestamp with time zone,
	"status" text NOT NULL,
	"hold_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "evidence_status_check" CHECK ("status" in ('screening', 'held', 'escalated', 'available')),
	CONSTRAINT "evidence_purge_shape" CHECK (("body" is null) = ("purged_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "interaction" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"logged_by_id" text NOT NULL,
	"occurred_on" date NOT NULL,
	"kind" text NOT NULL,
	"client_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "interaction_owner_key" UNIQUE("tenant_id","id","owner_id"),
	CONSTRAINT "interaction_date_key" UNIQUE("tenant_id","id","occurred_on"),
	CONSTRAINT "interaction_kind_check" CHECK ("kind" in ('client_meeting', 'book_review', 'team_conversation', 'prospect_meeting', 'presentation', 'other')),
	CONSTRAINT "interaction_client_ref_shape" CHECK ("client_ref" is null or "client_ref" ~ '^[A-Za-z0-9_-]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"intent" text DEFAULT '' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text NOT NULL,
	"agreed_by_id" text,
	"agreed_at" timestamp with time zone,
	"endorsed_by_id" text,
	"endorsed_at" timestamp with time zone,
	"closing_summary" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "plan_owner_key" UNIQUE("tenant_id","id","owner_id"),
	CONSTRAINT "plan_status_check" CHECK ("status" in ('draft', 'proposed', 'active', 'paused', 'completed', 'canceled', 'expired')),
	CONSTRAINT "plan_period" CHECK ("period_end" > "period_start"),
	CONSTRAINT "plan_agreed_pair" CHECK (("agreed_by_id" is null) = ("agreed_at" is null)),
	CONSTRAINT "plan_not_self_agreed" CHECK ("agreed_by_id" is null or "agreed_by_id" <> "owner_id"),
	CONSTRAINT "plan_agreed_when_live" CHECK ("status" not in ('active', 'paused', 'completed') or "agreed_by_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "plan_skill" (
	"tenant_id" text NOT NULL,
	"plan_id" text,
	"skill_id" text,
	"target_level" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	CONSTRAINT "plan_skill_pkey" PRIMARY KEY("plan_id","skill_id"),
	CONSTRAINT "plan_skill_position_key" UNIQUE("plan_id","position"),
	CONSTRAINT "plan_skill_target_level_check" CHECK ("target_level" in (1, 2, 3, 4)),
	CONSTRAINT "plan_skill_outcome_check" CHECK ("outcome" is null or "outcome" in ('achieved', 'partly', 'carried_over', 'not_pursued')),
	CONSTRAINT "plan_skill_position_check" CHECK ("position" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "badge_award" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"person_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"level" integer NOT NULL,
	"status" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"triggering_observation_id" text NOT NULL,
	"awarded_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_reversal_id" text,
	CONSTRAINT "badge_award_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "badge_award_status_check" CHECK ("status" in ('awarded', 'revoked')),
	CONSTRAINT "badge_award_level_check" CHECK ("level" in (2, 3)),
	CONSTRAINT "badge_award_revoked_shape" CHECK (("status" = 'revoked') = ("revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "badge_award_credit" (
	"tenant_id" text NOT NULL,
	"badge_award_id" text,
	"credit_entry_id" text,
	CONSTRAINT "badge_award_credit_pkey" PRIMARY KEY("badge_award_id","credit_entry_id")
);
--> statement-breakpoint
CREATE TABLE "badge_waiver" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"person_id" text NOT NULL,
	"criterion" text NOT NULL,
	"granted_by_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badge_waiver_criterion_check" CHECK ("criterion" in ('observers', 'firstHand')),
	CONSTRAINT "badge_waiver_not_self" CHECK ("person_id" <> "granted_by_id")
);
--> statement-breakpoint
CREATE TABLE "credit_entry" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"person_id" text NOT NULL,
	"skill_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"interaction_id" text NOT NULL,
	"observer_id" text NOT NULL,
	"skill_version_id" text NOT NULL,
	"level" integer NOT NULL,
	"mode" text NOT NULL,
	"is_first_hand" boolean NOT NULL,
	"demonstrated_on" date NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_entry_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "credit_entry_one_per_observation_skill" UNIQUE("observation_id","skill_id"),
	CONSTRAINT "credit_entry_level_check" CHECK ("level" in (1, 2, 3, 4)),
	CONSTRAINT "credit_entry_mode_check" CHECK ("mode" in ('saw_it', 'reviewed_work', 'discussed')),
	CONSTRAINT "credit_entry_first_hand" CHECK ("is_first_hand" = ("mode" <> 'discussed')),
	CONSTRAINT "credit_entry_not_self" CHECK ("person_id" <> "observer_id")
);
--> statement-breakpoint
CREATE TABLE "credit_reversal" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"credit_entry_id" text NOT NULL CONSTRAINT "credit_reversal_one_per_credit" UNIQUE,
	"reversed_by_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observation" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"interaction_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"observer_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"basis" text NOT NULL,
	"basis_reporting_line_id" text,
	"basis_engagement_id" text,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"narrative_saw" text,
	"narrative_next" text,
	"content_digest" text,
	"purged_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"signed_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observation_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "observation_parties_key" UNIQUE("tenant_id","id","subject_id","observer_id","interaction_id"),
	CONSTRAINT "observation_basis_shape" CHECK ((("basis" = 'leader') = ("basis_reporting_line_id" is not null)) and (("basis" = 'coach') = ("basis_engagement_id" is not null))),
	CONSTRAINT "observation_status_check" CHECK ("status" in ('requested', 'drafting', 'returned', 'signed', 'under_review', 'declined', 'withdrawn', 'expired', 'voided')),
	CONSTRAINT "observation_basis_check" CHECK ("basis" in ('leader', 'coach')),
	CONSTRAINT "observation_mode_check" CHECK ("mode" in ('saw_it', 'reviewed_work', 'discussed')),
	CONSTRAINT "observation_not_self" CHECK ("subject_id" <> "observer_id"),
	CONSTRAINT "observation_signed_at" CHECK (("status" in ('signed', 'under_review', 'voided')) = ("signed_at" is not null)),
	CONSTRAINT "observation_signed_digest" CHECK ("signed_at" is null or "content_digest" is not null)
);
--> statement-breakpoint
CREATE TABLE "observation_indicator" (
	"tenant_id" text NOT NULL,
	"observation_id" text,
	"skill_id" text NOT NULL,
	"skill_version_id" text NOT NULL,
	"indicator_id" text,
	"suggested" boolean DEFAULT false NOT NULL,
	CONSTRAINT "observation_indicator_pkey" PRIMARY KEY("observation_id","indicator_id")
);
--> statement-breakpoint
CREATE TABLE "observation_rating" (
	"tenant_id" text NOT NULL,
	"observation_id" text,
	"skill_id" text,
	"skill_version_id" text NOT NULL,
	"level" integer,
	"credit" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "observation_rating_pkey" PRIMARY KEY("observation_id","skill_id"),
	CONSTRAINT "observation_rating_pinned_key" UNIQUE("tenant_id","observation_id","skill_id","skill_version_id"),
	CONSTRAINT "observation_rating_position_key" UNIQUE("observation_id","position"),
	CONSTRAINT "observation_rating_level" CHECK ("level" is null or "level" between 1 and 4),
	CONSTRAINT "observation_rating_position" CHECK ("position" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "advisory_check" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"question_set" text NOT NULL,
	"question_set_version" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_version" integer NOT NULL,
	"arm" text DEFAULT 'shown' NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"input_digest" text NOT NULL,
	"questions_digest" text NOT NULL,
	"answers" jsonb,
	"thresholds" jsonb DEFAULT '{}' NOT NULL,
	"result" jsonb,
	"effect" text,
	"rationale" text,
	"failure" text,
	"input_tokens" integer,
	"cost_usd_micros" integer,
	"latency_ms" integer,
	"trace_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "advisory_check_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "advisory_check_subject_type_check" CHECK ("subject_type" in ('evidence', 'observation', 'interaction')),
	CONSTRAINT "advisory_check_status_check" CHECK ("status" in ('pending', 'completed', 'failed', 'skipped')),
	CONSTRAINT "advisory_check_question_set_check" CHECK ("question_set" in ('privacy-screen', 'narrative-indicators', 'narrative-quality', 'mode-consistency', 'skill-suggest')),
	CONSTRAINT "advisory_check_arm_check" CHECK ("arm" in ('shown', 'shadow')),
	CONSTRAINT "advisory_check_provider_check" CHECK ("provider" in ('google', 'mock', 'disabled', 'local')),
	CONSTRAINT "advisory_check_effect_check" CHECK ("effect" is null or "effect" in ('hold', 'escalate', 'nudge', 'none'))
);
--> statement-breakpoint
CREATE TABLE "advisory_disposition" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"check_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"disposition" text NOT NULL,
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisory_disposition_value_check" CHECK ("disposition" in ('agreed', 'overrode', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "advisory_exposure" (
	"tenant_id" text NOT NULL,
	"check_id" text,
	"viewer_id" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"expanded" boolean DEFAULT false NOT NULL,
	CONSTRAINT "advisory_exposure_pkey" PRIMARY KEY("check_id","viewer_id")
);
--> statement-breakpoint
CREATE TABLE "advisory_label" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"check_id" text NOT NULL,
	"question_key" text NOT NULL,
	"question_set" text NOT NULL,
	"question_set_version" integer NOT NULL,
	"model_probability" double precision,
	"threshold" double precision,
	"label_value" text NOT NULL,
	"source" text NOT NULL,
	"strength" text NOT NULL,
	"arm" text NOT NULL,
	"labeler_id" text,
	"labeler_role" text,
	"input_entity_type" text NOT NULL,
	"input_entity_id" text NOT NULL,
	"input_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advisory_label_once" UNIQUE("tenant_id","check_id","question_key","source"),
	CONSTRAINT "advisory_label_source_check" CHECK ("source" in ('tick_kept', 'tick_removed', 'skill_final', 'hold_released', 'hold_revised', 'reported_miss', 'mode_changed', 'mode_kept', 'second_read')),
	CONSTRAINT "advisory_label_strength_check" CHECK ("strength" in ('gold', 'silver', 'weak')),
	CONSTRAINT "advisory_label_arm_check" CHECK ("arm" in ('shown', 'shadow')),
	CONSTRAINT "advisory_label_question_set_check" CHECK ("question_set" in ('privacy-screen', 'narrative-indicators', 'narrative-quality', 'mode-consistency', 'skill-suggest'))
);
--> statement-breakpoint
CREATE TABLE "advisory_question_snapshot" (
	"digest" text PRIMARY KEY,
	"questions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_set_release" (
	"id" text PRIMARY KEY,
	"question_set" text NOT NULL,
	"set_version" integer NOT NULL,
	"template_digest" text NOT NULL,
	"thresholds" jsonb NOT NULL,
	"effect" text NOT NULL,
	"dataset_ref" text,
	"experiment_ref" text,
	"metrics" jsonb,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_set_release_version_key" UNIQUE("question_set","set_version"),
	CONSTRAINT "question_set_release_set_check" CHECK ("question_set" in ('privacy-screen', 'narrative-indicators', 'narrative-quality', 'mode-consistency', 'skill-suggest')),
	CONSTRAINT "question_set_release_effect_check" CHECK ("effect" in ('hold', 'escalate', 'nudge'))
);
--> statement-breakpoint
CREATE TABLE "second_read" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"observation_id" text NOT NULL,
	"reader_id" text NOT NULL,
	"assigned_reason" text NOT NULL,
	"narrative_specific" boolean,
	"status" text DEFAULT 'assigned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "second_read_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "second_read_reason_check" CHECK ("assigned_reason" in ('random', 'model_disagreement', 'new_observer')),
	CONSTRAINT "second_read_status_check" CHECK ("status" in ('assigned', 'completed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "second_read_rating" (
	"tenant_id" text NOT NULL,
	"second_read_id" text,
	"skill_id" text,
	"level" integer NOT NULL,
	CONSTRAINT "second_read_rating_pkey" PRIMARY KEY("second_read_id","skill_id"),
	CONSTRAINT "second_read_rating_level" CHECK ("level" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" text PRIMARY KEY,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_event_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" text NOT NULL,
	"actor_id" text,
	"auth_method" text,
	"request_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"event" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"reason_code" text,
	"note_id" text,
	"policy_version" text,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_reason_code_check" CHECK ("reason_code" is null or "reason_code" in ('note', 'privacy_local', 'privacy_assistant', 'assistant_unavailable', 'expired', 'directory_change', 'admin_release', 'compliance_resolution', 'data_correction'))
);
--> statement-breakpoint
CREATE TABLE "legal_hold" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"person_id" text NOT NULL,
	"placed_by_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "note" (
	"id" text PRIMARY KEY,
	"tenant_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text,
	"content_digest" text NOT NULL,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_kind_check" CHECK ("kind" in ('request', 'return', 'decline', 'review', 'void', 'uphold', 'release', 'resolve')),
	CONSTRAINT "note_purge_shape" CHECK (("body" is null) = ("purged_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "business_function_tenant_name_unique" ON "business_function" ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "person_tenant_email_unique" ON "person" ("tenant_id",lower("email")) WHERE "status" <> 'departed';--> statement-breakpoint
CREATE UNIQUE INDEX "person_tenant_entra_unique" ON "person" ("tenant_id","entra_object_id") WHERE "entra_object_id" is not null;--> statement-breakpoint
CREATE INDEX "person_tenant_name_idx" ON "person" ("tenant_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_line_one_open_per_report" ON "reporting_line" ("tenant_id","report_id") WHERE "valid_to" is null;--> statement-breakpoint
CREATE INDEX "reporting_line_manager_idx" ON "reporting_line" ("tenant_id","manager_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_grant_one_open" ON "role_grant" ("tenant_id","person_id","role") WHERE "valid_to" is null;--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_unique" ON "session" ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slug_unique" ON "tenant" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_entra_tenant_id_unique" ON "tenant" ("entra_tenant_id") WHERE "entra_tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_template_tenant_slug_unique" ON "activity_template" ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_tenant_slug_unique" ON "skill" ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_indicator_lineage_unique" ON "skill_indicator" ("skill_version_id","lineage_key");--> statement-breakpoint
CREATE INDEX "skill_indicator_lineage_idx" ON "skill_indicator" ("tenant_id","lineage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_version_number_unique" ON "skill_version" ("skill_id","number");--> statement-breakpoint
CREATE INDEX "engagement_expiry_idx" ON "engagement" ("status","expires_at");--> statement-breakpoint
CREATE INDEX "engagement_coachee_idx" ON "engagement" ("tenant_id","coachee_id");--> statement-breakpoint
CREATE INDEX "engagement_coach_idx" ON "engagement" ("tenant_id","coach_id");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_open_pair_unique" ON "engagement" ("tenant_id","coach_id","coachee_id") WHERE "status" in ('proposed', 'active', 'paused');--> statement-breakpoint
CREATE INDEX "activity_plan_idx" ON "activity" ("tenant_id","plan_id");--> statement-breakpoint
CREATE INDEX "activity_owner_idx" ON "activity" ("tenant_id","owner_id");--> statement-breakpoint
CREATE INDEX "evidence_interaction_idx" ON "evidence" ("tenant_id","interaction_id");--> statement-breakpoint
CREATE INDEX "evidence_status_idx" ON "evidence" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "interaction_activity_idx" ON "interaction" ("tenant_id","activity_id");--> statement-breakpoint
CREATE INDEX "interaction_owner_idx" ON "interaction" ("tenant_id","owner_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_one_current_per_owner" ON "plan" ("tenant_id","owner_id") WHERE "status" in ('draft', 'proposed', 'active', 'paused');--> statement-breakpoint
CREATE INDEX "plan_period_end_idx" ON "plan" ("status","period_end");--> statement-breakpoint
CREATE INDEX "plan_skill_skill_idx" ON "plan_skill" ("tenant_id","skill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "badge_award_one_active" ON "badge_award" ("tenant_id","person_id","skill_id","level") WHERE "status" = 'awarded';--> statement-breakpoint
CREATE INDEX "badge_award_skill_idx" ON "badge_award" ("tenant_id","skill_id","status");--> statement-breakpoint
CREATE INDEX "credit_entry_person_skill_idx" ON "credit_entry" ("tenant_id","person_id","skill_id");--> statement-breakpoint
CREATE INDEX "credit_entry_observer_idx" ON "credit_entry" ("tenant_id","observer_id","created_at");--> statement-breakpoint
CREATE INDEX "observation_inbox_idx" ON "observation" ("tenant_id","observer_id","due_at") WHERE "status" in ('requested', 'drafting');--> statement-breakpoint
CREATE INDEX "observation_observer_idx" ON "observation" ("tenant_id","observer_id","status");--> statement-breakpoint
CREATE INDEX "observation_subject_idx" ON "observation" ("tenant_id","subject_id","status");--> statement-breakpoint
CREATE INDEX "observation_interaction_idx" ON "observation" ("tenant_id","interaction_id");--> statement-breakpoint
CREATE INDEX "observation_due_idx" ON "observation" ("status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "observation_live_per_observer" ON "observation" ("interaction_id","observer_id") WHERE "status" in ('requested', 'drafting', 'returned', 'signed', 'under_review');--> statement-breakpoint
CREATE INDEX "observation_indicator_indicator_idx" ON "observation_indicator" ("tenant_id","indicator_id");--> statement-breakpoint
CREATE INDEX "observation_rating_skill_idx" ON "observation_rating" ("tenant_id","skill_id");--> statement-breakpoint
CREATE INDEX "advisory_check_subject_idx" ON "advisory_check" ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "advisory_check_usage_idx" ON "advisory_check" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "advisory_disposition_check_idx" ON "advisory_disposition" ("tenant_id","check_id");--> statement-breakpoint
CREATE INDEX "advisory_label_set_idx" ON "advisory_label" ("question_set","question_set_version","created_at");--> statement-breakpoint
CREATE INDEX "second_read_reader_idx" ON "second_read" ("tenant_id","reader_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_event_seq_unique" ON "audit_event" ("seq");--> statement-breakpoint
CREATE INDEX "audit_event_tenant_seq_idx" ON "audit_event" ("tenant_id","seq");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" ("tenant_id","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "legal_hold_person_idx" ON "legal_hold" ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "note_entity_idx" ON "note" ("tenant_id","entity_type","entity_id","created_at");--> statement-breakpoint
ALTER TABLE "business_function" ADD CONSTRAINT "business_function_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_business_function_fk" FOREIGN KEY ("tenant_id","business_function_id") REFERENCES "business_function"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "reporting_line" ADD CONSTRAINT "reporting_line_manager_fk" FOREIGN KEY ("tenant_id","manager_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "reporting_line" ADD CONSTRAINT "reporting_line_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "role_grant" ADD CONSTRAINT "role_grant_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "activity_template" ADD CONSTRAINT "activity_template_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "activity_template_skill" ADD CONSTRAINT "activity_template_skill_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "activity_template"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "activity_template_skill" ADD CONSTRAINT "activity_template_skill_skill_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "skill"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "skill_indicator" ADD CONSTRAINT "skill_indicator_level_fk" FOREIGN KEY ("tenant_id","skill_version_id","level") REFERENCES "skill_level"("tenant_id","skill_version_id","level");--> statement-breakpoint
ALTER TABLE "skill_level" ADD CONSTRAINT "skill_level_version_fk" FOREIGN KEY ("tenant_id","skill_version_id") REFERENCES "skill_version"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_skill_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "skill"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_published_by_fk" FOREIGN KEY ("tenant_id","published_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_coach_fk" FOREIGN KEY ("tenant_id","coach_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_coachee_fk" FOREIGN KEY ("tenant_id","coachee_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_proposed_by_fk" FOREIGN KEY ("tenant_id","proposed_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_plan_owner_fk" FOREIGN KEY ("tenant_id","plan_id","owner_id") REFERENCES "plan"("tenant_id","id","owner_id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "activity_template"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_owner_fk" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_intended_observer_fk" FOREIGN KEY ("tenant_id","intended_observer_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "activity_skill" ADD CONSTRAINT "activity_skill_activity_fk" FOREIGN KEY ("tenant_id","activity_id") REFERENCES "activity"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "activity_skill" ADD CONSTRAINT "activity_skill_skill_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "skill"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_interaction_fk" FOREIGN KEY ("tenant_id","interaction_id") REFERENCES "interaction"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_activity_owner_fk" FOREIGN KEY ("tenant_id","activity_id","owner_id") REFERENCES "activity"("tenant_id","id","owner_id");--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_owner_fk" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "interaction" ADD CONSTRAINT "interaction_logged_by_fk" FOREIGN KEY ("tenant_id","logged_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_owner_fk" FOREIGN KEY ("tenant_id","owner_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_agreed_by_fk" FOREIGN KEY ("tenant_id","agreed_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_endorsed_by_fk" FOREIGN KEY ("tenant_id","endorsed_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "plan_skill" ADD CONSTRAINT "plan_skill_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "plan"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "plan_skill" ADD CONSTRAINT "plan_skill_skill_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "skill"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "badge_award" ADD CONSTRAINT "badge_award_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "badge_award" ADD CONSTRAINT "badge_award_skill_fk" FOREIGN KEY ("tenant_id","skill_id") REFERENCES "skill"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "badge_award" ADD CONSTRAINT "badge_award_trigger_fk" FOREIGN KEY ("tenant_id","triggering_observation_id") REFERENCES "observation"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "badge_award_credit" ADD CONSTRAINT "badge_award_credit_award_fk" FOREIGN KEY ("tenant_id","badge_award_id") REFERENCES "badge_award"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "badge_award_credit" ADD CONSTRAINT "badge_award_credit_credit_fk" FOREIGN KEY ("tenant_id","credit_entry_id") REFERENCES "credit_entry"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "badge_waiver" ADD CONSTRAINT "badge_waiver_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "badge_waiver" ADD CONSTRAINT "badge_waiver_granted_by_fk" FOREIGN KEY ("tenant_id","granted_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_observation_fk" FOREIGN KEY ("tenant_id","observation_id","person_id","observer_id","interaction_id") REFERENCES "observation"("tenant_id","id","subject_id","observer_id","interaction_id");--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_rating_fk" FOREIGN KEY ("tenant_id","observation_id","skill_id","skill_version_id") REFERENCES "observation_rating"("tenant_id","observation_id","skill_id","skill_version_id");--> statement-breakpoint
ALTER TABLE "credit_entry" ADD CONSTRAINT "credit_entry_interaction_fk" FOREIGN KEY ("tenant_id","interaction_id","demonstrated_on") REFERENCES "interaction"("tenant_id","id","occurred_on");--> statement-breakpoint
ALTER TABLE "credit_reversal" ADD CONSTRAINT "credit_reversal_credit_fk" FOREIGN KEY ("tenant_id","credit_entry_id") REFERENCES "credit_entry"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "credit_reversal" ADD CONSTRAINT "credit_reversal_actor_fk" FOREIGN KEY ("tenant_id","reversed_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_subject_owns_interaction_fk" FOREIGN KEY ("tenant_id","interaction_id","subject_id") REFERENCES "interaction"("tenant_id","id","owner_id");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_observer_fk" FOREIGN KEY ("tenant_id","observer_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_basis_line_fk" FOREIGN KEY ("tenant_id","basis_reporting_line_id","observer_id","subject_id") REFERENCES "reporting_line"("tenant_id","id","manager_id","report_id");--> statement-breakpoint
ALTER TABLE "observation" ADD CONSTRAINT "observation_basis_engagement_fk" FOREIGN KEY ("tenant_id","basis_engagement_id","observer_id","subject_id") REFERENCES "engagement"("tenant_id","id","coach_id","coachee_id");--> statement-breakpoint
ALTER TABLE "observation_indicator" ADD CONSTRAINT "observation_indicator_rating_fk" FOREIGN KEY ("tenant_id","observation_id","skill_id","skill_version_id") REFERENCES "observation_rating"("tenant_id","observation_id","skill_id","skill_version_id");--> statement-breakpoint
ALTER TABLE "observation_indicator" ADD CONSTRAINT "observation_indicator_indicator_fk" FOREIGN KEY ("tenant_id","skill_version_id","indicator_id") REFERENCES "skill_indicator"("tenant_id","skill_version_id","id");--> statement-breakpoint
ALTER TABLE "observation_rating" ADD CONSTRAINT "observation_rating_observation_fk" FOREIGN KEY ("tenant_id","observation_id") REFERENCES "observation"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "observation_rating" ADD CONSTRAINT "observation_rating_version_fk" FOREIGN KEY ("tenant_id","skill_id","skill_version_id") REFERENCES "skill_version"("tenant_id","skill_id","id");--> statement-breakpoint
ALTER TABLE "advisory_check" ADD CONSTRAINT "advisory_check_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "advisory_check" ADD CONSTRAINT "advisory_check_release_fk" FOREIGN KEY ("question_set","question_set_version") REFERENCES "question_set_release"("question_set","set_version");--> statement-breakpoint
ALTER TABLE "advisory_check" ADD CONSTRAINT "advisory_check_questions_fk" FOREIGN KEY ("questions_digest") REFERENCES "advisory_question_snapshot"("digest");--> statement-breakpoint
ALTER TABLE "advisory_disposition" ADD CONSTRAINT "advisory_disposition_check_fk" FOREIGN KEY ("tenant_id","check_id") REFERENCES "advisory_check"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "advisory_disposition" ADD CONSTRAINT "advisory_disposition_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "advisory_exposure" ADD CONSTRAINT "advisory_exposure_check_fk" FOREIGN KEY ("tenant_id","check_id") REFERENCES "advisory_check"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "advisory_exposure" ADD CONSTRAINT "advisory_exposure_viewer_fk" FOREIGN KEY ("tenant_id","viewer_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "advisory_label" ADD CONSTRAINT "advisory_label_check_fk" FOREIGN KEY ("tenant_id","check_id") REFERENCES "advisory_check"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "advisory_label" ADD CONSTRAINT "advisory_label_labeler_fk" FOREIGN KEY ("tenant_id","labeler_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "second_read" ADD CONSTRAINT "second_read_observation_fk" FOREIGN KEY ("tenant_id","observation_id") REFERENCES "observation"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "second_read" ADD CONSTRAINT "second_read_reader_fk" FOREIGN KEY ("tenant_id","reader_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "second_read_rating" ADD CONSTRAINT "second_read_rating_read_fk" FOREIGN KEY ("tenant_id","second_read_id") REFERENCES "second_read"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "legal_hold" ADD CONSTRAINT "legal_hold_person_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "legal_hold" ADD CONSTRAINT "legal_hold_placed_by_fk" FOREIGN KEY ("tenant_id","placed_by_id") REFERENCES "person"("tenant_id","id");--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_author_fk" FOREIGN KEY ("tenant_id","author_id") REFERENCES "person"("tenant_id","id");